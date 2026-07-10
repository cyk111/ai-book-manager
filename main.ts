// ============================================================
// AI Book Manager — Plugin Entry Point (thin wiring)
// ============================================================

import { Plugin, Notice } from 'obsidian';
import { PluginSettings, DEFAULT_SETTINGS } from './src/models';
import { AIBookSettingTab } from './src/views/setting-tab';
import { SidebarView, VIEW_TYPE } from './src/views/sidebar-view';
import { ScanCommand } from './src/commands/scan-command';
import { TestAICommand } from './src/commands/test-ai-command';
import { ScanService } from './src/services/scan-service';
import { NoteService } from './src/services/note-service';
import { TagService, TagTaskData } from './src/services/tag-service';
import { TaskQueue, QueueTask } from './src/services/queue-service';
import { createLogger, Logger } from './src/logger';
import { BOOK_CATEGORIES } from './src/constants';
import { generateSummary, generateTOC, generateChapterContent } from './src/ai-client';

export default class AIBookManagerPlugin extends Plugin {
  settings!: PluginSettings;
  private log!: Logger;
  noteService!: NoteService;
  scanService!: ScanService;
  tagService!: TagService;
  tagQueue!: TaskQueue<TagTaskData>;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.log = createLogger('plugin');

    // Init services (order matters: tagQueue → tagService → scanService)
    this.noteService = new NoteService(this.app, this.settings.notesFolder, this.log);
    this.tagQueue = new TaskQueue<TagTaskData>(this.settings.maxConcurrency, 500, this.log);
    this.tagService = new TagService(this.app, this.settings, this.noteService, this.tagQueue, this.log);
    this.scanService = new ScanService(this.app, this.settings, this.tagService, this.log);

    // Restore persisted queue state
    const savedData = await this.loadData();
    if (savedData?.tagQueue) {
      (this.tagQueue as TaskQueue).restore(savedData.tagQueue as QueueTask[]);
    }

    // Settings tab
    this.addSettingTab(new AIBookSettingTab(this.app, this));

    // Sidebar view
    this.registerView(VIEW_TYPE, (leaf) => new SidebarView(leaf, this));
    this.addRibbonIcon('book-open', 'Open AI Book Manager', () => this.activateView());

    // Commands
    const scanCmd = new ScanCommand(this.app, this.settings, this.tagService);
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

    this.log.info('Plugin loaded');
  }

  onunload(): void {
    this.log.info('Plugin unloaded');
  }

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

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private updateActiveButtons(): void {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) return;

    const path = activeFile.path;

    // Try immediate + delayed update (Obsidian re-renders async after file modify)
    const doUpdate = () => {
      // Search entire document for the rendered markdown container
      const containers = document.querySelectorAll('.markdown-preview-view, .cm-s-obsidian');
      containers.forEach((c) => {
        this.noteService.updateButtonStates(c as HTMLElement, path);
      });
      // Also search standalone links anywhere in document
      const allLinks = document.querySelectorAll('.ai-book-link, .ai-toc-link');
      if (allLinks.length > 0) {
        this.noteService.updateButtonStates(document.body, path);
      }
    };

    doUpdate();
    setTimeout(doUpdate, 300);
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
