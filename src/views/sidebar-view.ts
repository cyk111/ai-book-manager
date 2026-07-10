// ============================================================
// Sidebar View — book list, scan progress, log viewer
// ============================================================

import { ItemView, WorkspaceLeaf } from 'obsidian';
import type AIBookManagerPlugin from '../../main';

export const VIEW_TYPE = 'ai-book-manager-sidebar';

type TabName = 'books' | 'progress' | 'log';

export class SidebarView extends ItemView {
  private plugin: AIBookManagerPlugin;
  private activeTab: TabName = 'books';

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

  private renderBooksTab(container: HTMLElement): void {
    container.createEl('p', {
      text: 'Run a scan to discover books in your configured directory.',
      cls: 'ai-book-hint',
    }).style.cssText = 'color: var(--text-muted); font-size: 0.85em;';

    container.createEl('button', {
      text: '🔍 Scan Now',
      cls: 'ai-book-scan-btn',
    }).style.cssText = 'width: 100%; margin: 8px 0; padding: 8px; cursor: pointer;';

    // Book list placeholder
    const list = container.createEl('div', { cls: 'ai-book-list' });
    list.createEl('p', {
      text: 'No books scanned yet. Click "Scan Now" to get started.',
      cls: 'ai-book-empty',
    }).style.cssText = 'color: var(--text-faint); font-style: italic; text-align: center; margin-top: 24px;';
  }

  // ---- Progress Tab ----

  private renderProgressTab(container: HTMLElement): void {
    const stats = container.createEl('div', { cls: 'ai-book-stats' });

    stats.createEl('p', { text: 'Last scan: never' }).style.cssText = 'color: var(--text-muted); font-size: 0.85em;';
    stats.createEl('p', { text: 'Total books: 0' }).style.cssText = 'color: var(--text-muted); font-size: 0.85em;';
    stats.createEl('p', { text: 'Tagged: 0' }).style.cssText = 'color: var(--text-muted); font-size: 0.85em;';

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

  // ---- Public: Refresh ----

  refresh(): void {
    this.render();
  }
}
