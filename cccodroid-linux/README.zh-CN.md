# cccodroid Linux 发行包

把 cccodroid（Claude Code 图形工作台）以“原生 Linux 桌面应用”的方式装到
x86_64 Linux 上：一个离线 tar.gz、一个不需要 root 的 `install.sh`、一个
systemd 用户服务、一个桌面条目。

面向 SteamOS 专门优化前端体验，也支持 Arch 系桌面；只依赖 bash、coreutils、systemd（可选）
与一个能跑 x86_64 二进制的内核。安装与更新都不访问 GitHub，也不依赖发布服务器。

---

## 1. 快速安装

```bash
tar -xzf cccodroid-0.1.3-linux-x86_64.tar.gz
cd cccodroid-0.1.3
./install.sh
```

> **Claude Code 不随发行包分发**（Anthropic 专有软件）。首次安装时 `install.sh` 会从 npm 官方平台包
> （`@anthropic-ai/claude-code-linux-x64`，验签 + sha512 校验）自动装到应用自己的运行时目录，约 110 MB，
> 需要能访问 npm 源。装不上时可以先跳过，之后运行 `cccodroid install-claude` 重试；
> 离线环境用 `cccodroid install-claude --from /路径/claude` 指定本机已有的二进制。

装完后：

```bash
cccodroid status      # 服务、端口、界面地址
cccodroid open        # 打开原生窗口（Qt6 WebEngine；没有 Qt 时退回浏览器）
```

如果启动器目录不在 `PATH` 里：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

已经解压好了、或者想直接指定 tarball：

```bash
./install.sh /路径/cccodroid-0.1.3-linux-x86_64.tar.gz
```

自定义安装位置：

```bash
./install.sh --prefix "$HOME/Applications/cccodroid" /路径/cccodroid-0.1.3-linux-x86_64.tar.gz
```

常用选项：

| 选项 | 作用 |
| --- | --- |
| `--prefix DIR` | 安装前缀，默认 `$XDG_DATA_HOME/cccodroid`（通常是 `~/.local/share/cccodroid`） |
| `--bin-dir DIR` | 启动器目录，默认 `~/.local/bin` |
| `--port N` | 网关端口，默认 `8790` |
| `--no-service` | 不安装/不启用 systemd 用户服务，改用后台进程模式 |
| `--force` | 同版本已存在时强制重新解包 |
| `--uninstall` | 卸载，默认保留 `home/` 与 `workspace/` |
| `--purge` | 与 `--uninstall` 连用，连数据一起删除 |

重复运行 `install.sh` 是安全的：已存在的版本目录会复用，数据目录不会被清空，
桌面条目、unit、启动器会按当前参数重新生成。

### 上游与同步

本移植基于 cccodroid 上游（<https://github.com/greyoak111/cccodroid>，Apache-2.0）。Linux 原生外壳、
打包与发布脚本在 `cccodroid-linux/`，这轮改动和验收工具在 `cccodroid-port/`；上游发新版后，用 git 把上游
合进 `main`，再把本地补丁分支 rebase 上去、重跑 `tools/ship.sh` 做验收和部署。配置文件
（`ccapp-providers.json`、`ccapp-settings.json`）与上游保持兼容。

对外介绍时可以说「面向 SteamOS 专门优化前端体验」。界面和标题用 `cccodroid`，不要把 Claude Code / Claude CLI
当作产品名（Claude Code 是 Anthropic 的专有软件，本移植只调用用户自己安装的 CLI）。

### 这是一个「只留 Linux 用得到的功能」的分支

0.1.0 起，网关和网页里只为安卓宿主应用、Termux 工具包、Shizuku 授权服务的功能已整体拆除，
界面上不会再出现：灵动岛（工作岛）、Shizuku 特权授权与设备工具、内存管家、耗电统计、
组件市场 / 工具包模块 / 自定义组件 / 对账 / 残留清理、端侧小模型、OpenAI 桥接组件、
公告与反馈入口、Office 转 PDF、截屏、执行方式与滚动冻结脱困、安卓分享与主题联动、
折叠屏适配、`/sdcard` 共享存储路径。保留了对话、会话管理、文件浏览、Git、项目与定时任务、
模型接口、GitHub 登录、Claude Code 更新、桌面通知、应用内浏览器窗格和会话导入导出。
`src/` 里因此只带网关、网页和许可证文件，不再包含安卓应用的 Java 源码、docs、scripts、i18n 等目录。

