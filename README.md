# Web AI Translator

<p align="center">
  <img src="extension/assets/icon-512.png" alt="Web AI Translator" width="128" height="128">
</p>

<p align="center">
  基于大语言模型（LLM）的浏览器网页翻译扩展，支持整页上下文感知翻译
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Vue-3.4-brightgreen?logo=vue.js" alt="Vue 3">
  <img src="https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/Vite-5.4-purple?logo=vite" alt="Vite">
  <img src="https://img.shields.io/badge/Manifest%20V3-green?logo=googlechrome" alt="Manifest V3">
</p>

---

## 功能亮点

- 🤖 **AI 驱动翻译** — 调用大语言模型，理解整页上下文，翻译质量远超传统机器翻译
- 🔌 **兼容多种 API** — 支持所有 OpenAI 兼容接口（OpenAI、DeepSeek、通义千问、Moonshot 等）
- 🖱️ **点击切换原文** — 点击翻译后的段落即可查看/隐藏原文，方便对比阅读
- 📜 **滚动即翻译** — 滚动到新区域时自动翻译可视内容，无需等待整页完成
- 📊 **实时进度** — 浮动进度条展示翻译进度，支持流式（streaming）逐元素出字
- ⌨️ **快捷键** — `Alt+T` 一键翻译当前页面
- 🌐 **Chrome + Firefox** — 同时支持 Chrome 和 Firefox 浏览器
- 🛡️ **Shadow DOM 隔离** — 翻译 UI 样式完全隔离，不影响宿主页面

## 截图

<p align="center">
  <img width="320" height="137" alt="Image" src="https://github.com/user-attachments/assets/08ae42c6-2dfb-49ec-85fc-ebb3c6550626" />
</p>

<p align="center">
  <img width="650" height="653" alt="Image" src="https://github.com/user-attachments/assets/83f2c434-ca00-4ce2-8622-a77041a16da9" />
</p>

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 9

### 安装依赖

```bash
pnpm install
```

### 开发

```bash
# Chrome 开发模式（默认）
pnpm dev

# Firefox 开发模式
pnpm dev-firefox
```

开发模式下，在浏览器中加载 `extension/` 目录即可。

