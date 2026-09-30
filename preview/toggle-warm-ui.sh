#!/usr/bin/env bash
# 在「隔离预览实例」里实时开关 dsh-warm-ui —— 用来做 A/B 对比。
#
#   bash toggle-warm-ui.sh off    # 预览实例回到出厂配色
#   bash toggle-warm-ui.sh on     # 预览实例换回暖色
#
# 只改预览 home 里的 patch（工作区内）；预览实例的 patch 文件是热监听的，
# 写完会在进程内重新装配，浏览器刷新一次即可看到效果。真实 profile 不受影响。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(cd "$HERE/.." && pwd)"
# 共用常量 / patch 片段操作各只有一处定义（scripts/ 下），本脚本只调用。
source "$SRC_DIR/scripts/warm-config.sh"
source "$SRC_DIR/scripts/patch-block.sh"

ID="dsh-warm-ui"
PREVIEW_HOME="${PREVIEW_HOME:-$WARM_PREVIEW_HOME_DEFAULT}"
PATCH="$PREVIEW_HOME/$WARM_PROFILE_SUBDIR/$WARM_PATCH_NAME"
MODE="${1:-status}"

[ -f "$PATCH" ] || { echo "找不到预览 patch：$PATCH" >&2; exit 1; }

case "$MODE" in
  on)
    if patch_block_present "$PATCH" "$ID"; then echo "本来就是开的，无需改动。"; exit 0; fi
    patch_block_add "$PATCH" "$ID" "$SRC_DIR/lib/index.js"
    echo "已把 dsh-warm-ui 插回预览 profile —— 刷新浏览器即可看到暖色。"
    ;;
  off)
    if ! patch_block_present "$PATCH" "$ID"; then echo "本来就是关的，无需改动。"; exit 0; fi
    patch_block_remove "$PATCH" plain "$ID"
    echo "已从预览 profile 摘掉 dsh-warm-ui —— 刷新浏览器即回到出厂配色。"
    ;;
  status)
    if patch_block_present "$PATCH" "$ID"; then echo "预览实例：暖色开（dsh-warm-ui 在 patch 里）"; else echo "预览实例：暖色关（出厂配色）"; fi
    ;;
  *)
    echo "用法：bash toggle-warm-ui.sh on|off|status" >&2
    exit 2
    ;;
esac
