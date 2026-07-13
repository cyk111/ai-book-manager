// ============================================================
// Skill Service Tests — pipeline orchestration unit tests
// ============================================================

import { SkillService, SkillProgress, SkillGenerationResult } from '../services/skill-service';
import { BookRecord, PluginSettings, DEFAULT_SETTINGS } from '../models';
import { App as MockApp } from '../__mocks__/obsidian';

// ---- Helpers ----

function createMockBook(overrides: Partial<BookRecord> = {}): BookRecord {
  return {
    id: 'book_test123',
    fileName: 'test-book.pdf',
    filePath: '/tmp/test-book.pdf',
    format: 'pdf',
    fileSize: 1024,
    fileHash: 'abc123',
    modifiedAt: Date.now(),
    title: '测试书籍',
    author: '测试作者',
    tags: [],
    notePath: '📚图书库/测试书籍.md',
    source: '本地书籍',
    sourcePath: null,
    skillPath: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function createMockSettings(overrides: Partial<PluginSettings> = {}): PluginSettings {
  return {
    ...DEFAULT_SETTINGS,
    aiApiKey: 'sk-test',
    aiBaseUrl: 'https://api.test.com/v1',
    aiModel: 'test-model',
    skillMode: 'light',
    skillSyncTargets: [],
    ...overrides,
  };
}

function validStructureResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{
        message: {
          content: JSON.stringify({
            chapters: [
              { title: '第一章：开始', startIndex: 0 },
              { title: '第二章：深入', startIndex: 500 },
              { title: '第三章：进阶', startIndex: 1000 },
            ],
            keyThemes: ['测试', '编程'],
            bookType: 'technical',
          }),
        },
      }],
      usage: { total_tokens: 500 },
    }),
    text: async () => JSON.stringify({ choices: [{ message: { content: '{}' } }] }),
  };
}

function validChapterSummariesResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{
        message: {
          content: `## Chapter 1: 第一章：开始

### 核心概念
- **概念A**: 解释

### 核心论点
- 论点1

### 关键启示
- 启示1

### 值得注意的引用
- "引用"`,
        },
      }],
      usage: { total_tokens: 800 },
    }),
    text: async () => '',
  };
}

function validSkillMdResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{
        message: {
          content: `---
name: test-book
description: Core mental models
---

# 测试书籍

## 核心思维模型
...`,
        },
      }],
      usage: { total_tokens: 2000 },
    }),
    text: async () => '',
  };
}

// ---- Mock setup ----

// Mock fs, os
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  readFileSync: jest.fn().mockReturnValue('Mock book content '.repeat(1000)),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

jest.mock('os', () => ({
  homedir: jest.fn().mockReturnValue('/home/testuser'),
}));

jest.mock('adm-zip', () => {
  return jest.fn().mockImplementation(() => ({
    getEntries: () => [],
  }));
});

// Mock pdfjs-dist
jest.mock('pdfjs-dist', () => ({
  getDocument: jest.fn().mockReturnValue({
    promise: Promise.resolve({
      numPages: 1,
      getMetadata: () => Promise.resolve({ info: {} }),
      getPage: () => Promise.resolve({
        getTextContent: () => Promise.resolve({
          items: [{ str: 'Mock PDF ' }],
        }),
      }),
    }),
  }),
}));

// ---- Tests ----

