// ============================================================
// Settings Tab — plugin configuration UI
// ============================================================

import { App, PluginSettingTab, Setting } from 'obsidian';
import type AIBookManagerPlugin from '../../main';

export class AIBookSettingTab extends PluginSettingTab {
  plugin: AIBookManagerPlugin;

  constructor(app: App, plugin: AIBookManagerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'AI Book Manager' });

    // ---- Book Directory ----
    new Setting(containerEl)
      .setName('Book directory')
      .setDesc('Absolute path to your local book folder')
      .addText(text =>
        text
          .setPlaceholder('/Users/xxx/books')
          .setValue(this.plugin.settings.bookDirectory)
          .onChange(async value => {
            this.plugin.settings.bookDirectory = value;
            await this.plugin.saveSettings();
          }),
      );

    // ---- Supported Formats ----
    new Setting(containerEl)
      .setName('Supported formats')
      .setDesc('Comma-separated file extensions (.pdf,.epub,.txt)')
      .addText(text =>
        text
          .setPlaceholder('.pdf,.epub,.txt')
          .setValue(this.plugin.settings.supportedFormats.join(','))
          .onChange(async value => {
            this.plugin.settings.supportedFormats = value
              .split(',')
              .map(s => s.trim().toLowerCase())
              .filter(s => s.startsWith('.'));
            await this.plugin.saveSettings();
          }),
      );

    // ---- DeepSeek API Key ----
    new Setting(containerEl)
      .setName('DeepSeek API key')
      .setDesc('Your DeepSeek API key (stored locally)')
      .addText(text =>
        text
          .setPlaceholder('sk-...')
          .setValue(this.plugin.settings.deepseekApiKey)
          .onChange(async value => {
            this.plugin.settings.deepseekApiKey = value;
            await this.plugin.saveSettings();
          }),
      );

    // ---- DeepSeek API URL ----
    new Setting(containerEl)
      .setName('DeepSeek API URL')
      .setDesc('API endpoint base URL')
      .addText(text =>
        text
          .setPlaceholder('https://api.deepseek.com/v1')
          .setValue(this.plugin.settings.deepseekBaseUrl)
          .onChange(async value => {
            this.plugin.settings.deepseekBaseUrl = value;
            await this.plugin.saveSettings();
          }),
      );

    // ---- Model Name ----
    new Setting(containerEl)
      .setName('Model')
      .setDesc('DeepSeek model name (deepseek-chat or deepseek-reasoner)')
      .addText(text =>
        text
          .setPlaceholder('deepseek-chat')
          .setValue(this.plugin.settings.deepseekModel)
          .onChange(async value => {
            this.plugin.settings.deepseekModel = value;
            await this.plugin.saveSettings();
          }),
      );

    // ---- Auto Tagging Toggle ----
    new Setting(containerEl)
      .setName('Auto AI tagging')
      .setDesc('Automatically classify books with AI tags after scanning')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.autoTagging)
          .onChange(async value => {
            this.plugin.settings.autoTagging = value;
            await this.plugin.saveSettings();
          }),
      );

    // ---- Notes Folder ----
    new Setting(containerEl)
      .setName('Notes folder')
      .setDesc('Vault folder for generated book notes')
      .addText(text =>
        text
          .setPlaceholder('📚图书库')
          .setValue(this.plugin.settings.notesFolder)
          .onChange(async value => {
            this.plugin.settings.notesFolder = value;
            await this.plugin.saveSettings();
          }),
      );

    // ---- Max Scan Pages ----
    new Setting(containerEl)
      .setName('Max scan pages')
      .setDesc('Pages to extract per book for AI classification (1-10)')
      .addSlider(slider =>
        slider
          .setLimits(1, 10, 1)
          .setValue(this.plugin.settings.maxScanPages)
          .setDynamicTooltip()
          .onChange(async value => {
            this.plugin.settings.maxScanPages = value;
            await this.plugin.saveSettings();
          }),
      );

    // ---- Max Concurrency ----
    new Setting(containerEl)
      .setName('Max concurrency')
      .setDesc('Max parallel AI requests (1-5, higher = faster but may hit rate limits)')
      .addSlider(slider =>
        slider
          .setLimits(1, 5, 1)
          .setValue(this.plugin.settings.maxConcurrency)
          .setDynamicTooltip()
          .onChange(async value => {
            this.plugin.settings.maxConcurrency = value;
            await this.plugin.saveSettings();
          }),
      );

    // ---- Enable Auto Sync ----
    const autoSyncSetting = new Setting(containerEl)
      .setName('启用自动同步')
      .setDesc('启动 Obsidian 时自动扫描新书（需先配置书籍目录且图书库文件夹存在）')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.autoSyncOnStartup)
          .onChange(async value => {
            this.plugin.settings.autoSyncOnStartup = value;
            // When auto-sync turned off, also disable file watcher
            if (!value && this.plugin.settings.watchBookDirectory) {
              this.plugin.settings.watchBookDirectory = false;
            }
            await this.plugin.saveSettings();
            // Re-render to update file watcher toggle state
            this.display();
          }),
      );

    // ---- Enable File Watcher (depends on auto-sync) ----
    const watcherSetting = new Setting(containerEl)
      .setName('实时监听文件变更')
      .setDesc('监听书籍目录的文件变化，自动同步新书（依赖「启用自动同步」）')
      .addToggle(toggle => {
        toggle
          .setValue(this.plugin.settings.watchBookDirectory)
          .onChange(async value => {
            this.plugin.settings.watchBookDirectory = value;
            await this.plugin.saveSettings();
          });

        // Disable when auto-sync is off
        if (!this.plugin.settings.autoSyncOnStartup) {
          toggle.setDisabled(true);
        }
      });

    // Grey out the entire row when auto-sync is off
    if (!this.plugin.settings.autoSyncOnStartup) {
      watcherSetting.settingEl.style.opacity = '0.5';
      watcherSetting.setDisabled(true);
    }
  }
}
