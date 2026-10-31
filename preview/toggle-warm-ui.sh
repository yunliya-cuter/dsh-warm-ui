#!/usr/bin/env bash
# 在「隔离预览实例」里开关 dsh-warm-ui 单包（暖色系列全部 4 个插件）。
#
#   bash toggle-warm-ui.sh off    # 预览实例回到出厂配色（从 profile bundles 摘掉单包）
#   bash toggle-warm-ui.sh on     # 预览实例换回暖色（加回 profile bundles）
#   bash toggle-warm-ui.sh status
#
# 2026-10-31 起 dsh-warm-ui 是单包 bundle，包含 shared / wallpaper / brandgag。
# 开关的是 profile package.json 的 dsh.profile.bundles，不再改 cordis.patch.yml。
# 改 bundles 需要重启预览实例才生效：bash preview/start-preview.sh。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(cd "$HERE/.." && pwd)"
source "$SRC_DIR/scripts/warm-config.sh"

ID="dsh-warm-ui"
PREVIEW_HOME="${PREVIEW_HOME:-$WARM_PREVIEW_HOME_DEFAULT}"
PROFILE="$PREVIEW_HOME/$WARM_PROFILE_SUBDIR/package.json"
MODE="${1:-status}"

[ -f "$PROFILE" ] || { echo "找不到预览 profile：$PROFILE" >&2; exit 1; }

case "$MODE" in
  on|off)
    python3 - "$PROFILE" "$MODE" <<'PY'
import json, sys
path, mode = sys.argv[1:3]
with open(path, encoding="utf-8") as f:
    manifest = json.load(f)
profile = manifest.setdefault("dsh", {}).setdefault("profile", {})
bundles = profile.setdefault("bundles", [])
if mode == "on":
    if "dsh-warm-ui" not in bundles:
        bundles.append("dsh-warm-ui")
else:
    bundles[:] = [item for item in bundles if item != "dsh-warm-ui"]
with open(path, "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)
    f.write("\n")
PY
    echo "已把 dsh-warm-ui 单包$([ "$MODE" = on ] && echo '加回' || echo '移出')预览 profile 的 bundles —— 执行 bash $HERE/start-preview.sh 重启后生效。"
    ;;
  status)
    python3 - "$PROFILE" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    manifest = json.load(f)
bundles = manifest.get("dsh", {}).get("profile", {}).get("bundles", [])
print("预览实例：暖色系列单包" + ("开" if "dsh-warm-ui" in bundles else "关"))
PY
    ;;
  *)
    echo "用法：bash toggle-warm-ui.sh on|off|status" >&2
    exit 2
    ;;
esac
