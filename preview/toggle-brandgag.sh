#!/usr/bin/env bash
# 在「隔离预览实例」里开关品牌文字恶搞彩蛋（dsh-warm-brandgag）。
# 本脚本只动**预览 home**（.dsh-warm-preview）里的那一条；3081 真实实例的 patch 里
# 也挂着这个包，那个不归本脚本管（要改就去改 ~/.dsh/profiles/web/cordis.patch.yml）。
#
#   bash toggle-brandgag.sh on      # 挂上彩蛋
#   bash toggle-brandgag.sh off     # 摘掉彩蛋
#   bash toggle-brandgag.sh status
#
# 加/删条目**不用重启预览**：patch 是热加载的（由 dsh-app-boot 的 watchUserPatches 用 cordis HMR 盯着），
# 改完刷新一次浏览器页面就生效。只改 brandgag/lib/client.js 也是刷新即热重载。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 共用常量 / patch 片段操作各只有一处定义（scripts/ 下），本脚本只调用。
source "$HERE/../scripts/warm-config.sh"
source "$HERE/../scripts/patch-block.sh"

ID="dsh-warm-brandgag"
PKG_DIR="$HERE/brandgag"
PREVIEW_HOME="${PREVIEW_HOME:-$WARM_PREVIEW_HOME_DEFAULT}"
PATCH="$PREVIEW_HOME/$WARM_PROFILE_SUBDIR/$WARM_PATCH_NAME"
MODE="${1:-status}"

[ -f "$PATCH" ] || { echo "找不到预览 patch：$PATCH" >&2; exit 1; }

case "$MODE" in
  on)
    if patch_block_present "$PATCH" "$ID"; then echo "本来就是开的，无需改动。"; exit 0; fi
    patch_block_add "$PATCH" "$ID" "$PKG_DIR/lib/index.js" \
      "品牌文字恶搞彩蛋：deepseek → deepsleep，HARNESS → 狗圈。只在预览 home 里挂。"
    echo "已把品牌彩蛋挂进预览 profile —— 执行 bash $HERE/start-preview.sh 重启后生效。"
    ;;
  off)
    if ! patch_block_present "$PATCH" "$ID"; then echo "本来就是关的，无需改动。"; exit 0; fi
    patch_block_remove "$PATCH" plain "$ID"
    echo "已从预览 profile 摘掉品牌彩蛋 —— 执行 bash $HERE/start-preview.sh 重启后彻底恢复。"
    ;;
  status)
    if patch_block_present "$PATCH" "$ID"; then echo "预览实例：品牌彩蛋 开"; else echo "预览实例：品牌彩蛋 关"; fi
    ;;
  *)
    echo "用法：bash toggle-brandgag.sh on|off|status" >&2
    exit 2
    ;;
esac
