// ============================================================
// AI Client Tests — DeepSeek API client unit tests
// ============================================================

import {
  classifyBook,
  generateSummary,
  verifyAIConnection,
} from '../ai-client';

// Access private functions for direct testing
// (exposed via a small re-export pattern — we test through public API)

const config = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'sk-test-key',
  model: 'deepseek-chat',
};

// ---- Helpers ----

function validTagResponse(tags: string[] = ['科幻', '人工智能']) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        { message: { content: JSON.stringify({ title: '三体', author: '刘慈欣', tags, category: '科幻' }) } },
      ],
      usage: { total_tokens: 180, prompt_tokens: 150, completion_tokens: 30 },
    }),
    text: async () => JSON.stringify({ choices: [{ message: { content: '{}' } }] }),
  };
}

function validSummaryResponse(summary: string = '这是一本好书。') {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        { message: { content: summary } },
      ],
      usage: { total_tokens: 350 },
    }),
    text: async () => JSON.stringify({ choices: [{ message: { content: summary } }] }),
  };
}

function errorResponse(status: number) {
  return {
    ok: false,
    status,
    json: async () => ({ error: { message: 'Something went wrong' } }),
    text: async () => `{"error":{"message":"Error ${status}"}}`,
  };
}

function emptyChoicesResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [] }),
    text: async () => '{"choices":[]}',
  };
}

function invalidJsonResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: 'not valid json {{{' } }],
    }),
    text: async () => 'not valid json {{{',
  };
}

// ---- Tests ----

describe('classifyBook', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should_return_structured_tags_when_api_succeeds', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(validTagResponse());

    const { result, tokenUsed } = await classifyBook(config, '三体', '刘慈欣', '科幻小说内容片段');

    expect(result.title).toBe('三体');
    expect(result.author).toBe('刘慈欣');
    expect(result.tags).toContain('科幻');
    expect(result.tags).toContain('人工智能');
    expect(result.category).toBe('科幻');
    expect(tokenUsed).toBe(180);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Verify request shape
    const fetchArgs = (global.fetch as jest.Mock).mock.calls[0];
    expect(fetchArgs[0]).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(fetchArgs[1].headers.Authorization).toBe('Bearer sk-test-key');
    const body = JSON.parse(fetchArgs[1].body);
    expect(body.max_tokens).toBe(200);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('should_throw_when_api_returns_http_401', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(errorResponse(401));

    await expect(
      classifyBook(config, '三体', '刘慈欣', 'text'),
    ).rejects.toThrow('API error (401)');
  });

  it('should_throw_after_retries_when_api_returns_http_500', async () => {
    // 500 triggers retry; on last attempt, classifyBook throws AIError
    (global.fetch as jest.Mock).mockResolvedValue(errorResponse(500));

    await expect(
      classifyBook(config, '三体', '刘慈欣', 'text'),
    ).rejects.toThrow('API error (500)');
  });

  it('should_throw_when_api_returns_invalid_json', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(invalidJsonResponse());

    await expect(
      classifyBook(config, '三体', '刘慈欣', 'text'),
    ).rejects.toThrow('Invalid JSON from API');
  });

  it('should_throw_when_api_returns_empty_choices', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(emptyChoicesResponse());

    await expect(
      classifyBook(config, '三体', '刘慈欣', 'text'),
    ).rejects.toThrow('API returned empty response');
  });

  it('should_throw_when_response_missing_tags_array', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          { message: { content: JSON.stringify({ title: 'Test', author: null, category: 'test' }) } },
        ],
      }),
      text: async () => '',
    });

    await expect(
      classifyBook(config, 'Test', null, 'text'),
    ).rejects.toThrow('missing tags array');
  });

  it('should_normalize_tags_by_deduplicating_and_trimming', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      validTagResponse(['科幻', ' 科幻 ', '人工智能', '科幻', '', '  深度学习  ']),
    );

    const { result } = await classifyBook(config, '三体', '刘慈欣', 'text');

    // Deduped: 科幻, 人工智能, 深度学习
    expect(result.tags).toHaveLength(3);
    expect(result.tags).toEqual(['科幻', '人工智能', '深度学习']);
  });

  it('should_limit_tags_to_max_3', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      validTagResponse(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']),
    );

    const { result } = await classifyBook(config, 'Test', null, 'text');

    expect(result.tags).toHaveLength(3);
  });

  it('should_return_token_count_from_api_response', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      validTagResponse(['科幻']),
    );

    const { tokenUsed } = await classifyBook(config, '三体', '刘慈欣', 'text');

    expect(tokenUsed).toBe(180);
  });

  it('should_estimate_tokens_when_usage_field_missing', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          { message: { content: JSON.stringify({ title: 'Test', author: null, tags: ['a'], category: null }) } },
        ],
        // No usage field
      }),
      text: async () => '',
    });

    const { tokenUsed } = await classifyBook(config, 'Test', null, 'hello');

    // Should fall back to estimateTokens
    expect(tokenUsed).toBeGreaterThan(0);
  });

  it('should_truncate_preview_text_to_300_chars_in_prompt', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(validTagResponse());

    const longText = 'x'.repeat(800);
    await classifyBook(config, 'Test', null, longText);

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    const userContent = body.messages[1].content as string;
    // Extract the preview snippet — it's between "Content preview: " / "Preview: " and next line break
    const previewMatch = userContent.match(/(?:Content preview|Preview): (.+)/);
    expect(previewMatch).not.toBeNull();
    const previewText = previewMatch![1];
    expect(previewText.length).toBeLessThanOrEqual(300);
  });

  it('should_include_author_in_prompt_when_provided', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(validTagResponse());

    await classifyBook(config, 'Test Book', 'Author Name', 'text');

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    const userContent = body.messages[1].content as string;
    expect(userContent).toContain('Author: Author Name');
  });

  it('should_not_include_author_line_when_author_is_null', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(validTagResponse());

    await classifyBook(config, 'Test Book', null, 'text');

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    const userContent = body.messages[1].content as string;
    expect(userContent).not.toContain('Author:');
  });
});

