// ============================================================
// Scan Command — trigger book directory scan from Obsidian
// ============================================================

import { Notice } from 'obsidian';
import { PluginSettings } from '../models';
import { ScanService } from '../services/scan-service';
import { createLogger } from '../logger';
import { App } from 'obsidian';

export class ScanCommand {
  private app: App;
  private settings: PluginSettings;
  private scanService: ScanService;

  constructor(app: App, settings: PluginSettings, scanService: ScanService) {
    this.app = app;
    this.settings = settings;
    this.scanService = scanService;
  }

  async execute(): Promise<void> {
    const log = createLogger('scan-cmd');

    if (!this.settings.bookDirectory) {
      new Notice('❌ Please configure your book directory in settings first.');
      return;
    }

    const notice = new Notice('🔍 Scanning book directory...', 0);

    try {
      const result = await this.scanService.executeFullScan((progress) => {
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
