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
    DEFAULT_MAX_RETRIES,
    DEFAULT_BASE_DELAY_MS,
    DEFAULT_TIMEOUT_MS,
    logger,
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
    DEFAULT_MAX_RETRIES,
    DEFAULT_BASE_DELAY_MS,
    DEFAULT_TIMEOUT_MS,
    logger,
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

// ---- Skill Generation AI Functions ----

/**
 * Analyze a book's structure: identify chapters, key themes, book type.
 * Used as step 1 of the skill generation pipeline.
 */
export async function analyzeBookStructure(
  config: AIConfig,
  title: string,
  author: string | null,
  fullText: string,
  logger: Logger = NOOP_LOGGER,
): Promise<{
  chapters: Array<{ title: string; startIndex: number }>;
  keyThemes: string[];
  bookType: string;
  tokenUsed: number;
}> {
  const cid = generateCorrelationId();

  if (!config.apiKey) {
    throw new AIError('API key is not configured', cid, { title });
  }

  const text = fullText.slice(0, TOKEN_BUDGET.SKILL_STRUCTURE_MAX_INPUT);
  const inputTokens = estimateTokens(text);

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
          {
            role: 'system',
            content: '你是一个严谨的书籍结构分析者。只能基于提供的书籍内容提取章节结构，绝不编造章节标题或顺序。如果内容不足以提取完整结构，只列出已确认的部分。只输出合法 JSON。',
          },
          {
            role: 'user',
            content: `Analyze this book and identify all chapters with approximate character positions.

Title: ${title}${author ? `\nAuthor: ${author}` : ''}

Book content:
${text}

Return ONLY valid JSON:
{
  "chapters": [
    {"title": "第1章：章节标题", "startIndex": 0},
    {"title": "第2章：章节标题", "startIndex": 1500}
  ],
  "keyThemes": ["主题1", "主题2", "主题3"],
  "bookType": "technical"
}

Rules:
- "startIndex" is the approximate character position (0-based) where this chapter begins
- Extract REAL chapter titles from the text — do NOT invent names
- If no clear chapter divisions, return one chapter with title "完整内容"
- "bookType" must be "technical" or "text"
- "keyThemes": 3-5 broad topics the book covers
- Write chapter titles in Chinese`,
          },
        ] as ChatMessage[],
        temperature: 0.3,
        max_tokens: TOKEN_BUDGET.SKILL_STRUCTURE_MAX_OUTPUT,
        response_format: { type: 'json_object' },
      }),
    },
    DEFAULT_MAX_RETRIES,
    DEFAULT_BASE_DELAY_MS,
    DEFAULT_TIMEOUT_MS,
    logger,
  );

  if (!response.ok) {
    throw new AIError(`API error (${response.status})`, cid, { title });
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new AIError('API returned empty response for structure analysis', cid, { title });
  }

  let parsed: { chapters: Array<{ title: string; startIndex: number }>; keyThemes: string[]; bookType: string };
  try {
    parsed = JSON.parse(content);
  } catch {
    // Fallback: treat entire text as one chapter
    parsed = { chapters: [{ title: '完整内容', startIndex: 0 }], keyThemes: [], bookType: 'text' };
  }

  const totalTokens = data.usage?.total_tokens ?? inputTokens + estimateTokens(content);

  logger.info('Book structure analyzed', {
    title,
    chapterCount: parsed.chapters?.length || 1,
    bookType: parsed.bookType,
    tokenUsed: totalTokens,
  });

  return {
    chapters: parsed.chapters || [{ title: '完整内容', startIndex: 0 }],
    keyThemes: parsed.keyThemes || [],
    bookType: parsed.bookType || 'text',
    tokenUsed: totalTokens,
  };
}

/**
 * Generate a consolidated summary for a batch of chapters (1-3 chapters per call).
 */
