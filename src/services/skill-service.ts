// ============================================================
// Skill Service — multi-tool skill generation pipeline
// ============================================================
//
// Orchestrates: extract full text → analyze structure →
// generate chapters → glossary/patterns/cheatsheet (full mode) →
// assemble SKILL.md → write files to vault (📚图书库/Skills/<slug>/) →
// create symlinks to selected AI tools

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { App, Notice } from 'obsidian';
import { AIConfig, analyzeBookStructure, generateChapterSummaries, generateGlossary, generatePatterns, generateCheatsheet, generateSkillMd } from '../ai-client';
import { extractFullText } from '../parser';
import { BookRecord, PluginSettings } from '../models';
import { Logger, NOOP_LOGGER } from '../logger';
import { SKILL_SYNC_TOOLS, SKILLS_FOLDER } from '../constants';

// ---- Types ----

export type SkillProgressPhase =
  | 'extracting'
  | 'analyzing_structure'
  | 'generating_chapters'
  | 'generating_glossary'
  | 'generating_patterns'
  | 'generating_cheatsheet'
  | 'assembling_skillmd'
  | 'writing_files'
  | 'complete'
  | 'error';

export interface SkillProgress {
  phase: SkillProgressPhase;
  current: number;
  total: number;
  message: string;
}

export type SkillProgressCallback = (progress: SkillProgress) => void;

export interface SkillGenerationResult {
  skillPath: string;
  chapterCount: number;
  totalTokens: number;
  syncedTools: string[];
}

// ---- Constants ----

const FULL_TEXT_MAX_CHARS = 200_000;
const CHAPTERS_PER_BATCH = 3;

// ---- Skill Service ----

export class SkillService {
  private app: App;
  private settings: PluginSettings;
  private log: Logger;

  constructor(app: App, settings: PluginSettings, logger: Logger = NOOP_LOGGER) {
    this.app = app;
    this.settings = settings;
    this.log = logger;
  }

  // ---- Public API ----

