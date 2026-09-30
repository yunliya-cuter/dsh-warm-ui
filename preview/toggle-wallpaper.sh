#!/usr/bin/env bash
# 在「隔离预览实例」里实时开关动态壁纸样品（dsh-warm-wallpaper）。
# 本脚本只动**预览 home**（.dsh-warm-preview）里的那一条；3081 真实实例的 patch 里
# 也挂着这个包，那个不归本脚本管（要改就去改 ~/.dsh/profiles/web/cordis.patch.yml）。
#
#   bash toggle-wallpaper.sh on      # 挂上样品
#   bash toggle-wallpaper.sh off     # 摘掉样品
#   bash toggle-wallpaper.sh status
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 共用常量 / patch 片段操作各只有一处定义（scripts/ 下），本脚本只调用。
source "$HERE/../scripts/warm-config.sh"
source "$HERE/../scripts/patch-block.sh"

ID="dsh-warm-wallpaper"
PKG_DIR="$HERE/wallpaper"
PREVIEW_HOME="${PREVIEW_HOME:-$WARM_PREVIEW_HOME_DEFAULT}"
PATCH="$PREVIEW_HOME/$WARM_PROFILE_SUBDIR/$WARM_PATCH_NAME"
MODE="${1:-status}"

[ -f "$PATCH" ] || { echo "找不到预览 patch：$PATCH" >&2; exit 1; }

case "$MODE" in
  on)
    if patch_block_present "$PATCH" "$ID"; then echo "本来就是开的，无需改动。"; exit 0; fi
    patch_block_add "$PATCH" "$ID" "$PKG_DIR/lib/index.js" \
      "动态壁纸「样品」：纸/纤维 + 摩尔纹，两模式在侧栏底部切换。只在预览 home 里挂。"
    echo "已把动态壁纸样品挂进预览 profile —— 刷新浏览器即可看到（侧栏底部多一行「壁纸」）。"
    ;;
  off)
    if ! patch_block_present "$PATCH" "$ID"; then echo "本来就是关的，无需改动。"; exit 0; fi
    patch_block_remove "$PATCH" plain "$ID"
    echo "已从预览 profile 摘掉动态壁纸样品。"
    ;;
  status)
    if patch_block_present "$PATCH" "$ID"; then echo "预览实例：动态壁纸样品 开"; else echo "预览实例：动态壁纸样品 关"; fi
    ;;
  *)
    echo "用法：bash toggle-wallpaper.sh on|off|status" >&2
    exit 2
    ;;
esac
