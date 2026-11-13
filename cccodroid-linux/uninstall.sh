#!/usr/bin/env bash
# cccodroid 卸载入口：真正的逻辑在 install.sh --uninstall。
# 默认保留 home/ 与 workspace/；加 --purge 连数据一起删除。
set -euo pipefail

SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

# 如果本脚本位于 <prefix>/versions/<版本>/ 下，自动把该前缀带上，
# 这样自定义 --prefix 安装后也能直接运行 current/uninstall.sh。
PREFIX_ARGS=()
cand="$(cd -P -- "$SCRIPT_DIR/../.." 2>/dev/null && pwd -P || true)"
if [ -n "$cand" ] && [ -f "$cand/install.env" ]; then
  PREFIX_ARGS=(--prefix "$cand")
fi

exec "$SCRIPT_DIR/install.sh" --uninstall "${PREFIX_ARGS[@]}" "$@"
