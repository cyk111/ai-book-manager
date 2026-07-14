// ============================================================
// Source Scanner — scan markdown note sources (weread, ibook, etc.)
// ============================================================

import { App, TFile, Notice } from 'obsidian';
import { BookRecord, NoteSource, PluginSettings } from '../models';
import { NoteService } from './note-service';
import { TagService } from './tag-service';
import { BookStore } from './scan-service';
import { Logger, NOOP_LOGGER } from '../logger';
import { extractMetadata } from '../utils/metadata-extractor';
import { findMatches, generateRelatedSection } from '../utils/book-matcher';
import { BOOK_CATEGORIES } from '../constants';
import { generateCorrelationId } from '../errors';
import * as crypto from 'crypto';

// ---- Types ----

export interface SourceScanResult {
  source: NoteSource;
  found: number;
  newBooks: number;
  skipped: number;
  errors: string[];
}

// ---- Source Scanner ----

export class SourceScanner {
  private app: App;
  private settings: PluginSettings;
  private noteService: NoteService;
  private tagService: TagService | null;
  private bookStore: BookStore;
  private log: Logger;

  constructor(
    app: App,
    settings: PluginSettings,
    noteService: NoteService,
    tagService: TagService | null,
    bookStore: BookStore,
    logger: Logger = NOOP_LOGGER,
  ) {
    this.app = app;
    this.settings = settings;
    this.noteService = noteService;
    this.tagService = tagService;
    this.bookStore = bookStore;
    this.log = logger;
  }

  // ---- Scan All Sources ----

  async scanAllSources(): Promise<SourceScanResult[]> {
    const results: SourceScanResult[] = [];

    for (const source of this.settings.noteSources) {
      const result = await this.scanSource(source);
      results.push(result);
    }

    // After all sources scanned, run cross-reference
    await this.crossReference();

    return results;
  }

  // ---- Scan Single Source ----

  async scanSource(source: NoteSource): Promise<SourceScanResult> {
    const cid = generateCorrelationId();
    this.log.info('Source scan started', { source: source.name, path: source.path });

    const result: SourceScanResult = {
      source,
      found: 0,
      newBooks: 0,
      skipped: 0,
      errors: [],
    };

    // Find all .md files in the source directory
    const folder = this.app.vault.getFolderByPath(source.path);
    if (!folder) {
      result.errors.push(`Source directory not found: ${source.path}`);
      this.log.warn('Source directory not found', { path: source.path });
      return result;
    }

    const mdFiles = this.app.vault.getMarkdownFiles().filter(f =>
      f.path.startsWith(source.path + '/')
    );

    result.found = mdFiles.length;

    // Load existing books for dedup
    const existingBooks = await this.bookStore.loadBooks();
    const sourceBooks = new Map<string, BookRecord>();
    for (const [, book] of existingBooks) {
      if (book.source === source.name) {
        sourceBooks.set(book.fileHash, book);
      }
    }

    for (const file of mdFiles) {
      try {
        const content = await this.app.vault.read(file);
        const hash = this.hashContent(content);

        // Check if already known AND index card still exists
        if (sourceBooks.has(hash)) {
          const knownBook = sourceBooks.get(hash)!;
          if (knownBook.notePath && this.app.vault.getFileByPath(knownBook.notePath)) {
            result.skipped++;
            this.log.debug('Source book already indexed', { file: file.path });
            continue;
          }
          // Index card was deleted — remove from map so we re-create it
          this.log.info('Index card missing, will re-create', { title: knownBook.title, notePath: knownBook.notePath });
          sourceBooks.delete(hash);
        }

        // Extract metadata
        const meta = extractMetadata(content, file.name, source.name);

        // Create BookRecord
        const now = Date.now();
        const book: BookRecord = {
          id: `src_${hash}`,
          fileName: file.name,
          filePath: file.path, // vault-relative path
          format: 'md',
          fileSize: content.length,
          fileHash: hash,
          modifiedAt: file.stat.mtime,
          title: meta.title,
          author: meta.author,
          tags: [],
          notePath: null,
          source: source.name,
          sourcePath: file.path,
          skillPath: null,
          createdAt: now,
          updatedAt: now,
        };

        // Create index card
        const indexCardPath = await this.createIndexCard(book, meta, source);
        book.notePath = indexCardPath;

        // Persist
        await this.bookStore.saveBook(book);
        sourceBooks.set(hash, book);

        // Auto-tag if enabled
        if (this.settings.autoTagging && this.tagService) {
          this.tagService.enqueueBook(
            book,
            meta.rawContent.slice(0, 500),
            indexCardPath,
            meta.sourceCategory || '',
          );
        }

        result.newBooks++;
        this.log.info('Source book indexed', {
          title: meta.title,
          source: source.name,
          indexCard: indexCardPath,
        });
      } catch (err) {
        result.errors.push(`Failed to index ${file.name}: ${String(err)}`);
        this.log.warn('Source book indexing failed', {
          file: file.name,
          error: String(err),
        });
      }
    }

    this.log.info('Source scan complete', {
      source: source.name,
      found: result.found,
      newBooks: result.newBooks,
      skipped: result.skipped,
    });

    return result;
  }

