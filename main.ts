// ============================================================
// AI Book Manager — Plugin Entry Point (thin wiring)
// ============================================================

import * as fs from 'fs';
import { Plugin, Notice } from 'obsidian';
import { BookRecord, ScanCache, PluginSettings, DEFAULT_SETTINGS } from './src/models';
import { AIBookSettingTab } from './src/views/setting-tab';
import { SidebarView, VIEW_TYPE } from './src/views/sidebar-view';
import { ScanCommand } from './src/commands/scan-command';
import { TestAICommand } from './src/commands/test-ai-command';
import { ScanService, BookStore } from './src/services/scan-service';
import { NoteService } from './src/services/note-service';
import { TagService, TagTaskData } from './src/services/tag-service';
import { TaskQueue, QueueTask } from './src/services/queue-service';
import { FileWatcher, createFileWatcher, WatchEvent } from './src/services/file-watcher';
import { createLogger, Logger } from './src/logger';
import { BOOK_CATEGORIES } from './src/constants';
import { generateSummary, generateTOC, generateChapterContent } from './src/ai-client';

// ---- Obsidian-backed BookStore ----

class ObsidianBookStore implements BookStore {
  private plugin: AIBookManagerPlugin;

  constructor(plugin: AIBookManagerPlugin) {
    this.plugin = plugin;
  }

  async loadBooks(): Promise<Map<string, BookRecord>> {
    const data = (await this.plugin.loadData()) || {};
    const books: BookRecord[] = data?.books || [];
    const map = new Map<string, BookRecord>();
    for (const book of books) {
      map.set(book.fileHash, book);
    }
    return map;
  }

  async saveBook(book: BookRecord): Promise<void> {
    const data = (await this.plugin.loadData()) || {};
    const books: BookRecord[] = data?.books || [];
    const idx = books.findIndex(b => b.fileHash === book.fileHash);
    if (idx >= 0) {
      books[idx] = book;
    } else {
      books.push(book);
    }
    data.books = books;
    await this.plugin.saveData(data);
  }

  async saveBooks(newBooks: BookRecord[]): Promise<void> {
    const data = (await this.plugin.loadData()) || {};
    const books: BookRecord[] = data?.books || [];
    for (const book of newBooks) {
      const idx = books.findIndex(b => b.fileHash === book.fileHash);
      if (idx >= 0) {
        books[idx] = book;
      } else {
        books.push(book);
      }
    }
    data.books = books;
    await this.plugin.saveData(data);
  }

  async saveScanCache(cache: ScanCache): Promise<void> {
    const data = (await this.plugin.loadData()) || {};
    data.scanCache = cache;
    await this.plugin.saveData(data);
  }
}

// ---- Plugin ----

export default class AIBookManagerPlugin extends Plugin {
  settings!: PluginSettings;
  private log!: Logger;
  noteService!: NoteService;
  scanService!: ScanService;
  tagService!: TagService;
  tagQueue!: TaskQueue<TagTaskData>;
  fileWatcher!: FileWatcher;
  private bookStore!: ObsidianBookStore;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.log = createLogger('plugin');

    // Init BookStore
    this.bookStore = new ObsidianBookStore(this);

    // Init services (order matters: tagQueue → tagService → scanService)
    this.noteService = new NoteService(this.app, this.settings.notesFolder, this.log);
    this.tagQueue = new TaskQueue<TagTaskData>(this.settings.maxConcurrency, 500, this.log);
    this.tagService = new TagService(this.app, this.settings, this.noteService, this.tagQueue, this.log);
    this.scanService = new ScanService(this.app, this.settings, this.tagService, this.log, this.bookStore);

    // Restore persisted queue state
    const savedData = (await this.loadData()) || {};
    if (savedData?.tagQueue) {
      (this.tagQueue as TaskQueue).restore(savedData.tagQueue as QueueTask[]);
    }

    // Settings tab
    this.addSettingTab(new AIBookSettingTab(this.app, this));

    // Sidebar view
    this.registerView(VIEW_TYPE, (leaf) => new SidebarView(leaf, this));
    this.addRibbonIcon('book-open', 'Open AI Book Manager', () => this.activateView());

    // Commands
    const scanCmd = new ScanCommand(this.app, this.settings, this.scanService);
    const testAICmd = new TestAICommand(this.app, this.settings);

