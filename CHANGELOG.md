# 变更记录

## v0.1.1（2026-11-13）

在 0.1.0 基础上的修复版。版本号统一为 **0.1.1**。

### 修正

- 产品标识统一为 **cccodroid Steam Deck 0.1.1**：更新页和 GitHub Release 标题都带 `Steam Deck`，
  避免把移植版的版本号当成上游 cccodroid 的版本号。
- 桌面只保留一个 cccodroid 快捷方式；应用图标改用上游 cccodroid 的图标（192×192 PNG）。
- 设置 → 更新：同时检查「cccodroid 本体」和「Claude Code」；应用本体可从 GitHub Releases 下载更新。
- 修正 Claude Code 当前版本高于 stable 渠道时被误显示为「有新版本」（点下去是降级）的问题；
  「检查更新」现在会立即给出反馈。
- 新增 `scripts/sync-upstream.sh` 与 `docs/UPSTREAM.md`：记录上游基线 v0.6.17，可对照 v0.6.20 的网关改动。
- 扩展页恢复「可选组件 / 自定义组件」两块，并按 Linux 适配：组件清单改为 Linux 可用的
  Chromium、FFmpeg、yt-dlp、restic、apktool 等（能用户级安装的直接装，需要 root 的给命令）；
  自定义组件支持导入 x86_64 程序 / AppImage / 脚本，生成同名命令和 Claude 技能。
- 修正 Flatpak 组件安装报 `No remote refs found for 'flathub'`：网关把 HOME/XDG 收进了应用目录，
  看不到用户自己的 flathub；现在 Flatpak 安装改用真实用户环境，装完生成 `chromium` 等包装命令。
- 应用本体更新下载 GitHub Release 资产时，直链失败会自动回退到 `ghfast.top` / `gh-proxy.com` /
  `ghproxy.net` 加速镜像；更新时优先继承已安装的 Claude Code，不再重复下载。
- **发行包确认不含 Claude Code 本体**；0.1.0 的旧二进制资产已撤回（旧构建误含 Claude Code），请使用 0.1.1。
- 游戏模式界面语言：Steam 启动时 `LANG` 可能不是桌面会话的语言；`cccodroid-ui` 会读
  `~/.config/plasma-localerc`，游戏模式和桌面模式显示同一种语言。
- 游戏模式触摸板：`cccodroid steam add` 会给快捷方式装「Web Browser」手柄布局，触摸板当鼠标，
  不用按住 Steam 键也能动光标。
- 桌面任务栏图标：窗口的 WM_CLASS / Wayland app_id 设为 `cccodroid`，桌面条目加 `StartupWMClass`，
  任务栏和切换器都用上游图标。
- **「全部放行」不再弹安全卡**：用户级配置变更（UserConfig）、项目自运行配置、上一轮留下的后台进程、
  敏感操作再确认（密钥 / 凭据）这几类卡片在 `bypassPermissions` 下全部跳过，guard 钩子也不挂；
  切回默认或逐次确认时这些保护照常保留。设置里的说明同步改成「默认 / 逐次确认会问；全部放行不问」。

### 文档

- `README` 增加「在 Steam Deck 上，它到底能帮你干什么」：agent 的工具清单、能做的事和使用边界。
- 新增 [`docs/STEAMDECK.zh-CN.md`](docs/STEAMDECK.zh-CN.md)：Decky 插件安装、只读根分区、软件安装路线选择、
  六个真实场景、游戏模式用法、提示词写法和常见报错对照表。

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

### 移除（Android 专属功能，Linux 用不到）

工作岛（灵动岛）、Shizuku/特权授权与设备工具、内存管家、耗电统计、组件市场/工具包模块/自定义组件/对账、
端侧小模型、公告与反馈入口、Office 转 PDF、截屏、执行方式与滚动冻结脱困、安卓分享与主题联动、折叠屏适配、
`/sdcard` 共享存储路径。

### 已知限制

- 真正的 Steam 游戏模式（gamescope 下渲染）与真手柄映射未在公开环境逐一验收。
- 页面操控依赖原生窗口运行；窗口没开时工具会提示先 `cccodroid open`。
- 发行包不含 Claude Code 本体，需要用户自行安装。
