// ============================================================
// Settings Tab — plugin configuration UI
// ============================================================

import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type AIBookManagerPlugin from '../../main';
import { NoteSource, AI_PROVIDER_CONFIG } from '../models';

/** Parse "name=path" lines into NoteSource array */
function parseNoteSources(text: string): NoteSource[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.includes('='))
    .map(line => {
      const idx = line.indexOf('=');
      return {
        name: line.slice(0, idx).trim(),
        path: line.slice(idx + 1).trim(),
      };
    })
    .filter(s => s.name && s.path);
}

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

    // ---- AI Provider ----
    const providerSetting = new Setting(containerEl)
      .setName('AI 模型')
      .setDesc('选择 AI 服务提供商')
      .addDropdown(dropdown => {
        dropdown
          .addOption('deepseek', 'DeepSeek')
          .addOption('openai', 'OpenAI')
          .addOption('qwen', '通义千问')
          .setValue(this.plugin.settings.aiProvider)
          .onChange(async value => {
            const provider = value as 'deepseek' | 'openai' | 'qwen';
            this.plugin.settings.aiProvider = provider;
            // Update base URL and model to provider defaults
            this.plugin.settings.aiBaseUrl = AI_PROVIDER_CONFIG[provider].baseUrl;
            this.plugin.settings.aiModel = AI_PROVIDER_CONFIG[provider].defaultModel;
            await this.plugin.saveSettings();
            // Re-render to update placeholder hints
            this.display();
          });
        return dropdown;
      });

    // ---- AI API Key ----
    const providerCfg = AI_PROVIDER_CONFIG[this.plugin.settings.aiProvider];
    new Setting(containerEl)
      .setName('API Key')
      .setDesc(`输入 ${providerCfg.name} 的 API Key（本地存储）`)
      .addText(text =>
        text
          .setPlaceholder(providerCfg.keyHint)
          .setValue(this.plugin.settings.aiApiKey)
          .onChange(async value => {
            this.plugin.settings.aiApiKey = value;
            await this.plugin.saveSettings();
          }),
      );

    // ---- AI Base URL ----
    new Setting(containerEl)
      .setName('API URL')
      .setDesc('API 端点地址（切换模型时自动更新，也可手动修改）')
      .addText(text =>
        text
          .setPlaceholder(providerCfg.baseUrl)
          .setValue(this.plugin.settings.aiBaseUrl)
          .onChange(async value => {
            this.plugin.settings.aiBaseUrl = value;
            await this.plugin.saveSettings();
          }),
      );

    // ---- Model Name ----
    new Setting(containerEl)
      .setName('模型名称')
      .setDesc('模型 ID（切换模型时自动更新，也可手动修改）')
      .addText(text =>
        text
          .setPlaceholder(providerCfg.defaultModel)
          .setValue(this.plugin.settings.aiModel)
          .onChange(async value => {
            this.plugin.settings.aiModel = value;
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

    // ---- Note Sources (微信读书, iBook, etc.) ----
    containerEl.createEl('h3', { text: '笔记来源' });
    containerEl.createEl('p', {
      text: '配置 Markdown 笔记目录。每行一个来源，格式：名称=路径。如：微信读书=微信读书笔记',
      cls: 'setting-item-description',
    }).style.cssText = 'margin-bottom: 8px; color: var(--text-muted); font-size: 0.85em;';

    const sourcesText = new Setting(containerEl)
      .setName('笔记来源列表')
      .setDesc('格式：来源名称=vault内路径，每行一个')
      .addTextArea(text => {
        text
          .setPlaceholder('微信读书=微信读书笔记\niBook=ibooks-highlights\nKindle=Kindle笔记')
          .setValue(
            this.plugin.settings.noteSources
              .map(s => `${s.name}=${s.path}`)
              .join('\n')
          )
          .onChange(async value => {
            this.plugin.settings.noteSources = parseNoteSources(value);
            await this.plugin.saveSettings();
          });
        text.inputEl.style.cssText = 'width: 100%; min-height: 80px;';
        return text;
      });

    // Add a "Scan Now" button for note sources
    new Setting(containerEl)
      .setName('扫描笔记来源')
      .setDesc('立即扫描所有配置的笔记来源目录，为新书创建索引卡')
      .addButton(btn =>
        btn
          .setButtonText('立即扫描')
          .onClick(async () => {
            if (!this.plugin.sourceScanner) {
              new Notice('❌ 插件未初始化');
              return;
            }
            new Notice('🔍 正在扫描笔记来源...');
            const results = await this.plugin.sourceScanner.scanAllSources();
            const total = results.reduce((sum, r) => sum + r.newBooks, 0);
            new Notice(`✅ 扫描完成：${total} 本新书`);
          }),
      );
  }
}
