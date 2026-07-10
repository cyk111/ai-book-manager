// ============================================================
// Note Service — CRUD for book notes in the Obsidian vault
// ============================================================

import { App, TFile, normalizePath } from 'obsidian';
import { BookRecord } from '../models';
import { Logger, NOOP_LOGGER } from '../logger';
import { sanitizeTitle } from '../utils/path-utils';

// ---- Types ----

export interface NoteTemplateData {
  title: string;
  author: string | null;
  format: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  bookId: string;
  tags: string[];
  createdAt: number;
}

// ---- Constants ----

const BUTTON_CONTAINER_CLASS = 'ai-book-manager-actions';
const TOC_SECTION = '📋 本书目录';

// ---- Note Service ----

export class NoteService {
  private app: App;
  private notesFolder: string;
  private log: Logger;

  constructor(app: App, notesFolder: string, logger: Logger = NOOP_LOGGER) {
    this.app = app;
    this.notesFolder = notesFolder;
    this.log = logger;
  }

  // ---- Create / Read / Update ----

  async createBookNote(book: BookRecord): Promise<TFile> {
    const content = this.generateNoteContent(book);
    const notePath = this.buildNotePath(book.title);

    // Ensure notes folder exists
    if (!this.app.vault.getFolderByPath(this.notesFolder)) {
      await this.app.vault.createFolder(this.notesFolder);
    }

    // Check for duplicate
    const existing = this.app.vault.getFileByPath(notePath);
    if (existing) {
      this.log.warn('Note already exists, skipping', { path: notePath });
      return existing;
    }

    const file = await this.app.vault.create(notePath, content);
    this.log.info('Book note created', { title: book.title, path: notePath });
    return file;
  }

  async updateBookNote(book: BookRecord, file: TFile): Promise<void> {
    const content = this.generateNoteContent(book);
    await this.app.vault.modify(file, content);
    this.log.debug('Book note updated', { title: book.title });
  }

  async appendSection(file: TFile, sectionTitle: string, sectionContent: string): Promise<void> {
    const current = await this.app.vault.read(file);
    const sectionMarker = `## ${sectionTitle}`;

    let updated: string;
    if (current.includes(sectionMarker)) {
      // Replace existing section (including trailing ---)
      const regex = new RegExp(`## ${this.escapeRegex(sectionTitle)}\\n[\\s\\S]*?(?=\\n## |$)`, 'g');
      updated = current.replace(regex, `${sectionMarker}\n\n${sectionContent}`);
    } else if (sectionTitle === '📝 书籍简介' && current.includes('## 📋 本书目录')) {
      // Insert summary before TOC
      const tocIdx = current.indexOf('## 📋 本书目录');
      updated = current.slice(0, tocIdx) + `${sectionMarker}\n\n${sectionContent}\n\n` + current.slice(tocIdx);
    } else {
      // Append at end
      updated = current.trimEnd() + `\n\n${sectionMarker}\n\n${sectionContent}`;
    }

    await this.app.vault.modify(file, updated);
    this.log.info('Section appended', { file: file.path, section: sectionTitle });
  }

