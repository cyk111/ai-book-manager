// ============================================================
// Scan Service — orchestrate scan → parse → create notes
// ============================================================

import { App } from 'obsidian';
import { BookRecord, ScanCache, PluginSettings } from '../models';
import { runScanner, validateBookDirectory, ScanResult } from '../scanner';
import { parseBook } from '../parser';
import { NoteService } from './note-service';
import { BOOK_CATEGORIES } from '../constants';
import { TagService } from './tag-service';
import { Logger, createLogger, NOOP_LOGGER } from '../logger';
import { generateCorrelationId } from '../errors';

// ---- Types ----

export interface ScanProgress {
  phase: 'scanning' | 'parsing' | 'creating_notes' | 'complete';
  current: number;
  total: number;
  bookTitle?: string;
  error?: string;
}

export type ScanProgressCallback = (progress: ScanProgress) => void;

/**
 * BookStore — persistence interface for book records.
 * The plugin (main.ts) implements this using Obsidian's loadData/saveData.
 */
export interface BookStore {
  /** Load all known book records (indexed by fileHash) */
  loadBooks(): Promise<Map<string, BookRecord>>;
  /** Save a single book record */
  saveBook(book: BookRecord): Promise<void>;
  /** Save all book records (batch) */
  saveBooks(books: BookRecord[]): Promise<void>;
  /** Save scan cache metadata */
  saveScanCache(cache: ScanCache): Promise<void>;
}

// ---- In-memory BookStore (for tests / when plugin data unavailable) ----

export class MemoryBookStore implements BookStore {
  private books: Map<string, BookRecord> = new Map();
  cache: ScanCache = { lastFullScan: null, totalBooksFound: 0, booksAdded: 0, booksSkipped: 0, booksFailed: 0 };

  async loadBooks(): Promise<Map<string, BookRecord>> {
    return new Map(this.books);
  }

  async saveBook(book: BookRecord): Promise<void> {
    this.books.set(book.fileHash, book);
  }

  async saveBooks(books: BookRecord[]): Promise<void> {
    for (const book of books) {
      this.books.set(book.fileHash, book);
    }
  }

  async saveScanCache(cache: ScanCache): Promise<void> {
    this.cache = cache;
  }

  getAllBooks(): BookRecord[] {
    return Array.from(this.books.values());
  }
}

// ---- Scan Service ----

export class ScanService {
  private app: App;
  private settings: PluginSettings;
  private noteService: NoteService;
  private tagService: TagService | null;
  private bookStore: BookStore;
  private log: Logger;

  constructor(
    app: App,
    settings: PluginSettings,
    tagService?: TagService,
    logger?: Logger,
    bookStore?: BookStore,
  ) {
    this.app = app;
    this.settings = settings;
    // File-scanned books go under 📚图书库/本地书籍/
    const localFolder = `${settings.notesFolder}/本地书籍`;
    this.noteService = new NoteService(app, localFolder, logger);
    this.tagService = tagService || null;
    this.bookStore = bookStore || new MemoryBookStore();
    this.log = logger || createLogger('scan-service');
  }

  // ---- Full Scan ----

  async executeFullScan(
    onProgress?: ScanProgressCallback,
  ): Promise<ScanResult> {
    const cid = generateCorrelationId();
    this.log.info('Full scan started');

    // 1. Validate directory
    validateBookDirectory(this.settings.bookDirectory, cid);

    // 2. Ensure vault directories exist
    await this.noteService.ensureCategoryDirectories(BOOK_CATEGORIES);

    // 3. Load existing books for dedup, but filter out missing notes
    const allKnown = await this.bookStore.loadBooks();
    const existingBooks = await this.filterMissingNotes(allKnown);
    const missingNotes = allKnown.size - existingBooks.size;
    if (missingNotes > 0) {
      this.log.info('Books with missing notes will be re-created', { count: missingNotes });
    }

    // 4. Scan file system
    onProgress?.({ phase: 'scanning', current: 0, total: 0 });
    const scanResult = runScanner(
      this.settings.bookDirectory,
      this.settings.supportedFormats,
      existingBooks,
      this.log,
    );

    this.log.info('File scan complete', {
      found: scanResult.totalFound,
      new: scanResult.newBooks,
      skipped: scanResult.skipped,
    });

    // 5. Process new books (parse → create notes → tag)
    await this.processNewBooks(scanResult, onProgress);

    // 6. Persist all new books
    await this.bookStore.saveBooks(scanResult.books);

    // 7. Update scan cache
    const cache: ScanCache = {
      lastFullScan: Date.now(),
      totalBooksFound: scanResult.totalFound,
      booksAdded: scanResult.newBooks,
      booksSkipped: scanResult.skipped,
      booksFailed: scanResult.failed,
    };
    await this.bookStore.saveScanCache(cache);

    onProgress?.({ phase: 'complete', current: scanResult.books.length, total: scanResult.books.length });
    this.log.info('Full scan complete', { newBooks: scanResult.newBooks });

    return scanResult;
  }

