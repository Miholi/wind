# DeepSeek Desktop 🖥️

> 基于 **Electron** 的 DeepSeek 桌面客户端 —— 支持 **API 模式** 与 **网页模式**，单应用双体验。

![Platform](https://img.shields.io/badge/platform-Windows-blue) ![Electron](https://img.shields.io/badge/Electron-33-47848F) ![License](https://img.shields.io/badge/license-MIT-green)

---

## ✨ 功能特性

| 功能 | 说明 |
|------|------|
| 💬 **API 模式** | 直连 DeepSeek 官方 API（`api.deepseek.com`），支持自定义 Base URL 与模型切换 |
| 🌐 **网页模式** | 内嵌官方网页版，域名白名单锁定 `chat.deepseek.com`，安全可控 |
| 📝 **Markdown 渲染** | 代码高亮（highlight.js）· 数学公式（KaTeX）· 流程图表（Mermaid） |
| 🌍 **中英双语** | 内置 i18n，一键切换界面语言 |
| 🖨️ **系统集成** | 系统托盘、桌面快捷方式、消息完成通知 |
| 🔒 **密钥本地化** | API Key 仅保存在本机，绝不随代码分发 |

## 📂 项目结构

```text
wind/
├── main.js                  # Electron 主进程：窗口、托盘、IPC、API 转发
├── preload.js               # 预加载脚本：渲染进程 ↔ 主进程的安全桥接
├── package.json             # 项目配置 + electron-builder 打包配置
├── package-lock.json        # 依赖版本锁定
│
├── assets/                  # 应用图标资源
│   ├── icon.ico             #   Windows 安装包图标
│   └── icon.png             #   通用图标
│
└── renderer/                # 渲染进程（界面层）
    ├── index.html           #   主页面骨架
    ├── css/
    │   └── app.css          #   全局样式
    ├── js/
    │   ├── app.js           #   应用入口：模式切换与状态流转
    │   ├── api.js           #   DeepSeek API 请求封装
    │   ├── ui.js            #   界面交互逻辑
    │   ├── store.js         #   本地持久化：会话记录 / 用户设置
    │   ├── markdown.js      #   Markdown 渲染管线（公式 / 图表）
    │   └── i18n.js          #   中英文案字典
    └── vendor/
        └── highlight.min.js #   代码高亮库（本地内置，离线可用）

🚫 dist/                     # 构建产物（不入库，见 .gitignore）
```

## 🚀 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) ≥ 18

### 开发运行

```bash
# 1. 克隆仓库
git clone https://github.com/Miholi/wind.git
cd wind

# 2. 安装依赖
npm install

# 3. 启动应用
npm run dev
```

### 打包 Windows 安装包

```bash
npm run dist     # 生成 NSIS 安装程序 → dist/ 目录
npm run pack     # 仅输出免安装目录（不打包 exe）
```

## ⚙️ 配置说明

1. 前往 [DeepSeek 开放平台](https://platform.deepseek.com) 创建并复制你的 **API Key**；
2. 打开应用 → 设置 → 粘贴 API Key；
3. 可选：修改 Base URL 或切换模型（默认 `deepseek-chat`）。

> 🔐 API Key 只存储在本地配置中，不会同步、不会上传。

## 🛡️ 安全说明

- ✅ 本仓库已通过敏感信息扫描：无硬编码密钥 / 密码 / 私钥；
- ✅ 网页模式内嵌浏览器受白名单限制，仅允许加载 `chat.deepseek.com`；
- ✅ `.env`、证书等文件已在 `.gitignore` 中永久排除。

## 📄 License

[MIT](./LICENSE) © wind
