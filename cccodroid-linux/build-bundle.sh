#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# 构建 cccodroid 离线安装 bundle
#
# 输入是一个“已经能在 Linux 上跑”的部署目录（默认：本机当前安装的版本目录，
# 即 <前缀>/current，前缀默认 ~/.local/share/cccodroid），形态如下：
#
#   <source>/src/             cccodroid 源码（gateway/ 为网关 + 前端）
#   <source>/runtime/node/    Node 官方 linux-x64 运行时
#   <source>/runtime/claude   Claude Code 官方 x86_64 原生二进制
#
# 输出：dist/cccodroid-<版本>-linux-<arch>.tar.gz 与同名 .sha256
#
# 明确不打包：home/、workspace/、日志、令牌、providers 配置、私钥、.env。
# bundle 内会生成 SHA256SUMS，install.sh 解包后会逐文件校验。
#
# 签名发布（可选）：--sign-key 用 OpenSSH 的 ssh-keygen -Y sign（ed25519，namespace 固定为 cccodroid-release）
# 给 tar.gz 签名，产出 <包>.sig，并把公钥作为 keys/release.pub、keys/allowed_signers 打进包里；
# 已装版本带公钥时，cccodroid update 对远程来源的新包强制验签（公钥以已装版本的为准）。
# --publish-dir 把包、.sha256、.sig 和 latest.json 放进一个目录，随便用什么静态服务器发布即可。
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail
shopt -s nullglob

SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

log()  { printf '[build] %s\n' "$*"; }
warn() { printf '[build] 警告：%s\n' "$*" >&2; }
die()  { printf '[build] 错误：%s\n' "$*" >&2; exit 1; }

usage() {
  cat <<EOF
用法：$0 [选项]

  --source DIR        部署目录（默认：<前缀>/current，前缀取 \$CCCODROID_PREFIX 或 ~/.local/share/cccodroid）
  --out DIR           输出目录（默认：$SCRIPT_DIR/dist）
  --version VER       版本号（默认读 $SCRIPT_DIR/VERSION，应形如 0.1.0）
  --arch ARCH         产物架构标签（默认：x86_64）
  --scripts-dir DIR   安装脚本与模板所在目录（默认：$SCRIPT_DIR）
  --sign-key FILE     用这把 ed25519 私钥签名（产出 <包>.sig，公钥打进包里的 keys/）
  --publish-dir DIR   把包、.sha256、.sig、latest.json 一起放进 DIR（供 cccodroid update --check 使用）
  --allow-sensitive   发现 *.key / .env 等文件时只警告，不中止（不建议）
  --without-claude    不打进 Claude Code（专有软件，由安装器首次安装时从 npm 官方包下载）
  --keep-stage        保留临时暂存目录，便于排查
  -h, --help          显示本帮助
EOF
}

SOURCE=""
OUT_DIR="$SCRIPT_DIR/dist"
VERSION=""
ARCH="x86_64"
SCRIPTS_DIR="$SCRIPT_DIR"
ALLOW_SENSITIVE=0
KEEP_STAGE=0
SIGN_KEY=""
PUBLISH_DIR=""
WITHOUT_CLAUDE=0
SIG_NS="cccodroid-release"

