// ============================================================
// DeepSeek AI Client — book classification, summary, retry logic
// ============================================================

import { AITagResult } from './models';
import { estimateTokens, TOKEN_BUDGET, formatCost } from './utils/token-estimator';
import { AIError, NetworkError, generateCorrelationId } from './errors';
import { Logger, NOOP_LOGGER } from './logger';

// ---- Types ----

export interface AIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

interface ChatCompletionResponse {
  choices: Array<{ message: { content: string } }>;
  usage?: { total_tokens: number; prompt_tokens: number; completion_tokens: number };
}

// ---- Retry with exponential backoff ----

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_TIMEOUT_MS = 30_000;

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = DEFAULT_MAX_RETRIES,
  baseDelay: number = DEFAULT_BASE_DELAY_MS,
  timeout: number = DEFAULT_TIMEOUT_MS,
  logger: Logger = NOOP_LOGGER,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Retry on rate limit (429) and server errors (5xx)
      if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 500;
        logger.warn(`AI API retry (${attempt}/${maxRetries})`, {
          status: response.status,
          delayMs: Math.round(delay),
        });
        await sleep(delay);
        continue;
      }

      return response;
    } catch (err) {
      lastError = err as Error;

      if ((err as Error).name === 'AbortError') {
        throw new NetworkError(
          `AI API timeout after ${timeout}ms`,
          generateCorrelationId(),
          { url },
        );
      }

      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        logger.warn(`AI API network retry (${attempt}/${maxRetries})`, {
          error: String(err),
          delayMs: Math.round(delay),
        });
        await sleep(delay);
      }
    }
  }

  throw new NetworkError(
    `AI API request failed after ${maxRetries} retries: ${String(lastError)}`,
    generateCorrelationId(),
    { url },
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---- Prompt builders ----

function buildTaggingPrompt(
  title: string,
  author: string | null,
  textSnippet: string,
  directoryHint?: string,
): string {
  const snippet = textSnippet.slice(0, TOKEN_BUDGET.TAGGING_MAX_INPUT);
  const preview = snippet.slice(0, TOKEN_BUDGET.TAGGING_MAX_PREVIEW);
  const hasText = snippet.trim().length > 20;
  const hintLine = directoryHint ? `\n- Directory hint: ${directoryHint} (reference only)` : '';

  if (hasText) {
    return `You are a book classifier. Output ONLY valid JSON, no other text.

Book info:
- Title: ${title}${author ? `\n- Author: ${author}` : ''}${hintLine}
- Content preview: ${preview}

First, identify this book from your training data. Then classify.
Return exactly:
{"title":"${title}","author":${author ? `"${author}"` : 'null'},"tags":["tag1","tag2","tag3","tag4","tag5"],"category":"科幻"}

Rules:
- tags: EXACTLY 3 broad, generic Chinese tags (e.g. "科幻","物理学","文明")
  Use general concepts only ("股票" not "股票投资") to prevent tag fragmentation
- category: single broad category, pick ONE from:
  文学, 科幻, 推理悬疑, 历史, 哲学, 心理学, 社会学, 经济学, 管理学, 编程, 人工智能, 数学, 物理学, 生物学, 医学, 法律, 政治, 教育, 艺术, 设计, 传记, 商业, 科普, 宗教, 技术
- Tags must match the UI language (all Chinese, even for foreign books)
- category is NOT included in tags`;
  }

  return `You are a book classifier. Identify this book from your training data. Output ONLY valid JSON.

Book:
- Title: ${title}${author ? `\n- Author: ${author}` : ''}${hintLine}
- No text content available. Classify based on your knowledge of this book.

Return exactly:
{"title":"${title}","author":${author ? `"${author}"` : 'null'},"tags":["tag1","tag2","tag3"],"category":"科幻"}

Rules:
- Tags must match the UI language (all Chinese, even for foreign books)
- tags: EXACTLY 3 broad, generic tags. Use general concepts ("股票" not "股票投资") to prevent tag fragmentation
- category: pick ONE from: 文学, 科幻, 推理悬疑, 历史, 哲学, 心理学, 社会学, 经济学, 管理学, 编程, 人工智能, 数学, 物理学, 生物学, 医学, 法律, 政治, 教育, 艺术, 设计, 传记, 商业, 科普, 宗教, 技术
- If you don't know this book, use the title and directory hint to make your best guess`;
}

function buildSummaryPrompt(title: string, author: string | null, fullPreviewText: string): string {
  const text = fullPreviewText.slice(0, TOKEN_BUDGET.SUMMARY_MAX_INPUT);

  return `Write a concise book summary (~200 Chinese characters). Include: what the book is about, who it's for, and the main takeaway.

Title: ${title}${author ? `\nAuthor: ${author}` : ''}

Book content preview:
${text}

Summary (200 chars, in Chinese):`;
}

// ---- Public API ----

export async function classifyBook(
  config: AIConfig,
  title: string,
  author: string | null,
  textSnippet: string,
  logger: Logger = NOOP_LOGGER,
  directoryHint?: string,
): Promise<{ result: AITagResult; tokenUsed: number }> {
  const cid = generateCorrelationId();

  if (!config.apiKey) {
    throw new AIError('API key is not configured', cid, { title });
  }

  const prompt = buildTaggingPrompt(title, author, textSnippet, directoryHint);
  const inputTokens = estimateTokens(prompt);

  const response = await fetchWithRetry(
    `${config.baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: '你是一个严谨的图书分类器。只能基于提供的书籍内容进行分类。绝不编造、猜测或给出无法验证的信息。只输出合法 JSON。' },
          { role: 'user', content: prompt },
        ] as ChatMessage[],
        temperature: 0.3,
        max_tokens: TOKEN_BUDGET.TAGGING_MAX_OUTPUT,
        response_format: { type: 'json_object' },
      }),
    },
    DEFAULT_MAX_RETRIES,
    DEFAULT_BASE_DELAY_MS,
    DEFAULT_TIMEOUT_MS,
    logger,
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown');
    throw new AIError(
      `API error (${response.status}): ${errorText.slice(0, 200)}`,
      cid,
      { status: response.status, title },
    );
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new AIError('API returned empty response', cid, { title });
  }

  // Parse and validate JSON
  let parsed: AITagResult;
  try {
    parsed = JSON.parse(content) as AITagResult;
  } catch {
    throw new AIError(
      `Invalid JSON from API: ${content.slice(0, 200)}`,
      cid,
      { title },
    );
  }

  if (!parsed.tags || !Array.isArray(parsed.tags)) {
    throw new AIError(
      `Response missing tags array: ${content.slice(0, 200)}`,
      cid,
      { title },
    );
  }

  // Normalize
  parsed.tags = [...new Set(parsed.tags.map(t => t.trim()).filter(Boolean))].slice(0, 3);
  parsed.title = parsed.title || title;
  parsed.category = parsed.category || null;

  const totalTokens = data.usage?.total_tokens ?? inputTokens + estimateTokens(content);

  logger.info('Book classified', {
    title: parsed.title,
    tags: parsed.tags,
    tokenUsed: totalTokens,
  });

  return { result: parsed, tokenUsed: totalTokens };
}

export async function generateSummary(
  config: AIConfig,
  title: string,
  author: string | null,
  fullPreviewText: string,
  logger: Logger = NOOP_LOGGER,
): Promise<{ summary: string; tokenUsed: number }> {
  const cid = generateCorrelationId();

  if (!config.apiKey) {
    throw new AIError('API key is not configured', cid, { title });
  }

  const prompt = buildSummaryPrompt(title, author, fullPreviewText);
  const inputTokens = estimateTokens(prompt);

  const response = await fetchWithRetry(
    `${config.baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: '你是一个严谨的书籍总结者。只能基于提供的书籍内容进行提炼，绝不编造任何信息。如果提供的内容不足以写出准确总结，明确说明信息来源不足。用中文输出。' },
          { role: 'user', content: prompt },
        ] as ChatMessage[],
        temperature: 0.5,
        max_tokens: TOKEN_BUDGET.SUMMARY_MAX_OUTPUT,
      }),
    },
    DEFAULT_MAX_RETRIES,
    DEFAULT_BASE_DELAY_MS,
    DEFAULT_TIMEOUT_MS,
    logger,
  );

  if (!response.ok) {
    throw new AIError(
      `API error (${response.status})`,
      cid,
      { title },
    );
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const summary = data.choices?.[0]?.message?.content?.trim() || '';
  const totalTokens = data.usage?.total_tokens ?? inputTokens + estimateTokens(summary);

  logger.info('Summary generated', { title, tokenUsed: totalTokens });

  return { summary, tokenUsed: totalTokens };
}

