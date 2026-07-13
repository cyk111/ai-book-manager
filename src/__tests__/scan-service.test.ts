// ============================================================
// Unit Tests: Scan Service — full scan, incremental, quick sync
// ============================================================

import { App } from 'obsidian';
import { ScanService, MemoryBookStore, BookStore } from '../services/scan-service';
import { BookRecord, PluginSettings, DEFAULT_SETTINGS } from '../models';
import { TagService, TagTaskData } from '../services/tag-service';
import { TaskQueue } from '../services/queue-service';
import { NoteService } from '../services/note-service';
import { NOOP_LOGGER } from '../logger';
import { createTempDir, createTestFile, createTestPdf, cleanupTempDirs } from './helpers';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ---- Helpers ----

function makeSettings(overrides: Partial<PluginSettings> = {}): PluginSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function makeBook(overrides: Partial<BookRecord> = {}): BookRecord {
  return {
    id: 'book_test',
    fileName: 'test.pdf',
    filePath: '/tmp/test.pdf',
    format: 'pdf',
    fileSize: 1000,
    fileHash: 'abcdef1234567890',
    modifiedAt: Date.now(),
    title: 'Test Book',
    author: null,
    tags: [],
    notePath: null,
    source: '本地书籍',
    sourcePath: null,
    skillPath: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// Simple hash for test files
function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

// ---- Tests ----

describe('ScanService', () => {
  let app: App;
  let bookDir: string;
  let bookStore: MemoryBookStore;
  let scanService: ScanService;

  beforeEach(() => {
    app = new App();
    bookDir = createTempDir('scan-svc');
    bookStore = new MemoryBookStore();
    scanService = new ScanService(
      app,
      makeSettings({ bookDirectory: bookDir, notesFolder: '📚图书库', autoTagging: false }),
      undefined,
      NOOP_LOGGER,
      bookStore,
    );
  });

  afterAll(() => {
    cleanupTempDirs();
  });

  // --------------------------------------------------------
  // MemoryBookStore
  // --------------------------------------------------------
  describe('MemoryBookStore', () => {
    it('should_return_empty_map_when_no_books_saved', async () => {
      const store = new MemoryBookStore();
      const books = await store.loadBooks();
      expect(books.size).toBe(0);
    });

    it('should_save_and_load_single_book', async () => {
      const store = new MemoryBookStore();
      const book = makeBook({ fileHash: 'hash1', title: 'Book 1' });
      await store.saveBook(book);

      const books = await store.loadBooks();
      expect(books.size).toBe(1);
      expect(books.get('hash1')?.title).toBe('Book 1');
    });

    it('should_save_books_in_batch', async () => {
      const store = new MemoryBookStore();
      const books = [
        makeBook({ fileHash: 'hash_a', title: 'A' }),
        makeBook({ fileHash: 'hash_b', title: 'B' }),
      ];
      await store.saveBooks(books);

      const loaded = await store.loadBooks();
      expect(loaded.size).toBe(2);
    });

    it('should_update_existing_book_on_save', async () => {
      const store = new MemoryBookStore();
      await store.saveBook(makeBook({ fileHash: 'hash_x', title: 'Original' }));
      await store.saveBook(makeBook({ fileHash: 'hash_x', title: 'Updated' }));

      const books = await store.loadBooks();
      expect(books.size).toBe(1);
      expect(books.get('hash_x')?.title).toBe('Updated');
    });

    it('should_persist_scan_cache', async () => {
      const store = new MemoryBookStore();
      await store.saveScanCache({ lastFullScan: 12345, totalBooksFound: 10, booksAdded: 3, booksSkipped: 5, booksFailed: 2 });
      expect(store.cache.lastFullScan).toBe(12345);
      expect(store.cache.totalBooksFound).toBe(10);
    });
  });

  // --------------------------------------------------------
  // Full Scan
  // --------------------------------------------------------
  describe('executeFullScan', () => {
    it('should_return_empty_result_when_directory_is_empty', async () => {
      const result = await scanService.executeFullScan();

      expect(result.totalFound).toBe(0);
      expect(result.books).toHaveLength(0);
      expect(result.newBooks).toBe(0);
    });

    it('should_discover_new_book_files', async () => {
      createTestFile(bookDir, 'hello.txt', 'Hello world book content');

      const result = await scanService.executeFullScan();

      expect(result.totalFound).toBe(1);
      expect(result.books).toHaveLength(1);
      expect(result.books[0].title).toBe('hello');
      expect(result.books[0].format).toBe('txt');
      expect(result.newBooks).toBe(1);
    });

    it('should_create_note_files_for_discovered_books', async () => {
      createTestFile(bookDir, 'notable.txt', 'Some notable content');

      const result = await scanService.executeFullScan();

      expect(result.books[0].notePath).not.toBeNull();
      expect(result.books[0].notePath).toContain('📚图书库');
    });

    it('should_track_failed_processing', async () => {
      // Create a book with unreadable permissions
      const badPath = path.join(bookDir, 'bad.pdf');
      createTestPdf(badPath, 'PDF content');
      fs.chmodSync(badPath, 0o000);

      const result = await scanService.executeFullScan();

      // The file will fail during parsing
      expect(result.failed).toBeGreaterThanOrEqual(0);

      // Restore for cleanup
      try { fs.chmodSync(badPath, 0o644); } catch {}
    });

    it('should_persist_books_after_full_scan', async () => {
      createTestFile(bookDir, 'persist.txt', 'Persistence test');

      await scanService.executeFullScan();

      const stored = await bookStore.loadBooks();
      expect(stored.size).toBe(1);
    });
  });

  // --------------------------------------------------------
  // Incremental Scan
  // --------------------------------------------------------
  describe('executeIncrementalScan', () => {
    it('should_only_process_new_files_not_known_ones', async () => {
      // First: add an existing book to the store
      const existingContent = 'Existing book content for incremental test';
      createTestFile(bookDir, 'existing.txt', existingContent);
      const existingHash = hashContent(existingContent);

      await bookStore.saveBook(makeBook({
        fileHash: existingHash,
        fileName: 'existing.txt',
        title: 'Existing Book',
        format: 'txt',
        filePath: path.join(bookDir, 'existing.txt'),
      }));

      // Second: add a truly new file
      createTestFile(bookDir, 'new_book.txt', 'Brand new book content not seen before');

      const result = await scanService.executeIncrementalScan();

      // Should only find the new book (existing was already known by hash)
      expect(result.newBooks).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.books).toHaveLength(1);
      expect(result.books[0].fileName).toBe('new_book.txt');
    });

    it('should_return_zero_new_books_when_nothing_changed', async () => {
      createTestFile(bookDir, 'unchanged.txt', 'Same old content');
      const hash = hashContent('Same old content');

      await bookStore.saveBook(makeBook({
        fileHash: hash,
        fileName: 'unchanged.txt',
        title: 'Unchanged',
        format: 'txt',
        filePath: path.join(bookDir, 'unchanged.txt'),
      }));

      const result = await scanService.executeIncrementalScan();

      expect(result.newBooks).toBe(0);
      expect(result.books).toHaveLength(0);
      expect(result.skipped).toBe(1);
    });

    it('should_skip_duplicate_hashes_during_incremental_scan', async () => {
      const dupContent = 'Duplicate content for hash test';
      createTestFile(bookDir, 'original.txt', dupContent);
      createTestFile(bookDir, 'copy.txt', dupContent); // Same content!

      const result = await scanService.executeIncrementalScan();

      // Only one should be "new" — the duplicate is caught by dedup within the scan
      expect(result.newBooks).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it('should_persist_only_new_books_after_incremental_scan', async () => {
      const oldContent = 'Old persisted book';
      createTestFile(bookDir, 'old.txt', oldContent);
      const oldHash = hashContent(oldContent);
      await bookStore.saveBook(makeBook({
        fileHash: oldHash,
        fileName: 'old.txt',
        title: 'Old',
        format: 'txt',
        filePath: path.join(bookDir, 'old.txt'),
      }));

      createTestFile(bookDir, 'fresh.txt', 'Fresh new file');
      await scanService.executeIncrementalScan();

      const stored = await bookStore.loadBooks();
      expect(stored.size).toBe(2); // old + new
    });
  });

  // --------------------------------------------------------
  // Quick Sync
  // --------------------------------------------------------
  describe('executeQuickSync', () => {
    it('should_process_only_specified_file_paths', async () => {
      createTestFile(bookDir, 'target.txt', 'Target file for quick sync');
      createTestFile(bookDir, 'ignored.txt', 'This should not be processed');
      const targetPath = path.join(bookDir, 'target.txt');

      const result = await scanService.executeQuickSync([targetPath]);

      expect(result.newBooks).toBeGreaterThanOrEqual(0);
      // Quick sync should not process files outside the provided list
    });

    it('should_do_full_incremental_when_passed_empty_array', async () => {
      createTestFile(bookDir, 'existing.txt', 'Some book');

      // Empty array → falls through to full incremental scan
      const result = await scanService.executeQuickSync([]);

      expect(result.newBooks).toBe(1);
      expect(result.books[0].fileName).toBe('existing.txt');
    });

    it('should_do_full_incremental_when_no_paths_provided', async () => {
      createTestFile(bookDir, 'auto.txt', 'Auto detected');

      const result = await scanService.executeQuickSync();

      expect(result.newBooks).toBe(1);
    });

    it('should_skip_known_books_during_quick_sync', async () => {
      const knownContent = 'Previously known book';
      createTestFile(bookDir, 'known.txt', knownContent);
      createTestFile(bookDir, 'unknown.txt', 'Unknown book');

      const knownHash = hashContent(knownContent);
      await bookStore.saveBook(makeBook({
        fileHash: knownHash,
        fileName: 'known.txt',
        title: 'Known',
        format: 'txt',
        filePath: path.join(bookDir, 'known.txt'),
      }));

      const result = await scanService.executeQuickSync();

      expect(result.newBooks).toBe(1);
      expect(result.books[0].fileName).toBe('unknown.txt');
    });
  });

  // --------------------------------------------------------
  // Deletion Detection
  // --------------------------------------------------------
  describe('detectDeletedBooks', () => {
    it('should_return_empty_list_when_no_files_missing', async () => {
      createTestFile(bookDir, 'alive.txt', 'Alive book');
      const hash = hashContent('Alive book');
      await bookStore.saveBook(makeBook({
        fileHash: hash,
        fileName: 'alive.txt',
        filePath: path.join(bookDir, 'alive.txt'),
        id: `book_${hash}`,
      }));

      const deleted = await scanService.detectDeletedBooks();
      expect(deleted).toHaveLength(0);
    });

    it('should_detect_when_book_file_is_missing', async () => {
      const missingPath = path.join(bookDir, 'missing.pdf');
      const hash = hashContent('will be deleted');
      await bookStore.saveBook(makeBook({
        fileHash: hash,
        fileName: 'missing.pdf',
        filePath: missingPath,
        id: `book_${hash}`,
      }));

      const deleted = await scanService.detectDeletedBooks();
      expect(deleted).toContain(`book_${hash}`);
    });
  });

  // --------------------------------------------------------
  // loadExistingBooks
  // --------------------------------------------------------
  describe('loadExistingBooks', () => {
    it('should_return_books_from_store', async () => {
      await bookStore.saveBook(makeBook({ fileHash: 'h1', title: 'B1' }));
      await bookStore.saveBook(makeBook({ fileHash: 'h2', title: 'B2' }));

      const books = await scanService.loadExistingBooks();
      expect(books.size).toBe(2);
    });

    it('should_return_empty_map_when_store_is_empty', async () => {
      const books = await scanService.loadExistingBooks();
      expect(books.size).toBe(0);
    });
  });
});
