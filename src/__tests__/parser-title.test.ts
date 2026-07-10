// Verify garbage title detection for PDF metadata
import * as fs from 'fs';
import { createTempDir, createTestFile, cleanupTempDirs } from './helpers';
import { parseBook } from '../parser';

describe('PDF title extraction', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir('title-test');
  });

  afterAll(() => {
    cleanupTempDirs();
  });

  it('should_use_filename_when_pdf_parsing_fails', async () => {
    const corruptPath = createTestFile(tmpDir, '三体.pdf', 'not a pdf');
    const result = await parseBook(corruptPath, 'pdf', 3);
    expect(result.title).toBe('三体');
  });

  it('should_fallback_to_filename_for_unsupported_format', async () => {
    const path = createTestFile(tmpDir, 'test.mobi', 'content');
    await expect(parseBook(path, 'mobi' as never, 3)).rejects.toThrow('Unsupported format');
  });

  it('should_extract_title_from_txt_filename', async () => {
    const path = createTestFile(tmpDir, '深度学习入门.txt', '第一章 深度学习概述...');
    const result = await parseBook(path, 'txt', 3);
    expect(result.title).toBe('深度学习入门');
  });
});
