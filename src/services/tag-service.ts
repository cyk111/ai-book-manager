// ============================================================
// Tag Service — AI auto-classification + frontmatter update
// ============================================================

import { App, Notice } from 'obsidian';
import { BookRecord, PluginSettings } from '../models';
import { classifyBook, fuzzyMatchCategory, AIConfig } from '../ai-client';
import { BOOK_CATEGORIES } from '../constants';
import { TaskQueue, QueueTask } from './queue-service';
import { NoteService } from './note-service';
import { Logger, NOOP_LOGGER } from '../logger';

// ---- Types ----

export interface TagTaskData {
  bookId: string;
  title: string;
  author: string | null;
  textSnippet: string;
  notePath: string;
  /** Parent directory names that may hint at category (e.g. "股票类") */
  directoryHint: string;
}

// ---- Tag Service ----

export class TagService {
  private app: App;
  private settings: PluginSettings;
  private noteService: NoteService;
  private queue: TaskQueue<TagTaskData>;
  private log: Logger;

  constructor(
    app: App,
    settings: PluginSettings,
    noteService: NoteService,
    queue: TaskQueue<TagTaskData>,
    logger: Logger = NOOP_LOGGER,
  ) {
    this.app = app;
    this.settings = settings;
    this.noteService = noteService;
    this.queue = queue;
    this.log = logger;

    this.queue.setHandler(async (task) => this.processTagTask(task));
  }

  // ---- Public ----

  getAIConfig(): AIConfig {
    return {
      baseUrl: this.settings.deepseekBaseUrl,
      apiKey: this.settings.deepseekApiKey,
      model: this.settings.deepseekModel,
    };
  }

  enqueueBook(book: BookRecord, textSnippet: string, notePath: string, directoryHint?: string): void {
    if (!this.settings.deepseekApiKey) {
      this.log.warn('No API key configured, skipping tagging', { bookId: book.id });
      return;
    }

    const task: QueueTask<TagTaskData> = {
      id: `tag_${book.id}`,
      type: 'tagging',
      data: {
        bookId: book.id,
        title: book.title,
        author: book.author,
        textSnippet,
        notePath,
        directoryHint: directoryHint || '',
      },
      status: 'pending',
      error: null,
      tokenUsed: 0,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      retries: 0,
    };

    this.queue.enqueue(task);
    this.log.info('Tag task enqueued', { bookId: book.id, title: book.title });
  }

  enqueueBatch(books: BookRecord[], snippets: Map<string, string>): void {
    for (const book of books) {
      const snippet = snippets.get(book.id) || '';
      this.enqueueBook(book, snippet, book.notePath || '');
    }
  }

  getUntaggedBooks(books: BookRecord[]): BookRecord[] {
    return books.filter(b => b.tags.length === 0);
  }

  getQueue(): TaskQueue<TagTaskData> {
    return this.queue;
  }

  // ---- Internal ----

  private async processTagTask(
    task: QueueTask<TagTaskData>,
  ): Promise<{ tokenUsed: number }> {
    const { bookId, title, author, textSnippet, notePath, directoryHint } = task.data;

    this.log.info('Processing tag task', { bookId, title, directoryHint });

    // Call AI — pass directory hint for better classification
    const { result, tokenUsed } = await classifyBook(
      this.getAIConfig(),
      title,
      author,
      textSnippet,
      this.log,
      directoryHint || undefined,
    );

    // Validate category: if AI didn't return a valid one from the predefined list, fuzzy match
    if (!result.category || !BOOK_CATEGORIES.includes(result.category as typeof BOOK_CATEGORIES[number])) {
      this.log.warn('Category not in predefined list, attempting fuzzy match', {
        bookId,
        rawCategory: result.category,
      });
      try {
        const matched = await fuzzyMatchCategory(
          this.getAIConfig(),
          result.category || title,
          BOOK_CATEGORIES,
          this.log,
        );
        if (matched && BOOK_CATEGORIES.includes(matched as typeof BOOK_CATEGORIES[number])) {
          result.category = matched;
          this.log.info('Fuzzy category match succeeded', { bookId, category: matched });
        }
      } catch {
        this.log.warn('Fuzzy category match failed', { bookId });
      }
    }

    // Get the note file directly by path (avoids metadata cache race condition)
    const file = this.app.vault.getFileByPath(notePath);
    if (file) {
      // Update frontmatter with tags
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        const tags = [...result.tags];
        if (result.category) {
          frontmatter['category'] = result.category;
        }
        frontmatter['tags'] = tags;
        if (result.author && result.author !== 'Unknown') {
          frontmatter['author'] = result.author;
        }
      });

      // Move note to category subdirectory
      if (result.category) {
        const fileName = notePath.split('/').pop() || '';
        const categoryFolder = `${this.settings.notesFolder}/${result.category}`;
        const newPath = `${categoryFolder}/${fileName}`;
        try {
          await this.app.vault.rename(file, newPath);
          // Add category link to book note body
          const movedFile = this.app.vault.getFileByPath(newPath);
          if (movedFile) {
            const currentContent = await this.app.vault.read(movedFile);
            const linkLine = `📂 分类：[[${result.category}]]`;
            if (!currentContent.includes(linkLine)) {
              await this.app.vault.modify(movedFile, currentContent.trimEnd() + `\n${linkLine}\n`);
            }
          }
          // Update the category navigation page
          await this.noteService.updateCategoryNav(result.category, title);
          this.log.info('Note moved to category', { from: notePath, to: newPath, category: result.category });
          new Notice(`🏷️ ${title}: ${result.tags.join(', ')}  → ${result.category}/`);
        } catch (err) {
          this.log.warn('Failed to move note to category dir', { notePath, error: String(err) });
          new Notice(`🏷️ ${title}: ${result.tags.join(', ')} (move failed)`);
        }
      } else {
        new Notice(`🏷️ ${title}: ${result.tags.join(', ')}`);
      }

      this.log.info('Tags written to note', {
        bookId,
        tags: result.tags,
        category: result.category,
      });
    } else {
      new Notice(`⚠️ Tagged but note not found: ${title}`);
      this.log.warn('Note not found for book', { bookId, notePath });
    }

    return { tokenUsed };
  }
}
