// ============================================================
// Obsidian API Mock — enables unit testing without Obsidian runtime
// ============================================================

// ---- Pure utility functions ----

export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}

// ---- Data classes ----

export class TFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
  stat: { ctime: number; mtime: number; size: number };

  constructor(path: string) {
    this.path = path;
    const parts = path.split('/');
    this.name = parts[parts.length - 1] || '';
    const dotIdx = this.name.lastIndexOf('.');
    this.basename = dotIdx >= 0 ? this.name.slice(0, dotIdx) : this.name;
    this.extension = dotIdx >= 0 ? this.name.slice(dotIdx + 1) : '';
    this.stat = { ctime: Date.now(), mtime: Date.now(), size: 0 };
  }
}

export class TFolder {
  path: string;
  name: string;
  children: Array<TFile | TFolder>;

  constructor(path: string) {
    this.path = path;
    this.name = path.split('/').pop() || '';
    this.children = [];
  }
}

export class TAbstractFile {}

// ---- Vault ----

export class Vault {
  files: Map<string, string> = new Map(); // path → content
  folders: Set<string> = new Set();

  exists(path: string): boolean {
    return this.files.has(path) || this.folders.has(path);
  }

  async create(path: string, content: string): Promise<TFile> {
    this.files.set(path, content);
    return new TFile(path);
  }

  async read(file: TFile): Promise<string> {
    return this.files.get(file.path) || '';
  }

  async modify(file: TFile, content: string): Promise<void> {
    this.files.set(file.path, content);
  }

  async delete(file: TFile): Promise<void> {
    this.files.delete(file.path);
  }

  getFileByPath(path: string): TFile | null {
    if (this.files.has(path)) return new TFile(path);
    return null;
  }

  getFolderByPath(path: string): TFolder | null {
    if (this.folders.has(path)) return new TFolder(path);
    return null;
  }

  async createFolder(path: string): Promise<TFolder> {
    this.folders.add(path);
    return new TFolder(path);
  }
}

// ---- MetadataCache / FileManager ----

export interface FrontMatterCache {
  [key: string]: unknown;
}

export interface FileCache {
  frontmatter?: FrontMatterCache;
  frontmatterPosition?: { start: { line: number }; end: { line: number } };
  tags?: Array<{ tag: string; position: { start: { line: number } } }>;
}

export class MetadataCache {
  cache: Map<string, FileCache> = new Map();

  getFileCache(file: TFile | null): FileCache | null {
    if (!file) return null;
    return this.cache.get(file.path) || null;
  }

  getCache(path: string): FileCache | null {
    return this.cache.get(path) || null;
  }

  trigger(_name: string): void {}

  on(_name: string, _callback: (...args: unknown[]) => void): void {}
  off(_name: string, _callback: (...args: unknown[]) => void): void {}
}

export class FileManager {
  async processFrontMatter(
    file: TFile,
    fn: (frontmatter: FrontMatterCache) => void,
  ): Promise<void> {
    // Stub: call fn with empty object
    const fm: FrontMatterCache = {};
    fn(fm);
  }

  generateMarkdownLink(file: TFile, sourcePath: string): string {
    return `[[${file.basename}]]`;
  }
}

// ---- Events / Component ----

export class Events {
  _handlers: Map<string, Array<(...args: unknown[]) => void>> = new Map();

  on(name: string, callback: (...args: unknown[]) => void): void {
    if (!this._handlers.has(name)) this._handlers.set(name, []);
    this._handlers.get(name)!.push(callback);
  }

  off(name: string, callback: (...args: unknown[]) => void): void {
    const handlers = this._handlers.get(name);
    if (handlers) {
      this._handlers.set(name, handlers.filter(h => h !== callback));
    }
  }

  trigger(name: string, ...args: unknown[]): void {
    const handlers = this._handlers.get(name);
    if (handlers) {
      handlers.forEach(h => h(...args));
    }
  }
}

export class Component {
  _loaded = true;

  load(): void {}
  unload(): void {}

  registerEvent(_event: unknown): void {}
  addCommand(_command: { id: string; name: string; callback: () => void }): void {}
  addSettingTab(_settingTab: unknown): void {}
  addRibbonIcon(_icon: string, _title: string, _callback: () => void): void {}
  registerView(
    _type: string,
    _viewCreator: (leaf: unknown) => unknown,
  ): void {}
  registerMarkdownPostProcessor(
    _processor: (element: HTMLElement, context: unknown) => void,
  ): void {}
  addStatusBarItem(): HTMLElement {
    return document.createElement('div');
  }
}

// ---- Plugin ----

export class Plugin extends Component {
  app!: App;
  _data: Record<string, unknown> = {};

  async loadData(): Promise<Record<string, unknown>> {
    return { ...this._data };
  }

  async saveData(data: Record<string, unknown>): Promise<void> {
    this._data = { ...data };
  }
}

// ---- PluginSettingTab / Setting ----

export class PluginSettingTab {
  app: App;
  plugin: Plugin;
  containerEl!: HTMLElement;

  constructor(app: App, plugin: Plugin) {
    this.app = app;
    this.plugin = plugin;
  }

  display(): void {}
  hide(): void {}
}

export function createEl(_tag: string, _attrs?: Record<string, string>): HTMLElement {
  return document.createElement(_tag);
}