export async function generateChapterSummaries(
  config: AIConfig,
  bookTitle: string,
  chapterNumbers: number[],
  chapterTitles: string[],
  chapterTexts: string[],
  logger: Logger = NOOP_LOGGER,
): Promise<{ summaries: Array<{ number: number; title: string; summary: string }>; tokenUsed: number }> {
  const cid = generateCorrelationId();

  if (!config.apiKey) {
    throw new AIError('API key is not configured', cid, { title: bookTitle });
  }

  // Build prompt with all chapters in this batch
  let chaptersSection = '';
  const allText = [];
  for (let i = 0; i < chapterNumbers.length; i++) {
    const text = chapterTexts[i].slice(0, TOKEN_BUDGET.SKILL_CHAPTER_MAX_INPUT);
    chaptersSection += `\n### Chapter ${chapterNumbers[i]}: ${chapterTitles[i]}\n${text}\n`;
    allText.push(text);
  }

  const combinedText = chaptersSection.slice(0, TOKEN_BUDGET.SKILL_CHAPTER_MAX_INPUT * chapterNumbers.length);
  const inputTokens = estimateTokens(combinedText);

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
          {
            role: 'system',
            content: '你是一个严谨的章节总结者。只能基于提供的章节内容进行提炼，绝不编造任何信息。如果内容不足，明确说明。用中文输出。',
          },
          {
            role: 'user',
            content: `Write a comprehensive chapter analysis for each chapter below. This will be used in a Claude Code skill file, loaded on-demand when Claude needs detailed knowledge.

Book: ${bookTitle}

${combinedText}

For each chapter, output in this format:

## Chapter {number}: {title}

### 核心概念
- **概念**: 解释（必须可在原文中找到依据）

### 核心论点
- 本章的主要论点或叙事发展

### 关键启示
- 读者应从本章获得的核心启示

### 值得注意的引用
- "原文引用"——如果在原文中存在

Rules:
- ONLY use information from the provided text
- If a section has no content, write "（本章无相关内容）"
- Write in Chinese
- Keep each chapter summary concise (~500-800 words)`,
          },
        ] as ChatMessage[],
        temperature: 0.5,
        max_tokens: TOKEN_BUDGET.SKILL_CHAPTER_MAX_OUTPUT * chapterNumbers.length,
      }),
    },
    DEFAULT_MAX_RETRIES,
    DEFAULT_BASE_DELAY_MS,
    DEFAULT_TIMEOUT_MS * 3, // 90s timeout for batch
    logger,
  );

  if (!response.ok) {
    throw new AIError(`API error (${response.status})`, cid, { title: bookTitle });
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content?.trim() || '';
  const totalTokens = data.usage?.total_tokens ?? inputTokens + estimateTokens(content);

  // Parse the combined output back into per-chapter summaries
  const summaries: Array<{ number: number; title: string; summary: string }> = [];
  for (let i = 0; i < chapterNumbers.length; i++) {
    const marker = `## Chapter ${chapterNumbers[i]}:`;
    const nextMarker = i + 1 < chapterNumbers.length
      ? `## Chapter ${chapterNumbers[i + 1]}:`
      : null;

    let section = '';
    const startIdx = content.indexOf(marker);
    if (startIdx >= 0) {
      const endIdx = nextMarker ? content.indexOf(nextMarker, startIdx + marker.length) : content.length;
      section = content.slice(startIdx + marker.length, endIdx >= 0 ? endIdx : content.length).trim();
    }

    summaries.push({
      number: chapterNumbers[i],
      title: chapterTitles[i],
      summary: section || `（无法从 API 响应中解析本章内容）`,
    });
  }

  logger.info('Chapter summaries generated', {
    bookTitle,
    batchSize: chapterNumbers.length,
    tokenUsed: totalTokens,
  });

  return { summaries, tokenUsed: totalTokens };
}

/**
 * Generate a glossary of key terms from chapter summaries (full mode only).
 */
