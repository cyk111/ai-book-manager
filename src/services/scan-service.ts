// ============================================================
// Scan Service — orchestrate scan → parse → create notes
// ============================================================

import { App } from 'obsidian';
import { BookRecord, ScanCache, PluginSettings } from '../models';
import { runScanner, validateBookDirectory, ScanResult } from '../scanner';
import { parseBook, ParserResult } from '../parser';
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

// ---- Scan Service ----

export class ScanService {
  private app: App;
  private settings: PluginSettings;
  private noteService: NoteService;
  private tagService: TagService | null;
  private log: Logger;

  constructor(app: App, settings: PluginSettings, tagService?: TagService, logger?: Logger) {
    this.app = app;
    this.settings = settings;
    this.noteService = new NoteService(app, settings.notesFolder, logger);
    this.tagService = tagService || null;
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

    // 2. Ensure vault directories exist (only on first scan)
    await this.noteService.ensureCategoryDirectories(BOOK_CATEGORIES);

    // 3. Load existing books for dedup
    const existingBooks = await this.loadExistingBooks();

    // 3. Scan file system
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

    // 4. Parse and create notes for new books
    onProgress?.({
      phase: 'parsing',
      current: 0,
      total: scanResult.newBooks,
    });

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

        // Persist book record
        await this.saveBookRecord(book);

        // Auto-tag if enabled (even without preview text, use filename+author)
        if (this.settings.autoTagging && this.tagService) {
          const snippet = parsed.previewText || `${book.title} ${book.author || ''}`;
          // Extract parent directory as category hint (e.g. "股票类")
          const dirHint = this.extractDirectoryHint(book.filePath);
          this.tagService.enqueueBook(book, snippet, book.notePath || '', dirHint);
          this.log.info('Book enqueued for tagging', { title: book.title, notePath: book.notePath, hasPreview: !!parsed.previewText, dirHint });
        }

        this.log.info('Book processed', {
          title: book.title,
          notePath: file.path,
        });
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

    // 5. Update scan cache
    await this.updateScanCache(scanResult);

    onProgress?.({ phase: 'complete', current: scanResult.books.length, total: scanResult.books.length });
    this.log.info('Full scan complete', { newBooks: scanResult.newBooks });

    return scanResult;
  }

  // ---- Incremental Scan ----

  async executeIncrementalScan(
    onProgress?: ScanProgressCallback,
  ): Promise<ScanResult> {
    this.log.info('Incremental scan started');

    const existingBooks = await this.loadExistingBooks();

    // Scan with existing books for dedup
    const scanResult = runScanner(
      this.settings.bookDirectory,
      this.settings.supportedFormats,
      existingBooks,
      this.log,
    );

    // Only process new/modified books (runScanner's dedup already handles duplicates)
    if (scanResult.newBooks > 0) {
      return this.executeFullScan(onProgress);
    }

    this.log.info('No new books found');
    return scanResult;
  }

  // ---- Book Records Management ----

  async loadExistingBooks(): Promise<Map<string, BookRecord>> {
    const data = await this.app.vault.adapter?.read?.('.obsidian/plugins/ai-book-manager/data.json')
      .catch(() => null) as string | null;

    if (!data) return new Map();

    try {
      const parsed = JSON.parse(data);
      const books: BookRecord[] = parsed?.books || [];
      const map = new Map<string, BookRecord>();
      for (const book of books) {
        map.set(book.fileHash, book);
      }
      return map;
    } catch {
      return new Map();
    }
  }

  async saveBookRecord(book: BookRecord): Promise<void> {
    // Books are saved via Plugin.saveData() which the plugin calls
    // This is a placeholder — the actual persistence is managed by main.ts
    // through the plugin's loadData/saveData lifecycle
    this.log.debug('Book record saved (via plugin data)', { bookId: book.id });
  }

  async updateScanCache(result: ScanResult): Promise<void> {
    const cache: ScanCache = {
      lastFullScan: Date.now(),
      totalBooksFound: result.totalFound,
      booksAdded: result.newBooks,
      booksSkipped: result.skipped,
      booksFailed: result.failed,
    };
    // Will be persisted by the plugin's saveData
    this.log.info('Scan cache updated', cache as unknown as Record<string, unknown>);
  }

  // ---- Helpers ----

  /** Extract parent directory name as a potential category hint */
  private extractDirectoryHint(filePath: string): string {
    const parts = filePath.replace(/\\/g, '/').split('/');
    // Get the immediate parent directory name
    if (parts.length >= 2) {
      const parentDir = parts[parts.length - 2];
      // Skip common non-category dirs
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