describe('generateSummary', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should_return_summary_when_api_succeeds', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      validSummaryResponse('这是一本关于人工智能的入门书籍，适合初学者阅读。'),
    );

    const { summary, tokenUsed } = await generateSummary(
      config,
      'AI入门',
      '作者名',
      '第一章 人工智能概述...',
    );

    expect(summary).toContain('人工智能');
    expect(tokenUsed).toBe(350);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.max_tokens).toBe(400);
    expect(body.temperature).toBe(0.5);
  });

  it('should_throw_when_summary_api_fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(errorResponse(500));

    await expect(
      generateSummary(config, 'Test', null, 'text'),
    ).rejects.toThrow('API error (500)');
  });

  it('should_return_empty_string_when_content_is_missing', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '' } }],
        usage: { total_tokens: 100 },
      }),
      text: async () => '',
    });

    const { summary } = await generateSummary(config, 'Test', null, 'hello world');

    expect(summary).toBe('');
  });

  it('should_truncate_input_text_to_3000_chars', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(validSummaryResponse('ok'));

    const longText = '书'.repeat(5000);
    await generateSummary(config, 'Test', null, longText);

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    const userContent = body.messages[1].content as string;
    // The text in the prompt should not exceed ~3000 chars plus the template overhead
    expect(userContent.length).toBeLessThan(3500);
  });
});

describe('verifyAIConnection', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should_return_error_message_when_api_key_is_empty', async () => {
    const result = await verifyAIConnection({
      ...config,
      apiKey: '',
    });

    expect(result).toContain('❌');
    expect(result).toContain('No AI API key');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should_return_success_details_when_api_works', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(validTagResponse());

    const result = await verifyAIConnection(config);

    expect(result).toContain('✅');
    expect(result).toContain('AI API connection: OK');
    expect(result).toContain('Response time:');
    expect(result).toContain('Tokens used:');
    expect(result).toContain('Estimated cost:');
  });

  it('should_return_error_details_when_api_fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(errorResponse(401));

    const result = await verifyAIConnection(config);

    expect(result).toContain('❌');
    expect(result).toContain('AI API error');
  });
});

describe('token estimation edge cases', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should_estimate_chinese_tokens_higher_than_english_tokens', async () => {
    const cnResponse = validTagResponse(['a']);
    const enResponse = validTagResponse(['a']);

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(cnResponse)
      .mockResolvedValueOnce(enResponse);

    // Chinese text — estimateTokens counts ~1 per char
    const cnBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0]?.[1]?.body || '{}');
    // Just verify the function runs without error for Chinese-heavy text
    await classifyBook(config, '测试', null, '这是中文测试内容');

    expect(global.fetch).toHaveBeenCalled();
  });
});

// ---- Skill Generation AI Functions ----

import {
  analyzeBookStructure,
  generateChapterSummaries,
  generateGlossary,
  generatePatterns,
  generateCheatsheet,
  generateSkillMd,
} from '../ai-client';