export async function generateGlossary(
  config: AIConfig,
  title: string,
  chapterData: Array<{ number: number; title: string; summary: string }>,
  logger: Logger = NOOP_LOGGER,
): Promise<{ glossary: string; tokenUsed: number }> {
  const cid = generateCorrelationId();

  if (!config.apiKey) {
    throw new AIError('API key is not configured', cid, { title });
  }

  const chaptersText = chapterData
    .map(c => `### 第${c.number}章：${c.title}\n${c.summary}`)
    .join('\n\n')
    .slice(0, TOKEN_BUDGET.SKILL_GLOSSARY_MAX_INPUT);
  const inputTokens = estimateTokens(chaptersText);

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
          {
            role: 'system',
            content: '你是一个严谨的术语提取者。只能基于提供的章节概要提取术语和概念定义，绝不编造或推测原文中不存在的术语。用中文输出。',
          },
          {
            role: 'user',
            content: `Create a glossary of key terms from this book for a Claude Code skill.

Book: ${title}

Chapter summaries:
${chaptersText}

Output a Markdown glossary:

## 术语表

- **术语名称**: 简洁定义（1-2行）。见第X章 — 章节标题

Rules:
- Include ONLY terms that appear in the provided chapter summaries
- If there are fewer than 5 extractable terms, that's fine — do NOT invent terms
- Sort terms logically or alphabetically
- Each definition must be grounded in the provided text
- Write in Chinese`,
          },
        ] as ChatMessage[],
        temperature: 0.4,
        max_tokens: TOKEN_BUDGET.SKILL_GLOSSARY_MAX_OUTPUT,
      }),
    },
    DEFAULT_MAX_RETRIES,
    DEFAULT_BASE_DELAY_MS,
    DEFAULT_TIMEOUT_MS,
    logger,
  );

  if (!response.ok) {
    throw new AIError(`API error (${response.status})`, cid, { title });
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const glossary = data.choices?.[0]?.message?.content?.trim() || '';
  const totalTokens = data.usage?.total_tokens ?? inputTokens + estimateTokens(glossary);

  logger.info('Glossary generated', { title, tokenUsed: totalTokens });
  return { glossary, tokenUsed: totalTokens };
}

/**
 * Extract techniques, patterns, and methodologies from the book (full mode only).
 */
export async function generatePatterns(
  config: AIConfig,
  title: string,
  chapterData: Array<{ number: number; title: string; summary: string }>,
  logger: Logger = NOOP_LOGGER,
): Promise<{ patterns: string; tokenUsed: number }> {
  const cid = generateCorrelationId();

  if (!config.apiKey) {
    throw new AIError('API key is not configured', cid, { title });
  }

  const chaptersText = chapterData
    .map(c => `### 第${c.number}章：${c.title}\n${c.summary}`)
    .join('\n\n')
    .slice(0, TOKEN_BUDGET.SKILL_PATTERNS_MAX_INPUT);
  const inputTokens = estimateTokens(chaptersText);

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
          {
            role: 'system',
            content: '你是一个严谨的模式提取者。只能基于提供的章节概要提取技术、算法、设计模式和方法论，绝不编造或补充原文中没有的信息。用中文输出。',
          },
          {
            role: 'user',
            content: `Extract techniques, algorithms, design patterns, frameworks, and methodologies from this book.

Book: ${title}

Chapter summaries:
${chaptersText}

Output a Markdown document:

## 技术与方法

### [技术/方法名称]
- **来源**: 第X章 — 章节标题
- **描述**: 2-3行描述（基于原文）
- **应用场景**: 何时使用（基于原文）

## 设计原则

- **原则名称**: 描述（基于原文）

Rules:
- ONLY extract patterns explicitly described in the provided summaries
- If the book doesn't contain technical patterns (fiction, memoir, etc.), output: "（本书不包含技术类模式）"
- Do not extrapolate beyond what's stated in the source material
- Write in Chinese`,
          },
        ] as ChatMessage[],
        temperature: 0.4,
        max_tokens: TOKEN_BUDGET.SKILL_PATTERNS_MAX_OUTPUT,
      }),
    },
    DEFAULT_MAX_RETRIES,
    DEFAULT_BASE_DELAY_MS,
    DEFAULT_TIMEOUT_MS,
    logger,
  );

  if (!response.ok) {
    throw new AIError(`API error (${response.status})`, cid, { title });
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const patterns = data.choices?.[0]?.message?.content?.trim() || '';
  const totalTokens = data.usage?.total_tokens ?? inputTokens + estimateTokens(patterns);

  logger.info('Patterns generated', { title, tokenUsed: totalTokens });
  return { patterns, tokenUsed: totalTokens };
}

