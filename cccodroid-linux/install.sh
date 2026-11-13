#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# cccodroid Linux 安装器
#
#   · 不需要 root；默认装到 ~/.local/share/cccodroid
#   · 幂等：重复运行只补齐缺失部分；同版本目录默认复用（--force 强制重装）
#   · 版本目录 + current 软链，更新时 home/ 与 workspace/ 不动
#   · 支持 systemd 用户服务、桌面条目、无服务（--no-service）手动模式
#
# 用法：
#   ./install.sh                                  # 当前目录是解压后的 bundle
#   ./install.sh cccodroid-0.1.0-linux-x86_64.tar.gz
#   ./install.sh --prefix "$HOME/Applications/cccodroid" <bundle>
#   ./install.sh --no-service <bundle>
#   ./install.sh --uninstall [--purge]
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail
shopt -s nullglob
shopt -u patsub_replacement 2>/dev/null || true

: "${HOME:?install.sh 需要 HOME 环境变量}"

readonly SERVICE_NAME="cccodroid-gateway.service"
readonly UI_SERVICE_NAME="cccodroid-ui.service"
readonly DEFAULT_PORT="8790"
readonly SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly DEFAULT_PREFIX="${XDG_DATA_HOME:-$HOME/.local/share}/cccodroid"

log()  { printf '[cccodroid] %s\n' "$*"; }
warn() { printf '[cccodroid] 警告：%s\n' "$*" >&2; }
die()  { printf '[cccodroid] 错误：%s\n' "$*" >&2; exit 1; }

usage() {
  cat <<EOF
用法：$0 [选项] [bundle.tar.gz | 解压后的目录]

  --prefix DIR      安装前缀（默认：$DEFAULT_PREFIX）
  --bin-dir DIR     启动器目录（默认：\$HOME/.local/bin）
  --port N          网关端口（默认：$DEFAULT_PORT）
  --no-service      不安装/不启用 systemd 用户服务，改用后台进程模式
  --service         明确要求 systemd 用户服务（覆盖安装清单里记的 --no-service）
  --force           同版本已存在时也重新解包覆盖
  --no-restart      只安装、不重启网关服务（新版本等下次重启才生效；cccodroid update --no-restart 用）
  --uninstall       卸载（默认保留 home/ 与 workspace/）
  --purge           与 --uninstall 连用：连数据一起删除
  -h, --help        显示本帮助

不带 bundle 参数时：优先用脚本所在目录（解压后的 bundle），
否则找脚本旁边唯一的 cccodroid-*.tar.gz。
EOF
}