while (($#)); do
  case "$1" in
    --source)       [ $# -ge 2 ] || die "--source 需要参数"; SOURCE="$2"; shift 2 ;;
    --source=*)     SOURCE="${1#*=}"; shift ;;
    --out)          [ $# -ge 2 ] || die "--out 需要参数"; OUT_DIR="$2"; shift 2 ;;
    --out=*)        OUT_DIR="${1#*=}"; shift ;;
    --version)      [ $# -ge 2 ] || die "--version 需要参数"; VERSION="$2"; shift 2 ;;
    --version=*)    VERSION="${1#*=}"; shift ;;
    --arch)         [ $# -ge 2 ] || die "--arch 需要参数"; ARCH="$2"; shift 2 ;;
    --arch=*)       ARCH="${1#*=}"; shift ;;
    --scripts-dir)  [ $# -ge 2 ] || die "--scripts-dir 需要参数"; SCRIPTS_DIR="$2"; shift 2 ;;
    --scripts-dir=*) SCRIPTS_DIR="${1#*=}"; shift ;;
    --sign-key)     [ $# -ge 2 ] || die "--sign-key 需要参数"; SIGN_KEY="$2"; shift 2 ;;
    --sign-key=*)   SIGN_KEY="${1#*=}"; shift ;;
    --publish-dir)  [ $# -ge 2 ] || die "--publish-dir 需要参数"; PUBLISH_DIR="$2"; shift 2 ;;
    --publish-dir=*) PUBLISH_DIR="${1#*=}"; shift ;;
    --allow-sensitive) ALLOW_SENSITIVE=1; shift ;;
    --keep-stage)   KEEP_STAGE=1; shift ;;
    --without-claude) WITHOUT_CLAUDE=1; shift ;;
    -h|--help)      usage; exit 0 ;;
    *)              die "未知参数：$1（--help 查看用法）" ;;
  esac
done

if [ -z "$SOURCE" ]; then
  cand="${CCCODROID_PREFIX:-$HOME/.local/share/cccodroid}/current"
  if [ -d "$cand/src" ] && [ -d "$cand/runtime" ]; then
    SOURCE="$(cd -P -- "$cand" && pwd -P)"
    log "来源：$SOURCE（本机当前安装的版本）"
  else
    die "没有 --source，也没找到已安装的版本：$cand（需要里面有 src/ 和 runtime/）"
  fi
fi
[ -d "$SOURCE" ] || die "来源目录不存在：$SOURCE"
[ -d "$SOURCE/src" ] || die "来源目录缺少 src/：$SOURCE"
if [ ! -f "$SOURCE/src/gateway/server.mjs" ] && [ ! -f "$SOURCE/src/server.mjs" ]; then
  die "在 $SOURCE/src 里找不到 gateway/server.mjs 或 server.mjs"
fi
[ -d "$SOURCE/runtime/node" ] || die "来源目录缺少 runtime/node/"
if [ ! -f "$SOURCE/runtime/claude" ] && [ "$WITHOUT_CLAUDE" -eq 0 ]; then die "来源目录缺少 runtime/claude（确认要打不含 Claude Code 的包就加 --without-claude）"; fi
if [ ! -e "$SOURCE/runtime/node/bin/node" ] && [ ! -e "$SOURCE/runtime/node/node" ]; then
  die "runtime/node 里找不到 node 可执行文件"
fi

if [ -z "$VERSION" ]; then
  [ -f "$SCRIPTS_DIR/VERSION" ] || die "没有 --version，且 $SCRIPTS_DIR/VERSION 不存在"
  VERSION="$(tr -d '[:space:]' < "$SCRIPTS_DIR/VERSION")"
fi
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$ ]] \
  || die "版本号不合规（应形如 0.1.0）：$VERSION"
[[ "$ARCH" =~ ^[A-Za-z0-9_+-]+$ ]] || die "架构标签不合规：$ARCH"

for f in install.sh uninstall.sh README.zh-CN.md bin/cccodroid bin/cccodroid-gateway bin/cccodroid-steam bin/cccodroid-steam-launch templates/cccodroid-gateway.service.in templates/cccodroid.desktop.in; do
  [ -e "$SCRIPTS_DIR/$f" ] || die "发行文件缺失：$SCRIPTS_DIR/$f"
done

PUB_FIELDS=""
if [ -n "$SIGN_KEY" ]; then
  command -v ssh-keygen >/dev/null 2>&1 || die "签名需要 ssh-keygen"
  [ -f "$SIGN_KEY" ] || die "签名私钥不存在：$SIGN_KEY"
  pub_line="$(ssh-keygen -y -f "$SIGN_KEY" 2>/dev/null)" || die "读不出公钥（私钥有口令？先 ssh-add，或换一把无口令的发布专用密钥）：$SIGN_KEY"
  case "$pub_line" in
    ssh-ed25519\ *) ;;
    *) die "发布密钥必须是 ed25519（ssh-keygen -t ed25519）" ;;
  esac
  PUB_FIELDS="$(printf '%s' "$pub_line" | awk '{ print $1, $2 }')"
  log "签名密钥：$(ssh-keygen -lf "$SIGN_KEY" 2>/dev/null | awk '{ print $2 }')"