  // ---- Incremental Scan (only processes new/changed files) ----

  async executeIncrementalScan(
    onProgress?: ScanProgressCallback,
  ): Promise<ScanResult> {
    this.log.info('Incremental scan started');

    // 1. Validate directory
    const cid = generateCorrelationId();
    validateBookDirectory(this.settings.bookDirectory, cid);

    // 2. Load existing books, but filter out any whose notes are missing (deleted)
    const allKnown = await this.bookStore.loadBooks();
    const existingBooks = await this.filterMissingNotes(allKnown);
    const knownCount = existingBooks.size;
    const missingNotes = allKnown.size - existingBooks.size;
    if (missingNotes > 0) {
      this.log.info('Skipped books with missing notes — will re-create', { count: missingNotes });
    }

    // 3. Scan — runScanner skips known hashes automatically
    onProgress?.({ phase: 'scanning', current: 0, total: 0 });
    const scanResult = runScanner(
      this.settings.bookDirectory,
      this.settings.supportedFormats,
      existingBooks,
      this.log,
    );

    this.log.info('Incremental scan file phase complete', {
      totalFound: scanResult.totalFound,
      newBooks: scanResult.newBooks,
      skipped: scanResult.skipped,
      previouslyKnown: knownCount,
    });

    // 4. If no new books, we're done
    if (scanResult.books.length === 0) {
      this.log.info('No new books found in incremental scan');
      onProgress?.({ phase: 'complete', current: 0, total: 0 });
      return scanResult;
    }

    // 5. Process only the new books (NOT a full scan)
    await this.processNewBooks(scanResult, onProgress);

    // 6. Persist new books
    await this.bookStore.saveBooks(scanResult.books);

    // 7. Update cache
    const cache: ScanCache = {
      lastFullScan: Date.now(),
      totalBooksFound: existingBooks.size + scanResult.newBooks,
      booksAdded: scanResult.newBooks,
      booksSkipped: scanResult.skipped,
      booksFailed: scanResult.failed,
    };
    await this.bookStore.saveScanCache(cache);

    onProgress?.({ phase: 'complete', current: scanResult.books.length, total: scanResult.books.length });
    this.log.info('Incremental scan complete', {
      newBooks: scanResult.newBooks,
      totalKnown: existingBooks.size + scanResult.newBooks,
    });

    return scanResult;
  }

  // ---- Quick Sync (lightweight — for startup / file watcher trigger) ----

  async executeQuickSync(
    newFilePaths?: string[],
    onProgress?: ScanProgressCallback,
  ): Promise<ScanResult> {
    this.log.info('Quick sync started', { providedPaths: newFilePaths?.length || 0 });

    const allKnown = await this.bookStore.loadBooks();
    const existingBooks = await this.filterMissingNotes(allKnown);

    // If specific file paths are provided (from file watcher), only scan those.
    // Otherwise, do a full incremental scan.
    let scanResult: ScanResult;

    if (newFilePaths && newFilePaths.length > 0) {
      // Targeted: only scan the provided files
      scanResult = {
        books: [],
        totalFound: 0,
        newBooks: 0,
        skipped: 0,
        failed: 0,
        errors: [],
      };

      for (const filePath of newFilePaths) {
        // Quick hash check against known books
        const fullScan = runScanner(
          this.settings.bookDirectory,
          this.settings.supportedFormats,
          existingBooks,
          this.log,
        );
        // Filter to only the files we care about
        const matching = fullScan.books.filter(b => newFilePaths.includes(b.filePath));
        scanResult.books.push(...matching);
      }
      scanResult.newBooks = scanResult.books.length;
    } else {
      // Full incremental scan
      scanResult = runScanner(
        this.settings.bookDirectory,
        this.settings.supportedFormats,
        existingBooks,
        this.log,
      );
    }

    if (scanResult.books.length === 0) {
      this.log.debug('Quick sync: no new books');
      return scanResult;
    }

    // Process new books
    await this.processNewBooks(scanResult, onProgress);

    // Persist
    await this.bookStore.saveBooks(scanResult.books);

    this.log.info('Quick sync complete', { newBooks: scanResult.newBooks });
    return scanResult;
  }

