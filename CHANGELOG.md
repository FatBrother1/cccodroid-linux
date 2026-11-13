# 变更记录

## v0.1.0（2026-11-13）

第一个公开版本。版本号 0.1.0，基于上游 cccodroid 网关源码。

### 新增

- 可直接安装的发行包（`cccodroid-0.1.0-linux-x86_64.tar.gz`）：解压后 `./install.sh` 即可；
  首次安装会从 npm 官方平台包安装 Claude Code（不随包分发）。
- Debian / Ubuntu 的 `.deb` 一键安装包（`cccodroid_0.1.0_amd64.deb`）：系统装到 `/opt/cccodroid`，
  首次运行时为当前用户初始化；SteamOS 不能用 .deb。
- Qt6 原生窗口外壳：单实例、缩放/全屏、大小记忆、下载与文件选择、控制台日志。
- Steam 游戏模式入口：`cccodroid steam add|remove|status`，手柄映射与前台启动脚本。
- 桌面通知：任务完成、等你确认、定时任务结果。
- 会话导入导出：`cccodroid export` / `import` / `import --undo`。
- 内置 OpenAI 本地协议桥（可选）：`cccodroid bridge configure|service install|provider`。
- 页面操控 MCP（ccui）：`screen / tap / type / scroll / key / open / pages / screenshot / wait`，
  让 Claude 操作原生窗口里的页面。
- 更新链路：本地文件/在线更新、签名验证、`rollback`、`prune`。
- `cccodroid doctor` 体检、`cccodroid tools-doc` 工具清单。

### 修正

- 产品标识统一为 **cccodroid Steam Deck 0.1.0**：更新页和 GitHub Release 标题都带 `Steam Deck`，
  避免把移植版的 0.1.0 当成上游 cccodroid 的版本号。
- 桌面只保留一个 cccodroid 快捷方式；应用图标改用上游 cccodroid 的图标（192×192 PNG）。
- 设置 → 更新：同时检查「cccodroid 本体」和「Claude Code」；应用本体可从 GitHub Releases 下载更新。
- 修正 Claude Code 当前版本高于 stable 渠道时被误显示为「有新版本」（点下去是降级）的问题；
  「检查更新」现在会立即给出反馈。
- 新增 `scripts/sync-upstream.sh` 与 `docs/UPSTREAM.md`：记录上游基线 v0.6.17，可对照 v0.6.20 的网关改动。

### 文档

- `README` 增加「在 Steam Deck 上，它到底能帮你干什么」：agent 的工具清单、能做的事和使用边界。
- 新增 [`docs/STEAMDECK.zh-CN.md`](docs/STEAMDECK.zh-CN.md)：Decky 插件安装、只读根分区、软件安装路线选择、
  五个真实场景、提示词写法和常见报错对照表。

### 移除（Android 专属功能，Linux 用不到）

工作岛（灵动岛）、Shizuku/特权授权与设备工具、内存管家、耗电统计、组件市场/工具包模块/自定义组件/对账、
端侧小模型、公告与反馈入口、Office 转 PDF、截屏、执行方式与滚动冻结脱困、安卓分享与主题联动、折叠屏适配、
`/sdcard` 共享存储路径。

### 已知限制

- 真正的 Steam 游戏模式（gamescope 下渲染）与真手柄映射未在公开环境逐一验收。
- 页面操控依赖原生窗口运行；窗口没开时工具会提示先 `cccodroid open`。
- 发行包不含 Claude Code 本体，需要用户自行安装。
