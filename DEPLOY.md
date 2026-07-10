# Obsidian AI Book Manager — 部署与测试指南

## 前置条件

- Obsidian ≥ 1.5.0（桌面版，不支持移动端）
- Node.js ≥ 18（用于构建）
- DeepSeek API Key（可选，不配置则只扫描不打标签）

---

## 第一步：构建插件

```bash
cd /Users/cyk-station/ai_book_library_manage
npm install
npm run build
```

产物：`main.js`、`manifest.json`。

---

## 第二步：部署到 Obsidian Vault

每个 Obsidian Vault 的插件目录在 `<vault>/.obsidian/plugins/`。假设你的测试 vault 路径为 `~/Documents/MyVault`：

```bash
# 创建插件目录
mkdir -p ~/Documents/MyVault/.obsidian/plugins/ai-book-manager

# 复制构建产物
cp main.js manifest.json ~/Documents/MyVault/.obsidian/plugins/ai-book-manager/

# 如果第 1 步还没跑
cd /Users/cyk-station/ai_book_library_manage && npm run build
```

**更快的方式——软链接（推荐开发时使用）：**

```bash
VAULT=~/Documents/MyVault
PLUGIN_DIR="$VAULT/.obsidian/plugins/ai-book-manager"
mkdir -p "$PLUGIN_DIR"
ln -sf /Users/cyk-station/ai_book_library_manage/main.js "$PLUGIN_DIR/main.js"
ln -sf /Users/cyk-station/ai_book_library_manage/manifest.json "$PLUGIN_DIR/manifest.json"
```

这样每次 `npm run build` 后 Obsidian 自动加载最新版本，无需重复复制。

---

## 第三步：启用插件

1. 打开 Obsidian
2. 设置 → 社区插件 → 关闭"安全模式"
3. 在已安装插件列表中找到 **AI Book Manager**
4. 点击开关启用

---

## 第四步：配置

打开设置 → AI Book Manager，逐项填写：

| 配置项 | 说明 | 示例 |
|---|---|---|
| Book directory | 书籍存放目录的绝对路径 | `/Users/cyk-station/books`（注意：不要用 `~/Downloads` 等 macOS 保护的目录，Obsidian 首次会弹窗请求文件访问权限） |
| Supported formats | 扫描的文件后缀 | `.pdf,.epub,.txt` |
| DeepSeek API key | 你的 API Key | `sk-...` |
| DeepSeek API URL | API 端点 | `https://api.deepseek.com/v1` |
| Model | 模型名 | `deepseek-chat` |
| Auto AI tagging | 扫描后自动打标签 | 先关闭，手动验证后再开 |
| Notes folder | 笔记存放目录 | `📚图书库` |
| Max scan pages | AI 分类时读取的前 N 页 | `3` |
| Max concurrency | 并行 AI 请求数 | `1` |

---

## 第五步：冒烟测试（逐步验证）

### 5.1 扫描测试

1. 确保 `/Users/cyk-station/books` 目录下有 3-5 本测试书籍（pdf/epub/txt 混合）
2. `Cmd+P` → 输入 "Scan book directory" → 回车
3. 预期：右上角弹出扫描进度，完成后提示 "Scan complete: X new, Y skipped"
4. 打开 Vault 文件列表 → 进入 📚图书库 文件夹 → 每本书生成了一个 `.md` 笔记
5. 打开任意笔记 → 验证 frontmatter 包含 title/author/format/book_id/tags/file_path

### 5.2 AI 连接测试

1. `Cmd+P` → 输入 "Test AI connection" → 回车
2. 预期：弹出 "DeepSeek API connection: OK"，显示耗时和 Token 消耗
3. 如果失败：检查 API Key 是否正确，网络是否能访问 `https://api.deepseek.com`

### 5.3 AI 自动打标测试

1. 设置中开启 "Auto AI tagging"
2. 删除一本书的笔记，用不同书名重新命名（测试去重），重新扫描
3. 预期：扫描完成后，笔记 frontmatter 中出现 `tags: ["标签1", "标签2", ...]` 和 `category: "分类"`
4. 打开 Obsidian 图谱视图 → 验证带标签的书籍节点出现并按标签聚类

### 5.4 侧边栏测试

1. 点击左侧 Ribbon 栏的书本图标（📖）
2. 预期：右侧出现 "AI Book Manager" 面板，三个标签页：Books / Progress / Log
3. Books 标签：显示已扫描书籍提示
4. Progress 标签：可切换 "Auto AI tagging" 开关
5. Log 标签：显示日志占位

### 5.5 AI 按钮测试

1. 打开任意书籍笔记
2. 预期：笔记底部出现 "🤖 AI Actions" 区域，三个按钮：Summary / Outline / Chapter Analysis
3. 点击任意按钮 → 显示 "⏳ Generating..." 加载状态（当前版本功能标记为 "coming soon"）

---

## 常见问题

### Q: 扫描后没有生成笔记？

- 检查书籍目录是否正确配置（绝对路径，末尾不带空格）
- macOS 首次运行：Obsidian 会弹窗请求文件夹访问权限，必须点"允许"
- 默认只扫描 `.pdf`、`.epub`、`.txt`，检查你的书籍后缀是否匹配

### Q: macOS 弹窗"无权访问 Downloads"？

macOS 对 `~/Downloads`、`~/Documents`、`~/Desktop` 有额外保护。首次使用时 Obsidian 会弹出系统级文件夹访问授权弹窗，点击"允许"即可。如果没有弹窗：系统设置 → 隐私与安全性 → 文件和文件夹 → 确保 Obsidian 已勾选对应文件夹。

如果一直无法访问，把书籍移到 `/Users/cyk-station/books` 等非保护目录。

### Q: 扫描大量 PDF 时报错？

扫描版/图片型 PDF 无法提取文字，parser 会自动跳过并生成警告。书籍仍会创建笔记，但 AI 打标时只依赖文件名，标签质量会下降。

### Q: 修改了书籍文件，如何更新笔记？

当前版本支持手动重新扫描。在目录中新增书籍 → `Cmd+P` → Scan → 只处理新文件（通过 SHA256 哈希去重）。修改已有文件需要删除原书笔记再重新扫描。

### Q: 开发模式如何快速迭代？

```bash
# 监听模式：修改源码自动重新构建
npm run dev

# 每次构建后在 Obsidian 中：
# Cmd+P → "Reload app without saving" 刷新插件
```

---

## 卸载

```bash
rm -rf <vault>/.obsidian/plugins/ai-book-manager
```

插件数据在 `<vault>/.obsidian/plugins/ai-book-manager/data.json`，删除目录即完全清理。生成的书籍笔记不受影响（它们是 vault 中的普通 Markdown 文件）。
