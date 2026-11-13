# Steam Deck 使用指南：装插件、装软件、看懂报错

这份文档写给已经装好 cccodroid 的人。目标不是把 Steam Deck 变成开发机，而是在遇到下面这些事时，知道怎么让 agent 帮你，而不是对着一句英文报错发呆。

---

## 一、先搞清楚：这个 agent 有哪些工具

cccodroid 里跑的是 Claude Code。它不是「你问一句、它答一句」的聊天窗口，而是一个能在你机器上动手的 agent。它可用的工具分两层：

### 1. Claude Code 自带的标准工具

| 工具 | 干什么 | 在 Steam Deck 上的实际用法 |
| --- | --- | --- |
| **Bash（终端）** | 在 Deck 上执行命令，读回输出和退出码 | 查系统版本、跑 `flatpak`、看日志、解压插件包、检查磁盘 |
| **Read / Write / Edit（文件）** | 读文件、写文件、按段落改文件 | 看配置和日志、改模拟器设置、批量整理存档 |
| **Glob / Grep（搜索）** | 按文件名找、按内容找 | 找出是哪个配置文件写错了、哪个日志里有报错 |
| **WebFetch / WebSearch（网页）** | 抓网页、搜资料 | 对着一句报错找同款案例，核对教程适用于哪个 SteamOS 版本 |
| **Task（子代理）** | 把一个复杂任务拆给多个子代理并行做 | 一边查资料一边改文件，不用排队 |
| **TaskCreate / TaskUpdate（任务清单）** | 把多步任务列成进度面板 | 装插件、修报错时你能看到做到哪一步 |
| **MCP / 技能 / 插件 / 钩子** | 接外部工具服务、复用现成的技能包 | `ccui` 页面操控就是一个预置 MCP |
| **Git（Bash + 工作台面板）** | 看改动、提交、回退 | 管自己的脚本和小项目 |

### 2. cccodroid 工作台提供的能力

| 能力 | 说明 |
| --- | --- |
| **会话与项目** | 每个项目一个工作目录，会话可以接着聊、可以导入导出 |
| **文件浏览与编辑** | 在窗口里直接看工作区文件，不用另开编辑器 |
| **应用内终端** | 窗口里自带终端（xterm.js，最多 8 个），你自己敲命令也行，不用切到 Konsole |
| **权限确认卡** | Claude 每次跑命令、改文件都会先弹确认，你可以逐项允许、拒绝或「始终允许」 |
| **定时任务** | 在界面里建一个按天/按周自动跑的任务，比如备份存档、检查磁盘 |
| **桌面通知** | 任务跑完、需要你确认时弹系统通知 |
| **应用内浏览器窗格** | 点聊天里的链接，在窗口右侧打开网页，agent 也能读这个页面 |
| **页面操控 MCP（ccui）** | 读 cccodroid 自己的界面：读屏、点按、输入、滚动、截图 |

页面操控的工具名是 `mcp__ccui__*`，包括 `pages`（列出窗口里的页面）、`screen`（读当前屏幕，返回带编号的元素）、`tap`（点按）、`type`（输入）、`scroll`（滚动）、`key`（按键）、`open`（打开网址）、`screenshot`（截图）、`wait`（等页面变化）。密码框不代填；删除、支付这类敏感按钮第一次调用只返回提醒，要带 `confirm:true` 才真正执行。

这些工具默认不是「全自动」的：Claude 每跑一条命令、每改一个文件，界面都会弹确认卡；你可以逐项允许、拒绝，或对某类操作选「始终允许」。不确定它要做什么时，先拒绝，让它解释清楚再来。

**一句话区别**：普通 AI 只能告诉你「网上说要这样敲」；这个 agent 会先跑一条命令看你机器上到底是什么情况，再决定下一步；命令报错了，它能读报错继续修。

---

## 二、Steam Deck 上最痛的三件事

### 1. 装插件：Decky Loader 为什么老失败

Decky Loader 是 Deck 上最常用的插件系统。它的安装和恢复流程有几个真实的坎（以下依据 Decky 官方 README）：