  async appendToSection(file: TFile, sectionTitle: string, line: string): Promise<void> {
    const current = await this.app.vault.read(file);
    const sectionMarker = `## ${sectionTitle}`;

    if (!current.includes(sectionMarker)) {
      // Create the section first
      await this.appendSection(file, sectionTitle, line);
      return;
    }

    // Append line to existing section
    const parts = current.split(sectionMarker);
    if (parts.length < 2) return;

    const before = parts[0];
    const sectionRest = parts.slice(1).join(sectionMarker);

    // Find where the section ends (next ## or EOF)
    const nextSectionMatch = sectionRest.match(/\n## /);
    let sectionContent: string;
    let afterContent = '';

    if (nextSectionMatch) {
      const idx = sectionRest.indexOf(nextSectionMatch[0]);
      sectionContent = sectionRest.slice(0, idx);
      afterContent = sectionRest.slice(idx);
    } else {
      sectionContent = sectionRest;
    }

    const updated = before + sectionMarker + sectionContent.trimEnd() + `\n${line}\n` + afterContent;
    await this.app.vault.modify(file, updated);
    this.log.debug('Line appended to section', { file: file.path, section: sectionTitle });
  }

  getBookNote(bookId: string): TFile | null {
    const files = this.app.vault.getFiles();
    for (const file of files) {
      if (!file.path.startsWith(this.notesFolder)) continue;
      const cache = this.app.metadataCache.getFileCache(file);
      if (cache?.frontmatter?.book_id === bookId) {
        return file;
      }
    }
    return null;
  }

  // ---- Content Generation ----

  generateNoteContent(book: BookRecord): string {
    const created = this.formatDate(book.createdAt);

    return `---
title: "${this.escapeYaml(book.title)}"
author: "${book.author ? this.escapeYaml(book.author) : 'Unknown'}"
format: "${book.format}"
tags: [${book.tags.map(t => `"${t}"`).join(', ')}]
category: ""
created: "${created}"
---

<div class="ai-book-actions">
🤖 <a href="ai-book://summary" class="ai-book-link">📝 生成简介</a> |
<a href="ai-book://toc" class="ai-book-link">📋 生成目录</a>
</div>

`;
  }

  // ---- Button Injection (for MarkdownPostProcessor) ----

  updateButtonStates(containerEl: HTMLElement, _sourcePath: string): void {
    const text = containerEl.textContent || '';
    const hasSummary = text.includes('📝 书籍简介');
    const hasTOC = text.includes('📋 本书目录');
    const chapterMatches = text.match(/📝 第\d+章[：:][^\n]+/g) || [];
    const generatedChapters = chapterMatches.map(m => m.trim());

    const links = containerEl.querySelectorAll('.ai-book-link');
    links.forEach((link) => {
      const href = link.getAttribute('href') || '';
      if (href.includes('summary') && hasSummary) link.textContent = '🔄 重新生成简介';
      if (href.includes('toc') && hasTOC) link.textContent = '🔄 重新生成目录';
    });

    const tocLinks = containerEl.querySelectorAll('.ai-toc-link');
    tocLinks.forEach((link) => {
      const chapter = link.getAttribute('data-chapter') || '';
      if (chapter && generatedChapters.some(c => c.includes(chapter))) link.textContent = '🔄 重新生成';
    });
  }

  injectButtons(containerEl: HTMLElement, bookTitle: string, sourcePath: string): void {
    if (containerEl.querySelector(`.${BUTTON_CONTAINER_CLASS}`)) return;

    const buttonContainer = containerEl.createDiv({ cls: BUTTON_CONTAINER_CLASS });
    buttonContainer.style.cssText = 'margin: 16px 0; padding: 12px; border: 1px solid var(--background-modifier-border); border-radius: 8px;';

    const label = buttonContainer.createEl('div', {
      text: '🤖 AI 操作',
      cls: 'ai-book-manager-label',
    });
    label.style.cssText = 'font-weight: 600; margin-bottom: 8px; color: var(--text-muted); font-size: 0.85em;';

    const btnRow = buttonContainer.createDiv({ cls: 'ai-book-manager-btn-row' });
    btnRow.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap;';

    // Create buttons immediately
    this.createActionButton(btnRow, '📝 生成简介', sourcePath, 'summary');
    this.createActionButton(btnRow, '📋 生成目录', sourcePath, 'toc');

    // Async update button states
    this.detectExistingSections(sourcePath, [
      { section: '📝 书籍简介' },
      { section: TOC_SECTION },
    ]).then(states => {
      const allBtns = btnRow.querySelectorAll('button');
      if (states.get('📝 书籍简介')) {
        (allBtns[0] as HTMLButtonElement).textContent = '🔄 重新生成简介';
      }
      if (states.get(TOC_SECTION)) {
        (allBtns[1] as HTMLButtonElement).textContent = '🔄 重新生成目录';
      }
    }).catch(() => {});
  }

  /**
   * Inject per-chapter buttons into the TOC section.
   * Called by MarkdownPostProcessor when a TOC section is found.
   */
  injectTOCButtons(tocContainer: HTMLElement, sourcePath: string, fileContent: string): void {
    const listItems = tocContainer.querySelectorAll('li');
    listItems.forEach((li) => {
      const text = li.textContent?.trim() || '';
      if (!text || text.length < 3) return;
      if (li.querySelector('.ai-toc-btn')) return;

      // Check if overview exists
      const sectionMarker = `📝 ${text}`;
      const hasOverview = fileContent.includes(`## ${sectionMarker}`);

      // Add button as inline span
      const btn = this.makeTOCButton(
        hasOverview ? '🔄' : '📝 生成概要',
        sourcePath,
        'chapter-overview',
        text,
      );
      li.appendChild(document.createTextNode(' '));
      li.appendChild(btn);
    });
  }

  private makeTOCButton(
    label: string,
    notePath: string,
    action: string,
    chapterTitle: string,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.className = 'ai-toc-btn';
    btn.style.cssText = `
      padding: 2px 8px; border-radius: 3px; font-size: 0.75em;
      border: 1px solid var(--background-modifier-border);
      background: var(--background-secondary);
      color: var(--text-muted); cursor: pointer;
    `;
    btn.addEventListener('click', () => {
      btn.style.opacity = '0.6';
      document.dispatchEvent(
        new CustomEvent('ai-book-action', {
          detail: { notePath, action, chapterTitle },
        }),
      );
    });
    return btn;
  }

  private async detectExistingSections(
    sourcePath: string,
    sections: Array<{ section: string }>,
  ): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();
    try {
      const file = this.app.vault.getFileByPath(sourcePath);
      if (file) {
        const content = await this.app.vault.read(file);
        for (const { section } of sections) {
          result.set(section, content.includes(`## ${section}`));
        }
      }
    } catch {
      for (const { section } of sections) {
        result.set(section, false);
      }
    }
    return result;
  }