  // ---- Cross-Reference ----

  async crossReference(): Promise<void> {
    const allBooks = await this.bookStore.loadBooks();
    const bookList = Array.from(allBooks.values());

    if (bookList.length < 2) return;

    this.log.info('Cross-referencing books', { total: bookList.length });

    for (const book of bookList) {
      if (!book.notePath) continue;

      const matches = findMatches(book, bookList);
      if (matches.length === 0) continue;

      const related = generateRelatedSection(book, matches);
      if (!related) continue;

      // Write related section to the index card
      const file = this.app.vault.getFileByPath(book.notePath);
      if (file) {
        try {
          const current = await this.app.vault.read(file);
          // Remove old related section if present
          const cleaned = current.replace(/\n📎 关联资源：[\s\S]*?(?=\n## |\n🤖|\n---\n*$|$)/, '');
          const updated = cleaned.trimEnd() + '\n\n' + related + '\n';
          await this.app.vault.modify(file, updated);
          this.log.debug('Cross-reference written', {
            book: book.title,
            links: matches.length,
          });
        } catch (err) {
          this.log.warn('Failed to write cross-reference', {
            book: book.title,
            error: String(err),
          });
        }
      }
    }
  }

  // ---- Index Card Creation ----

  private async createIndexCard(
    book: BookRecord,
    meta: ReturnType<typeof extractMetadata>,
    source: NoteSource,
  ): Promise<string> {
    const sourceFolder = `${this.settings.notesFolder}/${source.name}`;
    const fileName = sanitizeForPath(book.title) + '.md';
    const cardPath = `${sourceFolder}/${fileName}`;

    // Ensure source folder exists
    if (!this.app.vault.getFolderByPath(sourceFolder)) {
      await this.app.vault.createFolder(sourceFolder);
    }

    // Check if already exists
    const existing = this.app.vault.getFileByPath(cardPath);
    if (existing) {
      this.log.debug('Index card already exists', { path: cardPath });
      return cardPath;
    }

    const created = this.formatDate(book.createdAt);
    const sourceLink = book.sourcePath ? `[[${book.sourcePath}|原始笔记]]` : '';

    const content = `---
title: "${this.escapeYaml(book.title)}"
author: "${book.author ? this.escapeYaml(book.author) : '未知'}"
book_id: "${book.id}"
format: "md"
tags: []
category: ""
source: "${this.escapeYaml(source.name)}"
source_path: "${this.escapeYaml(book.sourcePath || '')}"
created: "${created}"
---

# ${book.title}

📂 来源：${source.name}  ${sourceLink ? '→ ' + sourceLink : ''}

${meta.sourceCategory ? `🏷️ 原始分类：${meta.sourceCategory}` : ''}

---

${sourceLink ? `> 💡 划线和高亮在 [[${book.sourcePath}|原始笔记]] 中查看\n> ⚠️ 笔记来源无书籍原文，不支持 AI 生成简介和目录` : ''}
`;

    const file = await this.app.vault.create(cardPath, content);
    this.log.info('Index card created', { title: book.title, path: cardPath });
    return file.path;
  }

  // ---- Helpers ----

  private hashContent(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  private formatDate(timestamp: number): string {
    const d = new Date(timestamp);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  private escapeYaml(value: string): string {
    return value
      .replace(/\\/g, '\\\\')   // backslash first (must precede other escapes)
      .replace(/"/g, '\\"')     // double quote
      .replace(/\n/g, '\\n')    // newline
      .replace(/\r/g, '\\r')    // carriage return
      .replace(/\t/g, '\\t');   // tab
  }
}

// ---- Helpers ----

function sanitizeForPath(title: string): string {
  return title
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}
