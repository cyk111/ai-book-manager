// ============================================================
// Test AI Command — verify DeepSeek connectivity
// ============================================================

import { App, Notice } from 'obsidian';
import { PluginSettings } from '../models';
import { verifyAIConnection } from '../ai-client';

export class TestAICommand {
  private app: App;
  private settings: PluginSettings;

  constructor(app: App, settings: PluginSettings) {
    this.app = app;
    this.settings = settings;
  }

  async execute(): Promise<void> {
    if (!this.settings.deepseekApiKey) {
      new Notice('❌ Please configure your DeepSeek API key in settings first.');
      return;
    }

    const notice = new Notice('🤖 Testing DeepSeek connection...', 0);

    try {
      const result = await verifyAIConnection({
        baseUrl: this.settings.deepseekBaseUrl,
        apiKey: this.settings.deepseekApiKey,
        model: this.settings.deepseekModel,
      });

      notice.hide();

      // Extract first line for short notice
      const firstLine = result.split('\n')[0];
      new Notice(firstLine, 5000);
    } catch (err) {
      notice.hide();
      new Notice(`❌ AI connection failed: ${String(err).slice(0, 100)}`, 8000);
    }
  }
}
