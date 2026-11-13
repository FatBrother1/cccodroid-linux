# cccodroid-linux：cccodroid 的 Steam Deck / SteamOS 原生移植

把 [cccodroid](https://github.com/greyoak111/cccodroid)（Claude Code 图形工作台）以原生 Linux 桌面应用的方式运行在
SteamOS / Arch 系桌面上：一个 Qt6 原生窗口、一套 systemd 用户服务、一个不需要 root 的安装脚本。
面向 SteamOS 专门优化前端体验，也支持普通 Arch 桌面。

**本项目是社区移植，不是 cccodroid 官方项目。** 上游版权归 Grey Oak 与 cccodroid 贡献者所有，详见「致谢」。

## 特性

- **原生窗口**：Qt6 WebEngine 外壳（`desktop/main.qml`），窗口缩放/全屏/大小记忆、下载与文件选择、控制台日志。
- **Steam 游戏模式**：`cccodroid steam add` 登记 Steam 快捷方式，手柄映射与 kiosk 启动。
- **桌面通知**：任务完成、等你确认、定时任务结果（`notify-send`）。
- **会话迁移**：`cccodroid export` / `import`，支持 zip、标准输入、URL、`用户@主机:路径`，可撤销。
- **内置 OpenAI 本地协议桥**：把自有的 OpenAI Chat Completions 接口适配成本机 Anthropic Messages 接口，
  作为自定义接口使用（组件来自 [cccodroid-openai-bridge](https://github.com/chenshi723/cccodroid-openai-bridge)，可选，需自备上游 API Key）。
- **页面操控 MCP（ccui）**：Claude 可以读取原生窗口里的页面、点按、输入、滚动、截图，用来操作 cccodroid 自己的界面
  和应用内浏览器窗格。
- **更新链路**：本地文件 / 在线更新、发布签名校验、`rollback` 回退、旧版本清理。

## 不包含

- **Claude Code 本体**：Claude Code 是 Anthropic 的专有软件，本仓库与发行包**都不包含**、也不再分发它的二进制或源码。
  请从 Anthropic 官方渠道安装并遵守其条款；本移植只调用你本机已安装的 CLI。
- API Key、模型额度、任何账号凭据。

## 下载安装（推荐）

> 第一次用 Linux / Steam Deck？看 **[大白话安装教程](docs/INSTALL.zh-CN.md)**，一步步照着做就行。

到 [Releases](https://github.com/FatBrother1/cccodroid-linux/releases) 下载
`cccodroid-0.1.0-linux-x86_64.tar.gz`（附 `.sha256` 与 `.sig`）：

```bash
tar -xzf cccodroid-0.1.0-linux-x86_64.tar.gz
cd cccodroid-0.1.0
./install.sh            # 不需要 root；装到 ~/.local/share/cccodroid
cccodroid status
cccodroid open          # 打开原生窗口
```

要求：x86_64 Linux（SteamOS 3.x / Arch 系桌面），Qt6 WebEngine（SteamOS 自带），可选 systemd 用户会话。

**Claude Code 不随包分发**（Anthropic 专有软件）。首次 `install.sh` 会从 npm 官方平台包
`@anthropic-ai/claude-code-linux-x64` 安装到应用自己的运行时目录（验签 + sha512 校验，约 110 MB），
需要能访问 npm 源；装不上时之后再运行 `cccodroid install-claude` 重试，离线环境用
`cccodroid install-claude --from /路径/claude`。

### Debian / Ubuntu 的一键 .deb

`.deb` 单独发布在 [v0.1.0-deb](https://github.com/FatBrother1/cccodroid-linux/releases/tag/v0.1.0-deb)。Debian / Ubuntu（amd64）也可以直接装，系统装到 `/opt/cccodroid`，首次运行 `cccodroid` 时为当前用户初始化：

```bash
sudo apt install ./cccodroid_0.1.0_amd64.deb
cccodroid open
```

卸载：`sudo apt remove cccodroid`（用户数据在 `~/.local/share/cccodroid`，需自行删除）。

> **SteamOS 是 Arch 系、根分区只读，不能用 .deb**；Steam Deck 请用上面的 tar.gz 安装包。

更细的安装、更新、回滚、卸载说明见 [`cccodroid-linux/README.zh-CN.md`](cccodroid-linux/README.zh-CN.md)。

## 从源码构建

`cccodroid-linux/build-bundle.sh` 负责把一份「已能在 Linux 上跑」的部署目录打成离线发行包。构建需要的运行时
（Node 26 x86_64、Claude Code 官方二进制）由构建者自行准备，**不随仓库分发**：

```bash
# 目录形态见 build-bundle.sh 头部注释
bash cccodroid-linux/build-bundle.sh \
  --source /path/to/stage \        # 含 src/、runtime/node/、runtime/claude
  --scripts-dir cccodroid-linux \
  --out dist
```

网关源码的移植改动在 [`docs/PORTING.md`](docs/PORTING.md) 里说明；与上游同步的流程见下。

## 与上游同步

- 上游：<https://github.com/greyoak111/cccodroid>（Apache-2.0）
- 本移植基于上游网关源码，做 Linux 适配、Android 专属功能移除，并加入本地桥与页面操控 MCP。
- 上游发新版后的流程：把上游合进本仓库的 `main`，再把本地移植提交 rebase 到新的上游之上，
  重建发行包并重跑验收/部署脚本；冲突主要集中在网关与前端的共享文件。
- 版本：项目与应用统一为 `0.1.0`。

## 致谢

- **[cccodroid](https://github.com/greyoak111/cccodroid)** —— Grey Oak 与所有贡献者。没有上游就没有这个移植；
  本项目只做 Linux 适配和外围功能，界面与网关逻辑的绝大部分来自上游（Apache-2.0）。
- **[cccodroid-openai-bridge](https://github.com/chenshi723/cccodroid-openai-bridge)** —— chenshi723（MIT），
  以及它依赖的 [Claude Code Router](https://github.com/musistudio/claude-code-router)（MIT）。
- 网页端第三方库（xterm.js、pdf.js、KaTeX、highlight.js、eruda 等）与上游一致，许可见各文件与 `NOTICE`。

## 许可

本仓库的移植代码以 Apache-2.0 发布（见 `LICENSE`）；上游与第三方组件的许可见 [`NOTICE`](NOTICE) 与 `vendor/`、
`cccodroid-linux/` 内的许可证文件。