- **安装器要管理员权限，但 Deck 默认没有密码。** Valve 官方说明：默认的 `deck` 用户出厂没有密码，不能直接 `sudo`；要用 `sudo`，得先在终端里运行 `passwd` 设一个。Decky 安装器知道这一点：它允许你输入自己的密码，也可以把密码临时设成 `Decky!`，装完自动删掉。
- **SteamOS 更新后 Decky 可能消失。** 官方说法是：重跑安装器、再装一次稳定版通常就能恢复；不行再试预发布版。
- **端口被占用时 Decky 起不来。** 官方明确提到，Syncthing 等软件占用 8080 或 1337 会导致问题。
- **插件和 Steam 客户端版本不匹配时，商店能装，但插件不工作**；从不可信来源装插件还有安全风险。
- **失败提示往往只有一句英文**，不告诉你是网络、权限还是版本问题。

Decky 的插件目录在 `~/homebrew/plugins`，加载器服务叫 `plugin_loader.service`，日志在 `~/homebrew/logs`。agent 可以：

1. 先看 `~/homebrew` 在不在、`plugin_loader.service` 是不是 active、插件目录和日志里有什么；
2. 用 `ss -ltnp` 检查 8080 / 1337 是不是被别的程序占了；
3. 读 `/etc/os-release` 确认 SteamOS 版本，判断是「没装好」「版本旧」「更新冲掉」还是「插件不兼容」；
4. 把官方安装脚本下载下来先读给你听，再指导你执行；装完核对服务和目录；
5. 你把安装器输出的英文报错整段贴给它，它按报错继续给下一步。

> 安装器临时设的 `Decky!` 密码会在装完后删除；如果你想用自己的密码，先在 Konsole 里运行一次 `passwd`。需要管理员权限的步骤，密码只能你自己输（除非你配置过免密 sudo），agent 负责把命令和后果讲清楚。

### 2. 装软件：为什么照着教程做就报错

SteamOS 是 Arch 系，但和普通 Arch 不一样：

- **根分区是只读的。** 直接 `pacman -S` 会报 `Read-only file system`。Valve 官方说明：要改只读镜像，得先 `sudo steamos-readonly disable`，而且「不懂就别动」。
- **解锁后装的东西可能被更新抹掉。** Valve 官方原话：任何在 Flatpak 之外安装的东西（例如用 pacman）都可能在下一次 SteamOS 更新时被抹掉。
- **SteamOS 的设计意图是让你用 Flatpak**（装在可写分区，跟着系统更新活下来）；要装一堆命令行工具，社区常用 **Distrobox**（容器里随便装）；单个程序用 **AppImage**（放用户目录）。

所以「装软件」在 Deck 上不是一个命令，而是一个选择：这个软件该走 Flatpak、AppImage、Distrobox，还是非要用 pacman？选错了，要么装不上，要么更新后消失。

agent 可以：

- 先问你「装什么、用来干什么」，再判断走哪条路；
- 不需要 root 的它直接做：`flatpak search`、`flatpak install`、下载 AppImage、`chmod +x`、生成桌面图标；
- 需要 root 的（pacman、解锁只读）它把命令、作用和风险讲清楚，由你执行；
- 装完帮你验证：命令能不能跑、桌面图标有没有、重启后还在不在。

### 3. 报错看不懂

Deck 上的报错有三个特点：英文、很长、教程对不上版本。agent 的价值不是「翻译」，而是结合你机器的状态判断原因：

- 它会先看：SteamOS 版本、你运行的完整命令、完整输出、从什么时候开始出错；
- 它会去查：这个报错在当前的 SteamOS / Decky / Flatpak 版本上是不是已知问题，有没有修法；
- 它会给顺序：先做哪个、不行再做哪个，而不是甩一堆命令让你自己试。

### 4. 跟自己搜教程比，差别在哪

