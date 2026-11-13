#!/usr/bin/env bash
# 把已经解开的发行包目录做成 Debian/Ubuntu 的 .deb（系统装到 /opt/cccodroid，首次运行再为用户初始化）。
# 注意：SteamOS 是 Arch 系且根分区只读，不能用 .deb；Steam Deck 请用 tar.gz 安装包。
#
# 用法：build-deb.sh --pkg-dir <发行包解开的目录，含 install.sh/VERSION/src/runtime> [--out 目录] [--version 版本] [--arch amd64]
# 依赖：dpkg-deb（Debian/Ubuntu 构建机上自带）
set -euo pipefail

PKG_DIR=""
OUT=""
VERSION=""
ARCH="amd64"
while (($#)); do
  case "$1" in
    --pkg-dir) PKG_DIR="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --arch) ARCH="$2"; shift 2 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done
[ -n "$PKG_DIR" ] && [ -d "$PKG_DIR" ] || { echo "需要 --pkg-dir 指向解开的发行包目录" >&2; exit 2; }
command -v dpkg-deb >/dev/null 2>&1 || { echo "构建机没有 dpkg-deb（Debian/Ubuntu 上才有）" >&2; exit 2; }
VERSION="${VERSION:-$(tr -d '[:space:]' < "$PKG_DIR/VERSION")}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]] || { echo "版本号不合规：$VERSION" >&2; exit 2; }
OUT="${OUT:-$(pwd)}"
mkdir -p "$OUT"

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/cccodroid-deb.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
R="$STAGE/root"
mkdir -p "$R/opt/cccodroid" "$R/usr/bin" "$R/usr/share/applications" \
         "$R/usr/share/icons/hicolor/192x192/apps" "$R/usr/share/doc/cccodroid" "$R/DEBIAN"

cp -a "$PKG_DIR/." "$R/opt/cccodroid/pkg/"

cat > "$R/usr/bin/cccodroid" <<'EOF'
#!/bin/bash
# 系统安装的 cccodroid：首次运行时为当前用户初始化到 ~/.local/share/cccodroid（下载 Claude Code、建数据目录），
# 之后直接转给用户自己的那份。程序本体在 /opt/cccodroid/pkg，不占用户目录。
set -euo pipefail
PKG="${CCCODROID_PKG:-/opt/cccodroid/pkg}"
PREFIX="${CCCODROID_PREFIX:-$HOME/.local/share/cccodroid}"
if [ ! -x "$PREFIX/current/bin/cccodroid" ]; then
  echo "[cccodroid] 首次运行，正在为 $USER 初始化到 $PREFIX …"
  "$PKG/install.sh" --prefix "$PREFIX" --bin-dir "$HOME/.local/bin"
fi
exec "$PREFIX/current/bin/cccodroid" "$@"
EOF
chmod 755 "$R/usr/bin/cccodroid"

cat > "$R/usr/share/applications/cccodroid.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=cccodroid
Comment=Claude Code 图形工作台（Steam Deck / Linux 移植）
Exec=cccodroid open
Icon=cccodroid
Terminal=false
Categories=Development;Utility;
StartupNotify=true
EOF

if [ -f "$PKG_DIR/templates/cccodroid.png" ]; then
  cp "$PKG_DIR/templates/cccodroid.png" "$R/usr/share/icons/hicolor/192x192/apps/cccodroid.png"
fi
for f in README.zh-CN.md; do
  [ -f "$PKG_DIR/$f" ] && cp "$PKG_DIR/$f" "$R/usr/share/doc/cccodroid/$f"
done
[ -f "$PKG_DIR/src/LICENSE" ] && cp "$PKG_DIR/src/LICENSE" "$R/usr/share/doc/cccodroid/copyright"

cat > "$R/DEBIAN/control" <<EOF
Package: cccodroid
Version: $VERSION
Architecture: $ARCH
Maintainer: FatBrother1 <FatBrother1@users.noreply.github.com>
Section: devel
Priority: optional
Homepage: https://github.com/FatBrother1/cccodroid-linux
Description: cccodroid Linux port (Steam Deck / SteamOS, community port)
 Claude Code 图形工作台 cccodroid 的 Linux 移植：Qt6 原生窗口、桌面通知、
 会话导入导出、内置 OpenAI 本地桥和页面操控 MCP。
 安装包不包含 Claude Code 本体（Anthropic 专有软件）；首次运行
 cccodroid 时会为该用户初始化并从 npm 官方平台包安装 Claude Code。
Depends: bash, coreutils, curl, ca-certificates, tar, gzip
Recommends: qml6-module-qtwebengine, qml6-module-qtwebchannel, qml6-module-qtquick-controls, qml6-module-qtquick-layouts, libnotify-bin
EOF

cat > "$R/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -t /usr/share/icons/hicolor || true
fi
echo "cccodroid 已安装。运行 cccodroid open 启动（首次会为该用户初始化）。"
echo "卸载：sudo apt remove cccodroid；用户数据在 ~/.local/share/cccodroid，需自行删除。"
EOF
cat > "$R/DEBIAN/prerm" <<'EOF'
#!/bin/sh
set -e
# 只删程序；用户数据与用户自己的 systemd 服务不动，卸载后手动 cccodroid 已不可用。
exit 0
EOF
chmod 755 "$R/DEBIAN/postinst" "$R/DEBIAN/prerm"

DEB="$OUT/cccodroid_${VERSION}_${ARCH}.deb"
dpkg-deb --root-owner-group -Zxz --build "$R" "$DEB" >/dev/null
( cd "$OUT" && sha256sum "$(basename "$DEB")" > "$(basename "$DEB").sha256" )
echo "已生成：$DEB"
ls -lh "$DEB" | awk '{print "大小：" $5}'