  private createActionButton(
    container: HTMLElement,
    label: string,
    notePath: string,
    action: string,
  ): void {
    const btn = container.createEl('button', { text: label });
    btn.setAttr('data-note-path', notePath);
    btn.setAttr('data-action', action);
    btn.style.cssText = `
      padding: 6px 12px;
      border-radius: 4px;
      border: 1px solid var(--background-modifier-border);
      background: var(--background-secondary);
      color: var(--text-normal);
      cursor: pointer;
      font-size: 0.85em;
    `;

    btn.addEventListener('click', async () => {
      const isRegenerate = label.includes('重新生成');
      if (isRegenerate) {
        const ok = confirm('确定要重新生成吗？现有内容将被覆盖。');
        if (!ok) return;
      }

      btn.setAttr('disabled', 'true');
      btn.setText('⏳ 生成中...');
      btn.style.opacity = '0.6';

      document.dispatchEvent(
        new CustomEvent('ai-book-action', {
          detail: { notePath, action },
        }),
      );
    });
  }

  // ---- Category Navigation Pages ----

  async updateCategoryNav(category: string, bookTitle: string): Promise<void> {
    const navPath = `${this.notesFolder}/${category}/${category}.md`;
    const bookLink = `- [[${bookTitle}]]`;

    const catFolder = `${this.notesFolder}/${category}`;
    if (!this.app.vault.getFolderByPath(catFolder)) {
      await this.app.vault.createFolder(catFolder);
    }

    const existing = this.app.vault.getFileByPath(navPath);
    if (existing) {
      const content = await this.app.vault.read(existing);
      if (!content.includes(bookLink)) {
        const updated = content.trimEnd() + `\n${bookLink}\n`;
        await this.app.vault.modify(existing, updated);
        this.log.debug('Nav page updated', { category, book: bookTitle });
      }
    } else {
      const content = `---
tags:
  - _分类/${category}
---

# ${category}

## 📖 书籍列表

${bookLink}
`;
      await this.app.vault.create(navPath, content);
      this.log.info('Nav page created', { category });
    }
  }

  // ---- Category Directory Management ----

  async ensureCategoryDirectories(categories: readonly string[]): Promise<void> {
    if (!this.app.vault.getFolderByPath(this.notesFolder)) {
      await this.app.vault.createFolder(this.notesFolder);
    }
    for (const cat of categories) {
      const catPath = `${this.notesFolder}/${cat}`;
      if (!this.app.vault.getFolderByPath(catPath)) {
        await this.app.vault.createFolder(catPath);
        this.log.debug('Created category directory', { path: catPath });
      }
    }
  }

  // ---- Helpers ----

  private buildNotePath(title: string): string {
    const safeName = sanitizeTitle(title);
    return normalizePath(`${this.notesFolder}/${safeName}.md`);
  }

  private formatDate(timestamp: number): string {
    const d = new Date(timestamp);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const hour = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${year}年${month}月${day}日 ${hour}:${min}`;
  }

  private escapeYaml(value: string): string {
    return value.replace(/"/g, '\\"');
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