  /**
   * Generate a Claude Code skill from a book.
   * @returns the output directory path
   */
  async generateSkill(
    book: BookRecord,
    onProgress: SkillProgressCallback,
  ): Promise<SkillGenerationResult> {
    const mode = this.settings.skillMode;
    const config: AIConfig = {
      baseUrl: this.settings.aiBaseUrl,
      apiKey: this.settings.aiApiKey,
      model: this.settings.aiModel,
    };

    if (!config.apiKey) {
      throw new Error('API key is not configured');
    }

    if (!fs.existsSync(book.filePath)) {
      throw new Error(`Book file not found: ${book.filePath}`);
    }

    let totalTokens = 0;

    // ---- Step 1: Extract full text ----
    onProgress({ phase: 'extracting', current: 0, total: 0, message: '提取全文...' });
    this.log.info('Skill gen: extracting full text', { title: book.title });

    const fullText = await extractFullText(book.filePath, book.format, this.log);
    if (!fullText || fullText.trim().length < 50) {
      throw new Error('无法从书籍中提取文本内容。文件可能为扫描版 PDF 或受 DRM 保护。');
    }
    this.log.info('Skill gen: full text extracted', { length: fullText.length });

    // ---- Step 2: Analyze structure ----
    onProgress({ phase: 'analyzing_structure', current: 0, total: 0, message: '分析章节结构...' });
    this.log.info('Skill gen: analyzing structure', { title: book.title });

    const structure = await analyzeBookStructure(config, book.title, book.author, fullText, this.log);
    totalTokens += structure.tokenUsed;

    const chapters = structure.chapters || [{ title: '完整内容', startIndex: 0 }];
    this.log.info('Skill gen: structure analyzed', { chapterCount: chapters.length, bookType: structure.bookType });

    // ---- Step 3: Extract chapter texts ----
    const chapterTexts: Array<{ number: number; title: string; text: string }> = [];
    for (let i = 0; i < chapters.length; i++) {
      const startIdx = chapters[i].startIndex;
      const endIdx = i + 1 < chapters.length ? chapters[i + 1].startIndex : fullText.length;
      chapterTexts.push({
        number: i + 1,
        title: chapters[i].title,
        text: fullText.slice(startIdx, Math.min(endIdx, startIdx + FULL_TEXT_MAX_CHARS)),
      });
    }

    // ---- Step 4: Generate chapter summaries in batches ----
    const chapterData: Array<{ number: number; title: string; summary: string }> = [];
    const totalBatches = Math.ceil(chapterTexts.length / CHAPTERS_PER_BATCH);

    for (let batch = 0; batch < totalBatches; batch++) {
      const batchChapters = chapterTexts.slice(batch * CHAPTERS_PER_BATCH, (batch + 1) * CHAPTERS_PER_BATCH);

      onProgress({
        phase: 'generating_chapters',
        current: batch + 1,
        total: totalBatches,
        message: `生成章节概要 (${batch + 1}/${totalBatches})...`,
      });

      this.log.info('Skill gen: generating chapter batch', { batch: batch + 1, totalBatches });

      const result = await generateChapterSummaries(
        config,
        book.title,
        batchChapters.map(c => c.number),
        batchChapters.map(c => c.title),
        batchChapters.map(c => c.text),
        this.log,
      );
      totalTokens += result.tokenUsed;
      chapterData.push(...result.summaries);
    }

    // ---- Step 5: Full mode extras ----
    let glossary = '';
    let patterns = '';
    let cheatsheet = '';

    if (mode === 'full') {
      onProgress({ phase: 'generating_glossary', current: 0, total: 0, message: '生成术语表...' });
      this.log.info('Skill gen: generating glossary');
      const gResult = await generateGlossary(config, book.title, chapterData, this.log);
      glossary = gResult.glossary;
      totalTokens += gResult.tokenUsed;

      onProgress({ phase: 'generating_patterns', current: 0, total: 0, message: '提取模式与方法...' });
      this.log.info('Skill gen: generating patterns');
      const pResult = await generatePatterns(config, book.title, chapterData, this.log);
      patterns = pResult.patterns;
      totalTokens += pResult.tokenUsed;

      onProgress({ phase: 'generating_cheatsheet', current: 0, total: 0, message: '创建速查表...' });
      this.log.info('Skill gen: generating cheatsheet');
      const cResult = await generateCheatsheet(config, book.title, chapterData, this.log);
      cheatsheet = cResult.cheatsheet;
      totalTokens += cResult.tokenUsed;
    }

    // ---- Step 6: Assemble SKILL.md ----
    onProgress({ phase: 'assembling_skillmd', current: 0, total: 0, message: '合成 SKILL.md...' });
    this.log.info('Skill gen: assembling SKILL.md');

    const slug = this.generateBookSlug(book.title, book.id);
    const mdResult = await generateSkillMd(
      config,
      book.title,
      book.author,
      slug,
      structure.keyThemes,
      structure.bookType,
      chapterData,
      mode,
      this.log,
    );
    totalTokens += mdResult.tokenUsed;

    // ---- Step 7: Write files to vault ----
    onProgress({ phase: 'writing_files', current: 0, total: 0, message: '写入文件...' });
    this.log.info('Skill gen: writing files', { slug });

    const vaultSkillDir = this.getVaultSkillPath();
    const skillPath = await this.writeSkillFiles(
      vaultSkillDir,
      slug,
      mdResult.skillMd,
      chapterData,
      mode,
      glossary,
      patterns,
      cheatsheet,
    );

    // ---- Step 8: Sync symlinks to selected tools ----
    const synced = this.syncSymlinks(skillPath);
    if (synced.length > 0) {
      this.log.info('Skill gen: synced to tools', { tools: synced });
    }

    onProgress({ phase: 'complete', current: 0, total: 0, message: '完成' });

    this.log.info('Skill gen: complete', {
      title: book.title,
      skillPath,
      chapterCount: chapterData.length,
      totalTokens,
      syncedTools: synced.length,
    });

    return {
      skillPath,
      chapterCount: chapterData.length,
      totalTokens,
      syncedTools: synced,
    };
  }

