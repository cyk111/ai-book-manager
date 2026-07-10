# 架构文档 — AI Book Manager

## 1. 架构概览

```
┌─────────────────────────────────────────────────────┐
│                    Obsidian App Host                 │
│  ┌───────────────────────────────────────────────┐  │
│  │              Plugin Entry (main.ts)            │  │
│  │   Lifecycle │ Settings │ Commands │ Sidebar   │  │
│  └──────┬──────────┬──────────┬─────────────────┘  │
│         │          │          │                      │
│  ┌──────▼──────┐ ┌─▼──────────▼──────────┐         │
│  │   Settings   │ │     Commands Layer     │         │
│  │   Tab View   │ │  ScanCmd │ TestAICmd  │         │
│  └─────────────┘ └──────────┬─────────────┘         │
│                              │                        │
│  ┌───────────────────────────▼───────────────────┐   │
│  │              Services Layer                     │   │
│  │  ┌──────────┐ ┌───────────┐ ┌──────────────┐  │   │
│  │  │  Scan    │ │   Note    │ │    Tag       │  │   │
│  │  │ Service  │ │  Service  │ │   Service    │  │   │
│  │  └────┬─────┘ └─────┬─────┘ └──────┬───────┘  │   │
│  │       │              │              │           │   │
│  │  ┌────▼──────────────▼──────────────▼───────┐  │   │
│  │  │           Queue Service                   │  │   │
│  │  │     Rate-limited, persistent task queue   │  │   │
│  │  └──────────────────────────────────────────┘  │   │
│  └───────────────────────────────────────────────┘   │
│                                                       │
│  ┌───────────────────────────────────────────────┐   │
│  │               Core Modules                      │   │
│  │  ┌──────────┐ ┌──────────┐ ┌───────────────┐ │   │
│  │  │ Scanner  │ │  Parser  │ │  AI Client    │ │   │
│  │  │ (fs,hash)│ │(pdf/epub)│ │(DeepSeek API) │ │   │
│  │  └──────────┘ └──────────┘ └───────────────┘ │   │
│  └───────────────────────────────────────────────┘   │
│                                                       │
│  ┌───────────────────────────────────────────────┐   │
│  │            Obsidian Native APIs                 │   │
│  │  Vault │ MetadataCache │ FileManager │ Graph  │   │
│  │  Workspace │ ItemView │ MarkdownPostProcessor │   │
│  └───────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

**依赖方向**：由外向内。外层（Views/Commands）依赖内层（Services），内层依赖核心模块（Scanner/Parser/AI Client）。核心模块不依赖 Obsidian API，纯逻辑可独立测试。

---

## 2. 模块设计

### 2.1 核心模块（无 Obsidian 依赖）

#### Scanner (`src/scanner.ts`)

- **职责**：递归遍历文件系统，识别书籍文件，SHA256 去重
- **输入**：`bookDir: string`, `formats: string[]`, `existingBooks: Map`
- **输出**：`ScanResult { books: BookRecord[], totalFound, newBooks, skipped, failed, errors }`
- **关键算法**：SHA256 前 64KB 快速哈希，已知哈希集合 O(1) 去重
- **错误策略**：单文件失败不中断扫描，记录到 errors[] 继续

#### Parser (`src/parser.ts`)

- **职责**：从 PDF/EPUB/TXT 提取文本和元数据
- **PDF**：`pdfjs-dist` 动态 import（首屏加载不阻塞），提取 metadata + 前 N 页文本
- **EPUB**：`adm-zip` 解压 ZIP → 遍历 xhtml/html → 正则去 HTML 标签
- **TXT**：原生 `fs.readFileSync`
- **容错**：任何格式解析失败 → 返回 warnings + 空文本，不抛异常

#### AI Client (`src/ai-client.ts`)

- **职责**：DeepSeek API 通信层
- **功能**：
  - `classifyBook()` — 标签分类（200 tokens 输出上限，JSON 模式）
  - `generateSummary()` — 摘要生成（400 tokens 输出上限）
  - `verifyAIConnection()` — 连通性测试
- **韧性**：指数退避重试（默认 3 次）、30s AbortController 超时
- **Token 估算**：中文 ~1 token/字，英文 ~0.25 token/字

### 2.2 业务服务层（依赖 Obsidian API）

#### ScanService (`src/services/scan-service.ts`)

- **职责**：扫描编排
- **流程**：验证目录 → 加载已有记录 → runScanner → parseBook → createBookNote → 持久化
- **进度事件**：`scanning → parsing → creating_notes → complete`
- **增量扫描**：通过 SHA256 去重自动实现，只处理新文件

#### NoteService (`src/services/note-service.ts`)

- **职责**：笔记 CRUD + AI 按钮注入
- **createBookNote**：生成 Markdown 内容、创建文件夹、写入 vault
- **appendSection**：追加或替换 Markdown 章节（`## SectionTitle`）
- **injectButtons**：通过 MarkdownPostProcessor 在书籍笔记底部注入 AI 按钮
- **getBookNote**：通过 metadataCache 按 book_id 查找笔记

#### TagService (`src/services/tag-service.ts`)

- **职责**：AI 打标 + frontmatter 更新
- **流程**：enqueueBook → QueueService → classifyBook → processFrontMatter → 写入 tags/category
- **与 QueueService 集成**：批量打标排队，限速执行

#### QueueService (`src/services/queue-service.ts`)

- **职责**：通用限速任务队列
- **特性**：可配并发数、最小间隔、暂停/恢复、事件系统、序列化/反序列化
- **持久化**：`serialize()` 输出完整队列快照 → `restore()` 恢复待处理任务

