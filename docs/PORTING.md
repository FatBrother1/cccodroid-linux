# 移植说明：cccodroid → Linux / SteamOS

本文说明这个移植做了什么、为什么这么做，以及和上游的关系。

## 1. 架构

```text
SteamOS / Arch 桌面
├── systemd 用户服务 cccodroid-gateway.service
│   └── node src/gateway/server.mjs        # 上游网关（本仓库 src/gateway，Linux 适配版）
│        ├── web/                          # 网页界面（上游 + 移除 Android 入口）
│        ├── Claude Code CLI（用户自备）    # 网关按会话启动，不是你手动跑
│        ├── 内置桥 <前缀>/bridge           # 可选：OpenAI→Anthropic 协议适配
│        └── ui-mcp/server.mjs              # 页面操控 MCP（stdio，服务名 ccui）
├── systemd 用户服务 cccodroid-ui.service
│   └── Qt6 WebEngine 原生窗口（desktop/main.qml）
│        └── 回环调试端口 → 页面操控 MCP
└── ~/.local/share/cccodroid
    ├── versions/<版本>/   # 一个版本一个目录，current 相对软链
    ├── home/              # 应用 HOME：配置、.claude 会话、令牌、日志
    ├── workspace/         # 工作区
    └── bridge/            # 内置桥组件（跨版本稳定）
```

安装脚本 `cccodroid-linux/install.sh` 把发行包里解出来的 `src/`、`runtime/`、`bin/`、`desktop/`、`bridge/`、
`ui-mcp/` 放进版本目录并原子切换 `current`；数据目录（`home/`、`workspace/`）跨版本保留。

## 2. 与上游的关系

- 上游：<https://github.com/greyoak111/cccodroid>（Apache-2.0）。
- `src/gateway/` 是上游网关源码的移植版本：Linux 适配 + 移除 Android 专属功能 + 内置桥/页面操控接入。
- `cccodroid-linux/`、`docs/`、`vendor/` 是本仓库新增的移植外壳与打包/安装工具。
- 我们不重新实现网关逻辑；上游修复与新功能通过 rebase 同步进来（见 README「与上游同步」）。

## 3. Linux 适配点（相对上游）

1. **启动与路径**：`bin/cccodroid-gateway` 用系统 Node 直接跑 `server.mjs`；`CCAPP_PREFIX` 留空表示非
   Termux 环境；`cccodroid-ui` 统一启动原生窗口并做单实例锁。
2. **Claude CLI 调用**：`gw/claude.mjs` 增加 `SYS_LINUX` 分支，PATH 优先系统目录与本机 `prefix/bin`，
   TERMINFO 使用系统路径；不使用 glibc loader / Termux 桥。
3. **无 Android 宿主**：移除 Shizuku/priv、设备工具 MCP、工作岛、组件市场、端侧模型、耗电统计、
   Office 转换、截屏、安卓分享/主题/折叠屏、`/sdcard` 路径等；相关接口直接返回 404，前端同步移除入口。
4. **通知**：`gw/notify.mjs` 用 `notify-send` 发桌面通知（完成、等待确认、定时任务），可在设置里开关。
5. **网关 cgroup**：`cc-detach` 把常驻程序放到网关服务 cgroup 之外，避免 stop/restart/update 时被一起杀掉。
6. **更新**：`cccodroid update/rollback/prune`，支持 sha256 与 OpenSSH 签名验证；更新保留上一版目录。
7. **Qt 外壳**：`desktop/main.qml` + `desktop/bridge.js`（实现窗口需要的 CCApp 方法）、游戏模式手柄映射。

## 4. 内置桥与页面操控

- **桥**：`vendor/openai-bridge` 是 [cccodroid-openai-bridge](https://github.com/chenshi723/cccodroid-openai-bridge)
  的源码（MIT，含 Claude Code Router 依赖锁定）。安装时把组件放到 `<前缀>/bridge`，用户在
  `<前缀>/home` 下配置自己的上游与 Key；`cccodroid bridge configure/service install/provider` 管理。
- **页面操控（ccui）**：`cccodroid-linux/ui-mcp/server.mjs` 是一个无依赖的 stdio MCP 服务。
  窗口启动时开一个只监听 `127.0.0.1` 的随机 Chromium 调试端口（`cccodroid-cdp.json`，0600），
  MCP 经 CDP 读页面元素、点按、输入、滚动、截图。编号只在一次读屏内有效；密码框不代填；
  敏感按钮（删除/支付等）需要二次确认。

## 5. 构建与发布

1. 准备运行时：Node 26 x86_64（官方 tar.gz）与 Claude Code（官方安装），放成
   `stage/runtime/node/`、`stage/runtime/claude`（**不提交到仓库**）。
2. 把 `src/` 放进 `stage/src/`，执行 `bash cccodroid-linux/build-bundle.sh --source stage
   --scripts-dir cccodroid-linux --out dist`。
3. 构建脚本生成 `SHA256SUMS`，可选 `ssh-keygen -Y sign` 签名与 `latest.json`。
4. 部署：`install.sh`（新装）或 `cccodroid update`（升级，验签 + 保留旧版 + 失败可 rollback）。
5. 维护者验收：在目标机沙箱里跑安装/升级/回滚/网关接口/桥/页面操控检查，再装进正式安装。

## 6. 已知限制

- 游戏模式（gamescope）与真手柄未在所有机型验收；桌面模式是主要使用方式。
- 页面操控的浏览器窗格是独立 CDP target，`pages` 会列出它；窗格关闭后 target 消失。
- Claude Code 的登录、计费与条款由 Anthropic 负责，本移植不代理、不分发。