  // ---- Deletion Detection ----

  async detectDeletedBooks(): Promise<string[]> {
    const existingBooks = await this.bookStore.loadBooks();
    const deleted: string[] = [];

    for (const [, book] of existingBooks) {
      try {
        const fs = require('fs');
        if (!fs.existsSync(book.filePath)) {
          deleted.push(book.id);
          this.log.info('Book file missing', { id: book.id, title: book.title, path: book.filePath });
        }
      } catch {
        // If we can't check, skip
      }
    }

    return deleted;
  }

  // ---- Book Records Access ----

  async loadExistingBooks(): Promise<Map<string, BookRecord>> {
    return this.bookStore.loadBooks();
  }

  getBookStore(): BookStore {
    return this.bookStore;
  }

  // ---- Private: shared processing logic ----

  private async processNewBooks(
    scanResult: ScanResult,
    onProgress?: ScanProgressCallback,
  ): Promise<void> {
    if (scanResult.books.length === 0) return;

    for (let i = 0; i < scanResult.books.length; i++) {
      const book = scanResult.books[i];

      try {
        onProgress?.({
          phase: 'parsing',
          current: i + 1,
          total: scanResult.books.length,
          bookTitle: book.title,
        });

        // Parse book for metadata
        const parsed = await parseBook(
          book.filePath,
          book.format,
          this.settings.maxScanPages,
          this.log,
        );

        // Merge parsed metadata
        if (parsed.title && parsed.title !== book.title) {
          book.title = parsed.title;
        }
        if (parsed.author) {
          book.author = parsed.author;
        }

        // Create note
        onProgress?.({
          phase: 'creating_notes',
          current: i + 1,
          total: scanResult.books.length,
          bookTitle: book.title,
        });

        const file = await this.noteService.createBookNote(book);
        book.notePath = file.path;

        // Auto-tag if enabled
        if (this.settings.autoTagging && this.tagService) {
          const snippet = parsed.previewText || `${book.title} ${book.author || ''}`;
          const dirHint = this.extractDirectoryHint(book.filePath);
          this.tagService.enqueueBook(book, snippet, book.notePath || '', dirHint);
          this.log.info('Book enqueued for tagging', {
            title: book.title,
            notePath: book.notePath,
            hasPreview: !!parsed.previewText,
            dirHint,
          });
        }

        this.log.info('Book processed', { title: book.title, notePath: file.path });
      } catch (err) {
        scanResult.failed++;
        scanResult.errors.push(
          `Failed to process ${book.fileName}: ${String(err)}`,
        );
        this.log.warn('Book processing failed', {
          fileName: book.fileName,
          error: String(err),
        });
      }
    }
  }

  // ---- Helpers ----

  /**
   * Filter out books whose note files have been deleted from the vault.
   * These books should be re-processed (notes re-created) on next scan.
   */
  private async filterMissingNotes(books: Map<string, BookRecord>): Promise<Map<string, BookRecord>> {
    const result = new Map<string, BookRecord>();
    for (const [hash, book] of books) {
      if (book.notePath) {
        const exists = this.app.vault.getFileByPath(book.notePath);
        if (!exists) {
          this.log.debug('Note missing, will re-scan', { title: book.title, notePath: book.notePath });
          continue; // Don't include — will be re-discovered
        }
      }
      result.set(hash, book);
    }
    return result;
  }

  /** Extract parent directory name as a potential category hint */
  private extractDirectoryHint(filePath: string): string {
    const parts = filePath.replace(/\\/g, '/').split('/');
    if (parts.length >= 2) {
      const parentDir = parts[parts.length - 2];
      const skipDirs = new Set(['books', 'downloads', 'documents', 'desktop', '..', '.']);
      if (!skipDirs.has(parentDir.toLowerCase()) && parentDir.length >= 2) {
        return parentDir;
      }
    }
    return '';
  }

  // ---- Accessors ----

  getNoteService(): NoteService {
    return this.noteService;
  }
}