### 2.3 视图层

#### SettingTab (`src/views/setting-tab.ts`)

- 9 项配置：书籍目录、格式、API Key、API URL、Model、Auto-tag 开关、笔记目录、扫描页数、并发数

#### SidebarView (`src/views/sidebar-view.ts`)

- 三 Tab：Books（书籍列表）、Progress（扫描状态）、Log（操作日志）
- 通过 Obsidian ItemView API 注册

### 2.4 命令层

| 命令 | 文件 | 作用 |
|---|---|---|
| Scan book directory | `commands/scan-command.ts` | 调用 ScanService 执行扫描，显示进度提示 |
| Test AI connection | `commands/test-ai-command.ts` | 调用 verifyAIConnection，显示连通性 |

---

## 3. 数据模型

### BookRecord
```typescript
interface BookRecord {
  id: string;           // book_{hash16}
  fileName: string;     // 原始文件名
  filePath: string;     // 绝对路径
  format: BookFormat;   // 'pdf' | 'epub' | 'txt'
  fileSize: number;
  fileHash: string;     // SHA256 前 64KB，16 hex
  modifiedAt: number;
  title: string;        // 从元数据提取或文件名推断
  author: string | null;
  tags: string[];       // AI 生成标签
  notePath: string | null;  // vault 内笔记路径
  createdAt: number;
  updatedAt: number;
}
```

### QueueTask
```typescript
interface QueueTask<T> {
  id: string;
  type: string;         // 'tagging' | 'summary' | 'outline' | 'chapter'
  data: T;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error: string | null;
  tokenUsed: number;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  retries: number;
}
```

### PluginSettings
```typescript
interface PluginSettings {
  bookDirectory: string;
  supportedFormats: string[];
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  deepseekModel: string;
  autoTagging: boolean;
  notesFolder: string;
  maxScanPages: number;
  maxConcurrency: number;
}
```

### 数据存储

```
<Vault>/.obsidian/plugins/ai-book-manager/
├── main.js              # 插件代码
├── manifest.json         # 插件声明
└── data.json            # 插件数据（Settings + BookRecords + QueueState）
```

---

## 4. 关键设计决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 存储方案 | Obsidian Vault 原生 Markdown | 零额外数据库，利用原生图谱、搜索、双链 |
| 图谱渲染 | 零开发，复用 Obsidian 原生 | 标签自动聚类、双链自动连线 |
| AI 策略 | 懒加载（用户点击才调用） | 节省 Token、用户可控 |
| 去重算法 | SHA256 前 64KB | 速度与准确性平衡，千本秒级 |
| 文本提取 | 只取前 3 页 | 满足 AI 分类需求，速度优先 |
| 队列模型 | 内存队列 + data.json 持久化 | 简单可靠，崩溃可恢复 |
| 错误处理 | AppError 继承体系 + correlationId | 全链路追踪，结构化日志 |
| 插件入口 | 薄入口 (< 100 行) | 只做生命周期管理和模块装配 |
| 测试策略 | 核心模块 80%+ 覆盖，胶水层不强制 | 避免为覆盖率数字写 mock |

---

## 5. 错误处理体系

```
AppError (基类)
  ├── ScanError    — 文件扫描错误（目录不存在、权限不足）
  ├── ParseError   — 书籍解析错误（格式不支持、文件损坏）
  ├── AIError      — AI API 错误（认证失败、响应异常）
  ├── NetworkError — 网络错误（超时、重试耗尽）
  └── QueueError   — 队列操作错误

每次错误携带:
  - code: "AIBM_{TYPE}"
  - correlationId: 唯一追踪 ID
  - details: 上下文数据
```

---

## 6. AI Prompt 架构

### 分类 Prompt（Token 优化）

```
System: "You are a book classifier. Output only valid JSON."
User:   "Book info: Title: {title}, Author: {author}, Preview: {300 chars}
         Return: JSON { title, author, tags[], category }
         Rules: 3-6 tags, Chinese preferred, genre+topic+style"
Config:  temperature=0.3, max_tokens=200, response_format=json_object
```

### 摘要 Prompt

```
System: "You write concise, insightful book summaries in Chinese."
User:   "Write summary (~200 chars): what it's about, who it's for, main takeaway.
         Title: {title}, Author: {author}, Content: {3000 chars}"
Config:  temperature=0.5, max_tokens=400
```

---

## 7. 技术栈

| 层级 | 技术 | 说明 |
|---|---|---|
| 平台 | Obsidian Plugin API | Vault, Metadata, Workspace, Graph |
| 语言 | TypeScript (strict) | 类型安全 |
| 构建 | esbuild | 极速打包 |
| 测试 | Jest + ts-jest | 92 个用例 |
| PDF | pdfjs-dist (动态 import) | 浏览器/Electron 兼容 |
| EPUB | adm-zip | ZIP 解压 + 正则 HTML 清洗 |
| AI | DeepSeek API (OpenAI 兼容) | 支持切换 Ollama/其他 |
| 日志 | 自定义结构化 JSON Logger | correlationId 追踪 |

---

## 8. 安全模型

- API Key 存储：Obsidian `data.json`，仅本地，不通过 `frontmatter` 暴露
- 书籍内容：默认发送到 DeepSeek 云端；切换 Ollama 可完全离线
- 文件访问：Electron 运行时 + macOS TCC 用户授权弹窗
- 插件沙箱：遵守 Obsidian 插件安全策略，不访问 Vault 外路径（除非用户显式授权）
