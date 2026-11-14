#!/usr/bin/env bash
# 把一批产物按「交付/<年>/<月>/<产物目录名>/<文件>」归档到共享目录。
# cccodroid SD 版约定：年/月取产物构建当天（不是移动当天），目录名默认用 cccodroid-linux-<版本>。
#
# 用法：
#   deliver.sh --from <源目录> --name <产物目录名> [--date YYYY-MM-DD] [--force] 文件...
#
# 例：
#   deliver.sh --from /sdcard/cccodroid/交付/cccodroid-linux-0.1.3 \
#     --name cccodroid-linux-0.1.3 --date 2026-11-14 \
#     cccodroid-0.1.3-linux-x86_64.tar.gz cccodroid-0.1.3-linux-x86_64.tar.gz.sha256 ...
set -euo pipefail

ROOT="${CCCODROID_DELIVER_ROOT:-/sdcard/cccodroid/交付}"
FROM=""
NAME=""
DATE=""
FORCE=0
FILES=()

usage() { sed -n '2,12p' "$0"; exit "${1:-0}"; }

while (($#)); do
  case "$1" in
    --from) FROM="${2:-}"; shift 2 ;;
    --name) NAME="${2:-}"; shift 2 ;;
    --date) DATE="${2:-}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage 0 ;;
    --) shift; FILES+=("$@"); break ;;
    -*) echo "未知参数：$1" >&2; usage 2 ;;
    *) FILES+=("$1"); shift ;;
  esac
done

[ -n "$FROM" ] || { echo "缺 --from" >&2; exit 2; }
[ -n "$NAME" ] || { echo "缺 --name" >&2; exit 2; }
[ "${#FILES[@]}" -gt 0 ] || { echo "至少给一个文件" >&2; exit 2; }
[ -d "$FROM" ] || { echo "源目录不存在：$FROM" >&2; exit 2; }
[[ "$NAME" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "目录名只能用字母、数字、点、下划线、连字符：$NAME" >&2; exit 2; }

DATE="${DATE:-$(date +%F)}"
[[ "$DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "日期格式应为 YYYY-MM-DD：$DATE" >&2; exit 2; }
YEAR="${DATE%%-*}"; REST="${DATE#*-}"; MONTH="${REST%%-*}"
TARGET="$ROOT/$YEAR/$MONTH/$NAME"

if [ -e "$TARGET" ] && [ "$FORCE" -ne 1 ]; then
  # 允许空目录；非空就拒绝，避免覆盖
  if [ -n "$(ls -A "$TARGET" 2>/dev/null || true)" ]; then
    echo "目标已存在且非空：$TARGET（要覆盖加 --force）" >&2
    exit 1
  fi
fi
mkdir -p "$TARGET"

for f in "${FILES[@]}"; do
  base="$(basename -- "$f")"
  [[ "$base" != */* ]] || { echo "只收文件名，不收子路径：$f" >&2; exit 2; }
  src="$FROM/$base"
  [ -f "$src" ] || { echo "文件不存在：$src" >&2; exit 1; }
  cp -f -- "$src" "$TARGET/$base"
done

{
  echo "source=$FROM"
  echo "date=$DATE"
  echo "name=$NAME"
  echo
  for f in "${FILES[@]}"; do
    base="$(basename -- "$f")"
    sha256sum "$TARGET/$base"
  done
} > "$TARGET/MANIFEST.txt"

echo "$TARGET"