fi

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/cccodroid-build.XXXXXX")"
cleanup() {
  if [ "$KEEP_STAGE" -eq 1 ]; then
    warn "保留暂存目录：$STAGE"
  else
    rm -rf "$STAGE"
  fi
}
trap cleanup EXIT

PKG="$STAGE/cccodroid-$VERSION"
mkdir -p "$PKG"

log "复制源码：$SOURCE/src"
cp -a "$SOURCE/src" "$PKG/src"

# 源码目录里可能混进运行期产物；这些绝不应该进发行包。
find "$PKG/src" -type d -name .git -prune -exec rm -rf {} + 2>/dev/null || true
find "$PKG/src" -type d -path '*/node_modules/.cache' -prune -exec rm -rf {} + 2>/dev/null || true
find "$PKG/src" -type f \( -name '*.log' -o -name '.gateway-token' -o -name 'ccapp-providers.json' \) -print -delete

log "复制 Node 运行时与 Claude Code 二进制"
mkdir -p "$PKG/runtime"
# 用 -L：来源里的 runtime/node 常常是指向 node-vX-linux-x64 的软链，cp -a 会把软链本身打进包，装完就找不到 node。
cp -aL "$SOURCE/runtime/node" "$PKG/runtime/node"
# 用 -L：来源里的 runtime/claude 若是软链，也把真实二进制装进包。
if [ "$WITHOUT_CLAUDE" -eq 0 ] && [ -f "$SOURCE/runtime/claude" ]; then cp -L "$SOURCE/runtime/claude" "$PKG/runtime/claude"; fi

# 网关的默认 PATHS.node 是 runtime/node/node（安卓布局），Linux 官方 Node 是 bin/node。
# 加一个相对软链兼容两种读法，不占空间。
if [ -x "$PKG/runtime/node/bin/node" ] && [ ! -e "$PKG/runtime/node/node" ]; then
  ln -s "bin/node" "$PKG/runtime/node/node"
fi

# 防呆：来源目录如果其实是安卓 arm64 的二进制，打出来的包在 Deck 上跑不了。
if [ "$ARCH" = "x86_64" ] && command -v file >/dev/null 2>&1; then
  for bin in "$PKG/runtime/claude" "$PKG/runtime/node/bin/node"; do
    [ -f "$bin" ] || continue
    desc="$(file -b "$bin" 2>/dev/null || true)"
    case "$desc" in
      *x86-64*|*x86_64*) ;;
      *) warn "架构检查：$bin 看起来不是 x86_64（$desc）" ;;
    esac
  done
fi

log "复制安装脚本、CLI 与模板"
cp "$SCRIPTS_DIR/install.sh" "$PKG/install.sh"
cp "$SCRIPTS_DIR/uninstall.sh" "$PKG/uninstall.sh"
cp "$SCRIPTS_DIR/README.zh-CN.md" "$PKG/README.zh-CN.md"
mkdir -p "$PKG/bin" "$PKG/templates"
cp -a "$SCRIPTS_DIR/bin/." "$PKG/bin/"
cp -a "$SCRIPTS_DIR/templates/." "$PKG/templates/"
# 原生外壳（Qt6 QML）：cccodroid open 优先用它，没有 Qt 的机器才退回浏览器。
if [ -d "$SCRIPTS_DIR/desktop" ]; then
  cp -a "$SCRIPTS_DIR/desktop" "$PKG/desktop"
fi

# 页面操控 MCP（cccodroid ui-mcp 用）：stdio 服务，无依赖。
if [ -d "$SCRIPTS_DIR/ui-mcp" ]; then
  [ -f "$SCRIPTS_DIR/ui-mcp/server.mjs" ] || die "ui-mcp/ 不完整：缺 server.mjs"
  cp -a "$SCRIPTS_DIR/ui-mcp" "$PKG/ui-mcp"
fi

