#!/usr/bin/env bash
# 把上游 cccodroid 的改动拉下来做一次对照，不自动改代码。
#
# 用法（在仓库根目录）：
#   bash scripts/sync-upstream.sh
#
# 输出写到 dist-upstream/：
#   upstream-commits.txt        基线之后上游 gateway 的提交
#   upstream-gateway.stat.txt   文件级改动统计
#   upstream-gateway.patch      完整补丁（对照用，不自动应用）
#
# 这个仓库是「移植快照」，不是 GitHub 上的 fork：上游历史与本仓库历史无关，
# 直接 git merge 会产生整棵树的冲突。同步方式是「对照 → 人工/脚本重放移植补丁」，
# 详细步骤见 docs/UPSTREAM.md。
set -euo pipefail
cd "$(dirname "$0")/.."

UP_URL="${UPSTREAM_URL:-https://github.com/greyoak111/cccodroid.git}"
BASE_FILE="UPSTREAM-BASE"
[ -f "$BASE_FILE" ] || { echo "缺 $BASE_FILE" >&2; exit 1; }

BASE_TAG="$(awk '/^greyoak111\//{print $2; exit}' "$BASE_FILE")"
BASE_COMMIT="$(awk '/^greyoak111\//{print $3; exit}' "$BASE_FILE")"
[ -n "$BASE_TAG" ] && [ -n "$BASE_COMMIT" ] || { echo "$BASE_FILE 格式不对" >&2; exit 1; }

git remote get-url upstream >/dev/null 2>&1 || {
  echo "添加 upstream 远端：$UP_URL"
  git remote add upstream "$UP_URL"
}
echo "拉取上游 main…"
# 不要用 --tags：上游也有 v0.1.0（cccodroid 早期版本），会和本仓库的发布标签撞名。
git fetch --quiet upstream main
# 基线提交本地没有时，单独取一次基线标签，并放进 upstream- 命名空间，避免和本仓库标签冲突。
if ! git cat-file -e "$BASE_COMMIT^{commit}" 2>/dev/null; then
  git fetch --quiet upstream "refs/tags/$BASE_TAG:refs/tags/upstream-$BASE_TAG" 2>/dev/null \
    || git fetch --quiet upstream "$BASE_COMMIT"
fi

UP_HEAD="$(git rev-parse --short upstream/main)"
UP_VER="$(git show upstream/main:android/AndroidManifest.xml 2>/dev/null \
  | sed -n 's/.*android:versionName="\([^"]*\)".*/\1/p' | head -1)"
OUT="dist-upstream"
mkdir -p "$OUT"

echo "本移植基线：$BASE_TAG ($BASE_COMMIT)"
echo "上游 main  ：${UP_VER:-?} ($UP_HEAD)"

git log --oneline "$BASE_COMMIT..upstream/main" -- gateway > "$OUT/upstream-commits.txt"
git diff --stat "$BASE_COMMIT..upstream/main" -- gateway > "$OUT/upstream-gateway.stat.txt"
git diff "$BASE_COMMIT..upstream/main" -- gateway > "$OUT/upstream-gateway.patch"

echo
echo "== 上游 gateway 提交（$(wc -l < "$OUT/upstream-commits.txt") 条）=="
sed -n '1,40p' "$OUT/upstream-commits.txt"

echo
echo "== 移植重点文件的上游改动 =="
for f in gateway/gw/run.mjs gateway/gw/claude.mjs gateway/gw/config.mjs \
         gateway/gw/settings-store.mjs gateway/web/index.html; do
  if ! git diff --quiet "$BASE_COMMIT..upstream/main" -- "$f"; then
    echo "  改了：$f"
  fi
done

cat <<EOF

报告写到 $OUT/。下一步：
  1. 看 upstream-gateway.patch，确认上游改了什么；
  2. 按 docs/UPSTREAM.md 把改动重放进 src/gateway（保留 Linux 适配与 Android 功能移除）；
  3. 构建、验收、发版，最后把 $BASE_FILE 更新成新的标签和提交。
EOF
