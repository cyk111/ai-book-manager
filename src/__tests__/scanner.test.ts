// ============================================================
// Unit Tests: Scanner Module
// Tests recursive directory scanning, dedup, hash computation,
// format detection, and file system verification.
// ============================================================

import { runScanner, verifyFileSystemAccess } from '../scanner';
import {
  createTempDir,
  createTestFile,
  createTestEpub,
  createTestPdf,
  cleanupTempDirs,
} from './helpers';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

describe('Scanner', () => {
  let bookDir: string;

  beforeAll(() => {
    // Verify test dependencies are available
    expect(typeof createTempDir).toBe('function');
  });

  beforeEach(() => {
    bookDir = createTempDir('scanner');
  });

  afterAll(() => {
    cleanupTempDirs();
  });

  // --------------------------------------------------------
  // runScanner tests
  // --------------------------------------------------------
  describe('runScanner', () => {
    // ------------------------------------------------------
    // Test 1: Empty directory
    // ------------------------------------------------------
    test('should_return_empty_result_when_directory_is_empty', () => {
      const result = runScanner(bookDir, ['.pdf', '.epub', '.txt']);

      expect(result.books).toEqual([]);
      expect(result.totalFound).toBe(0);
      expect(result.newBooks).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.errors).toEqual([]);
    });

    // ------------------------------------------------------
    // Test 2: All supported formats detected
    // ------------------------------------------------------
    test('should_detect_all_supported_formats', () => {
      createTestPdf(path.join(bookDir, 'book1.pdf'), 'PDF content');
      createTestEpub(path.join(bookDir, 'book2.epub'), [
        { name: 'index.html', content: '<p>Epub content</p>' },
      ]);
      createTestFile(bookDir, 'book3.txt', 'Text content');

      const result = runScanner(bookDir, ['.pdf', '.epub', '.txt']);

      expect(result.totalFound).toBe(3);
      expect(result.books).toHaveLength(3);

      const formats = result.books.map((b) => b.format).sort();
      expect(formats).toEqual(['epub', 'pdf', 'txt']);

      // Each book has a non-empty id and hash
      for (const book of result.books) {
        expect(book.id).toMatch(/^book_[0-9a-f]{16}$/);
        expect(book.fileHash).toMatch(/^[0-9a-f]{16}$/);
      }
    });

    // ------------------------------------------------------
    // Test 3: Unsupported extensions skipped
    // ------------------------------------------------------
    test('should_skip_unsupported_extensions', () => {
      createTestFile(bookDir, 'image.jpg', 'not a book');
      createTestFile(bookDir, 'document.djvu', 'not a book');
      createTestPdf(path.join(bookDir, 'book.pdf'), 'real book');

      const result = runScanner(bookDir, ['.pdf', '.epub', '.txt']);

      expect(result.totalFound).toBe(1);
      expect(result.books).toHaveLength(1);
      expect(result.books[0].format).toBe('pdf');
      expect(result.books[0].fileName).toBe('book.pdf');
    });

    // ------------------------------------------------------
    // Test 4: Deduplicate identical files (same hash)
    // ------------------------------------------------------
    test('should_deduplicate_identical_files', () => {
      // Two files with identical content -> same hash -> dedup
      createTestFile(bookDir, 'book1.txt', 'identical content');
      createTestFile(bookDir, 'book2.txt', 'identical content');
      // Third file with different content -> unique
      createTestFile(bookDir, 'unique.txt', 'different content');

      const result = runScanner(bookDir, ['.txt']);

      // totalFound counts every matching file
      expect(result.totalFound).toBe(3);
      // Only 2 unique hashes -> 2 books
      expect(result.books).toHaveLength(2);
      expect(result.newBooks).toBe(2);
      expect(result.skipped).toBe(1);
      expect(result.failed).toBe(0);

      // The unique file should always be present
      const fileNames = result.books.map((b) => b.fileName);
      expect(fileNames).toContain('unique.txt');
    });

    // ------------------------------------------------------
    // Test 5: Non-existent directory via verifyFileSystemAccess
    // ------------------------------------------------------
    test('should_throw_when_directory_does_not_exist', () => {
      const result = verifyFileSystemAccess('/nonexistent/path/for/test');

      expect(result).toContain('Directory does not exist');
      expect(result).toContain('/nonexistent/path/for/test');
    });

    // ------------------------------------------------------
    // Test 6: Recursive directory walk
    // ------------------------------------------------------
    test('should_recursively_walk_nested_directories', () => {
      const subDir1 = path.join(bookDir, 'subdir1');
      const subDir2 = path.join(bookDir, 'subdir1', 'subdir2');
      fs.mkdirSync(subDir1, { recursive: true });
      fs.mkdirSync(subDir2, { recursive: true });

      createTestFile(bookDir, 'root.txt', 'root level');
      createTestPdf(path.join(subDir1, 'nested.pdf'), 'one level deep');
      createTestEpub(path.join(subDir2, 'deep.epub'), [
        { name: 'index.html', content: '<p>Two levels deep</p>' },
      ]);

      const result = runScanner(bookDir, ['.pdf', '.epub', '.txt']);

      expect(result.totalFound).toBe(3);
      expect(result.books).toHaveLength(3);

      const fileNames = result.books.map((b) => b.fileName).sort();
      expect(fileNames).toEqual(['deep.epub', 'nested.pdf', 'root.txt']);

      // Verify file paths reflect actual locations
      const rootBook = result.books.find((b) => b.fileName === 'root.txt');
      expect(rootBook!.filePath).toBe(path.join(bookDir, 'root.txt'));

      const nestedBook = result.books.find((b) => b.fileName === 'nested.pdf');
      expect(nestedBook!.filePath).toBe(path.join(subDir1, 'nested.pdf'));

      const deepBook = result.books.find((b) => b.fileName === 'deep.epub');
      expect(deepBook!.filePath).toBe(path.join(subDir2, 'deep.epub'));
    });

    // ------------------------------------------------------
    // Test 7: BookRecord fields populated correctly
    // ------------------------------------------------------
    test('should_correctly_populate_book_record_fields', () => {
      const content = 'Field validation test content';
      createTestFile(bookDir, 'my- book.txt', content);

      const result = runScanner(bookDir, ['.txt']);

      expect(result.books).toHaveLength(1);
      const book = result.books[0];

      // Compute expected hash (identical to scanner's hashFileHead for small files)
      const expectedHash = crypto
        .createHash('sha256')
        .update(content)
        .digest('hex')
        .slice(0, 16);

      // --- Core identity fields ---
      expect(book.id).toBe(`book_${expectedHash}`);
      expect(book.id).toMatch(/^book_[0-9a-f]{16}$/);

      // --- File metadata ---
      expect(book.fileName).toBe('my- book.txt');
      expect(book.filePath).toBe(path.join(bookDir, 'my- book.txt'));
      expect(book.format).toBe('txt');
      expect(book.fileSize).toBe(Buffer.byteLength(content, 'utf-8'));
      expect(book.fileHash).toBe(expectedHash);
      expect(book.modifiedAt).toBeGreaterThan(0);

      // --- Derived fields ---
      // sanitizeTitle: removes extension, replaces FS-unsafe chars with '-', trims
      expect(book.title).toBe('my- book');
      expect(book.author).toBeNull();
      expect(book.tags).toEqual([]);
      expect(book.notePath).toBeNull();

      // --- Timestamps ---
      expect(book.createdAt).toBeGreaterThan(0);
      expect(book.updatedAt).toBe(book.createdAt);
      // Should be close to current time
      const now = Date.now();
      expect(book.createdAt).toBeGreaterThan(now - 60_000);
      expect(book.createdAt).toBeLessThanOrEqual(now + 1000);
    });

    // ------------------------------------------------------
    // Test 8: Stats tracking for new, skipped, failed
    // ------------------------------------------------------
    test('should_track_failed_new_skipped_counts', () => {
      // Two unique, readable files
      createTestFile(bookDir, 'file_a.txt', 'alpha content');
      createTestFile(bookDir, 'file_b.txt', 'beta content');

      // Duplicate of file_a (same content) -> should be skipped
      createTestFile(bookDir, 'file_a_dup.txt', 'alpha content');

      // File that exists but is unreadable -> should fail
      const unreadablePath = path.join(bookDir, 'secret.txt');
      createTestFile(bookDir, 'secret.txt', 'hidden content');
      fs.chmodSync(unreadablePath, 0o000);

      const result = runScanner(bookDir, ['.txt']);

      // Stats
      expect(result.totalFound).toBe(4);
      expect(result.newBooks).toBe(2); // two unique hashes with readable files
      expect(result.books).toHaveLength(2);
      expect(result.skipped).toBe(1); // file_a_dup deduped
      expect(result.failed).toBe(1); // secret.txt unreadable

      // Error message contains the problematic file
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('secret.txt');
      expect(result.errors[0]).toContain('EACCES');

      // Restore permissions for cleanup
      try {
        fs.chmodSync(unreadablePath, 0o644);
      } catch {
        // Best effort
      }
    });

    // ------------------------------------------------------
    // Test 9: Skip already known hashes (existingBooks map)
    // ------------------------------------------------------
    test('should_skip_already_known_hashes', () => {
      const content = 'content for existing hash';
      createTestFile(bookDir, 'existing.txt', content);

      // Compute the hash the same way runScanner does
      const hash = crypto
        .createHash('sha256')
        .update(content)
        .digest('hex')
        .slice(0, 16);

      // Build existingBooks map with a record that has this hash
      const existingBooks = new Map<string, import('../models').BookRecord>();
      existingBooks.set('old_id', {
        id: 'old_id',
        fileName: 'old_name.txt',
        filePath: '/old/path.txt',
        format: 'txt',
        fileSize: 100,
        fileHash: hash,
        modifiedAt: 1000,
        title: 'old title',
        author: null,
        tags: [],
        notePath: null,
        source: '本地书籍',
        sourcePath: null,
        createdAt: 1000,
        updatedAt: 1000,
      });

      const result = runScanner(bookDir, ['.txt'], existingBooks);

      // File was found but skipped because its hash is known
      expect(result.totalFound).toBe(1);
      expect(result.books).toHaveLength(0);
      expect(result.newBooks).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.failed).toBe(0);
    });

    // ------------------------------------------------------
    // Test 10: Chinese filenames
    // ------------------------------------------------------
    test('should_handle_files_with_chinese_names', () => {
      createTestFile(bookDir, '中文书名.txt', 'Chinese content');
      createTestPdf(path.join(bookDir, '测试文档.pdf'), 'PDF with Chinese name');
      createTestEpub(path.join(bookDir, '混合名称.epub'), [
        { name: 'index.html', content: '<p>Epub Chinese name</p>' },
      ]);

      const result = runScanner(bookDir, ['.pdf', '.epub', '.txt']);

      expect(result.totalFound).toBe(3);
      expect(result.books).toHaveLength(3);

      const fileNames = result.books.map((b) => b.fileName).sort();
      expect(fileNames).toEqual(['中文书名.txt', '测试文档.pdf', '混合名称.epub']);

      // Titles should preserve Chinese characters (non-ASCII are not FS-unsafe)
      const titles = result.books.map((b) => b.title).sort();
      expect(titles).toContain('中文书名');
      expect(titles).toContain('测试文档');
      expect(titles).toContain('混合名称');

      // Verify format detection still works
      const formats = result.books.map((b) => b.format).sort();
      expect(formats).toEqual(['epub', 'pdf', 'txt']);
    });

    // ------------------------------------------------------
    // Test 11: Only hash first 64KB (not whole file)
    // ------------------------------------------------------
    test('should_only_hash_first_64kb', () => {
      // Create a 200KB file - only first 64KB should be hashed
      const largeContent = 'x'.repeat(200 * 1024);
      createTestFile(bookDir, 'large_book.txt', largeContent);

      const result = runScanner(bookDir, ['.txt']);

      expect(result.books).toHaveLength(1);
      const book = result.books[0];

      // Confirm the file is indeed larger than 64KB
      expect(book.fileSize).toBeGreaterThan(64 * 1024);

      // Compute expected hash: sha256 of first 64KB of 'x' chars
      // Each 'x' is 1 byte in UTF-8, so Buffer.alloc(65536, 0x78)
      const first64kb = Buffer.alloc(64 * 1024, 0x78); // 0x78 = 'x'
      const expectedHash = crypto
        .createHash('sha256')
        .update(first64kb)
        .digest('hex')
        .slice(0, 16);

      expect(book.fileHash).toBe(expectedHash);

      // The hash should NOT equal the hash of the full 200KB
      const fullContent = Buffer.alloc(200 * 1024, 0x78);
      const fullHash = crypto
        .createHash('sha256')
        .update(fullContent)
        .digest('hex')
        .slice(0, 16);
      expect(book.fileHash).not.toBe(fullHash);
    });

    // ------------------------------------------------------
    // Coverage edge: unreadable subdirectory (lines 87-88)
    // ------------------------------------------------------
    test('should_log_error_when_subdirectory_is_not_readable', () => {
      // Create a subdirectory and lock it so readdirSync fails
      const lockedDir = path.join(bookDir, 'locked');
      fs.mkdirSync(lockedDir);
      createTestPdf(path.join(lockedDir, 'lost.pdf'), 'lost in locked dir');
      // Remove all permissions from the directory
      fs.chmodSync(lockedDir, 0o000);

      // Also have a readable file at root so we get some results
      createTestFile(bookDir, 'root.txt', 'I am accessible');

      const result = runScanner(bookDir, ['.pdf', '.txt']);

      expect(result.totalFound).toBe(1); // only root.txt
      expect(result.books).toHaveLength(1);
      expect(result.books[0].fileName).toBe('root.txt');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Cannot read directory');
      expect(result.errors[0]).toContain('locked');

      // Restore for cleanup
      try {
        fs.chmodSync(lockedDir, 0o755);
      } catch {
        // Best effort
      }
    });
  });

  // --------------------------------------------------------
  // verifyFileSystemAccess tests
  // --------------------------------------------------------
  describe('verifyFileSystemAccess', () => {
    // ------------------------------------------------------
    // Additional coverage for verifyFileSystemAccess
    // ------------------------------------------------------
    test('should_return_error_when_bookDir_is_empty_string', () => {
      const result = verifyFileSystemAccess('');

      expect(result).toContain('No book directory configured');
    });

    test('should_return_error_when_path_is_not_a_directory', () => {
      const filePath = path.join(bookDir, 'not_a_dir.txt');
      createTestFile(bookDir, 'not_a_dir.txt', 'this is a file, not a directory');

      const result = verifyFileSystemAccess(filePath);

      expect(result).toContain('Path is not a directory');
      expect(result).toContain('not_a_dir.txt');
    });

    test('should_return_formatted_summary_on_success', () => {
      createTestPdf(path.join(bookDir, 'doc.pdf'), 'PDF doc');
      createTestFile(bookDir, 'note.txt', 'Text note');

      const result = verifyFileSystemAccess(bookDir);

      expect(result).toContain('File system access: OK');
      expect(result).toContain('Total books found: 2');
      expect(result).toContain('New books: 2');
      expect(result).toContain('Skipped');
      expect(result).toContain('Failed');
      expect(result).not.toContain('Errors'); // no errors in this happy path
    });

    test('should_include_errors_section_when_scan_has_errors', () => {
      // Create a file then make it unreadable
      const unreadablePath = path.join(bookDir, 'broken.pdf');
      createTestPdf(unreadablePath, 'will be unreadable');
      fs.chmodSync(unreadablePath, 0o000);

      const result = verifyFileSystemAccess(bookDir);

      expect(result).toContain('File system access: OK');
      expect(result).toContain('Total books found: 1');
      expect(result).toContain('Failed: 1');
      expect(result).toContain('Errors');

      // Restore permissions for cleanup
      try {
        fs.chmodSync(unreadablePath, 0o644);
      } catch {
        // Best effort
      }
    });
  });
});