/**
 * Generate a book's table of contents (chapter titles only, no chapter content).
 */
export async function generateTOC(
  config: AIConfig,
  title: string,
  author: string | null,
  fullPreviewText: string,
  logger: Logger = NOOP_LOGGER,
): Promise<{ toc: string; tokenUsed: number }> {
  const cid = generateCorrelationId();
  if (!config.apiKey) throw new AIError('API key is not configured', cid, { title });

  const text = fullPreviewText.slice(0, TOKEN_BUDGET.OUTLINE_MAX_INPUT);

  const prompt = `Analyze this book and generate its table of contents. Output ONLY the chapter list in Markdown format.

Title: ${title}${author ? `\nAuthor: ${author}` : ''}

Book content:
${text}

Format — plain chapter list (NO markers, NO content):
- 第1章：章节标题
- 第2章：章节标题

Rules:
- Extract real chapter titles from the book text
- Do NOT generate chapter content, only titles
- Do NOT add any markers or labels — just clean chapter titles
- Write chapter titles in Chinese`;

  const response = await fetchWithRetry(
    `${config.baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: '你是一个严谨的目录提取者。只能基于提供的书籍内容提取章节结构，绝不编造章节标题或顺序。如果内容不足以提取完整目录，只列出已确认的部分。输出干净的 Markdown 列表。' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: TOKEN_BUDGET.OUTLINE_MAX_OUTPUT,
      }),
    },
  );
  if (!response.ok) throw new AIError(`TOC generation failed (${response.status})`, cid);
  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { total_tokens: number };
  };
  const toc = data.choices?.[0]?.message?.content?.trim() || '';
  const totalTokens = data.usage?.total_tokens ?? estimateTokens(prompt) + estimateTokens(toc);
  logger.info('TOC generated', { title, tokenUsed: totalTokens });
  return { toc, tokenUsed: totalTokens };
}

/**
 * Generate detailed content for a single chapter.
 */
export async function generateChapterContent(
  config: AIConfig,
  title: string,
  chapterTitle: string,
  chapterText: string,
  logger: Logger = NOOP_LOGGER,
): Promise<{ content: string; tokenUsed: number }> {
  const cid = generateCorrelationId();
  if (!config.apiKey) throw new AIError('API key is not configured', cid, { title });

  const text = chapterText.slice(0, TOKEN_BUDGET.CHAPTER_MAX_INPUT);

  const prompt = `Write detailed notes for this chapter of the book.

Book: ${title}
Chapter: ${chapterTitle}

Chapter content:
${text}

Write in Chinese. Include:
- Core concepts introduced
- Key arguments or events
- Important takeaways
- Notable quotes if any

Keep it under 500 words.`;

  const response = await fetchWithRetry(
    `${config.baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: '你是一个严谨的章节分析者。只能基于提供的章节内容进行分析和总结，绝不编造、臆测或补充原文中没有的信息。如果内容不足，明确指出。用中文输出。' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.5,
        max_tokens: TOKEN_BUDGET.CHAPTER_MAX_OUTPUT,
      }),
    },
  );
  if (!response.ok) throw new AIError(`Chapter generation failed (${response.status})`, cid);
  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { total_tokens: number };
  };
  const content = data.choices?.[0]?.message?.content?.trim() || '';
  const totalTokens = data.usage?.total_tokens ?? estimateTokens(prompt) + estimateTokens(content);
  logger.info('Chapter content generated', { title, chapter: chapterTitle, tokenUsed: totalTokens });
  return { content, tokenUsed: totalTokens };
}