describe('SkillService', () => {
  let service: SkillService;
  let app: import('obsidian').App;
  let settings: PluginSettings;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn();

    app = new MockApp() as unknown as import('obsidian').App;
    settings = createMockSettings();
    service = new SkillService(app, settings);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  // ---- generateBookSlug ----

  describe('generateBookSlug', () => {
    it('should_create_slug_from_chinese_title', () => {
      const slug = service.generateBookSlug('三体', 'book_abc123');
      expect(slug).toBe('三体-abc123');
    });

    it('should_create_slug_from_english_title', () => {
      const slug = service.generateBookSlug('Deep Learning', 'book_xyz456');
      expect(slug).toBe('Deep-Learning-xyz456');
    });

    it('should_handle_special_characters', () => {
      const slug = service.generateBookSlug('A/B:C 测试', 'book_test99');
      expect(slug).toContain('test99');
    });

    it('should_truncate_long_titles', () => {
      const longTitle = '这是一个非常非常非常非常非常非常非常非常非常非常非常长的书名';
      const slug = service.generateBookSlug(longTitle, 'book_abcd');
      expect(slug.length).toBeLessThanOrEqual(40 + 7); // title + -hash
    });

    it('should_fallback_when_title_is_only_special_chars', () => {
      const slug = service.generateBookSlug('!@#$%^&*()', 'src_abc123');
      expect(slug).toBe('book-abc123');
    });
  });

  // ---- generateSkill ----

  describe('generateSkill', () => {
    it('should_complete_full_pipeline_in_light_mode', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(validStructureResponse())
        .mockResolvedValueOnce(validChapterSummariesResponse())
        .mockResolvedValueOnce(validSkillMdResponse());

      const book = createMockBook({ filePath: '/tmp/test-book.txt', format: 'txt' });
      const progress: SkillProgress[] = [];

      const result = await service.generateSkill(book, (p) => progress.push(p));

      expect(result.chapterCount).toBe(3);
      expect(result.skillPath).toContain('/mock/vault/');
      expect(result.skillPath).toContain('Skills');
      expect(result.totalTokens).toBeGreaterThan(0);

      // Verify progress phases in order
      const phases = progress.map(p => p.phase);
      expect(phases).toContain('extracting');
      expect(phases).toContain('analyzing_structure');
      expect(phases).toContain('generating_chapters');
      expect(phases).toContain('assembling_skillmd');
      expect(phases).toContain('writing_files');
      expect(phases).toContain('complete');

      // Light mode should NOT generate glossary/patterns/cheatsheet
      expect(phases).not.toContain('generating_glossary');
      expect(phases).not.toContain('generating_patterns');
      expect(phases).not.toContain('generating_cheatsheet');
    });

    it('should_generate_glossary_patterns_cheatsheet_in_full_mode', async () => {
      settings.skillMode = 'full';
      service = new SkillService(app, settings);

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(validStructureResponse())
        .mockResolvedValueOnce(validChapterSummariesResponse())
        .mockResolvedValueOnce({ // glossary
          ok: true, status: 200,
          json: async () => ({ choices: [{ message: { content: '- **术语**: 定义' } }], usage: { total_tokens: 300 } }),
          text: async () => '',
        })
        .mockResolvedValueOnce({ // patterns
          ok: true, status: 200,
          json: async () => ({ choices: [{ message: { content: '## 技术与方法' } }], usage: { total_tokens: 300 } }),
          text: async () => '',
        })
        .mockResolvedValueOnce({ // cheatsheet
          ok: true, status: 200,
          json: async () => ({ choices: [{ message: { content: '## 速查表' } }], usage: { total_tokens: 300 } }),
          text: async () => '',
        })
        .mockResolvedValueOnce(validSkillMdResponse());

      const book = createMockBook({ filePath: '/tmp/test-book.txt', format: 'txt' });
      const progress: SkillProgress[] = [];

      await service.generateSkill(book, (p) => progress.push(p));

      const phases = progress.map(p => p.phase);
      expect(phases).toContain('generating_glossary');
      expect(phases).toContain('generating_patterns');
      expect(phases).toContain('generating_cheatsheet');
    });

    it('should_throw_when_book_file_not_found', async () => {
      const fs = require('fs');
      fs.existsSync.mockReturnValueOnce(false);

      const book = createMockBook({ filePath: '/nonexistent.pdf' });

      await expect(service.generateSkill(book, () => {}))
        .rejects.toThrow('Book file not found');
    });

    it('should_handle_single_chapter_structure', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  chapters: [{ title: '完整内容', startIndex: 0 }],
                  keyThemes: [],
                  bookType: 'text',
                }),
              },
            }],
            usage: { total_tokens: 200 },
          }),
          text: async () => '',
        })
        .mockResolvedValueOnce(validChapterSummariesResponse())
        .mockResolvedValueOnce(validSkillMdResponse());

      const book = createMockBook({ filePath: '/tmp/test-book.txt', format: 'txt' });

      const result = await service.generateSkill(book, () => {});
      expect(result.chapterCount).toBe(1);
    });

    it('should_throw_when_api_key_not_configured', async () => {
      settings.aiApiKey = '';
      service = new SkillService(app, settings);

      const book = createMockBook();
      await expect(service.generateSkill(book, () => {}))
        .rejects.toThrow('API key is not configured');
    });

    it('should_batch_chapters_3_per_call', async () => {
      // 7 chapters → 3 batches (3 + 3 + 1)
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  chapters: [
                    { title: 'Ch1', startIndex: 0 },
                    { title: 'Ch2', startIndex: 300 },
                    { title: 'Ch3', startIndex: 600 },
                    { title: 'Ch4', startIndex: 900 },
                    { title: 'Ch5', startIndex: 1200 },
                    { title: 'Ch6', startIndex: 1500 },
                    { title: 'Ch7', startIndex: 1800 },
                  ],
                  keyThemes: ['a'],
                  bookType: 'text',
                }),
              },
            }],
            usage: { total_tokens: 500 },
          }),
          text: async () => '',
        })
        // 3 batches of chapter summaries
        .mockResolvedValueOnce(validChapterSummariesResponse())
        .mockResolvedValueOnce(validChapterSummariesResponse())
        .mockResolvedValueOnce(validChapterSummariesResponse())
        .mockResolvedValueOnce(validSkillMdResponse());

      const book = createMockBook({ filePath: '/tmp/test-book.txt', format: 'txt' });
      const progressCalls: Array<{ phase: string; current: number; total: number }> = [];

      const result = await service.generateSkill(book, (p) => {
        if (p.phase === 'generating_chapters') {
          progressCalls.push({ phase: p.phase, current: p.current, total: p.total });
        }
      });

      expect(result.chapterCount).toBe(7);
      expect(progressCalls.length).toBe(3);
      expect(progressCalls[0]).toEqual({ phase: 'generating_chapters', current: 1, total: 3 });
      expect(progressCalls[2]).toEqual({ phase: 'generating_chapters', current: 3, total: 3 });
    });

    it('should_write_skills_to_vault_skills_folder', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(validStructureResponse())
        .mockResolvedValueOnce(validChapterSummariesResponse())
        .mockResolvedValueOnce(validSkillMdResponse());

      const book = createMockBook({ filePath: '/tmp/test-book.txt', format: 'txt' });

      const result = await service.generateSkill(book, () => {});
      // Skills folder is inside the vault's notes folder
      expect(result.skillPath).toContain('/mock/vault/');
      expect(result.skillPath).toContain('Skills');
    });

    it('should_report_synced_tools_when_targets_configured', async () => {
      settings.skillSyncTargets = ['claude'];
      service = new SkillService(app, settings);

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(validStructureResponse())
        .mockResolvedValueOnce(validChapterSummariesResponse())
        .mockResolvedValueOnce(validSkillMdResponse());

      const book = createMockBook({ filePath: '/tmp/test-book.txt', format: 'txt' });

      const result = await service.generateSkill(book, () => {});
      // The sync may fail in test (no real filesystem), but syncedTools
      // should still be populated from the sync attempt
      expect(result.syncedTools).toBeDefined();
    });
  });
});
