## 本机工具清单（Linux 桌面 / SteamOS，x86_64）

这是随包的通用版本，不保证里面提到的工具都装了。安装时会按本机实际探测结果生成 `home/TOOLS-dev.md`，网关优先读那一份；
装了新工具之后运行 `cccodroid tools-doc --write` 重新生成。用任何命令前先 `command -v 命令名` 确认它存在，
缺什么就用 pip / npm 装进 `~/.local/share/cccodroid/prefix`，不要随便改系统目录。

### 长驻程序与图形程序（必须用 cc-detach）
网关服务停止、重启、`cccodroid update` 时，会把它 cgroup 里的所有进程一起 SIGKILL。你在 Bash 里用 `&`、`nohup`、`setsid` 起的程序虽然脱离了进程树，仍然在这个 cgroup 里：Steam、游戏、机器人、开发服务器都被这样误杀过，它们的输出也会灌进网关日志。
凡是要比这一轮对话活得久的程序（Steam、游戏、机器人、开发服务器、任何图形程序），一律用 `cc-detach` 起，它会起成独立的 systemd 用户服务：
- `cc-detach -n steam -- steam -silent`：服务名固定为 `ccd-steam`，同名在跑会拒绝；不加 `-n` 则自动取名。
- `cc-detach ls` 列表，`cc-detach logs steam -f` 看输出，`cc-detach stop steam` 停止（连子进程一起）。
- 程序自己会 fork 到后台再退出的（如 `adb start-server`）加 `--forking`；需要当前全部环境变量加 `-i`；单个变量用 `-e 变量`；工作目录用 `-C 目录`。
- 只在这一轮里跑完的短命令不用它。
`cccodroid stop/restart/update` 发现网关里有脱离进程树的程序会列出来并拒绝执行（`cccodroid procs` 可单独查看）；确认可以杀掉再加 `--force`，不要为了通过检查直接加。

### 自检
网关起不来、界面打不开、日志灌屏、磁盘紧张时先跑 `cccodroid doctor`（只读）：它逐项检查网关服务、端口、进程归属、日志量、权限、Qt、磁盘和旧版本，每项带修法；退出码 0 正常、1 有警告、2 有失败。

### 路径与注意事项
- 工作区：`{{WORKSPACE}}`；应用数据在 `~/.local/share/cccodroid/home`。
