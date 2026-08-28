# AI Web 🖥️

> 基于 **Electron** 的 AI 网页客户端桌面封装 —— 专为 DeepSeek 打造的轻量桌面窗口，登录态自动持久化。

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue) ![Electron](https://img.shields.io/badge/Electron-33.4.11-47848F) ![License](https://img.shields.io/badge/license-MIT-green) ![Version](https://img.shields.io/badge/version-2.0.0-orange)

---

## ✨ 功能特性

| 功能 | 说明 |
|------|------|
| 🧭 **DeepSeek 专属** | 内置 DeepSeek 官方网页，启动即加载，无需切换平台 |
| 🔐 **登录态持久化** | DeepSeek 使用独立持久化分区（partition），Cookies / 登录状态自动保存 |
| 🚪 **登录跳转放行** | DeepSeek 的第三方 OAuth 登录跳转（Google / Apple / 微软 / GitHub 等）在应用内完成，不弹出外部浏览器 |
| 🧱 **安全外链** | 网页内弹窗新开一律交给系统浏览器打开（仅放行 http/https 链接）；页内导航不做拦截 |
| 🖨️ **系统集成** | 系统托盘（左键唤起主界面 / 右键菜单退出）、全局快捷键 Ctrl+Alt+D 唤起窗口 |
| ⌨️ **网页区快捷键** | Ctrl+R 刷新、Alt+←/→ 前进后退、Ctrl+=/-/0 缩放、Ctrl+Alt+I 开发者工具，均作用于 DeepSeek 页面 |
| 🛡️ **内存管理** | 优化内存使用，应用退出时自动清理资源，避免内存泄漏 |
| 💾 **数据持久化** | 头像设置本地存储，重启后保留配置 |

## 📂 项目结构

```text
wind/
├── main.js                  # Electron 主进程：窗口、托盘、全局快捷键、头像持久化、外链打开
├── preload.js               # 预加载脚本：渲染进程 ↔ 主进程的安全桥接
├── package.json            # 项目配置 + electron-builder 打包配置
├── assets/                  # 应用图标资源（icon.ico / icon.png）
├── renderer/                # 渲染进程（界面层）
│   ├── index.html           #   主页面骨架（侧边栏 + BrowserView 容器 + 裁剪弹窗）
│   ├── css/app.css          #   全局样式
│   └── js/app.js            #   平台配置、侧边栏渲染、头像管理
└── .gitignore               # Git 忽略规则配置
```

## 🛡️ 安全说明

- ✅ 网页内容运行在独立的 `BrowserView` 中，与主进程隔离（`contextIsolation` + 默认 `sandbox`）；
- ✅ 弹窗新开链接在主进程完成 scheme 校验（仅 http/https）后统一交给系统浏览器打开；页内导航暂不拦截；
- ✅ DeepSeek 使用独立持久化分区，登录状态持久化保存；
- ✅ 优化内存管理，应用退出时自动清理 BrowserView 资源，防止内存泄漏；
- ✅ 完善的错误处理机制，异常情况下有友好的用户提示。

## 🚀 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) ≥ 18
- npm ≥ 8.0

### 安装依赖

```bash
# 如果下载速度慢，建议使用淘宝镜像
npm install --registry=https://registry.npmmirror.com

# 或者设置环境变量（Windows）
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm install
```

### 开发运行

```bash
npm run dev      # 启动开发模式
```

### 打包应用

```bash
npm run dist     # 生成 Windows 安装程序 → dist/ 目录
npm run pack     # 仅输出免安装目录（不打包 exe）
```

## 📝 更新日志

### v2.0.0 (2024-08-27)

#### 🎉 新增功能
- ✨ 支持自定义平台头像上传
- ✨ 优化内存管理，退出时自动清理资源
- ✨ 完善错误处理和用户提示

#### 🐛 Bug 修复
- 🔧 修复内存泄漏问题（BrowserView 未清理）
- 🔧 修复 Promise 错误处理缺失导致的应用异常
- 🔧 修复删除所有自定义平台后的边界情况
- 🔧 修复全局快捷键重复注册问题
- 🔧 修复跨平台托盘图标兼容性

#### 🛡️ 安全增强
- 🔒 优化外链安全校验机制
- 🔒 加强用户输入验证和过滤

#### 📝 代码优化
- 🎯 完善 .gitignore 规则
- 🎯 优化代码结构和注释
- 🎯 提升错误日志的可读性

### v1.0.0 (2024-08-16)

#### 🎉 初始发布
- ✨ 支持多平台切换
- ✨ 支持自定义平台添加
- ✨ 登录态隔离
- ✨ 系统托盘集成
- ✨ 全局快捷键支持

## ❓ 常见问题

### Q: 安装 electron 时下载很慢怎么办？

**A:** 使用国内镜像源：

```bash
# 设置 electron 镜像（Windows PowerShell）
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"

# 然后重新安装
npm install
```

### Q: 启动时提示 "Lock file can not be created" 错误？

**A:** 这是由于之前的 electron 进程没有正常退出导致的。解决方案：

1. **重启电脑**（最简单）
2. **手动清理**：
   ```bash
   # 以管理员身份运行 PowerShell
   taskkill /F /IM electron.exe
   Remove-Item "$env:LOCALAPPDATA\electron\Cache" -Recurse -Force
   ```

### Q: 头像数据保存在哪里？

**A:** 保存在系统用户数据目录：
- Windows: `C:\Users\用户名\AppData\Roaming\ai-web-desktop\`
- macOS: `~/Library/Application Support/ai-web-desktop/`
- Linux: `~/.config/ai-web-desktop/`

### Q: 如何保持 DeepSeek 的登录状态？

**A:** 应用为 DeepSeek 使用独立的持久化分区（partition），Cookies 和登录状态会自动保存，重启后仍然有效。

### Q: 应用占用内存过高怎么办？

**A:**
- 定期重启应用清理缓存
- 使用最新版本（v2.0.0 已优化内存管理）

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 License

[MIT](./LICENSE) © wind
