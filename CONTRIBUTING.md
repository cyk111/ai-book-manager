# Contributing to AI Book Manager

感谢你的关注！欢迎提交 Issue、PR 和建议。

## 开发环境

```bash
# 克隆仓库
git clone https://github.com/cyk111/ai-book-manager.git
cd ai-book-manager

# 安装依赖
npm install

# 构建
npm run build

# 测试
npm test

# 监听模式（开发时使用）
npm run dev
```

## 项目结构

```
├── main.ts            # 插件入口
├── src/
│   ├── models.ts      # 类型定义
│   ├── ai-client.ts   # AI API 客户端
│   ├── parser.ts      # 书籍解析器
│   ├── scanner.ts     # 文件扫描器
│   ├── services/      # 业务逻辑
│   ├── views/         # UI 组件
│   ├── commands/      # 命令
│   ├── utils/         # 工具函数
│   └── __tests__/     # 测试
```

## 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

- `feat:` — 新功能
- `fix:` — Bug 修复
- `docs:` — 文档更新
- `test:` — 测试
- `refactor:` — 重构
- `chore:` — 构建/工具

## 代码规范

参见 [CLAUDE.md](CLAUDE.md) 了解详细的编码规范。

## Pull Request 流程

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feat/amazing-feature`)
3. 提交你的修改 (`git commit -m 'feat: add amazing feature'`)
4. 推送到分支 (`git push origin feat/amazing-feature`)
5. 开启 Pull Request

## 问题反馈

- 使用 GitHub Issues 报告 Bug
- 提供完整的错误日志和重现步骤
- 功能建议请先搜索是否已有相关 Issue

## 许可证

参与本项目即表示你同意将你的代码按照本项目 [CC BY-NC 4.0](LICENSE) 许可证授权。