# 把字符串安全地包成 shell 单引号字面量（用于写 install.env 与启动器 shim）。
shquote() {
  local s="${1-}" out="'" ch i
  for ((i = 0; i < ${#s}; i++)); do
    ch="${s:i:1}"
    if [ "$ch" = "'" ]; then
      out+="'\\''"
    else
      out+="$ch"
    fi
  done
  out+="'"
  printf '%s' "$out"
}

abs_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *)  printf '%s/%s\n' "$PWD" "$1" ;;
  esac
}

normalize_prefix() {
  local p="$1"
  while [ "$p" != "/" ] && [ "${p%/}" != "$p" ]; do
    p="${p%/}"
  done
  printf '%s\n' "$p"
}

systemd_user_ok() {
  command -v systemctl >/dev/null 2>&1 || return 1
  systemctl --user show-environment >/dev/null 2>&1
}

# unit 文件是不是这个安装器、为这个前缀生成的。按固定服务名对 systemd 做 stop / disable 之前必须先过这一关，
# 否则给临时前缀（测试、第二份安装）做安装 / 卸载，会把机器上正式安装的同名服务一起停掉。
unit_belongs_here() {
  local f="$1" bin="$2"
  [ -f "$f" ] || return 1
  grep -q '由 cccodroid install.sh 生成' "$f" 2>/dev/null || return 1
  grep -qF "$PREFIX/current/bin/$bin" "$f" 2>/dev/null
}

ensure_dir() {
  local d="$1" mode="$2"
  if [ ! -d "$d" ]; then
    mkdir -p "$d"
    chmod "$mode" "$d"
  fi
}

render_template() {
  local tpl="$1" out="$2" line tmp="$2.tmp.$$"
  [ -f "$tpl" ] || die "模板缺失：$tpl"
  : > "$tmp"
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line//@PREFIX@/$PREFIX}"
    line="${line//@BIN_DIR@/$BIN_DIR}"
    line="${line//@VERSION@/$VERSION}"
    line="${line//@PORT@/$PORT}"
    line="${line//@HOME_DIR@/$PREFIX/home}"
    line="${line//@WORKSPACE@/$PREFIX/workspace}"
    line="${line//@CURRENT@/$PREFIX/current}"
    line="${line//@GATEWAY@/$PREFIX/current/bin/cccodroid-gateway}"
    printf '%s\n' "$line" >> "$tmp"
  done < "$tpl"
  chmod 644 "$tmp"
  mv -f "$tmp" "$out"
}

stop_pid_mode() {
  local pidf="$PREFIX/run/gateway.pid" pid="" i
  if [ ! -f "$pidf" ]; then
    return 0
  fi
  pid="$(cat "$pidf" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
    for ((i = 0; i < 20; i++)); do
      if ! kill -0 "$pid" 2>/dev/null; then
        break
      fi
      sleep 0.2
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
  fi
  rm -f "$pidf"
}

# ── 参数 ──────────────────────────────────────────────────────────────
PREFIX=""
BIN_DIR="$HOME/.local/bin"
PORT="$DEFAULT_PORT"
DO_SERVICE=1
ACTION="install"
PURGE=0
FORCE=0
BUNDLE=""
PREFIX_GIVEN=0
BIN_DIR_GIVEN=0
PORT_GIVEN=0
SERVICE_GIVEN=0
SERVICE_WANTED=""      # 用户想要的服务模式；systemd 暂时不可用时本次退回手动，但意图要记进清单
NO_RESTART=0

while (($#)); do
  case "$1" in
    --prefix)
      [ $# -ge 2 ] || die "--prefix 需要一个目录参数"
      PREFIX="$2"; PREFIX_GIVEN=1; shift 2 ;;
    --prefix=*)
      PREFIX="${1#*=}"; PREFIX_GIVEN=1; shift ;;
    --bin-dir)
      [ $# -ge 2 ] || die "--bin-dir 需要一个目录参数"
      BIN_DIR="$2"; BIN_DIR_GIVEN=1; shift 2 ;;
    --bin-dir=*)
      BIN_DIR="${1#*=}"; BIN_DIR_GIVEN=1; shift ;;
    --port)
      [ $# -ge 2 ] || die "--port 需要一个数字参数"
      PORT="$2"; PORT_GIVEN=1; shift 2 ;;
    --port=*)
      PORT="${1#*=}"; PORT_GIVEN=1; shift ;;
    --no-service)
      DO_SERVICE=0; SERVICE_GIVEN=1; shift ;;
    --service)
      DO_SERVICE=1; SERVICE_GIVEN=1; shift ;;
    --uninstall|--remove)
      ACTION="uninstall"; shift ;;
    --purge)
      PURGE=1; shift ;;
    --force)
      FORCE=1; shift ;;
    --no-restart)
      NO_RESTART=1; shift ;;
    -h|--help)
      usage; exit 0 ;;
    --)
      shift
      while (($#)); do
        BUNDLE="$1"; shift
      done ;;
    -*)
      die "未知选项：$1（--help 查看用法）" ;;
    *)
      [ -z "$BUNDLE" ] || die "只能指定一个 bundle"
      BUNDLE="$1"; shift ;;
  esac
done