| 你遇到的问题 | 自己折腾 | 用 cccodroid |
| --- | --- | --- |
| SteamOS 更新后 Decky 没了 | 搜到几篇教程，版本各不相同，不知道信哪个 | 先读你的 SteamOS / Decky 版本和目录状态，再给对应步骤 |
| `pacman` 报 PGP / 密钥环错误 | 照着命令硬修，越修越乱 | 先判断原因，优先给不动系统分区的替代方案 |
| 装完软件，系统一更新就没了 | 不知道这是 SteamOS 的设计 | 一开始就选能活过更新的装法（Flatpak / AppImage） |
| 英文报错看不懂 | 复制去搜，搜到的答案对不上版本 | 结合你的日志和已装包解释，必要时去查最新 issue |
| 一堆文件要整理 | 手动点，容易漏 | 让它写个小脚本，先备份再批量处理 |

除了上面三件事，它还能帮你：整理 Mod / 存档 / 下载目录，写和改小脚本，管 Git 仓库，定时备份，查资料并整理成步骤，或者通过 `ccui` 操作 cccodroid 自己的设置页。

---

## 三、六个真实场景（照着说就行）

### 场景 0：第一次装 Decky Loader，卡在管理员密码

你可以这样说：

> 我想装 Decky Loader。安装器说可以把管理员密码临时设成 `Decky!`，这安全吗？帮我用官方方式装，装之前先看看 8080 和 1337 端口有没有被占，装完确认 `plugin_loader.service` 在跑。

它会：解释 `Decky!` 是官方安装器临时设置的密码、装完会删除；先查端口冲突；把官方安装脚本下载下来读一遍给你看；指导你执行；装完检查服务和 `~/homebrew`。

### 场景 A：SteamOS 更新后 Decky 不见了

你可以这样说：

> 我 SteamOS 更新后 Decky 面板不见了。先帮我看看现在是什么版本、`~/homebrew` 和 `plugin_loader.service` 还在不在，告诉我属于哪种情况，先别动系统文件。

它会：读系统版本、检查 Decky 目录和服务状态、看日志，再按官方建议先重跑安装器装稳定版；不行再试预发布版；还不行去查现有 issue。

### 场景 B：pacman 报 PGP / 密钥环错误

你可以这样说：

> 我运行 `sudo pacman -S 某某` 报这个错：〔把完整报错贴进来〕。别直接给我命令，先告诉我原因、风险，以及有没有不用动系统分区的替代方案。

它会：解释是密钥环过期、包损坏还是源不对；先给你 Flatpak / Distrobox 的替代方案；确实需要修 keyring 时，再把命令和风险列清楚。

### 场景 C：装一个 Flatpak 软件并放到桌面

你可以这样说：

> 帮我装 XYZ，先查有没有 Flatpak 版；有就直接装，装完确认能不能启动，再帮我看看桌面图标有没有出来。

它会：`flatpak search`、安装、启动验证、检查 `.desktop` 文件。全程不需要 root。

### 场景 D：整理 Mod 和存档

你可以这样说：

> 帮我把下载目录里这个 Mod 解压到正确的游戏目录，先备份原来的文件，告诉我改了哪些路径。

它会：找游戏安装目录（通常在 `~/.local/share/Steam/steamapps/common/`）、解压、备份、核对文件结构。

### 场景 E：日常维护

你可以这样说：

> 每周日晚上帮我检查一下磁盘空间和 cccodroid 的日志，超过 90% 就在通知里提醒我，别自动删东西。

它会：把检查脚本写好、告诉你在「定时任务」页怎么填；以后每周自动跑，结果通过桌面通知告诉你。

---

## 四、怎么把话说清楚

agent 能不能帮上忙，很大程度取决于你怎么描述问题。四句话原则：

1. **说目标**：「我想装什么 / 修什么 / 让什么跑起来」。
2. **说现状**：「现在是什么版本、我运行了什么命令、完整报错是什么」。
3. **说约束**：「不要动系统分区 / 先备份 / 不要自动删文件 / 我没有 sudo 密码」。
4. **说验证**：「做完告诉我怎么确认它真的好了」。

几个好习惯：

