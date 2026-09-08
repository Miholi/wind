# AI Web 🖥️

> 基于 **Electron** 的 AI 网页客户端桌面封装 —— 专为 DeepSeek 打造的轻量桌面窗口，登录态自动持久化。

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue) ![Electron](https://img.shields.io/badge/Electron-33.4.11-47848F) ![License](https://img.shields.io/badge/license-MIT-green) ![Version](https://img.shields.io/badge/version-2.1.0-orange)

---

## ✨ 功能特性

| 功能 | 说明 |
|------|------|
| 🧭 **DeepSeek 专属** | 内置 DeepSeek 官方网页，启动即加载，无需切换平台 |
| 🖼️ **视觉启动页** | 照片背景 + 暗色遮罩 + Ken Burns 缓慢推镜动效，加载等待不再单调 |
| 🔐 **登录态持久化** | DeepSeek 使用独立持久化分区（partition），Cookies / 登录状态自动保存 |
| 🧱 **安全外链** | 网页内弹窗新开一律交给系统浏览器打开（仅放行 http/https 链接）；页内导航不做拦截 |
| 🚀 **会话自动同步** | 窗口在后台停留超过 5 分钟后，唤起时自动重载网页，同步其他客户端产生的新会话 |
| 🖥️ **系统集成** | 系统托盘（左键唤起主界面 / 右键菜单退出）、全局快捷键 Ctrl+Alt+D 唤起窗口、单实例锁 |
| ⌨️ **网页区快捷键** | Ctrl+R 刷新、Alt+←/→ 前进后退、Ctrl+=/-/0 缩放、Ctrl+Alt+I 开发者工具，均作用于 DeepSeek 页面 |
| 🛡️ **内存管理** | 应用退出时自动清理 BrowserView 资源，避免内存泄漏 |

## 🎨 启动页设计

启动 / 加载过渡页由一张实拍照片驱动（原图 `angen.jpg`）：

- **背景层**：美化后的照片经降采样 + 重模糊生成轻量背景图（约 29KB），`cover` 铺满并缓慢推镜；
- **遮罩层**：暗色渐变 + 品牌蓝辉光，保证白色前景文字的对比度；
- **前景**：DeepSeek 徽标 + 旋转加载环 + 状态文字，尊重系统「减少动态效果」设置（`prefers-reduced-motion`）；
- 窗口底色与启动页同为深色（`#0f1322`），启动瞬间无白闪。

## 📂 项目结构

```text
wind/
├── main.js                  # Electron 主进程：窗口、托盘、全局快捷键、外链拦截、会话同步
├── preload.js               # 预加载脚本：selectPlatform / onLoading 两个安全桥接接口
├── package.json             # 项目配置 + electron-builder 打包配置（含 Electron 下载镜像）
├── .npmrc                   # npm 侧国内镜像（Electron 运行时 / electron-builder 二进制）
├── assets/                  # 应用图标资源（icon.ico / icon.png）
├── renderer/                # 渲染进程（界面层）
│   ├── index.html           #   页面骨架（splash 启动页 + BrowserView 容器）
│   ├── css/app.css          #   全局样式（启动页视觉 / 动效）
│   ├── js/app.js            #   平台配置、启动页状态控制
│   └── img/
│       ├── angen-bg.jpg     #   启动页背景（720 宽，约 29KB，由处理脚本生成）
│       ├── angen.jpg        #   美化后全尺寸照片（1280x720，备用母版）
│       ├── platform-1.png   #   DeepSeek 徽标（启动页 logo，2.9MB，待优化）
│       └── brand.png        #   品牌图（当前未被引用）
├── originals/               # 原图存档（不参与打包）
│   └── angen-src.jpg        #   原始照片的未修改副本（SHA256 与原件一致）
├── tools/
│   └── enhance-angen.ps1    # 图片美化 + 优化处理脚本（可复现全部图片资源）
└── .gitignore               # Git 忽略规则配置
```

## 🖼️ 图片资源管线

启动页照片源自外部原图（`D:\equip\picture\angen.jpg`，**永远只读，绝不修改**）：

1. 原图副本存档于 `originals/angen-src.jpg`（哈希校验与原件一致）；
2. 运行处理脚本一键生成全部图片资源：

   ```powershell
   # Windows PowerShell 5.1+（依赖系统自带 System.Drawing）
   powershell -File tools\enhance-angen.ps1
   ```

3. 脚本处理流程与输出：

   | 步骤 | 参数 | 输出 |
   |------|------|------|
   | 饱和度增强 | +10%（保亮度、不动色相） | — |
   | 对比度增强 | +7%（中点保持） | — |
   | USM 锐化 | amount 0.38（清晰度 221 → 432） | `renderer/img/angen.jpg`（q88，约 165KB） |
   | 背景版 | 720 宽降采样 + 重模糊 + 轻压暗 | `renderer/img/angen-bg.jpg`（q80，约 29KB） |

想调整风格，直接改脚本头部的参数区重跑即可。

## 🛡️ 安全说明

- ✅ 网页内容运行在独立的 `BrowserView` 中，与主进程隔离（`contextIsolation` + 默认 `sandbox`）；
- ✅ 弹窗新开链接在主进程完成 scheme 校验（仅 http/https）后统一交给系统浏览器打开；页内导航暂不拦截；
- ✅ DeepSeek 使用独立持久化分区，登录状态持久化保存；
- ✅ 页面 UA 内核版本跟随实际 Chromium 版本，避免站点风控误判；
- ✅ 单实例锁：重复启动自动唤起已有窗口；
- ✅ 应用退出时自动清理 BrowserView 资源，防止内存泄漏。

## 🚀 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) ≥ 18
- npm ≥ 8.0

### 安装依赖

```bash
npm install
```

> ✅ 项目已内置国内镜像配置（`.npmrc`）：Electron 运行时与 electron-builder 构建工具自动走 npmmirror，克隆后开箱即可安装/打包，无需再手动设置 `ELECTRON_MIRROR`。若 npm 包本身下载慢，可追加 `--registry=https://registry.npmmirror.com`。

### 开发运行

```bash
npm run dev      # 启动开发模式
```

### 打包应用

```bash
npm run dist     # 生成 Windows 安装程序 → dist/ 目录
npm run pack     # 仅输出免安装目录（不打包 exe）
```

> 打包配置只收录 `main.js`、`preload.js`、`renderer/**`、`assets/**`；`originals/` 与 `tools/` 不进入安装包。

## 📝 更新日志

### v2.1.0 (2026-09-09)

#### 🎨 界面改版
- ✨ 启动页全新视觉：实拍照片背景 + 暗色可读性遮罩 + Ken Burns 缓慢推镜动效
- ✨ 支持系统「减少动态效果」设置（自动停用背景动效与加载环动画）
- 🔧 窗口底色改为深色 `#0f1322`，消除启动瞬间白闪

#### 🖼️ 图片资源
- ✨ 新增图片处理脚本 `tools/enhance-angen.ps1`（饱和/对比/锐化 + 轻量背景版生成，全流程可复现）
- ✨ 新增 `renderer/img/angen.jpg`（美化全尺寸版）与 `renderer/img/angen-bg.jpg`（启动页背景，约 29KB）
- 🛡️ 原图副本存档于 `originals/`（不参与打包），外部原图文件保持只读

#### 🧹 工程清理与文档
- 🔧 清理根目录误生成的 Windows 保留名文件 `nul`（该文件会导致 ripgrep 等工具扫描报错）
- 📝 README 与当前代码同步：移除已废弃的多平台侧栏、头像上传等历史功能描述，补充图片资源管线说明

#### 🔧 构建优化
- ✨ 新增 `.npmrc`：Electron 运行时与 electron-builder 二进制统一走 npmmirror 国内镜像，克隆后开箱即可 `npm install` / `npm run pack`，无需手动配置任何镜像环境变量
- 📝 快速开始文档同步简化（移除手动设置 `ELECTRON_MIRROR` 的旧步骤）

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

### Q: 如何更换启动页背景图？

**A:** 用新图替换 `originals/angen-src.jpg`（保持文件名不变），然后重新运行 `tools/enhance-angen.ps1` 即可。想微调效果，修改脚本头部的饱和度 / 对比度 / 锐化参数即可。

### Q: 如何保持 DeepSeek 的登录状态？

**A:** 应用为 DeepSeek 使用独立的持久化分区（partition），Cookies 和登录状态会自动保存，重启后仍然有效。

### Q: 应用占用内存过高怎么办？

**A:**
- 定期重启应用清理缓存
- 使用最新版本（已优化内存管理，退出时自动清理 BrowserView）

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 License

[MIT](./LICENSE) © wind
