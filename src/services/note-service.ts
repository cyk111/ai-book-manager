// ============================================================
// Note Service — CRUD for book notes in the Obsidian vault
// ============================================================

import { App, TFile, normalizePath } from 'obsidian';
import { BookRecord } from '../models';
import { Logger, NOOP_LOGGER } from '../logger';
import { sanitizeTitle } from '../utils/path-utils';

// ---- Constants ----

const TOC_SECTION = '📋 本书目录';

// ---- Note Service ----

export class NoteService {
  private app: App;
  private notesFolder: string;
  private log: Logger;
  private eventToken: string;

  constructor(app: App, notesFolder: string, logger: Logger = NOOP_LOGGER, eventToken: string = '') {
    this.app = app;
    this.notesFolder = notesFolder;
    this.log = logger;
    this.eventToken = eventToken;
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
book_id: "${book.id}"
format: "${book.format}"
tags: [${book.tags.map(t => `"${this.escapeYaml(t)}"`).join(', ')}]
category: ""
created: "${created}"
---

<div class="ai-book-actions">
🤖 <a href="ai-book://summary" class="ai-book-link">📝 生成简介</a> |
<a href="ai-book://toc" class="ai-book-link">📋 生成目录</a> |
<a href="ai-book://skill" class="ai-book-link">🧠 生成 Skill</a>
</div>

`;
  }

  // ---- Button State Update (for MarkdownPostProcessor) ----

  updateButtonStates(containerEl: HTMLElement, _sourcePath: string): void {
    const text = containerEl.textContent || '';
    const hasSummary = text.includes('📝 书籍简介');
    const hasTOC = text.includes('📋 本书目录');
    const hasSkill = text.includes('🧠 AI Skill');
    const chapterMatches = text.match(/📝 第\d+章[：:][^\n]+/g) || [];
    const generatedChapters = chapterMatches.map(m => m.trim());

    const links = containerEl.querySelectorAll('.ai-book-link');
    links.forEach((link) => {
      const href = link.getAttribute('href') || '';
      if (href.includes('summary') && hasSummary) link.textContent = '🔄 重新生成简介';
      if (href.includes('toc') && hasTOC) link.textContent = '🔄 重新生成目录';
      if (href.includes('skill') && hasSkill) link.textContent = '🔄 重新生成 Skill';
    });

    const tocLinks = containerEl.querySelectorAll('.ai-toc-link');
    tocLinks.forEach((link) => {
      const chapter = link.getAttribute('data-chapter') || '';
      if (chapter && generatedChapters.some(c => c.includes(chapter))) link.textContent = '🔄 重新生成';
    });
  }

  // ---- Category Navigation Pages ----

  /**
   * Update the category navigation page.
   * @param basePath — the source subfolder (e.g. "📚图书库/本地书籍")
   * @param category — the category name (e.g. "科幻")
   * @param bookTitle — the book title for the wiki link
   */
  async updateCategoryNav(basePath: string, category: string, bookTitle: string): Promise<void> {
    const catFolder = `${basePath}/${category}`;
    const navPath = `${catFolder}/${category}.md`;
    const bookLink = `- [[${bookTitle}]]`;
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
  - ${category}
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
    return value
      .replace(/\\/g, '\\\\')   // backslash first (must precede other escapes)
      .replace(/"/g, '\\"')     // double quote
      .replace(/\n/g, '\\n')    // newline
      .replace(/\r/g, '\\r')    // carriage return
      .replace(/\t/g, '\\t');   // tab
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

}