- **贴完整报错**，不要只贴最后一行；前面的上下文往往才是原因。
- **先让它诊断再动手**：「先别改，告诉我你看到了什么、判断依据是什么。」
- **要求备份**：改配置、换驱动、动游戏文件之前，让它先复制一份。
- **一次只做一件事**：装完验证完，再做下一件。
- **不懂就问**：「这一步为什么要这样做？不做会怎样？」

---

## 五、常见报错对照表

| 报错（原文） | 意思 | 通常怎么办 |
| --- | --- | --- |
| `Read-only file system` | SteamOS 根分区锁着，不能写 `/usr` | 先判断是不是真的需要写系统分区；优先 Flatpak / AppImage / 用户目录 |
| `invalid or corrupted package (PGP signature)` | 包签名校验失败，常见于密钥环过期 | 更新 keyring / 换源；先确认包的来源可信 |
| `key "……" could not be looked up` | 缺对应的签名公钥 | 同上，初始化并填充 keyring |
| `failed to commit transaction (conflicting files)` | 两个包要装同一个文件 | 找出是哪个包占用了文件，别用 `--overwrite` 硬盖 |
| `failed to init transaction (unable to lock database)` | 上次 pacman 没跑完，留下了锁 | 确认没有 pacman 在跑，再处理 `/var/lib/pacman/db.lck` |
| `error: target not found: 包名` | 源里没有这个包 | 核对包名；SteamOS 的源比 Arch 少，可能需要 Flatpak |
| `flatpak: command not found` | 环境里没有 flatpak | 用 Discover 商店，或先确认 flatpak 是否安装 |
| `No remote refs found similar to "……"` | Flatpak 源里没有这个应用 | 先加 Flathub 源，或核对应用 ID |
| Decky 安装器只给一句英文失败 | 网络、权限、版本三者之一 | 看完整输出；核对 SteamOS 与 Decky 版本；确认管理员密码可用 |
| Decky 面板不见了 / 插件加载不出来 | 常见于 SteamOS 更新、8080/1337 被占、版本不匹配 | 看 `plugin_loader.service` 与 `~/homebrew/logs`；重跑安装器装稳定版；查端口占用 |
| `curl: (6) Could not resolve host` | DNS 或网络不通 | 换网络、检查 DNS；别反复重试 |
| 安装时 `Permission denied` | 没有管理员权限，或密码没设 | 先 `passwd` 设密码，或用安装器临时设 `Decky!` |

> 这张表只覆盖最常见的几类。真正的报错往往带着路径、版本号和堆栈，直接把整段贴给 agent 更快。

---

## 六、边界：哪些事不要让它做

- **不要让它绕过 sudo。** 它用你的用户权限运行；需要 root 的操作，它会准备好命令，由你确认。
- **不要让它操作 Steam 界面和系统弹窗。** 页面操控只能操作 cccodroid 自己的窗口。
- **不要在 Steam 开着的时候改 `shortcuts.vdf`。** 想加非 Steam 游戏，先退出 Steam。
- **不要运行来源不明的一行脚本**（尤其是 `curl …… | bash`）。至少先让 agent 把脚本下载下来读一遍，告诉你它要做什么。
- **不要把 API Key、密码、令牌贴进对话。** 它们会进会话记录；配置密钥请用设置页。
- **不要指望系统更新后 pacman 包还在。** 这是 SteamOS 的设计，不是 agent 能改变的；它能帮你更新后快速恢复。

---

## 七、参考资料

- [Steam Deck and Steam Machine Desktop: FAQ](https://help.steampowered.com/en/faqs/view/671A-4453-E8D2-323C) —— Valve 官方：Flatpak、只读镜像、
  `steamos-readonly`、默认用户为什么没有密码、更新会不会抹掉 pacman 包
- [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) —— 官方安装说明、更新后消失怎么办、端口冲突
- [Flatpak 文档](https://docs.flatpak.org/) —— Flatpak 的基本概念与命令
- [Distrobox](https://github.com/89luca89/distrobox) —— 在 Deck 上跑一个可随便装的容器
- [Arch Wiki: Pacman/Troubleshooting](https://wiki.archlinux.org/title/Pacman/Troubleshooting) —— pacman 常见报错