# 从 current 里的脚本反推自定义前缀（例如 <prefix>/versions/0.1.0/install.sh）。
if [ -z "$PREFIX" ] && [[ "$SCRIPT_DIR" == */versions/* ]]; then
  cand="$(cd -P -- "$SCRIPT_DIR/../.." && pwd -P)"
  if [ -f "$cand/install.env" ]; then
    PREFIX="$cand"
  fi
fi

PREFIX="${PREFIX:-$DEFAULT_PREFIX}"
PREFIX="$(normalize_prefix "$(abs_path "$PREFIX")")"
[ "$PREFIX" != "/" ] || die "拒绝把根目录当作安装前缀"
MANIFEST="$PREFIX/install.env"

# 读旧清单：重装时沿用自定义 bin 目录 / 端口 / 服务模式；卸载时沿用原路径。
if [ -f "$MANIFEST" ]; then
  CCCODROID_PREFIX=""
  CCCODROID_BIN_DIR=""
  CCCODROID_VERSION=""
  CCCODROID_SERVICE=""
  CCCODROID_PORT=""
  CCCODROID_UNIT=""
  CCCODROID_UI_UNIT=""
  CCCODROID_DESKTOP=""
  CCCODROID_ICON=""
  CCCODROID_PREVIOUS=""
  # shellcheck disable=SC1090
  . "$MANIFEST"
  if [ "$PREFIX_GIVEN" -eq 0 ] && [ -n "$CCCODROID_PREFIX" ]; then
    PREFIX="$(normalize_prefix "$(abs_path "$CCCODROID_PREFIX")")"
    MANIFEST="$PREFIX/install.env"
  fi
  if [ "$BIN_DIR_GIVEN" -eq 0 ] && [ -n "$CCCODROID_BIN_DIR" ]; then
    BIN_DIR="$CCCODROID_BIN_DIR"
  fi
  if [ "$PORT_GIVEN" -eq 0 ] && [ -n "$CCCODROID_PORT" ]; then
    PORT="$CCCODROID_PORT"
  fi
  if [ "$SERVICE_GIVEN" -eq 0 ] && [ -n "$CCCODROID_SERVICE" ]; then
    DO_SERVICE="$CCCODROID_SERVICE"
  fi
fi

[[ "$PORT" =~ ^[0-9]+$ ]] || die "端口必须是数字：$PORT"
[ -n "$BIN_DIR" ] || die "--bin-dir 不能为空"
BIN_DIR="$(normalize_prefix "$(abs_path "$BIN_DIR")")"

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_PATH="$UNIT_DIR/$SERVICE_NAME"
UI_UNIT_PATH="$UNIT_DIR/$UI_SERVICE_NAME"
APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
DESKTOP_PATH="$APPS_DIR/cccodroid.desktop"
ICONS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/scalable/apps"
ICON_PATH="$ICONS_DIR/cccodroid.svg"

if [ "$ACTION" = "uninstall" ]; then
  if [ -n "${CCCODROID_UNIT:-}" ]; then UNIT_PATH="$CCCODROID_UNIT"; fi
  if [ -n "${CCCODROID_UI_UNIT:-}" ]; then UI_UNIT_PATH="$CCCODROID_UI_UNIT"; fi
  if [ -n "${CCCODROID_DESKTOP:-}" ]; then DESKTOP_PATH="$CCCODROID_DESKTOP"; fi
  if [ -n "${CCCODROID_ICON:-}" ]; then ICON_PATH="$CCCODROID_ICON"; fi
fi

# ── 卸载 ──────────────────────────────────────────────────────────────
do_uninstall() {
  log "卸载 cccodroid（前缀：$PREFIX）"

  # 0) Steam 里登记过的 cccodroid 快捷方式：尽力删掉。只有「Steam 正在运行」（退出码 3）值得提醒，
  #    没装 Steam、旧版本没有这个子命令都是正常情况，不吭声。
  if [ -x "$PREFIX/current/bin/cccodroid" ]; then
    steam_rc=0
    CCCODROID_PREFIX="$PREFIX" timeout 60 "$PREFIX/current/bin/cccodroid" steam remove >/dev/null 2>&1 || steam_rc=$?
    if [ "$steam_rc" -eq 3 ]; then
      warn "Steam 正在运行，没能删掉里面的 cccodroid 快捷方式；关掉 Steam 后可用 cccodroid steam remove 删（卸载前）或在 Steam 里手动删"
    fi
  fi

  # 1) systemd 用户服务：只动属于这个前缀的 unit
  if [ -f "$UNIT_PATH" ]; then
    if unit_belongs_here "$UNIT_PATH" cccodroid-gateway; then
      if systemd_user_ok; then
        systemctl --user stop "$SERVICE_NAME" >/dev/null 2>&1 || true
        systemctl --user disable "$SERVICE_NAME" >/dev/null 2>&1 || true
      fi
      rm -f "$UNIT_PATH"
      if systemd_user_ok; then
        systemctl --user daemon-reload >/dev/null 2>&1 || true
      fi
    else
      warn "保留不属于这个前缀的 unit（或不是本安装器生成的）：$UNIT_PATH"
    fi
  fi

  # 1b) 原生窗口服务
  if [ -f "$UI_UNIT_PATH" ]; then
    if unit_belongs_here "$UI_UNIT_PATH" cccodroid-ui; then
      if systemd_user_ok; then
        systemctl --user stop "$UI_SERVICE_NAME" >/dev/null 2>&1 || true
      fi
      rm -f "$UI_UNIT_PATH"
      if systemd_user_ok; then
        systemctl --user daemon-reload >/dev/null 2>&1 || true
      fi
    else
      warn "保留不属于这个前缀的 unit（或不是本安装器生成的）：$UI_UNIT_PATH"
    fi
  fi

  # 2) 手动模式的进程
  stop_pid_mode

  # 3) 桌面条目
  if [ -f "$DESKTOP_PATH" ]; then
    if grep -q 'X-cccodroid-Managed=true' "$DESKTOP_PATH" 2>/dev/null; then
      rm -f "$DESKTOP_PATH"
      if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database "$(dirname "$DESKTOP_PATH")" >/dev/null 2>&1 || true
      fi
    else
      warn "保留不是本安装器生成的桌面条目：$DESKTOP_PATH"
    fi
  fi

  # 4) 图标
  rm -f "$ICON_PATH"

  # 5) 启动器 shim（只删带标记的）
  if [ -f "$BIN_DIR/cccodroid" ]; then
    if grep -q 'cccodroid-launcher' "$BIN_DIR/cccodroid" 2>/dev/null; then
      rm -f "$BIN_DIR/cccodroid"
    else
      warn "保留不是本安装器生成的启动器：$BIN_DIR/cccodroid"
    fi
  fi

  # 6) 程序本体（保留数据是默认）
  # 内置桥：先停掉它的 systemd 用户服务，再删程序目录；配置和密钥留在 home/ 下，由用户自己决定去留。
  if [ -f "$HOME/.config/systemd/user/cccodroid-bridge.service" ]; then
    systemctl --user disable --now cccodroid-bridge.service >/dev/null 2>&1 || true
    rm -f "$HOME/.config/systemd/user/cccodroid-bridge.service"
    systemctl --user daemon-reload >/dev/null 2>&1 || true
  fi
  rm -rf "$PREFIX/bridge"
  # 页面操控 MCP：从 Claude 的用户级配置里移除（版本目录删掉后服务就没了，配置留着会指向空路径）
  if [ -x "$PREFIX/current/bin/cccodroid" ]; then
    CCCODROID_PREFIX="$PREFIX" timeout 30 "$PREFIX/current/bin/cccodroid" ui-mcp remove >/dev/null 2>&1 || true
  fi
  rm -f "$PREFIX/current"
  rm -rf "$PREFIX/versions"
  for d in "$PREFIX"/.staging.*; do
    rm -rf "$d"
  done
  rm -rf "$PREFIX/logs" "$PREFIX/run"

  if [ "$PURGE" -eq 1 ]; then
    case "$PREFIX" in
      "/"|"$HOME"|"")
        die "拒绝删除：$PREFIX 看起来不是 cccodroid 的安装前缀" ;;
    esac
    if [ ! -f "$PREFIX/install.env" ] && [ "$FORCE" -ne 1 ]; then
      die "拒绝删除：$PREFIX 没有 cccodroid 安装标记（确属本安装器创建的目录可加 --force）"
    fi
    rm -rf "$PREFIX"
    log "已删除安装目录与数据：$PREFIX"
  else
    # 保留安装清单：它既是“这个前缀归 cccodroid 管”的标记，
    # 也方便之后 --purge 或重新安装时沿用原来的 bin 目录 / 端口。
    log "已保留数据：$PREFIX/home 与 $PREFIX/workspace"
    log "安装清单保留在：$PREFIX/install.env"
    log "如需彻底删除：重新解压发行包后运行 ./install.sh --uninstall --purge --prefix $(shquote "$PREFIX")"
  fi
}

# ── 解包 / 校验 ───────────────────────────────────────────────────────
BROOT=""
STAGING=""

extract_tarball() {
  local file="$1" list="$STAGING/tar-list.txt" tmp="$STAGING/extract" dirs=()
  [ -f "$file" ] || die "bundle 不存在：$file"

  if [ -f "$file.sha256" ]; then
    log "校验 bundle 外层校验和…"
    ( cd -P -- "$(dirname -- "$file")" && sha256sum -c "$(basename -- "$file").sha256" ) || die "bundle 校验失败"
  else
    warn "未找到 $file.sha256，跳过外层校验"
  fi

  tar -tzf "$file" > "$list" || die "不是有效的 tar.gz：$file"
  if grep -Eq '(^/|(^|/)\.\.(/|$))' "$list"; then
    die "bundle 含绝对路径或 .. 路径，拒绝解压"
  fi

  mkdir -p "$tmp"
  tar -xzf "$file" -C "$tmp" --no-same-owner
  if [ -f "$tmp/VERSION" ]; then
    BROOT="$tmp"
    return 0
  fi
  dirs=("$tmp"/*)
  if ((${#dirs[@]} == 1)) && [ -d "${dirs[0]}" ] && [ -f "${dirs[0]}/VERSION" ]; then
    BROOT="${dirs[0]}"
    return 0
  fi
  die "bundle 结构不正确（找不到 VERSION）"
}

prepare_bundle() {
  local given="$1" tars=() sub=()
  if [ -n "$given" ]; then
    [ -e "$given" ] || die "bundle 不存在：$given"
    if [ -d "$given" ]; then
      if [ -f "$given/VERSION" ]; then
        BROOT="$(cd -P -- "$given" && pwd -P)"
        return 0
      fi
      sub=("$given"/*)
      if ((${#sub[@]} == 1)) && [ -d "${sub[0]}" ] && [ -f "${sub[0]}/VERSION" ]; then
        BROOT="$(cd -P -- "${sub[0]}" && pwd -P)"
        return 0
      fi
      die "目录里没有 VERSION：$given"
    fi
    case "$given" in
      *.tar.gz|*.tgz) extract_tarball "$given" ;;
      *) die "只支持 .tar.gz / .tgz，或解压后的目录" ;;
    esac
    return 0
  fi

  if [ -f "$SCRIPT_DIR/VERSION" ] && [ -d "$SCRIPT_DIR/src" ]; then
    BROOT="$SCRIPT_DIR"
    return 0
  fi
  tars=("$SCRIPT_DIR"/cccodroid-*.tar.gz)
  if ((${#tars[@]} == 1)); then
    extract_tarball "${tars[0]}"
    return 0
  fi
  die "没有指定 bundle，且脚本目录里找不到 VERSION/src 或唯一的 cccodroid-*.tar.gz"
}

validate_bundle_root() {
  local root="$1"
  [ -f "$root/VERSION" ] || die "bundle 缺少 VERSION"
  [ -d "$root/src" ] || die "bundle 缺少 src/"
  [ -f "$root/runtime/claude" ] || warn "bundle 不含 Claude Code（首次安装时会从 npm 官方平台包装）"
  if [ ! -x "$root/runtime/node/bin/node" ] && [ ! -x "$root/runtime/node/node" ]; then
    die "bundle 缺少 Node 运行时（runtime/node/bin/node）"
  fi
}

# ── 安装 ──────────────────────────────────────────────────────────────
do_install() {
  if [ "$(id -u)" -eq 0 ]; then
    warn "正在以 root 运行。安装器按当前用户设计；如果这是 sudo，装出来的文件会归 root。"
  fi

  mkdir -p "$PREFIX" "$PREFIX/versions"
  [ -w "$PREFIX/versions" ] || die "没有写权限：$PREFIX/versions"

  STAGING="$PREFIX/.staging.$$"
  rm -rf "$STAGING"
  mkdir -p "$STAGING"
  cleanup() {
    if [ -n "$STAGING" ] && [ -d "$STAGING" ]; then
      rm -rf "$STAGING"
    fi
    rm -f "$PREFIX/.current.$$" 2>/dev/null || true
  }
  trap cleanup EXIT

  prepare_bundle "$BUNDLE"
  validate_bundle_root "$BROOT"

  VERSION="$(tr -d '[:space:]' < "$BROOT/VERSION")"
  [ -n "$VERSION" ] || die "bundle 的 VERSION 为空"
  [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$ ]] \
    || die "版本号不合规（应形如 0.1.0）：$VERSION"

  TEMPLATE_DIR=""
  for d in "$BROOT/templates" "$SCRIPT_DIR/templates"; do
    if [ -d "$d" ]; then
      TEMPLATE_DIR="$d"
      break
    fi
  done
  [ -n "$TEMPLATE_DIR" ] || die "找不到 templates/（bundle 不完整）"

  # 1) 版本目录：存在且完整就复用，否则在工作区解包后一次性挪进去。
  local dest="$PREFIX/versions/$VERSION"
  local vdir=""
  if [ -d "$dest" ] && [ -f "$dest/VERSION" ] && [ -x "$dest/bin/cccodroid" ] && [ "$FORCE" -eq 0 ]; then
    log "版本 $VERSION 已安装，复用（--force 可强制重装）"
    vdir="$dest"
  else
    local new="$STAGING/version-$VERSION"
    mkdir -p "$new"
    log "解包 cccodroid $VERSION…"
    cp -a "$BROOT/." "$new/"

    if [ -f "$new/SHA256SUMS" ]; then
      log "校验 bundle 内容…"
      ( cd -P -- "$new" && sha256sum -c SHA256SUMS >/dev/null ) || die "bundle 内容校验失败"
    else
      warn "bundle 没有 SHA256SUMS，跳过内容校验"
    fi

    chmod 755 "$new/install.sh" "$new/uninstall.sh" 2>/dev/null || true
    if [ -d "$new/bin" ]; then
      find "$new/bin" -maxdepth 1 -type f -exec chmod 755 {} + 2>/dev/null || true
    fi
    chmod 755 "$new/runtime/claude" 2>/dev/null || true
    if [ -d "$new/runtime/node/bin" ]; then
      find "$new/runtime/node/bin" -maxdepth 1 -type f -exec chmod 755 {} + 2>/dev/null || true
    fi

    local old=""
    if [ -e "$dest" ]; then
      old="$STAGING/old-$VERSION"
      mv "$dest" "$old"
    fi
    if ! mv "$new" "$dest"; then
      if [ -n "$old" ] && [ -e "$old" ] && [ ! -e "$dest" ]; then
        mv "$old" "$dest"
      fi
      die "写入版本目录失败：$dest"
    fi
    vdir="$dest"
  fi

  # 2) 原子切换 current（相对软链，前缀整体搬走也不坏）。
  local old_target=""
  old_target="$(readlink "$PREFIX/current" 2>/dev/null || true)"
  rm -f "$PREFIX/.current.$$"
  ln -s "versions/$VERSION" "$PREFIX/.current.$$"
  if ! mv -Tf "$PREFIX/.current.$$" "$PREFIX/current" 2>/dev/null; then
    rm -f "$PREFIX/.current.$$"
    if [ -n "$old_target" ]; then
      ln -sfn "$old_target" "$PREFIX/current"
    else
      rm -f "$PREFIX/current"
    fi
    die "无法切换 current 软链"
  fi

  # 2b) 记下上一个版本，cccodroid rollback / prune 靠它：切走之前 current 指着的那个版本；
  #     重装同一个版本时沿用清单里原来记的。
  local prev_ver="${CCCODROID_PREVIOUS:-}" old_ver=""
  if [ -n "$old_target" ]; then
    old_ver="$(basename -- "$old_target")"
  fi
  if [ -n "$old_ver" ] && [ "$old_ver" != "$VERSION" ] && [ -d "$PREFIX/versions/$old_ver" ]; then
    prev_ver="$old_ver"
  fi

  # 2c) 内置的 OpenAI 本地桥组件（可选）：装在 <前缀>/bridge，跨版本稳定 —— 桥的安装清单记着这个入口，
  #     放在 versions/<版本>/ 里会让升级后入口失效。包里没有 bridge/ 就跳过。
  local bsrc="" bd=""
  for bd in "$BROOT/bridge" "$SCRIPT_DIR/bridge"; do
    [ -f "$bd/component.cjs" ] && { bsrc="$bd"; break; }
  done
  if [ -n "$bsrc" ]; then
    local btmp="$PREFIX/.bridge.$$" bold="$PREFIX/.bridge-old.$$"
    rm -rf "$btmp" "$bold"
    cp -a "$bsrc" "$btmp" || die "复制内置桥组件失败：$bsrc"
    if [ -e "$PREFIX/bridge" ]; then mv "$PREFIX/bridge" "$bold" || { rm -rf "$btmp"; die "腾出 $PREFIX/bridge 失败"; }; fi
    if ! mv "$btmp" "$PREFIX/bridge"; then
      [ -e "$bold" ] && mv "$bold" "$PREFIX/bridge"
      die "写入 $PREFIX/bridge 失败"
    fi
    rm -rf "$bold"
    chmod 755 "$PREFIX/bridge/runtime/"*.sh 2>/dev/null || true
    [ -x "$PREFIX/bridge/node_modules/@musistudio/claude-code-router/dist/cli.js" ] \
      || warn "内置桥组件缺少 CCR 依赖（bundle 不完整？）：$PREFIX/bridge"
    log "内置桥组件已就位：$PREFIX/bridge"
  fi

  # 3) 数据目录（首装创建；已有的一律不动）。
  ensure_dir "$PREFIX/home" 700
  chmod 700 "$PREFIX/home" 2>/dev/null || true      # 迁移来的旧目录可能是 755；里面是令牌、密钥和全部会话
  ensure_dir "$PREFIX/home/tmp" 700
  ensure_dir "$PREFIX/workspace" 755
  ensure_dir "$PREFIX/logs" 700
  ensure_dir "$PREFIX/run" 700

  # 4) ~/.local/bin/cccodroid 启动器 shim。
  mkdir -p "$BIN_DIR"
  local tmp_launcher="$BIN_DIR/.cccodroid.$$"
  {
    printf '#!/usr/bin/env bash\n'
    printf '# cccodroid-launcher —— 由 install.sh 生成；指向 current，版本切换后自动跟随。\n'
    printf 'set -euo pipefail\n'
    printf 'exec %s/current/bin/cccodroid "$@"\n' "$(shquote "$PREFIX")"
  } > "$tmp_launcher"
  chmod 755 "$tmp_launcher"
  mv -f "$tmp_launcher" "$BIN_DIR/cccodroid"

  # 4b) cc-detach：常驻程序 / 图形程序用它起在网关 cgroup 之外（网关重启不会连带杀掉）。
  #     放进工具前缀的 bin（网关给 Claude 的 PATH 里有 <前缀>/prefix/bin），用相对软链跟随 current。
  if [ -f "$vdir/bin/cc-detach" ]; then
    mkdir -p "$PREFIX/prefix/bin"
    ln -sfn "../../current/bin/cc-detach" "$PREFIX/prefix/bin/cc-detach"
  fi

  # 5) 图标与桌面条目。
  if [ -f "$TEMPLATE_DIR/cccodroid.svg" ]; then
    mkdir -p "$ICONS_DIR"
    cp -f "$TEMPLATE_DIR/cccodroid.svg" "$ICON_PATH"
    chmod 644 "$ICON_PATH"
    if command -v gtk-update-icon-cache >/dev/null 2>&1; then
      gtk-update-icon-cache -f -t "$(dirname "$(dirname "$ICONS_DIR")")" >/dev/null 2>&1 || true
    fi
  else
    warn "模板里没有 cccodroid.svg，跳过图标"
  fi
  mkdir -p "$APPS_DIR"
  render_template "$TEMPLATE_DIR/cccodroid.desktop.in" "$DESKTOP_PATH"
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
  fi

  # 6) systemd 用户服务（或 --no-service 手动模式）。
  if [ "$DO_SERVICE" = "1" ] && ! systemd_user_ok; then
    warn "systemd 用户服务不可用（可能不在桌面会话），本次改为手动模式。"
    warn "之后可在桌面会话里重新运行 install.sh（安装清单仍记着要用服务），或用 cccodroid start 启动。"
    SERVICE_WANTED=1
    DO_SERVICE=0
  fi

  if [ "$DO_SERVICE" = "1" ]; then
    mkdir -p "$UNIT_DIR"
    render_template "$TEMPLATE_DIR/cccodroid-gateway.service.in" "$UNIT_PATH"
    # 原生窗口服务：只渲染、不 enable；用 cccodroid open 打开（旧 bundle 没有这个模板就跳过）。
    if [ -f "$TEMPLATE_DIR/cccodroid-ui.service.in" ]; then
      render_template "$TEMPLATE_DIR/cccodroid-ui.service.in" "$UI_UNIT_PATH"
    fi
    systemctl --user daemon-reload >/dev/null 2>&1 || true
    if ! systemctl --user enable "$SERVICE_NAME" >/dev/null 2>&1; then
      warn "systemctl --user enable 失败；可稍后手动 enable。"
    fi
  else
    if unit_belongs_here "$UNIT_PATH" cccodroid-gateway; then
      if systemd_user_ok; then
        systemctl --user disable --now "$SERVICE_NAME" >/dev/null 2>&1 || true
      fi
      warn "已停用现有 systemd 服务；本次以手动模式运行（unit 文件保留，--uninstall 会删除）。"
    fi
  fi

  # 7) 安装清单：CLI 与卸载脚本靠它找回自定义路径。
  local tmp_manifest="$PREFIX/.install.env.$$"
  {
    printf '# cccodroid 安装清单（由 install.sh 生成；uninstall.sh 与 CLI 读取）\n'
    printf 'CCCODROID_PREFIX=%s\n' "$(shquote "$PREFIX")"
    printf 'CCCODROID_BIN_DIR=%s\n' "$(shquote "$BIN_DIR")"
    printf 'CCCODROID_VERSION=%s\n' "$(shquote "$VERSION")"
    printf 'CCCODROID_SERVICE=%s\n' "$(shquote "${SERVICE_WANTED:-$DO_SERVICE}")"
    printf 'CCCODROID_PORT=%s\n' "$(shquote "$PORT")"
    printf 'CCCODROID_UNIT=%s\n' "$(shquote "$UNIT_PATH")"
    printf 'CCCODROID_UI_UNIT=%s\n' "$(shquote "$UI_UNIT_PATH")"
    printf 'CCCODROID_DESKTOP=%s\n' "$(shquote "$DESKTOP_PATH")"
    printf 'CCCODROID_ICON=%s\n' "$(shquote "$ICON_PATH")"
    if [ -n "$prev_ver" ]; then
      printf 'CCCODROID_PREVIOUS=%s\n' "$(shquote "$prev_ver")"
    fi
  } > "$tmp_manifest"
  chmod 600 "$tmp_manifest"
  mv -f "$tmp_manifest" "$PREFIX/install.env"

  # 7b) 按本机实际探测结果生成给 Claude 看的工具清单（home/TOOLS-dev.md）。
  #     随包的 TOOLS-dev.md 是不声称具体工具的通用版本；手工改过的清单不会被覆盖，失败也不影响安装。
  CCCODROID_PREFIX="$PREFIX" timeout 60 "$vdir/bin/cccodroid" tools-doc --write >/dev/null 2>&1 || true

  # 7d) Claude Code 本体：专有软件，发行包不随附。缺了就从 npm 官方平台包装（验签 + sha512 + 试跑），
  #     装到 <版本>/runtime/claude；没网就先跳过，之后可运行 cccodroid install-claude 重试。
  local clbin="$vdir/runtime/claude"
  if [ ! -x "$clbin" ] && [ -f "$vdir/bin/install-claude.mjs" ] && { [ -x "$vdir/runtime/node/bin/node" ] || [ -x "$vdir/runtime/node/node" ]; }; then
    local nodebin="$vdir/runtime/node/bin/node"; [ -x "$nodebin" ] || nodebin="$vdir/runtime/node/node"
    log "本安装包不含 Claude Code（Anthropic 专有软件），正在从 npm 官方平台包安装…"
    mkdir -p "$PREFIX/logs"
    if "$nodebin" "$vdir/bin/install-claude.mjs" --dest "$clbin" >>"$PREFIX/logs/install-claude.log" 2>&1; then
      log "Claude Code 已安装：$clbin"
    else
      warn "Claude Code 没装上（网络原因？）。稍后运行 cccodroid install-claude 重试，或 cccodroid install-claude --from /路径/claude 用本地文件。"
    fi
  fi

  # 7c) 页面操控 MCP（ccui）：登记到 Claude 的 user 级 MCP 配置；失败不影响安装。
  #     它让 Claude 能读原生窗口里的页面并点按/输入（cccodroid ui-mcp remove 可撤销）。
  if [ -f "$vdir/ui-mcp/server.mjs" ]; then
    CCCODROID_PREFIX="$PREFIX" timeout 60 "$vdir/bin/cccodroid" ui-mcp install >/dev/null 2>&1 \
      || warn "页面操控 MCP 没登记上；装好后可以运行 cccodroid ui-mcp install"
  fi

  # 8) 启动（systemd 模式）并等待令牌。
  if [ "$DO_SERVICE" = "1" ] && [ "$NO_RESTART" -eq 1 ]; then
    log "--no-restart：没有重启网关服务，新版本等下次 cccodroid restart 才生效。"
  elif [ "$DO_SERVICE" = "1" ]; then
    if ! systemctl --user restart "$SERVICE_NAME" >/dev/null 2>&1; then
      warn "服务启动失败；运行 systemctl --user status $SERVICE_NAME 查看原因。"
    fi
    for ((i = 0; i < 40; i++)); do
      if [ -s "$PREFIX/home/.gateway-token" ]; then
        break
      fi
      sleep 0.25
    done
  else
    log "未自动启动；用 $BIN_DIR/cccodroid start 手动启动。"
  fi

  # 9) 汇总。
  log "已安装 cccodroid $VERSION"
  log "安装前缀：$PREFIX"
  log "启动器：$BIN_DIR/cccodroid"
  if [ "$DO_SERVICE" = "1" ]; then
    log "服务：$SERVICE_NAME（已 enable，随用户会话启动）"
  else
    log "服务：未启用（手动模式）"
  fi
  log "桌面条目：$DESKTOP_PATH"
  if [ -n "$prev_ver" ]; then
    log "上一个版本：$prev_ver（cccodroid rollback 可退回）"
  fi
  if [ -f "$vdir/keys/release.pub" ] && command -v ssh-keygen >/dev/null 2>&1; then
    log "发布公钥：$(ssh-keygen -lf "$vdir/keys/release.pub" 2>/dev/null | awk '{ print $2 }')（之后的远程更新用它验签）"
  fi

  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) warn "$BIN_DIR 不在 PATH 中；建议把 export PATH=\"\$HOME/.local/bin:\$PATH\" 加到 shell 配置。" ;;
  esac

  local token=""
  if [ -r "$PREFIX/home/.gateway-token" ]; then
    token="$(tr -d '[:space:]' < "$PREFIX/home/.gateway-token" 2>/dev/null || true)"
    if [[ "$token" =~ ^[0-9a-fA-F]{32,}$ ]]; then
      log "界面：http://127.0.0.2:$PORT/?t=$token"
    fi
  fi
  if [ ! -f "$PREFIX/home/ccapp-providers.json" ]; then
    log "首次配置：打开界面 → 设置 → 接口，添加你自己的 API 线路。"
    log "          配置会写入 $PREFIX/home/ccapp-providers.json；安装包不含任何密钥。"
  fi
}

# ── 入口 ──────────────────────────────────────────────────────────────
if [ "$ACTION" = "uninstall" ]; then
  do_uninstall
else
  do_install
fi
