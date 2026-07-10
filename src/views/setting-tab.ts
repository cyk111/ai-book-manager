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
  }
}