# 内置的 OpenAI 本地协议桥（cccodroid bridge 用；可选）。依赖必须预装好——安装机上不联网装 npm。
if [ -d "$SOURCE/bridge" ]; then
  [ -f "$SOURCE/bridge/component.cjs" ] || die "bridge/ 不完整：缺 component.cjs"
  [ -f "$SOURCE/bridge/node_modules/@musistudio/claude-code-router/dist/cli.js" ] || die "bridge/ 缺 CCR 依赖（构建机上先跑 npm ci --ignore-scripts --omit=dev）"
  cp -a "$SOURCE/bridge" "$PKG/bridge"
  log "内置 OpenAI 本地桥：$(du -sh "$PKG/bridge" | cut -f1)"
fi

# 工具清单：来源目录里的 TOOLS-dev.md 是按某一台机器手写的（写着那台机器上才有的工具），
# 发行包里换成不声称具体工具的通用版本；安装时由 cccodroid tools-doc 按本机实际探测结果生成 home/TOOLS-dev.md。
if [ -f "$SCRIPTS_DIR/templates/TOOLS-dev.generic.md" ] && [ -d "$PKG/src/gateway" ]; then
  cp "$SCRIPTS_DIR/templates/TOOLS-dev.generic.md" "$PKG/src/gateway/TOOLS-dev.md"
  log "TOOLS-dev.md 换成通用版本"
fi

if [ -n "$PUB_FIELDS" ]; then
  mkdir -p "$PKG/keys"
  printf '%s cccodroid-release\n' "$PUB_FIELDS" > "$PKG/keys/release.pub"
  printf 'cccodroid-release namespaces="%s" %s\n' "$SIG_NS" "$PUB_FIELDS" > "$PKG/keys/allowed_signers"
  chmod 644 "$PKG/keys/release.pub" "$PKG/keys/allowed_signers"
  log "发布公钥已写入 keys/"
fi

chmod 755 "$PKG/install.sh" "$PKG/uninstall.sh"
find "$PKG/bin" -maxdepth 1 -type f -exec chmod 755 {} + 2>/dev/null || true
chmod 755 "$PKG/runtime/claude" 2>/dev/null || true
if [ -d "$PKG/runtime/node/bin" ]; then
  find "$PKG/runtime/node/bin" -maxdepth 1 -type f -exec chmod 755 {} + 2>/dev/null || true
fi

# 版本与构建信息
printf '%s\n' "$VERSION" > "$PKG/VERSION"

node_ver="unknown"
if [ -x "$PKG/runtime/node/bin/node" ]; then
  node_ver="$("$PKG/runtime/node/bin/node" --version 2>/dev/null || true)"
  [ -n "$node_ver" ] || node_ver="unknown"
fi
claude_ver="unknown"
if [ -x "$PKG/runtime/claude" ]; then
  claude_ver="$("$PKG/runtime/claude" --version 2>/dev/null | head -n 1 || true)"
  [ -n "$claude_ver" ] || claude_ver="unknown"
fi
app_tag="unknown"
if [ -f "$SOURCE/TAG" ]; then
  app_tag="$(tr -d '\r\n' < "$SOURCE/TAG")"
fi

{
  printf 'cccodroid Linux bundle\n'
  printf 'version: %s\n' "$VERSION"
  printf 'arch: %s\n' "$ARCH"
  printf 'built_at: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf 'built_on: %s\n' "$(uname -srm)"
  printf 'source: %s\n' "$SOURCE"
  printf 'node: %s\n' "$node_ver"
  printf 'claude: %s\n' "$claude_ver"
  printf 'app_tag: %s\n' "$app_tag"
} > "$PKG/BUILD-INFO"

# ── 安全检查 ─────────────────────────────────────────────────────────
if [ -e "$PKG/home" ] || [ -e "$PKG/workspace" ]; then
  die "发行包里出现了 home/ 或 workspace/，拒绝继续"
fi

