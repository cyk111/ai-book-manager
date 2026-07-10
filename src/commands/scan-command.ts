// ============================================================
// Scan Command — trigger book directory scan from Obsidian
// ============================================================

import { Notice } from 'obsidian';
import { PluginSettings } from '../models';
import { ScanService } from '../services/scan-service';
import { TagService } from '../services/tag-service';
import { createLogger } from '../logger';
import { App } from 'obsidian';

export class ScanCommand {
  private app: App;
  private settings: PluginSettings;
  private tagService?: TagService;

  constructor(app: App, settings: PluginSettings, tagService?: TagService) {
    this.app = app;
    this.settings = settings;
    this.tagService = tagService;
  }

  async execute(): Promise<void> {
    const log = createLogger('scan-cmd');

    if (!this.settings.bookDirectory) {
      new Notice('❌ Please configure your book directory in settings first.');
      return;
    }

    const notice = new Notice('🔍 Scanning book directory...', 0);
    const scanService = new ScanService(this.app, this.settings, this.tagService);

    try {
      const result = await scanService.executeFullScan((progress) => {
        if (progress.phase === 'parsing' && progress.total > 0) {
          notice.setMessage(
            `📖 Processing books: ${progress.current}/${progress.total} — ${progress.bookTitle || ''}`,
          );
        }
      });

      notice.hide();

      const parts = [`✅ Scan: ${result.newBooks} new`];
      if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
      if (result.failed > 0) parts.push(`${result.failed} failed`);
      if (this.settings.autoTagging && this.tagService) {
        const queueStatus = this.tagService.getQueue().getStatus();
        parts.push(`🏷️ Tagging: ${queueStatus.pending} queued`);
      }

      new Notice(parts.join(', '), 5000);
      log.info('Scan command completed', {
        new: result.newBooks,
        skipped: result.skipped,
        failed: result.failed,
      });
    } catch (err) {
      notice.hide();
      new Notice(`❌ Scan failed: ${String(err).slice(0, 100)}`, 8000);
      log.error('Scan command failed', { error: String(err) });
    }
  }
}
