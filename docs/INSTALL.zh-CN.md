# 安装教程（大白话版）

这份教程写给第一次用 Linux / Steam Deck 的人。照着做就行，不需要懂编程。

---

## 一、先搞清楚你要装什么

**cccodroid-linux** 是把 cccodroid（一个给 Claude Code 用的图形界面）搬到 Steam Deck / Linux 桌面上。
装好之后你会得到一个窗口：左边是会话列表，右边是聊天框，Claude 在后台帮你干活。

两件事要先知道：

1. **这个安装包不含 Claude Code 本体**（它是 Anthropic 的收费软件，不能随包发）。
   安装的时候会自动从官方 npm 源下载，需要联网，大约 110 MB。
2. **用之前要准备一个能用的接口**：
   - 有 Claude 账号（订阅或 API Key）的，可以在「设置 → 接口」里选 Claude；
   - 用国内模型的，准备对应平台的 API Key（DeepSeek、智谱、通义、Kimi 等都可以）；
   - 都没有的话，先去申请一个，再往下装。

---

## 二、下载安装包

1. 打开浏览器，进这个页面：

   <https://github.com/FatBrother1/cccodroid-linux/releases/tag/v0.1.4>

2. 在下面的 **Assets** 里点 `cccodroid-0.1.4-linux-x86_64.tar.gz` 下载（约 102 MB）。
   旁边的 `.sha256`、`.sig` 是校验文件，普通用户不用管。

> Steam Deck 用户：先按 Steam 键 → 电源 → **切换到桌面模式**，在桌面上的浏览器里下载。

---

## 三、Debian / Ubuntu 用 .deb 一键安装（可选）