# 私钥、凭据、.env 类：默认中止，让打包的人明确处理。
# 只扫我们自己的代码与脚本；runtime/ 是官方 Node 与 Claude 二进制，
# 里面可能有正当的 CA/测试证书，不能一把抓。
secret_list="$STAGE/secret-list.txt"
{
  find "$PKG/src" "$PKG/bin" "$PKG/templates" -type f \( \
    -name '*.pem' -o -name '*.key' -o -name 'id_rsa*' -o -name 'id_ed25519*' \
    -o -name '.npmrc' -o -name '.netrc' -o -name '.git-credentials' -o -name '.env' \
  \) -print
  find "$PKG/src" "$PKG/bin" "$PKG/templates" -type f -name '.env.*' \
    ! -name '*.example' ! -name '*.sample' ! -name '*.template' -print
} > "$secret_list"

if [ -s "$secret_list" ]; then
  if [ "$ALLOW_SENSITIVE" -eq 1 ]; then
    warn "发现疑似敏感文件（--allow-sensitive，已保留）："
    sed 's/^/  - /' "$secret_list" >&2
  else
    printf '[build] 发现疑似敏感文件，拒绝打包：\n' >&2
    sed 's/^/  - /' "$secret_list" >&2
    die "请把它们移出源码目录，或确认无密钥后加 --allow-sensitive"
  fi
fi

# ── SHA256SUMS 与 tar.gz ─────────────────────────────────────────────
log "生成 SHA256SUMS…"
(
  cd -P -- "$PKG"
  find . -type f ! -name 'SHA256SUMS' -print0 \
    | LC_ALL=C sort -z \
    | xargs -0 sha256sum > SHA256SUMS
)

mkdir -p "$OUT_DIR"
tarball="$OUT_DIR/cccodroid-$VERSION-linux-$ARCH.tar.gz"
tmp_tar="$tarball.tmp.$$"
log "打包：$tarball"
tar --sort=name --owner=0 --group=0 --numeric-owner \
  -C "$STAGE" -czf "$tmp_tar" "cccodroid-$VERSION"
mv -f "$tmp_tar" "$tarball"

(
  cd -P -- "$OUT_DIR"
  sha256sum "$(basename -- "$tarball")" > "$(basename -- "$tarball").sha256"
)

if [ -n "$SIGN_KEY" ]; then
  rm -f "$tarball.sig"
  if ! ssh-keygen -Y sign -f "$SIGN_KEY" -n "$SIG_NS" "$tarball" >/dev/null 2>"$STAGE/sign.err"; then
    cat "$STAGE/sign.err" >&2
    die "签名失败"
  fi
  # 自检：用刚打进包里的公钥把签名验一遍
  ssh-keygen -Y verify -f "$PKG/keys/allowed_signers" -I "$SIG_NS" -n "$SIG_NS" -s "$tarball.sig" < "$tarball" >/dev/null 2>&1 \
    || die "签名自检没通过：$tarball.sig"
  log "已签名：$tarball.sig"
fi

if [ -n "$PUBLISH_DIR" ]; then
  mkdir -p "$PUBLISH_DIR"
  base_name="$(basename -- "$tarball")"
  cp -f "$tarball" "$PUBLISH_DIR/$base_name"
  cp -f "$tarball.sha256" "$PUBLISH_DIR/$base_name.sha256"
  if [ -f "$tarball.sig" ]; then cp -f "$tarball.sig" "$PUBLISH_DIR/$base_name.sig"; fi
  tmp_json="$PUBLISH_DIR/.latest.json.tmp.$$"
  {
    printf '{\n  "version": "%s",\n  "file": "%s",\n  "sha256": "%s",\n' "$VERSION" "$base_name" "$(cut -d' ' -f1 "$tarball.sha256")"
    if [ -f "$tarball.sig" ]; then printf '  "sig": "%s.sig",\n' "$base_name"; fi
    printf '  "built_at": "%s"\n}\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  } > "$tmp_json"
  mv -f "$tmp_json" "$PUBLISH_DIR/latest.json"
  log "已发布到：$PUBLISH_DIR（latest.json 指向 $base_name）"
fi

log "完成"
log "  产物：$tarball"
log "  大小：$(du -h "$tarball" | cut -f1)"
log "  SHA256：$(cut -d' ' -f1 "$tarball.sha256")"
log "  校验：sha256sum -c $(basename -- "$tarball").sha256"
log "  顶层目录：cccodroid-$VERSION/"