---

## 2. 目录布局

默认前缀 `~/.local/share/cccodroid/`：

```text
~/.local/share/cccodroid/
├── versions/
│   ├── 0.1.3/                 # 一个版本一个目录，互不覆盖
│   │   ├── VERSION
│   │   ├── BUILD-INFO         # 构建时间、Node/Claude 版本、来源
│   │   ├── SHA256SUMS
│   │   ├── src/               # cccodroid 源码；gateway/ 是网关 + 前端
│   │   ├── runtime/
│   │   │   ├── node/          # Node 26.13.1 官方 linux-x64
│   │   │   └── claude         # Claude Code 2.1.311 x86_64 原生二进制
│   │   ├── bin/
│   │   │   ├── cccodroid      # CLI
│   │   │   ├── cc-detach      # 把常驻程序起在网关 cgroup 之外（见第 4 节）
│   │   │   ├── cccodroid-ui   # 启动原生窗口（单实例锁、桥口令文件、gamescope 检测）
│   │   │   ├── cccodroid-steam         # 登记 / 删除 Steam 快捷方式（见第 11 节）
│   │   │   ├── cccodroid-steam-launch  # Steam 游戏模式里实际启动的前台脚本
│   │   │   └── cccodroid-gateway
│   │   ├── desktop/
│   │   │   ├── main.qml       # 原生窗口（Qt6 WebEngine）
│   │   │   ├── bridge.js      # 注入网页的 window.CCApp 垫片
│   │   │   └── gamepad.js     # 游戏模式下的手柄映射
│   │   ├── keys/              # 发布公钥（只有签名构建的包才有；更新时用它验签）
│   │   ├── templates/
│   │   ├── install.sh
│   │   └── uninstall.sh
│   └── 0.2.0/                 # 更新后新增，旧版本保留
├── current -> versions/0.2.0  # 原子切换的相对软链
├── home/                      # 应用 HOME：配置、.claude 会话、令牌、日志
├── workspace/                 # 工作区（claude 的默认 cwd）
├── logs/                      # --no-service 模式下的 gateway.out
├── run/                       # --no-service 模式下的 gateway.pid
└── install.env                # 安装清单：前缀、bin 目录、端口、unit/desktop 路径
```

用户目录里的其他文件：

```text
~/.local/bin/cccodroid                                       # 启动器 shim
~/.config/systemd/user/cccodroid-gateway.service             # systemd 用户服务
~/.config/systemd/user/cccodroid-ui.service                  # 原生窗口服务（不自启，cccodroid open 来拉起）
~/.local/share/applications/cccodroid.desktop                # 桌面条目
~/.local/share/icons/hicolor/192x192/apps/cccodroid.png      # 图标（上游图标）
```

`current` 是**相对**软链（指向 `versions/<版本>`）。更新时先完整解包新版本，
再用 rename 替换 `current`；任何时刻它都指向一个完整目录。

---

## 3. 首次配置（不包含任何密钥）

安装包**不包含** API key、令牌、会话或 `ccapp-providers.json`。

首次打开界面后，在「设置 → 接口」里添加你自己的线路；保存后网关会生成：

```text
<前缀>/home/ccapp-providers.json
```

`home/.gateway-token` 由网关首次启动时随机生成（0600），用于界面鉴权。
从安卓版迁移时，可以手动把旧的 `ccapp-providers.json`、`ccapp-settings.json`
拷进 `home/`，但请自行确认文件里没有你不希望留在 Deck 上的凭据。

---

## 4. 命令行

