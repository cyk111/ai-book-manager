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
    contentEl.style.cssText = 'padding: 8px;';

    // Header
    const header = contentEl.createEl('div', { cls: 'ai-book-header' });
    header.style.cssText = 'margin-bottom: 12px;';

    header.createEl('h3', { text: '📚 AI Book Manager' });

    // Tab bar
    const tabBar = contentEl.createEl('div', { cls: 'ai-book-tab-bar' });
    tabBar.style.cssText = 'display: flex; gap: 4px; margin-bottom: 12px; border-bottom: 1px solid var(--background-modifier-border);';

    this.createTab(tabBar, 'books', '📖 Books');
    this.createTab(tabBar, 'progress', '📊 Progress');
    this.createTab(tabBar, 'log', '📜 Log');

    // Tab content
    const tabContent = contentEl.createEl('div', { cls: 'ai-book-tab-content' });
    this.renderActiveTab(tabContent);
  }

  private createTab(container: HTMLElement, tab: TabName, label: string): void {
    const el = container.createEl('button', { text: label });
    el.style.cssText = `
      padding: 6px 12px;
      border: none;
      border-bottom: 2px solid ${this.activeTab === tab ? 'var(--interactive-accent)' : 'transparent'};
      background: transparent;
      color: ${this.activeTab === tab ? 'var(--text-normal)' : 'var(--text-muted)'};
      cursor: pointer;
      font-size: 0.85em;
    `;

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
    // Action buttons row
    const btnRow = container.createEl('div');
    btnRow.style.cssText = 'display: flex; gap: 8px; margin-bottom: 12px;';

    const scanBtn = btnRow.createEl('button', {
      text: this.scanning ? '⏳ Scanning...' : '🔍 Full Scan',
      cls: 'ai-book-scan-btn',
    });
    scanBtn.style.cssText = 'flex: 1; padding: 8px; cursor: pointer;';
    scanBtn.disabled = this.scanning;
    scanBtn.addEventListener('click', () => this.runFullScan(scanBtn));

    const refreshBtn = btnRow.createEl('button', {
      text: '🔄 Quick Sync',
      cls: 'ai-book-refresh-btn',
    });
    refreshBtn.style.cssText = 'flex: 1; padding: 8px; cursor: pointer;';
    refreshBtn.disabled = this.scanning;
    refreshBtn.addEventListener('click', () => this.runQuickSync(refreshBtn));

    // Book list
    const list = container.createEl('div', { cls: 'ai-book-list' });
    list.style.cssText = 'max-height: 400px; overflow-y: auto;';

    try {
      const books = await this.plugin.scanService.loadExistingBooks();
      if (books.size === 0) {
        list.createEl('p', {
          text: 'No books scanned yet. Click "Full Scan" to get started.',
          cls: 'ai-book-empty',
        }).style.cssText = 'color: var(--text-faint); font-style: italic; text-align: center; margin-top: 24px;';
      } else {
        const sorted = Array.from(books.values()).sort((a, b) => a.title.localeCompare(b.title));
        for (const book of sorted) {
          const row = list.createEl('div');
          row.style.cssText = 'padding: 4px 0; font-size: 0.85em; cursor: pointer;';
          row.textContent = `${book.tags.length > 0 ? '🏷️' : '📄'} ${book.title}`;
          row.addEventListener('click', () => {
            if (book.notePath) {
              const file = this.plugin.app.vault.getFileByPath(book.notePath);
              if (file) {
                this.plugin.app.workspace.getLeaf().openFile(file);
              }
            }
          });
        }
      }
    } catch {
      list.createEl('p', {
        text: 'Failed to load books. Check your book directory setting.',
        cls: 'ai-book-error',
      }).style.cssText = 'color: var(--text-error); font-style: italic;';
    }
  }

  // ---- Progress Tab ----

  private async renderProgressTab(container: HTMLElement): Promise<void> {
    const stats = container.createEl('div', { cls: 'ai-book-stats' });

    try {
      const books = await this.plugin.scanService.loadExistingBooks();
      const bookArr = Array.from(books.values());
      const tagged = bookArr.filter(b => b.tags.length > 0).length;
      const store = this.plugin.scanService.getBookStore();
      const cache = (store as any).cache as import('../models').ScanCache | undefined;

      if (cache?.lastFullScan) {
        const lastScan = new Date(cache.lastFullScan);
        stats.createEl('p', {
          text: `Last scan: ${lastScan.toLocaleString('zh-CN')}`,
        }).style.cssText = 'color: var(--text-muted); font-size: 0.85em;';
      } else {
        stats.createEl('p', { text: 'Last scan: never' })
          .style.cssText = 'color: var(--text-muted); font-size: 0.85em;';
      }

      stats.createEl('p', { text: `Total books: ${books.size}` })
        .style.cssText = 'color: var(--text-muted); font-size: 0.85em;';
      stats.createEl('p', { text: `Tagged: ${tagged}` })
        .style.cssText = 'color: var(--text-muted); font-size: 0.85em;';

      // Queue status
      if (this.plugin.tagQueue) {
        const qs = this.plugin.tagQueue.getStatus();
        stats.createEl('p', {
          text: `Queue: ${qs.completed} done, ${qs.failed} failed, ${qs.pending} pending`,
        }).style.cssText = 'color: var(--text-muted); font-size: 0.85em;';
      }
    } catch {
      stats.createEl('p', { text: 'Stats unavailable' })
        .style.cssText = 'color: var(--text-muted); font-size: 0.85em;';
    }

    // File watcher status
    const watcherRow = container.createEl('div');
    watcherRow.style.cssText = 'margin-top: 12px;';
    const watcherRunning = this.plugin.fileWatcher?.isRunning() ?? false;
    watcherRow.createEl('p', {
      text: `📁 File watcher: ${watcherRunning ? '🟢 Active' : '⚫ Inactive'}`,
    }).style.cssText = 'color: var(--text-muted); font-size: 0.85em;';

    // Auto-tag toggle
    const toggleRow = container.createEl('div');
    toggleRow.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-top: 12px;';

    const toggle = toggleRow.createEl('input');
    toggle.type = 'checkbox';
    toggle.checked = this.plugin.settings.autoTagging;
    toggle.addEventListener('change', async () => {
      this.plugin.settings.autoTagging = toggle.checked;
      await this.plugin.saveSettings();
    });

    toggleRow.createEl('span', { text: 'Auto AI tagging' }).style.cssText = 'font-size: 0.85em;';
  }

  // ---- Log Tab ----

  private renderLogTab(container: HTMLElement): void {
    const logContainer = container.createEl('div', { cls: 'ai-book-log' });
    logContainer.style.cssText = 'max-height: 400px; overflow-y: auto; font-family: monospace; font-size: 0.8em;';

    logContainer.createEl('p', {
      text: 'No log entries yet. Logs will appear as you use the plugin.',
      cls: 'ai-book-log-empty',
    }).style.cssText = 'color: var(--text-faint); font-style: italic;';
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
