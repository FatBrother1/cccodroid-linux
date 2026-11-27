# 与上游 cccodroid 同步

上游：<https://github.com/greyoak111/cccodroid>（Apache-2.0）。

## 1. 先弄清一件事：这不是 GitHub 上的 fork

本仓库是**移植快照**：只放了 Linux 用得到的网关、网页、外壳和打包脚本，历史是重新开始的。
所以 GitHub 页面上的 **「Sync fork」按钮用不了**，`git merge upstream/main` 也不合适——
两边历史无关，直接合并会把整棵上游 Android 工程（Java、Gradle、原生库）一起卷进来，产生成千上万个冲突。

正确的同步方式是：

1. 拉上游，做**对照**；
2. 把上游对 `gateway/` 的改动**重放**进本仓库的 `src/gateway/`，同时保留本移植的 Linux 适配和 Android 功能移除；
3. 构建、验收、发版。

`UPSTREAM-BASE` 记录当前基线。目前是：

```text
greyoak111/cccodroid v0.6.20 cb1403590456fec6192f7c33f006d202b7d1be43
```

## 2. 一条命令看上游改了什么

```bash
bash scripts/sync-upstream.sh
```

它会：

- 没有 `upstream` 远端就自动加：`https://github.com/greyoak111/cccodroid.git`；
- 拉 `upstream/main`（**不用 `--tags`**：上游也有 `v0.1.0`，会和本仓库的发布标签撞名）；
- 从 `UPSTREAM-BASE` 的提交对比到 `upstream/main`，只看 `gateway/`；
- 把提交列表、文件统计、完整补丁写到 `dist-upstream/`；
- 特别标出本移植改过的重点文件（`run.mjs`、`claude.mjs`、`config.mjs`、`settings-store.mjs`、`web/index.html`）有没有上游改动。

报告是**只读**的，不会改你的工作区。

## 3. 重放一次上游更新

以 `v0.6.17 → v0.6.20` 为例：

### 3.1 先看报告

```bash
bash scripts/sync-upstream.sh
less dist-upstream/upstream-gateway.stat.txt
less dist-upstream/upstream-gateway.patch
```

补丁里标了每个文件改了什么。先判断哪些是上游修 bug、哪些是新功能、哪些和本移植的 Linux 改动撞车。

### 3.2 没改过的文件：直接取上游新版

本移植只动了少部分文件。没动过的文件可以直接用上游的：

```bash
git show upstream/main:gateway/gw/某个文件.mjs > src/gateway/gw/某个文件.mjs
```

### 3.3 改过的文件：三方合并

本移植动过的文件至少包括：

```text
gateway/gw/run.mjs              # 启动参数、权限、Linux 分支
gateway/gw/claude.mjs           # Linux 下直接起 claude（不走 glibc loader）
gateway/gw/config.mjs           # Linux 路径与 PREFIX 处理
gateway/gw/settings-store.mjs   # 默认值与 Linux 行为
gateway/web/index.html          # 移除 Android 入口
gateway/web/app/*.js            # 移除 Android 页面与交互
```

用 git 的三方合并，以当前基线为 base：

```bash
mkdir -p /tmp/up
git show v0.6.17:gateway/gw/run.mjs > /tmp/up/run.base.mjs
git show upstream/main:gateway/gw/run.mjs > /tmp/up/run.theirs.mjs
git merge-file src/gateway/gw/run.mjs /tmp/up/run.base.mjs /tmp/up/run.theirs.mjs
# 有冲突会写进文件并返回非 0；解决后继续
```

对每个改过的文件重复。合并后**必须重新检查 Android 专属功能的移除**：Shizuku/priv、设备工具、
工作岛、内存管家、组件市场、端侧模型、Office 转换、截屏、安卓分享/主题/折叠屏、`/sdcard`。
上游新加的功能如果依赖 Android 宿主，也要按同样口径拆掉或让接口返回 404。

### 3.4 构建与验收

```bash
# 在装有 Node 26 x86_64 与 Claude Code 的构建机上
bash cccodroid-linux/build-bundle.sh --source stage --scripts-dir cccodroid-linux --out dist
```

然后用仓库里的验收脚本（或自己的沙箱）检查：安装、升级、回滚、`/api/state`、会话、Git、
终端、页面操控、内置桥。**不要跳过验收直接发版。**

### 3.5 更新基线

确认新版本可用后，把 `UPSTREAM-BASE` 改成新的标签和提交：

```text
greyoak111/cccodroid v0.6.20 cb1403590456fec6192f7c33f006d202b7d1be43
```

提交信息写清楚：`sync: upstream v0.6.20`，并在 `CHANGELOG.md` 里列出上游带来的变化和本移植的调整。

## 4. 为什么不直接把本仓库做成 fork

- GitHub 的 fork 会带上上游整棵 Android 工程（Java、Gradle、NDK、二进制），而本移植只保留 `gateway/` 的一部分；
- fork 的「Sync fork」会把上游所有提交合并进来，冲突量远超收益；
- 本移植的版本号（0.1.x）与上游（0.6.x）是两套号，发布节奏也不同。

如果你想要一个「真正能 merge」的 fork，可以另外建一个私有 fork 专门跟踪上游，把 `src/gateway` 当生成产物，
再用本仓库发布——这是另一种工作流，但维护成本更高。

## 5. 当前状态

- 基线：v0.6.20（2026-11-13 已同步）。
- 上游 main：v0.8.3（2026-11-26）。
- 2026-11-27 选摘了 v0.7.8–v0.8.3 的四项网关改进（未改基线）：
  - MCP 编辑：`remove` 显式带 `-s user`；remove + add-json 在同一把 `EXT_LOCK` 内原子执行；
    stdio 命令按 shell 引号规则解析。
  - 更新状态只读：`upd_status` 不再隐式联网，`upd_check` 显式检查；`lastAutoCheck` / `checkedOnce`
    分开手动与自动，状态接口带 `appVersion`。
  - 自定义接口按 origin（协议 + 主机 + 端口）比较对话与模型清单端点，接收方变化即清旧 Key。
  - 上下文用量条：暂缓 `message_start` 的偏小输入用量，等本请求末尾确认，避免回摆。
- 2026-11-17 选摘了 v0.7.0–v0.7.7 与网关/网页相关的改动（未改基线）：
  - v0.7.0：每个通过来源校验的请求都更新 `LAST_LANG`；自动起名提示用明确的语言名（#211）。
  - v0.7.1：内嵌浏览器窗格关闭/隐藏后把焦点还给主页面（本移植在 QML 外壳里实现）。
  - v0.7.4：上下文窗口按二进制换算，`1k=1024`、`1m=1048576`（#222）；内置桥升级到市场 r21
    （OpenAI 兼容端点裸模型名路由、路径别名卸载）。
  - v0.7.5 / v0.7.6：MCP 服务器直接编辑（含停用条目），令牌只回显名字；远程 MCP 把
    `Authorization=Bearer …` 写成等号时拦截并提示 `Header: 值`；http / sse 地址加回环与局域网 IP 提示。
- 未同步：Shizuku、特权授权、组件市场、QQ 机器人、GPU 驱动等 Android 专属改动。
- 再运行 `scripts/sync-upstream.sh` 会从新基线开始对照后续改动。