```text
cccodroid start            启动（systemd 服务或后台进程）
cccodroid stop [--force]   停止
cccodroid restart [--force] 重启
cccodroid status           查看服务、端口、界面地址；未运行时退出码 1
cccodroid url              打印带令牌的界面地址
cccodroid open             必要时先启动，再打开原生窗口（--kiosk 全屏）；没有 Qt 时退回浏览器
cccodroid logs             跟随日志
cccodroid procs            列出网关服务里脱离进程树的程序
cccodroid doctor [--json]  体检：网关、端口、进程归属、日志量、权限、Qt、磁盘、旧版本（只读，每项带修法）
cccodroid tools-doc [--write [--force]]   按本机实际探测结果生成给 Claude 看的工具清单
cccodroid version          版本、前缀、Node、Claude Code、已安装版本
cccodroid update [来源] [--sha256 HEX] [--no-restart] [--force]   更新（见第 6 节）
cccodroid update --check [--url 基址]    查有没有新版
cccodroid rollback [--force]             退回上一个版本
cccodroid prune [--keep N] [--dry-run]   清理旧版本目录
cccodroid steam add|remove|status        在 Steam 里登记 / 删除「cccodroid」快捷方式（游戏模式入口，见第 11 节）
cccodroid import <来源>                  导入会话包（见下）
cccodroid import --undo <清单>           把某次导入的会话放进回收站
cccodroid export [--all | 会话号...]     把会话导出成 .zip
```

`cccodroid doctor` 退出码：0 全部正常，1 有警告，2 有失败；`--json` 输出机器可读的结果。
网关起不来、界面打不开、日志被刷屏、磁盘紧张时先跑它。

### 常驻程序要用 cc-detach 起

网关服务是 `KillMode=mixed`：`stop`、`restart`、`update` 会把它 cgroup 里的**所有进程**一起 SIGKILL。
在 Claude 的 Bash 里用 `&`、`nohup`、`setsid` 起的程序虽然脱离了进程树，仍然在这个 cgroup 里
（Steam、游戏、机器人、开发服务器都中过招），输出还会灌进网关的日志，`cccodroid logs` 被刷屏。

`cc-detach` 用 `systemd-run --user` 把程序起成独立的用户服务，不受网关重启影响，日志在自己的 unit 里：

```bash
cc-detach -n steam -- steam -silent      # 服务名 ccd-steam；同名在跑会拒绝
cc-detach -n bot -C ~/bjbot -- python3 bot.py
cc-detach ls                             # 列出
cc-detach logs bot -f                    # 看输出
cc-detach stop bot                       # 停止（连子进程）
```

程序自己会 fork 到后台的加 `--forking`；要继承当前全部环境变量加 `-i`；单个变量用 `-e 变量`。
`install.sh` 会把它链进 `<前缀>/prefix/bin/`，网关给 Claude 的 PATH 里有这个目录。

`stop`、`restart`、`update` 在发现网关里有脱离进程树的程序时，会把它们列出来并拒绝执行
（只检查 systemd 服务模式）；确认可以杀掉再加 `--force`。直接运行 `install.sh` 不做这个检查。

### 会话迁移（import / export）

会话包是 cccodroid 自己导出的 zip（`manifest.json` + `sessions/<会话号>.jsonl` 和各会话的子代理记录、
工具结果；标题和章节档案一起带上）。在任何一台装了 cccodroid 的机器上：

```bash
cccodroid export --all            # 或 cccodroid export 会话号...；包放在 <前缀>/home/exports/，命令会打印路径
cccodroid import 会话包.zip        # 来源也可以是 -（标准输入）、http(s):// 的 .zip、用户@主机:/路径.zip（经 ssh 拉取）
cccodroid import --undo <前缀>/home/imports/import-<时间>.json   # 后悔了：把这次导入的会话放进回收站
```

导入由网关完成：会话的 cwd 一律改成本机工作区（`--resume` 才找得到）、同号的会话跳过（在回收站里的先恢复）、
导入的会话按「现在」排序，列表里立刻看得到，第一次接着聊时模型会被提醒这是导入的历史。
每次导入的会话号记在 `<前缀>/home/imports/`；包可以很大（上限 4 GB，解出来的总量受剩余空间限制），
一次只能导一个包。

### OpenAI 本地协议桥（内置）