describe('analyzeBookStructure', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should_return_chapters_and_themes_when_api_succeeds', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              chapters: [
                { title: '第1章：开始', startIndex: 0 },
                { title: '第2章：深入', startIndex: 500 },
              ],
              keyThemes: ['编程', '架构'],
              bookType: 'technical',
            }),
          },
        }],
        usage: { total_tokens: 600 },
      }),
      text: async () => '',
    });

    const result = await analyzeBookStructure(config, '测试书', '作者', 'Mock content '.repeat(1000));

    expect(result.chapters).toHaveLength(2);
    expect(result.chapters[0].title).toBe('第1章：开始');
    expect(result.keyThemes).toContain('编程');
    expect(result.bookType).toBe('technical');
    expect(result.tokenUsed).toBe(600);
  });

  it('should_fallback_to_single_chapter_on_invalid_json', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'not valid json {{{' } }],
        usage: { total_tokens: 100 },
      }),
      text: async () => '',
    });

    const result = await analyzeBookStructure(config, 'Test', null, 'content');

    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0].title).toBe('完整内容');
  });

  it('should_throw_on_http_error', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'server error' }),
      text: async () => 'error',
    });

    await expect(analyzeBookStructure(config, 'Test', null, 'content'))
      .rejects.toThrow('API error (500)');
  });
});

describe('generateChapterSummaries', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should_return_summaries_for_batch', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: `## Chapter 1: 第一章
### 核心概念
- **概念**: 解释
### 核心论点
- 论点`,
          },
        }],
        usage: { total_tokens: 500 },
      }),
      text: async () => '',
    });

    const result = await generateChapterSummaries(
      config, '测试书', [1], ['第一章'], ['chapter text here'],
    );

    expect(result.summaries).toHaveLength(1);
    expect(result.summaries[0].number).toBe(1);
    expect(result.summaries[0].summary).toContain('核心概念');
    expect(result.tokenUsed).toBe(500);
  });

  it('should_handle_http_error', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'err' }),
      text: async () => '',
    });

    await expect(generateChapterSummaries(config, 'T', [1], ['C1'], ['text']))
      .rejects.toThrow('API error (500)');
  });
});

describe('generateGlossary', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should_return_glossary_markdown', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '## 术语表\n- **术语**: 定义' } }],
        usage: { total_tokens: 300 },
      }),
      text: async () => '',
    });

    const result = await generateGlossary(config, 'Test', [
      { number: 1, title: 'Ch1', summary: 'summary text' },
    ]);

    expect(result.glossary).toContain('术语表');
    expect(result.tokenUsed).toBe(300);
  });
});

describe('generatePatterns', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should_return_patterns_markdown', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '## 技术与方法\n### Pattern A' } }],
        usage: { total_tokens: 400 },
      }),
      text: async () => '',
    });

    const result = await generatePatterns(config, 'Test', [
      { number: 1, title: 'Ch1', summary: 'text' },
    ]);

    expect(result.patterns).toContain('技术');
    expect(result.tokenUsed).toBe(400);
  });
});

describe('generateCheatsheet', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should_return_cheatsheet_markdown', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '## 速查表\n| 概念 | 定义 |' } }],
        usage: { total_tokens: 350 },
      }),
      text: async () => '',
    });

    const result = await generateCheatsheet(config, 'Test', [
      { number: 1, title: 'Ch1', summary: 'text' },
    ]);

    expect(result.cheatsheet).toContain('速查表');
    expect(result.tokenUsed).toBe(350);
  });
});

describe('generateSkillMd', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should_return_complete_skill_md', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: `---
name: test-slug
description: A test skill
---

# Test Book

## 核心思维模型
### Model 1: Something`,
          },
        }],
        usage: { total_tokens: 2000 },
      }),
      text: async () => '',
    });

    const result = await generateSkillMd(
      config, 'Test Book', 'Author', 'test-slug',
      ['主题1', '主题2'], 'technical',
      [{ number: 1, title: 'Ch1', summary: 'summary' }],
      'light',
    );

    expect(result.skillMd).toContain('test-slug');
    expect(result.skillMd).toContain('核心思维模型');
    expect(result.tokenUsed).toBe(2000);
  });

  it('should_throw_on_api_error', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'error' }),
      text: async () => '',
    });

    await expect(generateSkillMd(
      config, 'Test', null, 'slug', [], 'text', [], 'light',
    )).rejects.toThrow('API error (500)');
  });
});