  /**
   * Generate a URL-safe slug from a book title.
   * Public so main.ts can use it for the usage notice.
   */
  generateBookSlug(title: string, bookId: string): string {
    const sanitized = title
      .replace(/[^\w一-鿿]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    const shortHash = bookId.replace(/^book_/, '').replace(/^src_/, '').slice(0, 6);
    const base = sanitized || 'book';
    return `${base}-${shortHash}`;
  }

  // ---- Private Helpers ----

  /** Get the absolute vault path for skills output: {vaultRoot}/📚图书库/Skills */
  private getVaultSkillPath(): string {
    const vaultRoot = (this.app.vault.adapter as unknown as { basePath?: string }).basePath;
    if (!vaultRoot) {
      throw new Error('Cannot determine vault root path');
    }
    return path.join(vaultRoot, this.settings.notesFolder, SKILLS_FOLDER);
  }

  /**
   * Create symlinks from vault skill dir to each configured sync target.
   * E.g., vault/Skills/三体-abc123 → ~/.claude/skills/三体-abc123
   */
  private syncSymlinks(skillDir: string): string[] {
    const synced: string[] = [];
    const targets = this.settings.skillSyncTargets || [];

    for (const targetId of targets) {
      const tool = SKILL_SYNC_TOOLS[targetId];
      if (!tool) continue;

      const targetDir = tool.defaultPath.replace(/^~/, os.homedir());
      const linkPath = path.join(targetDir, path.basename(skillDir));

      try {
        // Ensure target directory exists
        fs.mkdirSync(targetDir, { recursive: true });

        // Remove existing symlink or directory if present
        if (fs.existsSync(linkPath)) {
          const stat = fs.lstatSync(linkPath);
          if (stat.isSymbolicLink()) {
            fs.unlinkSync(linkPath);
          } else if (stat.isDirectory()) {
            fs.rmSync(linkPath, { recursive: true });
          }
        }

        // Create symlink: linkPath → skillDir
        fs.symlinkSync(skillDir, linkPath, 'dir');
        synced.push(`${tool.name} (${linkPath})`);
        this.log.info('Skill symlinked', { tool: tool.name, linkPath, target: skillDir });
      } catch (err) {
        this.log.warn('Skill symlink failed', {
          tool: tool.name,
          linkPath,
          error: String(err),
        });
      }
    }

    return synced;
  }

  private slugifyChapter(title: string): string {
    return title
      .replace(/[^\w一-鿿]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30);
  }

  private async writeSkillFiles(
    outputDir: string,
    slug: string,
    skillMd: string,
    chapterData: Array<{ number: number; title: string; summary: string }>,
    mode: 'light' | 'full',
    glossary: string,
    patterns: string,
    cheatsheet: string,
  ): Promise<string> {
    const skillDir = path.join(outputDir, slug);
    const chaptersDir = path.join(skillDir, 'chapters');

    // Create directories
    fs.mkdirSync(chaptersDir, { recursive: true });

    // Write SKILL.md
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillMd, 'utf-8');

    // Write chapter files
    for (const ch of chapterData) {
      const chSlug = this.slugifyChapter(ch.title) || `chapter-${ch.number}`;
      const chNum = String(ch.number).padStart(2, '0');
      const chFileName = `ch${chNum}-${chSlug}.md`;

      const chContent = `# ${ch.title}

${ch.summary}
`;
      fs.writeFileSync(path.join(chaptersDir, chFileName), chContent, 'utf-8');
    }

    // Write full mode extras
    if (mode === 'full') {
      if (glossary) {
        fs.writeFileSync(path.join(skillDir, 'glossary.md'), glossary, 'utf-8');
      }
      if (patterns) {
        fs.writeFileSync(path.join(skillDir, 'patterns.md'), patterns, 'utf-8');
      }
      if (cheatsheet) {
        fs.writeFileSync(path.join(skillDir, 'cheatsheet.md'), cheatsheet, 'utf-8');
      }
    }

    return skillDir;
  }
}