/**
 * Generate a quick-reference cheatsheet (full mode only).
 */
export async function generateCheatsheet(
  config: AIConfig,
  title: string,
  chapterData: Array<{ number: number; title: string; summary: string }>,
  logger: Logger = NOOP_LOGGER,
): Promise<{ cheatsheet: string; tokenUsed: number }> {
  const cid = generateCorrelationId();

  if (!config.apiKey) {
    throw new AIError('API key is not configured', cid, { title });
  }

  const chaptersText = chapterData
    .map(c => `### 第${c.number}章：${c.title}\n${c.summary}`)
    .join('\n\n')
    .slice(0, TOKEN_BUDGET.SKILL_CHEATSHEET_MAX_INPUT);
  const inputTokens = estimateTokens(chaptersText);

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
          {
            role: 'system',
            content: '你是一个严谨的信息提取者。只能基于提供的章节概要创建速查表，绝不编造或补充原文中没有的信息。用中文输出。',
          },
          {
            role: 'user',
            content: `Create a quick-reference cheatsheet for a Claude Code skill.

Book: ${title}

Chapter summaries:
${chaptersText}

Output a Markdown cheatsheet:

## 速查表

### 核心概念速查
| 概念 | 定义 | 章节 |
|------|------|------|

### 决策框架
| 场景 | 建议方案 | 依据（章节） |
|------|---------|------------|

### 关键公式/原则
- **名称**: 描述（必须可在原文中找到依据）

Rules:
- ONLY use information from the provided summaries
- If a table would be empty, omit it
- Keep cells concise — this is a quick reference
- Do not invent frameworks, formulas, or rules
- Write in Chinese`,
          },
        ] as ChatMessage[],
        temperature: 0.4,
        max_tokens: TOKEN_BUDGET.SKILL_CHEATSHEET_MAX_OUTPUT,
      }),
    },
    DEFAULT_MAX_RETRIES,
    DEFAULT_BASE_DELAY_MS,
    DEFAULT_TIMEOUT_MS,
    logger,
  );

  if (!response.ok) {
    throw new AIError(`API error (${response.status})`, cid, { title });
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const cheatsheet = data.choices?.[0]?.message?.content?.trim() || '';
  const totalTokens = data.usage?.total_tokens ?? inputTokens + estimateTokens(cheatsheet);

  logger.info('Cheatsheet generated', { title, tokenUsed: totalTokens });
  return { cheatsheet, tokenUsed: totalTokens };
}

/**
 * Synthesize all analysis into the final SKILL.md.
 * This is the master file that Claude Code loads when the skill is invoked.
 */