// ---- Workspace ----

export class WorkspaceLeaf {
  view: unknown;

  constructor() {
    this.view = null;
  }

  async setViewState(_state: { type: string; active: boolean }): Promise<void> {}

  getViewState(): { type: string } {
    return { type: '' };
  }
}

export class Workspace {
  leaves: WorkspaceLeaf[] = [];

  getLeavesOfType(_type: string): WorkspaceLeaf[] {
    return [];
  }

  getRightLeaf(_split: boolean): WorkspaceLeaf | null {
    return new WorkspaceLeaf();
  }

  revealLeaf(_leaf: WorkspaceLeaf): void {}

  onLayoutReady(callback: () => void): void {
    callback();
  }

  on(
    _name: string,
    _callback: (...args: unknown[]) => void,
  ): void {}
}

// ---- App ----

export class App {
  vault: Vault;
  metadataCache: MetadataCache;
  fileManager: FileManager;
  workspace: Workspace;

  constructor() {
    this.vault = new Vault();
    this.metadataCache = new MetadataCache();
    this.fileManager = new FileManager();
    this.workspace = new Workspace();
  }
}

// ---- MarkdownRenderer ----

export class MarkdownRenderer {
  static renderMarkdown(
    _markdown: string,
    _el: HTMLElement,
    _sourcePath: string,
    _component: Component,
  ): Promise<void> {
    return Promise.resolve();
  }
}

// ---- Notice ----

export class Notice {
  message: string;

  constructor(message: string) {
    this.message = message;
  }

  setMessage(message: string): void {
    this.message = message;
  }

  hide(): void {}
}

// ---- ItemView ----

export class ItemView {
  app: App;
  leaf: WorkspaceLeaf;
  contentEl: HTMLElement;

  constructor(leaf: WorkspaceLeaf) {
    this.app = new App();
    this.leaf = leaf;
    this.contentEl = document.createElement('div');
  }

  getDisplayText(): string {
    return '';
  }

  getIcon(): string {
    return '';
  }

  getViewType(): string {
    return '';
  }

  async onOpen(): Promise<void> {}
  async onClose(): Promise<void> {}
}

// ---- Setting (UI) ----
// Minimal stub for settings tab tests

interface SettingOptions {
  name: string;
  desc: string;
  containerEl: HTMLElement;
}

export class Setting {
  name: string;
  desc: string;
  containerEl: HTMLElement;

  constructor(options: SettingOptions) {
    this.name = options.name;
    this.desc = options.desc;
    this.containerEl = options.containerEl;
  }

  setName(_name: string): this { return this; }
  setDesc(_desc: string): this { return this; }
  addText(_cb: (text: TextComponent) => void): this {
    const textComp = new TextComponent();
    textComp.setValue = (val: string) => {
      textComp._value = val;
      return textComp;
    };
    textComp.setPlaceholder = (_p: string) => textComp;
    textComp.onChange = (cb: (value: string) => void) => {
      textComp._onChange = cb;
      return textComp;
    };
    _cb(textComp);
    return this;
  }
  addToggle(_cb: (toggle: ToggleComponent) => void): this {
    const toggleComp = new ToggleComponent();
    toggleComp.setValue = (val: boolean) => {
      toggleComp._value = val;
      return toggleComp;
    };
    toggleComp.onChange = (cb: (value: boolean) => void) => {
      toggleComp._onChange = cb;
      return toggleComp;
    };
    _cb(toggleComp);
    return this;
  }
  addSlider(_cb: (slider: SliderComponent) => void): this {
    const sliderComp = new SliderComponent();
    sliderComp.setLimits = (_min: number, _max: number, _step: number) => sliderComp;
    sliderComp.setValue = (val: number) => { sliderComp._value = val; return sliderComp; };
    sliderComp.setDynamicTooltip = () => sliderComp;
    sliderComp.onChange = (cb: (value: number) => void) => {
      sliderComp._onChange = cb;
      return sliderComp;
    };
    _cb(sliderComp);
    return this;
  }

  /** The root DOM element of this setting row. */
  settingEl: HTMLElement = document.createElement('div');

  /** Disable or enable the entire setting. */
  setDisabled(_disabled: boolean): this {
    return this;
  }
}

export class TextComponent {
  _value = '';
  _onChange: ((value: string) => void) | null = null;
  setValue(val: string): this { this._value = val; return this; }
  setPlaceholder(_placeholder: string): this { return this; }
  onChange(cb: (value: string) => void): this { this._onChange = cb; return this; }
  getValue(): string { return this._value; }
}

export class ToggleComponent {
  _value = false;
  _onChange: ((value: boolean) => void) | null = null;
  _disabled = false;
  setValue(val: boolean): this { this._value = val; return this; }
  onChange(cb: (value: boolean) => void): this { this._onChange = cb; return this; }
  getValue(): boolean { return this._value; }
  setDisabled(disabled: boolean): this { this._disabled = disabled; return this; }
}

export class SliderComponent {
  _value = 3;
  _onChange: ((value: number) => void) | null = null;
  setLimits(_min: number, _max: number, _step: number): this { return this; }
  setValue(val: number): this { this._value = val; return this; }
  setDynamicTooltip(): this { return this; }
  onChange(cb: (value: number) => void): this { this._onChange = cb; return this; }
  getValue(): number { return this._value; }
}