> Vite 自动处理 HMR；但仍推荐安装 [Extensions Reloader](https://chromewebstore.google.com/detail/extensions-reloader/fimgfedafeadlieiabdeeaodndnlbhid) 以便干净的硬重载。

### 构建

```bash
pnpm build
```

构建产物位于 `extension/dist/`。

### 打包

```bash
pnpm pack
```

生成 `.zip`、`.crx`、`.xpi` 打包文件。

## 使用指南

### 1. 配置 API

点击扩展图标 → **设置**，填写：

| 配置项       | 说明                 | 示例                        |
| ------------ | -------------------- | --------------------------- |
| API Base URL | OpenAI 兼容 API 地址 | `https://api.openai.com/v1` |
| API Key      | 你的 API 密钥        | `sk-...`                    |
| 模型名称     | 要使用的模型         | `gpt-4o-mini`               |
| 目标语言     | 翻译的目标语言       | `简体中文`                  |

配置后点击 **测试连接** 验证 API 是否可用。

### 2. 翻译页面

- 点击 Popup 中的 **翻译此页** 按钮
- 或使用快捷键 `Alt+T`

翻译过程中页面右下角会显示进度条。翻译完成后，点击任意段落可查看原文。

### 3. 恢复原文

点击 Popup 中的 **恢复原文** 按钮，所有翻译将被撤销。

## 架构

```
src/
├── background/         # Service Worker — LLM 调用、消息路由
│   └── main.ts
├── popup/              # 浏览器操作弹窗
│   └── Popup.vue
├── options/            # 全页设置界面
│   └── Options.vue
├── sidepanel/          # Chrome 侧边栏 / Firefox 边栏
│   └── Sidepanel.vue
├── contentScripts/     # 注入网页的脚本 + 进度浮窗组件
│   ├── index.ts
│   └── views/
├── logic/              # 核心逻辑（跨上下文共享）
│   ├── html-extractor.ts   # DOM 遍历、元素标记、HTML 提取分片
│   ├── translator.ts       # OpenAI 兼容 API 调用 + 流式翻译
│   ├── prompt-builder.ts   # 翻译提示词构建 + 响应解析
│   ├── dom-replacer.ts     # 翻译结果回填、原文/译文切换
│   ├── element-extractor.ts # 流式增量元素提取器
│   ├── storage.ts          # 响应式持久化存储
│   └── types.ts            # 类型定义
├── composables/        # 响应式存储封装
└── styles/             # 共享样式
```

### 翻译流水线

```
用户触发翻译 (Popup / Alt+T)
       │
       ▼
Content Script: TreeWalker 遍历 DOM
  ├─ 标记 text-bearing 元素 (data-wt-id)
  ├─ 提取清洗后的 HTML 副本
  └─ 分片 (max 80K 字符/片)
       │
       ▼
Background: 并发翻译分片 (limit 3)
  ├─ 流式调用 LLM (SSE streaming)
  ├─ element-extractor 增量提取完成的元素
  └─ 逐元素推回 content script
       │
       ▼
Content Script: 接收翻译结果
  ├─ 通过 data-wt-id 映射回真实 DOM
  ├─ 注入点击切换样式 (wt-translated-block)
  └─ 更新进度条
```

### 跨上下文通信

使用 [webext-bridge](https://github.com/serversideup/webext-bridge) 实现类型安全的消息传递：

| 消息                       | 方向                        | 用途              |
| -------------------------- | --------------------------- | ----------------- |
| `translate-page`           | Content Script → Background | 发送 HTML 分片    |
| `translation-chunk-result` | Background → Content Script | 返回单个翻译结果  |
| `translation-progress`     | Background → Content Script | 状态更新          |
| `trigger-translation`      | Popup → Content Script      | 用户触发翻译/恢复 |
| `get-translation-status`   | Popup → Content Script      | 查询进度状态      |

## 技术栈

| 类别    | 技术                                       |
| ------- | ------------------------------------------ |
| 框架    | Vue 3 (Composition API + `<script setup>`) |
| 语言    | TypeScript                                 |
| 构建    | Vite 5                                     |
| CSS     | UnoCSS (Atomic CSS)                        |
| 扩展    | Manifest V3 / WebExtension Polyfill        |
| 通信    | webext-bridge                              |
| 存储    | browser.storage.local (响应式封装)         |
| LLM SDK | openai ^6.0                                |
| 测试    | Vitest + Playwright                        |
| Lint    | ESLint (flat config, @antfu/eslint-config) |
| 包管理  | pnpm                                       |

## 命令速查

```bash
pnpm dev              # 开发 (Chrome)
pnpm dev-firefox      # 开发 (Firefox)
pnpm build            # 生产构建
pnpm lint             # 代码检查
pnpm test             # 单元测试
pnpm test:e2e         # E2E 测试
pnpm typecheck        # TypeScript 类型检查
pnpm pack             # 打包 .zip/.crx/.xpi
pnpm start:chromium   # web-ext 启动 Chromium
pnpm start:firefox    # web-ext 启动 Firefox
```

## 支持的 API 服务商

任何兼容 OpenAI Chat Completions 接口的服务均可使用：

- [OpenAI](https://platform.openai.com/)
- [DeepSeek](https://www.deepseek.com/)
- [Moonshot (月之暗面)](https://www.moonshot.cn/)
- [通义千问 (Qwen)](https://tongyi.aliyun.com/)
- [智谱 GLM](https://open.bigmodel.cn/)
- [硅基流动 (SiliconFlow)](https://siliconflow.cn/)
- 以及其他兼容 OpenAI 接口的服务

## 许可证

[MIT](LICENSE)

---

<p align="center">
  Built on <a href="https://github.com/antfu/vitesse-webext">Vitesse WebExt</a>
</p>