    this.addCommand({
      id: 'scan-books',
      name: 'Scan book directory',
      callback: () => scanCmd.execute(),
    });

    this.addCommand({
      id: 'test-ai-connection',
      name: 'Test AI connection',
      callback: () => testAICmd.execute(),
    });

    // Handle ai-book:// link clicks
    this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
      const target = evt.target as HTMLElement;
      const isBookLink = target.classList.contains('ai-book-link');
      const isTocLink = target.classList.contains('ai-toc-link');

      if (!isBookLink && !isTocLink) return;
      evt.preventDefault();
      evt.stopPropagation();

      // Confirm before regenerating
      if (target.textContent?.includes('重新生成')) {
        if (!confirm('确定要重新生成吗？现有内容将被覆盖。')) return;
      }

      const href = target.getAttribute('href') || '';
      const action = href.replace('ai-book://', '');

      const activeFile = this.app.workspace.getActiveFile();
      if (!activeFile) return;

      let chapterTitle: string | undefined;
      if (isTocLink) {
        chapterTitle = target.getAttribute('data-chapter') || undefined;
      }

      this.handleAIAction(activeFile.path, action, chapterTitle);
    });

    // Listen for AI action events from note buttons
    document.addEventListener('ai-book-action', ((e: CustomEvent) => {
      this.handleAIAction(e.detail.notePath, e.detail.action, e.detail.chapterTitle);
    }) as EventListener);

    // MarkdownPostProcessor: update button states (生成 → 重新生成)
    this.registerMarkdownPostProcessor((element, context) => {
      if (!context.sourcePath.startsWith(this.settings.notesFolder)) return;
      this.noteService.updateButtonStates(element, context.sourcePath);
    });

    // ---- Startup Auto-Sync (strict precondition checks) ----
    if (this.canAutoSync()) {
      this.log.info('Auto-sync conditions met, starting incremental scan');
      setTimeout(() => {
        this.scanService.executeIncrementalScan().then(result => {
          if (result.newBooks > 0) {
            new Notice(`📚 Auto-sync: ${result.newBooks} new book(s) found.`);
          }
          this.log.info('Startup auto-sync complete', { newBooks: result.newBooks });
        }).catch(err => {
          this.log.warn('Startup auto-sync failed', { error: String(err) });
        });
      }, 2000);
    } else {
      this.log.debug('Auto-sync skipped: preconditions not met', {
        autoSyncOnStartup: this.settings.autoSyncOnStartup,
        bookDirectory: this.settings.bookDirectory || '(empty)',
      });
    }

    // ---- File Watcher (strict precondition checks) ----
    if (this.settings.watchBookDirectory && this.canAutoSync()) {
      this.startFileWatcher();
    }

    this.log.info('Plugin loaded');
  }

  onunload(): void {
    // Stop file watcher
    if (this.fileWatcher) {
      this.fileWatcher.stop();
    }
    this.log.info('Plugin unloaded');
  }

  // ---- View Management ----

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        await rightLeaf.setViewState({ type: VIEW_TYPE, active: true });
      }
    } else {
      workspace.revealLeaf(leaf);
    }
  }

  // ---- AI Actions ----

  async handleAIAction(notePath: string, action: string, chapterTitle?: string): Promise<void> {
    const config = {
      baseUrl: this.settings.deepseekBaseUrl,
      apiKey: this.settings.deepseekApiKey,
      model: this.settings.deepseekModel,
    };

    if (!config.apiKey) {
      new Notice('❌ Please configure your API key first.');
      return;
    }

    const file = this.app.vault.getFileByPath(notePath);
    if (!file) {
      new Notice('❌ Note not found.');
      return;
    }

    const cache = this.app.metadataCache.getCache(notePath);
    const title = (cache?.frontmatter?.title as string) || notePath;
    const author = (cache?.frontmatter?.author as string) || null;
    const fileContent = await this.app.vault.read(file);

    try {
      if (action === 'summary') {
        new Notice('📝 正在生成简介...');
        const { summary } = await generateSummary(config, title, author, fileContent, this.log);
        await this.noteService.appendSection(file, '📝 书籍简介', summary + '\n\n---\n');
        this.updateActiveButtons();
        new Notice('✅ 简介已生成');

      } else if (action === 'toc') {
        new Notice('📋 正在生成目录...');
        const { toc } = await generateTOC(config, title, author, fileContent, this.log);
        const tocWithButtons = toc.split('\n').map(line => {
          const trimmed = line.trim();
          if (trimmed.startsWith('- ')) {
            const chapterTitle = trimmed.replace(/^- /, '').trim();
            return `${trimmed} <a href="ai-book://chapter-overview" data-chapter="${this.escapeHtml(chapterTitle)}" class="ai-toc-link">📝 生成概要</a>`;
          }
          return line;
        }).join('\n');
        await this.noteService.appendSection(file, '📋 本书目录', tocWithButtons + '\n\n---\n');
        this.updateActiveButtons();
        new Notice('✅ 目录已生成');

      } else if (action === 'chapter-overview' && chapterTitle) {
        new Notice(`📝 正在生成概要: ${chapterTitle}...`);
        const { content } = await generateChapterContent(
          config, title, chapterTitle,
          fileContent.slice(0, 10000), this.log,
        );
        await this.noteService.appendSection(file, `📝 ${chapterTitle}`, content + '\n\n---\n');
        this.updateActiveButtons();
        new Notice(`✅ ${chapterTitle} 概要已生成`);
      }
    } catch (err) {
      new Notice(`❌ Failed: ${String(err).slice(0, 100)}`);
      this.log.error('AI action failed', { action, notePath, error: String(err) });
    }
  }

  // ---- Settings ----

  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings || data);
  }

  async saveSettings(): Promise<void> {
    const data = (await this.loadData()) || {};
    data.settings = this.settings;
    await this.saveData(data);

    // Start/stop file watcher based on settings + preconditions
    if (this.settings.watchBookDirectory && this.canAutoSync()) {
      if (!this.fileWatcher || !this.fileWatcher.isRunning()) {
        this.startFileWatcher();
      }
    } else {
      if (this.fileWatcher) {
        this.fileWatcher.stop();
      }
    }
  }

  // ---- File Watcher ----

  private startFileWatcher(): void {
    if (this.fileWatcher) {
      this.fileWatcher.stop();
    }

    this.fileWatcher = createFileWatcher(
      this.settings.bookDirectory,
      this.settings.supportedFormats,
      (events: WatchEvent[]) => {
        this.handleNewFiles(events);
      },
      this.log,
    );

    this.fileWatcher.start();
    this.log.info('File watcher initialized');
  }

  private handleNewFiles(events: WatchEvent[]): void {
    const filePaths = events.map(e => e.filePath);

    // Run quick sync for the new files
    this.scanService.executeQuickSync(filePaths).then(result => {
      if (result.newBooks > 0) {
        new Notice(`📁 ${result.newBooks} new book(s) detected and synced.`);
      }
    }).catch(err => {
      this.log.warn('File watcher sync failed', { error: String(err) });
    });
  }

  // ---- Button State ----

  private updateActiveButtons(): void {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) return;

    const path = activeFile.path;

    const doUpdate = () => {
      const containers = document.querySelectorAll('.markdown-preview-view, .cm-s-obsidian');
      containers.forEach((c) => {
        this.noteService.updateButtonStates(c as HTMLElement, path);
      });
      const allLinks = document.querySelectorAll('.ai-book-link, .ai-toc-link');
      if (allLinks.length > 0) {
        this.noteService.updateButtonStates(document.body, path);
      }
    };

    doUpdate();
    setTimeout(doUpdate, 300);
  }

  // ---- Helpers ----

  /**
   * Strict precondition check for auto-sync.
   * ALL conditions must be met:
   *  1. autoSyncOnStartup is enabled in settings
   *  2. bookDirectory is configured (non-empty)
   *  3. Book directory exists on disk
   *  4. Notes folder exists in vault (user hasn't deleted it)
   */
  private canAutoSync(): boolean {
    if (!this.settings.autoSyncOnStartup) {
      return false;
    }
    if (!this.settings.bookDirectory || this.settings.bookDirectory.trim() === '') {
      return false;
    }
    if (!fs.existsSync(this.settings.bookDirectory)) {
      return false;
    }
    if (!this.app.vault.getFolderByPath(this.settings.notesFolder)) {
      this.log.debug('Auto-sync blocked: notes folder does not exist', {
        notesFolder: this.settings.notesFolder,
      });
      return false;
    }
    return true;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
