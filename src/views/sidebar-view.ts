// ============================================================
// Sidebar View — book list, scan progress, log viewer
// ============================================================

import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import type AIBookManagerPlugin from '../../main';

export const VIEW_TYPE = 'ai-book-manager-sidebar';

type TabName = 'books' | 'progress' | 'log';

export class SidebarView extends ItemView {
  private plugin: AIBookManagerPlugin;
  private activeTab: TabName = 'books';
  private scanning = false;

  constructor(leaf: WorkspaceLeaf, plugin: AIBookManagerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'AI Book Manager';
  }

  getIcon(): string {
    return 'book-open';
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  // ---- Render ----

  render(): void {
    const { contentEl } = this;
    contentEl.empty();

    // Header
    const header = contentEl.createDiv({ cls: 'ai-book-sidebar-header' });
    header.createEl('h3', { text: '📚 AI Book Manager' });

    // Tab bar
    const tabBar = contentEl.createDiv({ cls: 'ai-book-sidebar-tabs' });
    this.createTab(tabBar, 'books', '📖 Books');
    this.createTab(tabBar, 'progress', '📊 Progress');
    this.createTab(tabBar, 'log', '📜 Log');

    // Tab content
    const tabContent = contentEl.createDiv({ cls: 'ai-book-sidebar-content' });
    this.renderActiveTab(tabContent);
  }

  private createTab(container: HTMLElement, tab: TabName, label: string): void {
    const el = container.createEl('button', { text: label });
    el.addClass('ai-book-sidebar-tab');
    if (this.activeTab === tab) {
      el.addClass('active');
    }

    el.addEventListener('click', () => {
      this.activeTab = tab;
      this.render();
    });
  }

  private renderActiveTab(container: HTMLElement): void {
    switch (this.activeTab) {
      case 'books':
        this.renderBooksTab(container);
        break;
      case 'progress':
        this.renderProgressTab(container);
        break;
      case 'log':
        this.renderLogTab(container);
        break;
    }
  }

  // ---- Books Tab ----

  private async renderBooksTab(container: HTMLElement): Promise<void> {
    container.empty();

    // Action buttons row
    const btnRow = container.createDiv({ cls: 'ai-book-manager-btn-row' });

    const scanBtn = btnRow.createEl('button', {
      text: this.scanning ? '⏳ Scanning...' : '🔍 Full Scan',
    });
    scanBtn.disabled = this.scanning;
    scanBtn.addEventListener('click', () => this.runFullScan(scanBtn));

    const refreshBtn = btnRow.createEl('button', {
      text: '🔄 Quick Sync',
    });
    refreshBtn.disabled = this.scanning;
    refreshBtn.addEventListener('click', () => this.runQuickSync(refreshBtn));

    // Book list
    const list = container.createDiv({ cls: 'ai-book-sidebar-content' });

    try {
      const books = await this.plugin.scanService.loadExistingBooks();
      if (books.size === 0) {
        list.createEl('p', {
          text: 'No books scanned yet. Click "Full Scan" to get started.',
          cls: 'ai-book-sidebar-empty',
        });
      } else {
        const sorted = Array.from(books.values()).sort((a, b) => a.title.localeCompare(b.title));
        for (const book of sorted) {
          const row = list.createDiv({ cls: 'ai-book-sidebar-book-item' });
          const titleEl = row.createDiv({ cls: 'ai-book-sidebar-book-title' });
          titleEl.textContent = `${book.tags.length > 0 ? '🏷️' : '📄'} ${book.title}`;
          titleEl.addEventListener('click', () => {
            if (book.notePath) {
              const file = this.plugin.app.vault.getFileByPath(book.notePath);
              if (file) {
                this.plugin.app.workspace.getLeaf().openFile(file);
              }
            }
          });
          if (book.tags.length > 0) {
            const metaRow = row.createDiv({ cls: 'ai-book-sidebar-book-meta' });
            book.tags.forEach(tag => {
              metaRow.createSpan({ text: tag, cls: 'ai-book-sidebar-tag' });
            });
          }
        }
      }
    } catch {
      list.createEl('p', {
        text: 'Failed to load books. Check your book directory setting.',
        cls: 'ai-book-sidebar-empty',
      });
    }
  }

  // ---- Progress Tab ----

  private async renderProgressTab(container: HTMLElement): Promise<void> {
    container.empty();

    try {
      const books = await this.plugin.scanService.loadExistingBooks();
      const bookArr = Array.from(books.values());
      const tagged = bookArr.filter(b => b.tags.length > 0).length;
      const store = this.plugin.scanService.getBookStore();
      const cache = (store as any).cache as import('../models').ScanCache | undefined;

      if (cache?.lastFullScan) {
        const lastScan = new Date(cache.lastFullScan);
        container.createEl('p', {
          text: `Last scan: ${lastScan.toLocaleString('zh-CN')}`,
          cls: 'ai-book-sidebar-stats',
        });
      } else {
        container.createEl('p', { text: 'Last scan: never', cls: 'ai-book-sidebar-stats' });
      }

      container.createEl('p', { text: `Total books: ${books.size}`, cls: 'ai-book-sidebar-stats' });
      container.createEl('p', { text: `Tagged: ${tagged}`, cls: 'ai-book-sidebar-stats' });

      // Queue status
      if (this.plugin.tagQueue) {
        const qs = this.plugin.tagQueue.getStatus();
        container.createEl('p', {
          text: `Queue: ${qs.completed} done, ${qs.failed} failed, ${qs.pending} pending`,
          cls: 'ai-book-sidebar-stats',
        });
      }
    } catch {
      container.createEl('p', { text: 'Stats unavailable', cls: 'ai-book-sidebar-stats' });
    }

    // File watcher status
    const watcherRunning = this.plugin.fileWatcher?.isRunning() ?? false;
    container.createEl('p', {
      text: `📁 File watcher: ${watcherRunning ? '🟢 Active' : '⚫ Inactive'}`,
      cls: 'ai-book-sidebar-stats',
    });

    // Auto-tag toggle
    const toggleRow = container.createDiv({ cls: 'ai-book-toggle-row' });

    const toggle = toggleRow.createEl('input');
    toggle.type = 'checkbox';
    toggle.checked = this.plugin.settings.autoTagging;
    toggle.addEventListener('change', async () => {
      this.plugin.settings.autoTagging = toggle.checked;
      await this.plugin.saveSettings();
    });

    toggleRow.createEl('span', { text: 'Auto AI tagging' });
  }

  // ---- Log Tab ----

  private renderLogTab(container: HTMLElement): void {
    container.empty();

    container.createEl('p', {
      text: 'No log entries yet. Logs will appear as you use the plugin.',
      cls: 'ai-book-sidebar-empty',
    });
  }

  // ---- Scan Actions ----

  private async runFullScan(btn: HTMLButtonElement): Promise<void> {
    this.scanning = true;
    btn.textContent = '⏳ Scanning...';
    btn.disabled = true;

    try {
      const result = await this.plugin.scanService.executeFullScan((progress) => {
        if (progress.phase === 'parsing') {
          btn.textContent = `⏳ ${progress.current}/${progress.total}`;
        }
      });

      const parts = [`✅ ${result.newBooks} new`];
      if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
      if (result.failed > 0) parts.push(`${result.failed} failed`);
      new Notice(parts.join(', '), 5000);
    } catch (err) {
      new Notice(`❌ Scan failed: ${String(err).slice(0, 100)}`, 8000);
    } finally {
      this.scanning = false;
      this.render();
    }
  }

  private async runQuickSync(btn: HTMLButtonElement): Promise<void> {
    this.scanning = true;
    btn.textContent = '⏳ Syncing...';
    btn.disabled = true;

    try {
      const result = await this.plugin.scanService.executeQuickSync();

      if (result.newBooks === 0) {
        new Notice('✅ Already up to date — no new books found.', 3000);
      } else {
        new Notice(`✅ ${result.newBooks} new book(s) synced.`, 5000);
      }
    } catch (err) {
      new Notice(`❌ Sync failed: ${String(err).slice(0, 100)}`, 8000);
    } finally {
      this.scanning = false;
      this.render();
    }
  }

  // ---- Public: Refresh ----

  refresh(): void {
    this.render();
  }
}
