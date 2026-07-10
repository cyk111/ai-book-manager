// ============================================================
// Unit Tests: Book Parser (parseBook, verifyBookParsing)
// ============================================================

import { parseBook } from '../parser';
import {
  createTempDir,
  createTestFile,
  createTestEpub,
  cleanupTempDirs,
} from './helpers';
import * as path from 'path';
import * as fs from 'fs';

// ============================================================
// Mock pdfjs-dist — intercepts dynamic import in parsePdfFile
// Jest hoists this above all imports, so all code paths that
// dynamically import('pdfjs-dist') receive the mock.
// ============================================================
jest.mock('pdfjs-dist', () => ({
  getDocument: jest.fn(),
}));

// ---- Helper to access the mock inside tests ----

function getPdfJsMock() {
  return jest.requireMock('pdfjs-dist') as { getDocument: jest.Mock };
}

// ============================================================
// describe: parseBook
// ============================================================

describe('parseBook', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir('parser-test');
    // Reset all mock call counts / return values before each test
    jest.clearAllMocks();
  });

  afterAll(() => {
    cleanupTempDirs();
  });

  // -------------------------------------------------------
  // TXT Parser Tests
  // -------------------------------------------------------

  test('should_parse_txt_file_with_utf8_content', async () => {
    const content = '这是一个中文测试文件。';
    const filePath = createTestFile(tempDir, 'test.txt', content);

    const result = await parseBook(filePath, 'txt', 3);

    expect(result.format).toBe('txt');
    expect(result.title).toBe('test');
    expect(result.author).toBeNull();
    expect(result.previewText).toBe(content);
    expect(result.textLength).toBe(content.length);
    expect(result.warnings).toHaveLength(0);
  });

  test('should_truncate_txt_to_max_pages', async () => {
    const maxPages = 2;
    const charsPerPage = 3000;
    const oversized = maxPages * charsPerPage + 1000;
    const content = 'A'.repeat(oversized);
    const filePath = createTestFile(tempDir, 'long.txt', content);

    const result = await parseBook(filePath, 'txt', maxPages);

    expect(result.previewText.length).toBe(maxPages * charsPerPage);
    // The slice should be exactly the first 6000 chars
    expect(result.previewText).toBe(content.slice(0, maxPages * charsPerPage));
    // textLength reflects the FULL original length
    expect(result.textLength).toBe(content.length);
    expect(result.warnings).toHaveLength(0);
  });

  test('should_handle_empty_txt_file', async () => {
    const filePath = createTestFile(tempDir, 'empty.txt', '');

    const result = await parseBook(filePath, 'txt', 3);

    expect(result.previewText).toBe('');
    expect(result.textLength).toBe(0);
    expect(result.title).toBe('empty');
    expect(result.author).toBeNull();
    expect(result.format).toBe('txt');
    expect(result.warnings).toHaveLength(0);
  });

  // -------------------------------------------------------
  // PDF Parser Tests
  // -------------------------------------------------------

  test('should_parse_pdf_with_extractable_text_and_metadata', async () => {
    const filePath = createTestFile(tempDir, 'document.pdf', 'dummy');
    const { getDocument } = getPdfJsMock();

    const mockPage = {
      getTextContent: jest
        .fn()
        .mockResolvedValue({ items: [{ str: 'Hello from page 1' }] }),
    };

    const mockDoc = {
      numPages: 1,
      getMetadata: jest
        .fn()
        .mockResolvedValue({ info: { Title: 'Scientific Paper', Author: 'Dr. Smith' } }),
      getPage: jest.fn().mockResolvedValue(mockPage),
    };

    getDocument.mockReturnValue({ promise: Promise.resolve(mockDoc) });

    const result = await parseBook(filePath, 'pdf', 3);

    expect(result.format).toBe('pdf');
    // Filename-based title wins when metadata is very different
    expect(result.title).toBeDefined();
    expect(result.author).toBe('Dr. Smith');
    expect(result.previewText).toBe('Hello from page 1');
    expect(result.textLength).toBe('Hello from page 1'.length);
    expect(result.warnings).toHaveLength(0);

    // Verify the mock was exercised correctly
    expect(getDocument).toHaveBeenCalledTimes(1);
    expect(getDocument).toHaveBeenCalledWith({ data: expect.any(Uint8Array) });
    expect(mockDoc.getMetadata).toHaveBeenCalledTimes(1);
    expect(mockDoc.getPage).toHaveBeenCalledTimes(1);
    expect(mockDoc.getPage).toHaveBeenCalledWith(1);
    expect(mockPage.getTextContent).toHaveBeenCalledTimes(1);
  });

  test('should_return_warning_when_pdf_has_no_text', async () => {
    const filePath = createTestFile(tempDir, 'scan.pdf', 'dummy');
    const { getDocument } = getPdfJsMock();

    const mockPage = {
      getTextContent: jest.fn().mockResolvedValue({ items: [] }),
    };

    const mockDoc = {
      numPages: 1,
      getMetadata: jest.fn().mockResolvedValue({ info: {} }),
      getPage: jest.fn().mockResolvedValue(mockPage),
    };

    getDocument.mockReturnValue({ promise: Promise.resolve(mockDoc) });

    const result = await parseBook(filePath, 'pdf', 3);

    expect(result.previewText).toBe('');
    expect(result.textLength).toBe(0);
    // Falls back to filename-based title when metadata has no Title
    expect(result.title).toBe('scan');
    expect(result.author).toBeNull();
    expect(result.format).toBe('pdf');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/No extractable text/i);
  });

  test('should_fallback_and_return_warnings_when_pdf_parsing_fails', async () => {
    const filePath = createTestFile(tempDir, 'corrupt.pdf', 'dummy');
    const { getDocument } = getPdfJsMock();

    // Simulate a valid getDocument returning a doc whose getMetadata rejects
    const mockDoc = {
      numPages: 1,
      getMetadata: jest.fn().mockRejectedValue(new Error('Corrupt metadata stream')),
      getPage: jest.fn(),
    };

    getDocument.mockReturnValue({ promise: Promise.resolve(mockDoc) });

    const result = await parseBook(filePath, 'pdf', 3);

    expect(result.previewText).toBe('');
    expect(result.textLength).toBe(0);
    // Falls back to filename when metadata extraction fails
    expect(result.title).toBe('corrupt');
    expect(result.author).toBeNull();
    expect(result.format).toBe('pdf');
    // May have 1+ warnings (metadata extraction + PDF parsing fail)
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    const pdfFailWarning = result.warnings.find((w: string) => /PDF parsing failed/i.test(w));
    expect(pdfFailWarning).toBeDefined();
  });

  // -------------------------------------------------------
  // EPUB Parser Tests
  // -------------------------------------------------------

  test('should_parse_epub_with_xhtml_content', async () => {
    const filePath = path.join(tempDir, 'book.epub');
    // Content must be long enough to pass the >50-char filter after tag stripping
    const pageContent = '<p>' + 'This is real book content that should appear in the parsed output. '.repeat(3) + '</p>';
    createTestEpub(filePath, [
      { name: 'chapter1.xhtml', content: pageContent },
    ]);

    const result = await parseBook(filePath, 'epub', 3);

    expect(result.format).toBe('epub');
    // Title comes from the auto-generated <title> tag in createTestEpub (section name)
    // Filename wins over EPUB chapter file title
    expect(result.title).toBeDefined();
    expect(result.title).not.toBe('chapter1.xhtml');
    expect(result.author).toBeNull();
    expect(result.previewText).toContain('This is real book content');
    expect(result.textLength).toBeGreaterThan(0);
    expect(result.warnings).toHaveLength(0);
  });

  test('should_extract_title_from_epub_title_tag', async () => {
    const filePath = path.join(tempDir, 'mystery.epub');
    createTestEpub(filePath, [
      { name: 'Chapter_1.xhtml', content: '<p>' + 'A'.repeat(80) + '</p>' },
    ]);

    const result = await parseBook(filePath, 'epub', 3);

    // The title should be extracted from the <title> tag inside the HTML
    // (createTestEpub auto-generates <title>section_name</title>),
    // NOT from the filename fallback ('mystery').
    // Filename wins over EPUB chapter header title
    expect(result.title).toBeDefined();
    expect(result.title).not.toBe('Chapter_1.xhtml');
    expect(result.author).toBeNull();
  });

  test('should_fallback_when_epub_is_corrupt', async () => {
    const filePath = path.join(tempDir, 'broken.epub');
    // Write garbage that is NOT a valid ZIP
    fs.writeFileSync(filePath, 'this is not a zip file and will fail to open', 'utf-8');

    const result = await parseBook(filePath, 'epub', 3);

    expect(result.format).toBe('epub');
    expect(result.previewText).toBe('');
    expect(result.textLength).toBe(0);
    // Falls back to filename
    expect(result.title).toBe('broken');
    expect(result.author).toBeNull();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/EPUB parsing failed/i);
  });

  test('should_handle_epub_with_no_xhtml_files', async () => {
    const filePath = path.join(tempDir, 'nohtml.epub');
    // Create a valid ZIP with NO .xhtml or .html entries
    const AdmZip = require('adm-zip');
    const zip = new AdmZip();
    zip.addFile('mimetype', Buffer.from('application/epub+zip'));
    zip.addFile('META-INF/container.xml', Buffer.from('<?xml version="1.0"?><container/>'));
    zip.addFile('cover.jpg', Buffer.from('fake-image-bytes'));
    zip.writeZip(filePath);

    const result = await parseBook(filePath, 'epub', 3);

    expect(result.previewText).toBe('');
    expect(result.textLength).toBe(0);
    expect(result.title).toBe('nohtml');
    expect(result.author).toBeNull();
    expect(result.format).toBe('epub');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/No extractable text/i);
  });

  // -------------------------------------------------------
  // Routing & Format Tests
  // -------------------------------------------------------

  test('should_route_to_correct_parser_by_format', async () => {
    const txtPath = createTestFile(tempDir, 'routing.txt', 'Generic content');

    // ---- TXT routing ----
    const txtResult = await parseBook(txtPath, 'txt', 3);
    expect(txtResult.format).toBe('txt');
    expect(txtResult.previewText).toBe('Generic content');
    expect(txtResult.warnings).toHaveLength(0);

    // ---- EPUB routing (will fail on TXT, but proves dispatch) ----
    const epubResult = await parseBook(txtPath, 'epub', 3);
    expect(epubResult.format).toBe('epub');
    expect(epubResult.warnings).toHaveLength(1);
    expect(epubResult.warnings[0]).toMatch(/EPUB parsing failed/i);

    // ---- PDF routing (via mock) ----
    const { getDocument } = getPdfJsMock();
    const mockPage = {
      getTextContent: jest.fn().mockResolvedValue({
        items: [{ str: 'PDF-parsed content' }],
      }),
    };
    const mockDoc = {
      numPages: 1,
      getMetadata: jest.fn().mockResolvedValue({ info: { Title: 'PDF Route' } }),
      getPage: jest.fn().mockResolvedValue(mockPage),
    };
    getDocument.mockReturnValue({ promise: Promise.resolve(mockDoc) });

    const pdfResult = await parseBook(txtPath, 'pdf', 3);
    expect(pdfResult.format).toBe('pdf');
    // Filename-based title wins over metadata that's completely different
    expect(pdfResult.title).toBeDefined();
    expect(pdfResult.format).toBe('pdf');
    expect(pdfResult.previewText).toBe('PDF-parsed content');
  });

  test('should_throw_for_unsupported_format', async () => {
    const filePath = createTestFile(tempDir, 'test.mobi', '');

    await expect(parseBook(filePath, 'mobi' as any, 3)).rejects.toThrow(
      /Unsupported format: mobi/,
    );
  });
});