// ---- Verification (POC compatibility) ----

/**
 * Batch classify multiple books at once — sends all titles in one API call.
 * Used for second-pass classification of books that failed first pass.
 */
export async function batchClassifyBooks(
  config: AIConfig,
  books: Array<{ title: string; author: string | null }>,
  categories: readonly string[],
  logger: Logger = NOOP_LOGGER,
): Promise<Map<string, string>> {
  const cid = generateCorrelationId();

  if (!config.apiKey) {
    throw new AIError('API key is not configured', cid);
  }

  const bookList = books.map((b, i) => `${i + 1}. ${b.title}${b.author ? ` - ${b.author}` : ''}`).join('\n');
  const catList = categories.join(', ');

  const prompt = `Classify each book into exactly ONE category from the list below.

Categories: ${catList}

Books:
${bookList}

Return ONLY valid JSON: {"results":[{"index":1,"category":"科幻"},...]}
Every book MUST get a category. Pick the best fit.`;

  const response = await fetchWithRetry(
    `${config.baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: '你是一个严谨的图书分类器。只能基于提供的书籍内容进行分类。绝不编造、猜测或给出无法验证的信息。只输出合法 JSON。' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: books.length * 30,
        response_format: { type: 'json_object' },
      }),
    },
  );

  if (!response.ok) {
    throw new AIError(`Batch classify failed (${response.status})`, cid);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { total_tokens: number };
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new AIError('Batch classify empty response', cid);

  const parsed = JSON.parse(content) as { results: Array<{ index: number; category: string }> };
  const result = new Map<string, string>();

  for (const item of parsed.results || []) {
    const book = books[item.index - 1];
    if (book) {
      result.set(book.title, item.category);
    }
  }

  logger.info('Batch classification complete', {
    total: books.length,
    classified: result.size,
    tokenUsed: data.usage?.total_tokens,
  });

  return result;
}

/**
 * Fuzzy match a raw category string to the closest predefined category using AI.
 */
export async function fuzzyMatchCategory(
  config: AIConfig,
  rawCategory: string,
  categories: readonly string[],
  logger: Logger = NOOP_LOGGER,
): Promise<string | null> {
  const cid = generateCorrelationId();
  const catList = categories.join(', ');

  const prompt = `Map the following description to the SINGLE closest category from the list.

Description: "${rawCategory}"
Categories: ${catList}

Return JSON: {"category":"编程"} or {"category":null} if no match.`;

  const response = await fetchWithRetry(
    `${config.baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: '你是一个严谨的文本分类器。只能基于输入内容映射到给定类别，不做主观推断。只输出合法 JSON。' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 50,
        response_format: { type: 'json_object' },
      }),
    },
  );

  if (!response.ok) return null;

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  try {
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    return parsed.category || null;
  } catch {
    return null;
  }
}

export async function verifyAIConnection(config: AIConfig): Promise<string> {
  if (!config.apiKey) {
    return '❌ No AI API key configured. Set it in plugin settings.';
  }

  const startTime = Date.now();

  try {
    const { result, tokenUsed } = await classifyBook(
      config,
      '三体',
      '刘慈欣',
      '文化大革命如火如荼进行的同时，军方探寻外星文明的绝秘计划取得了突破性进展。',
    );

    const elapsed = Date.now() - startTime;

    const lines = [
      '✅ AI API connection: OK',
      `⏱️  Response time: ${elapsed}ms`,
      `💰 Tokens used: ${tokenUsed}`,
      `📖 Title: ${result.title}`,
      `👤 Author: ${result.author || 'unknown'}`,
      `🏷️  Tags: ${result.tags.join(', ')}`,
      `📂 Category: ${result.category || 'none'}`,
      '',
      `💵 Estimated cost: ${formatCost(tokenUsed)}`,
    ];

    return lines.join('\n');
  } catch (err) {
    const elapsed = Date.now() - startTime;
    return `❌ AI API error (${elapsed}ms): ${String(err)}`;
  }
}