发行包内置 [cccodroid-openai-bridge](https://github.com/chenshi723/cccodroid-openai-bridge)（MIT，基于
MIT 许可的 Claude Code Router 1.0.73）：把你自己的 OpenAI Chat Completions 兼容接口，在本机适配成
Anthropic Messages 接口（`http://127.0.0.1:<端口>/v1/messages`），在「设置 → 接口」里作为一条自定义线路使用。
不提供模型、Key 或额度；上游只允许 HTTPS（本机测试可 http），桥只监听回环地址。

```bash
cccodroid bridge configure        # 交互填上游地址、Key、模型（或 --config 指向 0600 的私有 JSON）
cccodroid bridge service install  # 装成 systemd 用户服务常驻（开机自启，网关重启不会带走它）
cccodroid bridge provider         # 在网关「设置 → 接口」里登记线路「本地 OpenAI 桥」
cccodroid bridge status           # 状态（不显示密钥）
cccodroid bridge connection       # 本机地址、模型、密钥文件位置（--show-key 才打印密钥）
cccodroid bridge stop --yes       # 停（钩子/服务还在，下次会话或服务会再拉起）
cccodroid bridge uninstall --yes  # 卸载（默认保留密钥与配置；--purge 连它们一起删）
```

- 不用 systemd 的安装（`install.sh --no-service`）可以跳过 `service install`，用 `cccodroid bridge start` 手动起；
  桥自带看护，运行中会自己恢复，单实例锁保证不会起两份。
- 私有运行副本、配置、密钥都在 `<前缀>/home/.local/share/ccr-bridge-kit/`；`connection.json` 里的本地桥 Key 只给本机用，
  不要转发。`cccodroid bridge provider` 只把这个 Key 写进本机网关的接口配置。
- `cccodroid bridge selftest` 只测回环假上游，不消耗任何额度。

### 页面操控（ui-mcp，给 Claude 用）

把原生窗口（Qt6 WebEngine）里的页面当成「屏幕」交给 Claude：读屏（带编号的可点/可输入元素）、
点按、输入、滚动、按键、打开网址、截图。主界面和应用内浏览器窗格都能操作。

安装时自动登记成 Claude 的用户级 MCP 服务（名字 `ccui`，工具 `mcp__ccui__*`）：

```bash
cccodroid ui-mcp status          # 看有没有登记、窗口调试端口
cccodroid ui-mcp install         # 重新登记（升级后一般不用手动跑）
cccodroid ui-mcp remove          # 撤销
```

- 前提是窗口在跑（`cccodroid open`）。窗口启动时会自动开一个只监听 `127.0.0.1` 的 Chromium
  调试端口，端口写在 `$XDG_RUNTIME_DIR/cccodroid-cdp.json`（没有该目录时写 `<前缀>/run/`，0600）；
  `CCCODROID_UI_DEBUG=0` 可关掉它（工具会报「窗口没在运行」）。
- 安全：密码框不代填；敏感按钮（删除、支付等）第一次调用只返回提醒，带 `confirm:true` 才真正执行；
  页面文字和截图会作为工具结果发给模型。
- 工具语义照搬 DSH Go 的手机操控：`screen` 返回的编号只在这一屏有效，`tap`/`type`/`scroll` 要带上屏号。

### 给 Claude 的工具清单

网关把 `TOOLS-dev.md` 拼进 Claude 的系统提示。随包的 `src/gateway/TOOLS-dev.md` 是不声称具体工具的
通用版本；`install.sh` 装完会运行 `cccodroid tools-doc --write`，探测本机实际有什么（编译器、Python 模块、
radare2、scanmem、MCP 服务、`sudo` 与根分区状态…），生成 `home/TOOLS-dev.md`，网关优先读这一份。
装了新工具后再运行一次。手工改过的 `home/TOOLS-dev.md` 不会被覆盖，要覆盖加 `--force`。
Zig、radare2、scanmem 这类工具包本身不随发行包分发，需要自己装进 `<前缀>/prefix`。

`open` 优先启动 `desktop/main.qml`，也就是 Qt6 WebEngine 的原生窗口：标题
`cccodroid`、单实例（已经在运行时不会重复开）。机器上没有 Qt6 QML 运行时、
或当前不在图形会话里时，自动退回用系统浏览器打开同一个带令牌地址。

### 原生窗口

快捷键：`Ctrl+=` / `Ctrl++` / `Ctrl+-` / `Ctrl+0` 缩放（每档 10%，范围 50%–300%），`F5` 或 `Ctrl+R` 刷新，
`Ctrl+Shift+R` 或 `Ctrl+F5` 绕过缓存刷新，`F11` 全屏（`--kiosk` 下无效），`Ctrl+L` 聚焦浏览器窗格的地址栏，`Ctrl+Q` 退出。
缩放、窗口大小和最大化状态记在 `home/.qtwebengine/shell.ini`（Wayland 下不记位置），删掉即恢复默认。

- **应用内浏览器窗格**：点聊天里的网页链接，宽屏在右侧工作区里打开，窄屏整窗打开；有后退、前进、刷新、地址栏、
  「在系统浏览器打开」和关闭。窗格用独立的浏览数据，带不上网关的登录状态；只放行 http / https，权限请求一律拒绝，
  不支持文件上传和全屏。
- **保存与下载**：网页里的「保存到」会弹系统保存对话框（选已有文件会直接覆盖，由对话框负责确认）；
  其他下载存到下载目录并在界面里提示。
- **桌面通知**：窗口不在前台时，一轮任务跑完（超过 10 秒或出错）、定时任务有结果、Claude 在等你确认，会发系统通知；
  通知里不带命令内容。在「设置 → 通知」里分别开关；机器上没有 `notify-send` 时这一项不显示。
- **控制台日志**：页面里 warning 及以上的控制台消息会写进窗口日志（去重、限速，不会刷屏）。
- 页面里的 `window.CCApp` 由 `desktop/bridge.js` 经 QWebChannel 提供，有副作用的调用都要带每次启动随机生成的口令；
  口令放在 `$XDG_RUNTIME_DIR/cccodroid-ui.key`（0600），预览用的跨源页面拿不到。

网关只监听 `127.0.0.1` 与 `127.0.0.2`。界面地址形如：

```text
http://127.0.0.2:8790/?t=<令牌>
```

`127.0.0.2` 是 cccodroid 的界面专用回环地址；令牌通过 `?t=` 换成
`HttpOnly + SameSite=Strict` Cookie。

---

## 5. systemd 用户服务

unit 由模板渲染，路径写死为当前安装前缀：

```text
~/.config/systemd/user/cccodroid-gateway.service
```

常用命令：

```bash
systemctl --user status cccodroid-gateway.service
systemctl --user restart cccodroid-gateway.service
journalctl --user -u cccodroid-gateway.service -f
```

`install.sh` 会 `enable` 服务，登录桌面后自动启动。如果希望**未登录也运行**
（例如只通过 SSH 使用），可以按需开启 linger：

```bash
loginctl enable-linger "$USER"
```

这一步不是安装器默认做的，因为它会改变该用户的 systemd 会话行为。

如果机器上 `systemctl --user` 不可用（容器、无 systemd、纯 SSH 未建用户会话），
安装器会警告并自动退回手动模式；也可以显式用 `--no-service`：

```bash
./install.sh --no-service
cccodroid start
cccodroid logs
```

手动模式的 pid 与输出分别在 `run/gateway.pid`、`logs/gateway.out`。

---

## 6. 更新、回滚与清理

### 本地文件更新

1. 在构建机上打出新 bundle（见第 8 节）；
2. 把 `cccodroid-<新版本>-linux-x86_64.tar.gz`（连同 `.sha256`、`.sig`）拷到目标机；
3. 运行：

```bash
cccodroid update /路径/cccodroid-0.1.3-linux-x86_64.tar.gz   # 同名 .sha256 / .sig 旁文件会自动核对
cat 包.tar.gz | cccodroid update -                            # 也可以走标准输入
```

更新行为：

- 新版本解到 `versions/<版本>/`；
- `home/`、`workspace/` **不动**；
- `current` 原子切到新版本，旧版本目录原样保留，可以 `cccodroid rollback`；
- systemd 模式下自动重启网关（`--no-restart` 可以只装不重启；网关里有脱离进程树的程序时会先拒绝，确认后加 `--force`）；
- 原生窗口要重开才会换成新界面（命令结束时会提醒）。

### 在线更新

构建时用发布密钥签名，并把发布目录放到任意静态服务器（建议 https）：

```bash
./build-bundle.sh --sign-key ~/.ssh/ccd-release --publish-dir ./publish
# publish/ 里有：包、.sha256、.sig、latest.json
```

在目标机的 `home/update.conf` 里写一行 `url=https://你的服务器/路径`，然后：

```bash
cccodroid update --check                              # 看有没有新版
cccodroid update https://你的服务器/路径/latest.json   # 按清单下载、校验、安装
cccodroid update 用户@主机:/路径/包.tar.gz              # 或经 ssh 拉取（用现有 ssh 配置）
```

校验规则：

- 远程来源（URL、ssh）必须有 sha256：`--sha256 HEX`，或同位置的 `.sha256`；
- 当前已装版本带发布公钥（`keys/allowed_signers`）时，远程来源还必须验签通过，**没有绕过开关**；
  公钥只认已装版本里的，不认新包自带的；
- 明文 `http://` 只在有签名保护、或你用 `--sha256` 自己给出校验和时才接受；
- 本地文件来源不强制验签。装一个不带 `keys/` 的本地包之后，已装版本就没有公钥，后面的远程更新不再强制验签；
  要保持这条链，每次构建都带 `--sign-key`；
- 第一个带公钥的版本只能用本地文件装。

### 回滚与清理

```bash
cccodroid rollback                       # 切回上一个版本并重启网关；再运行一次就切回去
cccodroid prune [--keep N] [--dry-run]   # 删旧版本目录，永远保留当前和上一个；顺带清两小时前的更新残留
```

`prune` 不动 `backup-*` 目录，只提示它们的大小。

退到一个还没有 `rollback` 子命令的老版本（0.3.0 之前的版本）之后，启动器指向的是老版本的命令行，
想再回到新版本要用新版本目录里的命令行：

```bash
~/.local/share/cccodroid/versions/0.1.3/bin/cccodroid rollback
```

---

## 7. 卸载

```bash
./uninstall.sh                 # 停服务、删程序/桌面条目/unit，保留 home/ workspace/
./uninstall.sh --purge         # 连 home/、workspace/、versions/ 一起删
```

自定义前缀安装的，用：

```bash
./uninstall.sh --prefix /你的/前缀
```

从已安装的 `current/` 里直接运行 `uninstall.sh` 时，会自动带上正确前缀。
卸载脚本只删除带本安装器标记的 unit、桌面条目和启动器；不是它生成的文件会保留并警告。

普通卸载会保留 `install.env`（安装清单），这样之后再执行 `--purge` 或重新安装时
还能找回原来的端口、bin 目录与服务设置。要连它一起删掉，用 `--purge`。

---

## 8. 构建 bundle

在已经装好 cccodroid 的机器上运行 `build-bundle.sh`。默认来源是本机当前安装的版本目录
（`~/.local/share/cccodroid/current`，前缀可用 `CCCODROID_PREFIX` 指定）：

```bash
./build-bundle.sh
# 或指定来源与输出目录
./build-bundle.sh --source ~/.local/share/cccodroid/current --out ./dist
```

脚本、模板、`desktop/` 和 `bin/` 取自 `build-bundle.sh` 所在目录（`--scripts-dir` 可改），
`src/` 与 `runtime/` 取自来源目录。**来源目录的 `src/` 里手工改过的文件会原样进包**，
打包前先确认它和源码仓库一致。

输入目录要求：

```text
<source>/src/gateway/server.mjs
<source>/runtime/node/bin/node
<source>/runtime/claude
```

产物：

```text
dist/cccodroid-0.1.3-linux-x86_64.tar.gz
dist/cccodroid-0.1.3-linux-x86_64.tar.gz.sha256
dist/cccodroid-0.1.3-linux-x86_64.tar.gz.sig        # 只有加了 --sign-key 才有
```

签名发布（可选）：`--sign-key 私钥` 用 OpenSSH 的 `ssh-keygen -Y sign` 给 tar.gz 签名（ed25519，
namespace 固定为 `cccodroid-release`，私钥不能有口令），并把公钥作为 `keys/release.pub`、
`keys/allowed_signers` 打进包里；`--publish-dir 目录` 把包、`.sha256`、`.sig` 和 `latest.json`
一起放进该目录。私钥只在构建机上，不要放进包或共享目录；丢了私钥，已装版本就验不过新包，
只能再用一次本地文件更新换公钥。

包内：

- `src/`（完整源码，含 `gateway/` 与 `node_modules`，保证离线可跑）；
- `runtime/node/`（官方 Node 运行时）；
- `runtime/claude`（官方原生二进制，软链会被解引用）；
- `VERSION`、`BUILD-INFO`、`SHA256SUMS`；
- `install.sh`、`uninstall.sh`、`bin/`、`desktop/`、`templates/`、本 README；
- `keys/`（签名构建才有）。

明确排除：

- `home/`、`workspace/`（运行期数据，绝不进包）；
- `.gateway-token`、`ccapp-providers.json`、`*.log`；
- `.git/`、`node_modules/.cache/`；
- `*.pem`、`*.key`、`id_rsa*`、`.env`、`.npmrc` 等疑似凭据文件。

最后一类默认会让构建**中止**并列出文件；确认不是密钥后可加
`--allow-sensitive` 继续（不建议）。

版本号来自 `--version` 或仓库根目录的 `VERSION` 文件，格式 `主.次.修订`
（允许 `-rc.1` 这类后缀）。发新版本时先改 `VERSION`，再构建。

如果版本号没变但内容改了（调试时常见），安装端默认会复用已存在的版本目录；
需要在安装/更新时加 `--force` 才会覆盖。正式发布请始终递增 `VERSION`。

---

## 9. 与官方 Claude Code Linux 安装方式的对应

| 官方 Claude Code | cccodroid Linux |
| --- | --- |
| `curl -fsSL https://claude.ai/install.sh \| bash` | 离线 tar.gz + `./install.sh`（不访问网络） |
| `~/.local/share/claude/versions/<版本>/` | `~/.local/share/cccodroid/versions/<版本>/` |
| `~/.local/bin/claude` 启动器 | `~/.local/bin/cccodroid` shim |
| 自动更新 / 多版本 | `cccodroid update <本地文件 / URL / ssh>`（远程来源强制校验，带公钥时强制验签）；多版本目录 + `current` 软链；`rollback`、`prune` |
| 单一原生二进制 | 额外带 Node 运行时、网关、systemd 服务与桌面条目 |

设计上刻意沿用同一套“版本目录 + current + `~/.local/bin` 启动器”的布局，
所以备份、迁移、回滚的心智模型与官方 Claude Code 一致。

---

## 10. 安全与数据

- 安装器不需要 root；不要用 `sudo` 运行，否则文件归 root，用户服务起不来。
- 网关只绑定回环地址，不监听局域网；界面令牌在 `home/.gateway-token`（0600）。
- `home/` 初始权限 700，`run/`、`logs/` 同为 700。
- 安装包不写任何真实密钥；`ccapp-providers.json` 由用户首次配置时生成。
- bundle 自带 `SHA256SUMS`，`install.sh` 解包后逐文件校验；外层 tarball
  同名 `.sha256` 也会在解包前校验。
- 更新与安装都不依赖 GitHub；但首次配置的模型 API 仍然需要相应网络可达。

---

## 11. SteamOS / Arch 提示

- 桌面模式：应用菜单里会出现 cccodroid，双击即 `cccodroid open`，打开的是
  Qt6 WebEngine 原生窗口（SteamOS 自带 Qt，不需要 Electron 或浏览器）。
- 游戏模式：先退出 Steam，再运行 `cccodroid steam add`（Steam 开着时它会拒绝；加 `--restart-steam`
  可以自动关掉再起回来），然后在 Steam 库的「非 Steam 游戏」里启动「cccodroid」：它会拉起网关，
  再以全屏窗口在前台运行（检测到 gamescope 会自动 `--kiosk` 并改用 xcb 平台）。
  `cccodroid steam remove` 删除快捷方式，卸载时会尽力删掉。
  - 手柄（Steam 输入要给出标准手柄）：左摇杆或十字键滚动，A 确认，B 返回，LB / RB 翻页，Y 聚焦输入框；
    手柄没反应就用触屏，或给这个快捷方式选「键盘和鼠标」一类的控制器模板。
  - 打字用 STEAM+X 调出屏幕键盘。
  - **验证范围**：只在桌面模式下用 gamescope（headless）验证了渲染和键鼠输入；真正切换到游戏模式、
    以及手柄，都没有在真机上实测过。
  - `shortcuts.vdf` 里还有 Decky 的 Freedeck 插件在用的咨询锁，`steam add` 会和它一起排队写入。
- SteamOS 的根文件系统是只读的；本方案全部装在用户目录，不需要解锁。
- 前缀路径可以包含空格（脚本已加引号）；但**不要包含 `%`**——
  systemd 与 desktop 文件会把它当说明符/字段码。
- Arch 上如果 `~/.local/bin` 还没进 `PATH`，在 shell 配置里补一行即可。

---

## 12. 故障排查

**先跑体检**：`cccodroid doctor` 逐项检查并给出修法（退出码 0 / 1 / 2 = 正常 / 警告 / 失败）。

**端口被占**

```bash
cccodroid status
ss -ltnp | grep 8790
```

换端口重装：`./install.sh --port 8890`。

**服务起不来**

```bash
systemctl --user status cccodroid-gateway.service
journalctl --user -u cccodroid-gateway.service -n 100 --no-pager
```

**没有令牌 / 界面 401**

先启动，再看令牌是否生成：

```bash
cccodroid start
ls -l ~/.local/share/cccodroid/home/.gateway-token
cccodroid url
```

**Node 或 Claude 找不到**

```bash
cccodroid version
ls ~/.local/share/cccodroid/current/runtime/
```

`cccodroid version` 会显示当前软链、Node 版本与 Claude Code 版本。

**想完全重来（保留数据）**

```bash
./install.sh --force
```

**想完全重来（删数据）**

```bash
./uninstall.sh --purge
rm -rf ~/.local/share/cccodroid   # 若之前卸载时选择了保留
```

---

## 13. 发行文件清单

```text
VERSION                                   # 0.1.3
install.sh                                # 安装 / 卸载入口
uninstall.sh                              # 卸载薄封装
build-bundle.sh                           # 构建离线 bundle
bin/cccodroid                             # CLI
bin/install-claude.mjs                    # 首次安装/补装 Claude Code（不随包分发）
bin/cc-detach                             # 把常驻程序起在网关 cgroup 之外
bin/cccodroid-gateway                     # 网关启动包装器
bin/cccodroid-ui                          # 启动原生窗口
bin/cccodroid-steam                       # 登记 / 删除 Steam 快捷方式
bin/cccodroid-steam-launch                # 游戏模式里 Steam 启动的前台脚本
desktop/main.qml                          # 原生窗口（Qt6 WebEngine）
desktop/bridge.js                         # window.CCApp 垫片（QWebChannel）
desktop/gamepad.js                        # 游戏模式手柄映射
templates/cccodroid-gateway.service.in    # systemd 用户服务模板
templates/cccodroid.desktop.in            # 桌面条目模板
templates/cccodroid.png                   # 图标（来自上游 cccodroid）
bridge/                                   # 内置 OpenAI 本地桥（组件源码 + 预装依赖）
ui-mcp/                                   # 页面操控 MCP（stdio 服务，无依赖）
README.zh-CN.md                           # 本文件
# 另有 src/：网关与网页（gateway/）、LICENSE、NOTICE、ThirdPartyLicenses；
# 安卓应用源码、docs、scripts 等不随发行包分发。
```