如果你用的是 **Debian / Ubuntu**（不是 Steam Deck），可以不看后面的解压步骤：到
[这个单独的 .deb 发布页](https://github.com/FatBrother1/cccodroid-linux/releases/tag/v0.1.4-deb) 下载 `cccodroid_0.1.4_amd64.deb`，然后：

```bash
cd ~/Downloads
sudo apt install ./cccodroid_0.1.4_amd64.deb
cccodroid open
```

第一次运行 `cccodroid` 时会自动为当前用户初始化（下载 Claude Code、建数据目录），
过程和解压安装一样。卸载：`sudo apt remove cccodroid`。

> **Steam Deck / SteamOS 不要用 .deb**：SteamOS 是 Arch 系且根分区只读，装不了。
> Deck 用户继续看下面的解压安装。

## 三、解压

### 方法 A：用文件管理器（推荐新手）

1. 打开「下载」文件夹，找到刚下好的 `cccodroid-0.1.4-linux-x86_64.tar.gz`。
2. 右键 → **解压到此处**（Extract Here）。
3. 会多出一个文件夹 `cccodroid-0.1.4`。

### 方法 B：用终端

打开终端（Steam Deck 桌面左下角「Konsole」），输入：

```bash
cd ~/Downloads
tar -xzf cccodroid-0.1.4-linux-x86_64.tar.gz
cd cccodroid-0.1.4
```

---

## 四、安装

在解压出来的文件夹里打开终端（文件管理器里右键「在此处打开终端」），或者在终端里：

```bash
cd ~/Downloads/cccodroid-0.1.4
./install.sh
```

**不需要 sudo，也不要加 sudo。** 它只会装到你自己的用户目录（`~/.local/share/cccodroid`），
不会动系统文件。

安装过程会做这些事：

1. 解包到 `~/.local/share/cccodroid/versions/0.1.4`；
2. **自动下载 Claude Code**（联网，约 110 MB，等一两分钟）；
3. 生成桌面图标和启动器。

看到 `已安装 cccodroid 0.1.4` 就成功了。

> 如果提示 `Permission denied`，先执行 `chmod +x install.sh` 再运行。
> 如果 Claude Code 没下载成功（网络问题），安装仍会继续；装完后运行
> `cccodroid install-claude` 单独补装即可。完全没有网络的环境，可以提前把
> Claude Code 的二进制拷到机器上，用 `cccodroid install-claude --from /路径/claude`。

---

## 五、第一次打开

终端里运行：

```bash
cccodroid open
```

或者在桌面应用菜单里找 **cccodroid** 双击。

会弹出一个窗口。第一次打开可能慢几秒，正常。

> 如果没装桌面图标，或者提示找不到 `cccodroid`，可以先用完整路径：
> `~/.local/share/cccodroid/current/bin/cccodroid open`

---

## 六、配置接口（关键一步）

窗口打开后：

1. 点左下角头像 / 齿轮，进 **设置**。
2. 左边选 **接口与型号**。
3. 点 **添加接口**，选一家你准备好的（比如 DeepSeek、智谱 GLM、通义千问），
   把 API Key 粘进去；如果是自己的中转站，选「自定义」，填地址和 Key。
4. 保存后回到聊天页，在输入框上方选一个模型。
5. 随便发一句话，比如「你好」，能回复就说明装好了。

> 有 Claude 订阅的：在「接口与型号」里选 **Claude 账户登录**，按提示登录即可。

---

## 七、日常使用

- 左边是会话列表，点「新对话」开始新的。
- 文件都在 `~/.local/share/cccodroid/workspace`，你让 Claude 改的文件也在这里。
- 常用命令：

```bash
cccodroid status      # 看后台服务在不在
cccodroid logs        # 看日志（按 Ctrl+C 退出）
cccodroid doctor      # 一键体检，出问题先跑这个
cccodroid restart     # 重启后台
```

---

## 八、Steam 游戏模式（可选）

想把 cccodroid 加到游戏模式：

```bash
cccodroid steam add
```

然后**完全退出 Steam 再重新打开**，游戏库的「非 Steam 游戏」里会多一个「cccodroid」。
手柄：左摇杆 / 十字键滚动，A 确认，B 返回，LB / RB 翻页，Y 聚焦输入框；打字按 **STEAM + X** 调出屏幕键盘。
建议还是用桌面模式，窗口和输入法都更顺手。

---

## 九、更新

**在窗口里检查**：设置 → 更新 → **检查更新**。它会同时查两样东西：

- **cccodroid 本体**：读 GitHub Releases 的最新正式版，和当前版本比较；有新版时可以点「更新」下载安装（需要能访问 GitHub）。
- **Claude Code**：读 npm 官方源 / 官方渠道；有新版时点「更新」，也可以开「自动更新」。

手动更新（网络不好、或者想自己控制）时，下载新的 tar.gz，解压后运行：

```bash
cd ~/Downloads/cccodroid-0.1.4
./install.sh --force
```

**版本号没变的时候一定要加 `--force`**：不加的话安装器会以为「这个版本已经装过」，
直接跳过。`--force` 会重新解包并切过去，你的会话、配置、工作区都保留。

如果这次是从一个**不同的版本号**升上来的，之后可以用 `cccodroid rollback` 退回上一版；
同版本号内更新不会留下可回退的旧副本。

---

## 十、卸载

在解压出来的安装包目录里运行：

```bash
./install.sh --uninstall
```

默认只删程序，**保留**你的会话和配置。想连数据一起删：

```bash
./install.sh --uninstall --purge
```

---

## 十一、常见问题

> 装 Decky 插件、装软件、看报错这类 Steam Deck 上的问题，见另一份文档：
> [Steam Deck 使用指南](STEAMDECK.zh-CN.md)。

**1. 打开窗口是白屏 / 打不开**
先跑 `cccodroid doctor` 看哪一项失败。SteamOS 自带 Qt，一般不会缺；普通 Arch 需要装 Qt6 WebEngine。

**2. 提示端口被占用**
换一个端口重装：`./install.sh --port 8791`。

**3. Claude Code 下载失败**
换网络重试，或运行 `cccodroid install-claude`；也可以从别的机器拷一个 claude 二进制过来，
用 `cccodroid install-claude --from /路径/claude`。

**4. 发消息报错 / 401**
接口的 Key 或地址不对。设置里重新填一次；国内模型注意选对「线路」。

**5. 想改工作区目录**
默认工作区是 `~/.local/share/cccodroid/workspace`；想让 Claude 在别的目录干活，
可以在界面的「项目」里添加那个目录，再在项目里新建会话。

**6. 安装包安全吗？**
安装包带 sha256 和签名，但**不含 Claude Code**；Claude Code 是 Anthropic 的软件，
请从官方渠道获取并遵守它的条款。这个项目是社区移植，不是 cccodroid 官方。

---

## 十二、文件都装到哪了

```text
~/.local/share/cccodroid/
├── versions/0.1.4/   # 程序本体
├── current           # 指向正在用的版本
├── home/             # 配置、会话、日志
└── workspace/        # 你让 Claude 干活的地方
```

备份的话，拷走 `home/` 和 `workspace/` 就够了（里面有密钥，别随便发给别人）。