export async function generateSkillMd(
  config: AIConfig,
  title: string,
  author: string | null,
  slug: string,
  keyThemes: string[],
  bookType: string,
  chapterData: Array<{ number: number; title: string; summary: string }>,
  mode: 'light' | 'full',
  logger: Logger = NOOP_LOGGER,
): Promise<{ skillMd: string; tokenUsed: number }> {
  const cid = generateCorrelationId();

  if (!config.apiKey) {
    throw new AIError('API key is not configured', cid, { title });
  }

  const chaptersSummary = chapterData
    .map(c => `- 第${c.number}章：${c.title} — ${c.summary.slice(0, 200)}`)
    .join('\n')
    .slice(0, TOKEN_BUDGET.SKILL_MD_MAX_INPUT);

  const modeNote = mode === 'light'
    ? '- 轻量模式：不包含 glossary.md、patterns.md、cheatsheet.md'
    : '- 完整模式：包含 glossary.md（术语表）、patterns.md（模式库）、cheatsheet.md（速查表）';

  const inputTokens = estimateTokens(chaptersSummary);

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
          {
            role: 'system',
            content: '你是一个严谨的技能文档编写者。只能基于提供的书籍分析结果编写 Claude Code 技能文档，绝不编造或补充分析结果中没有的信息。用中文输出。',
          },
          {
            role: 'user',
            content: `Create the SKILL.md for a Claude Code skill based on this book analysis.

Book: ${title}${author ? `\nAuthor: ${author}` : ''}
Type: ${bookType}
Slug: ${slug}
Key themes: ${keyThemes.join(', ') || '(none identified)'}

Chapter index:
${chaptersSummary}

Write a complete SKILL.md:

---
name: ${slug}
description: Core mental models from《${title}》— a book about ${keyThemes.slice(0, 3).join('、') || 'various topics'}
---

# ${title}

## 核心思维模型

[Extract 3-5 core mental models. Each: what + when/how to apply. 2-3 sentences each. Grounded in the chapter data above.]

## 本书概要

[One paragraph summarizing the book's thesis, approach, and audience. Based ONLY on the provided chapter data.]

## 章节索引

[For EACH chapter listed above, write: chapter title + 1-line summary + file path]
- **第N章：标题**: 一句话概括 → \`chapters/ch{N}-{slug}.md\`

## 使用指南

### 何时调用此 Skill
- [When to use this book's knowledge]
- [Specific query types]

### 如何使用
- 加载 \`chapters/ch{N}-*.md\` 获取章节详细内容
${modeNote}

Rules:
- ONLY synthesize from the provided chapter data — do NOT add external knowledge
- Chapter index MUST exactly match the provided chapter list
- Keep under 4000 tokens equivalent
- Write in Chinese
- Mental models section is the most important — spend the most effort there`,
          },
        ] as ChatMessage[],
        temperature: 0.5,
        max_tokens: TOKEN_BUDGET.SKILL_MD_MAX_OUTPUT,
      }),
    },
    DEFAULT_MAX_RETRIES,
    DEFAULT_BASE_DELAY_MS,
    DEFAULT_TIMEOUT_MS,
    logger,
  );

  if (!response.ok) {
    throw new AIError(`API error (${response.status})`, cid, { title });
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const skillMd = data.choices?.[0]?.message?.content?.trim() || '';
  const totalTokens = data.usage?.total_tokens ?? inputTokens + estimateTokens(skillMd);

  logger.info('SKILL.md generated', { title, tokenUsed: totalTokens });
  return { skillMd, tokenUsed: totalTokens };
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
    DEFAULT_MAX_RETRIES,
    DEFAULT_BASE_DELAY_MS,
    DEFAULT_TIMEOUT_MS * 2, // longer timeout for batch operations
    logger,
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

  let parsed: { results: Array<{ index: number; category: string }> };
  try {
    parsed = JSON.parse(content) as { results: Array<{ index: number; category: string }> };
  } catch (err) {
    logger.warn('Batch classify: invalid JSON from API, attempting partial recovery', {
      contentPreview: content.slice(0, 200),
      error: String(err),
    });
    // Fallback: return empty map — individual books can be re-classified
    return new Map<string, string>();
  }

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
    DEFAULT_MAX_RETRIES,
    DEFAULT_BASE_DELAY_MS,
    DEFAULT_TIMEOUT_MS,
    logger,
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
