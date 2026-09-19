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
PKG_DIR="$HERE/wallpaper"
PREVIEW_HOME="${PREVIEW_HOME:-/mnt/d/projects/.dsh-warm-preview}"
PATCH="$PREVIEW_HOME/profiles/web/cordis.patch.yml"
BEGIN="# >>> dsh-warm-wallpaper >>>"
END="# <<< dsh-warm-wallpaper <<<"
MODE="${1:-status}"

[ -f "$PATCH" ] || { echo "找不到预览 patch：$PATCH" >&2; exit 1; }

present() { grep -qF "$BEGIN" "$PATCH"; }

case "$MODE" in
  on)
    if present; then echo "本来就是开的，无需改动。"; exit 0; fi
    cat >> "$PATCH" <<YAML

$BEGIN
# 动态壁纸「样品」：纸/纤维 + 摩尔纹，两模式在侧栏底部切换。只在预览 home 里挂。
- insert:
    - id: dsh-warm-wallpaper
      name: $PKG_DIR/lib/index.js
      config: {}
$END
YAML
    echo "已把动态壁纸样品挂进预览 profile —— 刷新浏览器即可看到（侧栏底部多一行「壁纸」）。"
    ;;
  off)
    if ! present; then echo "本来就是关的，无需改动。"; exit 0; fi
    python3 - "$PATCH" "$BEGIN" "$END" <<'PY'
import sys
path, begin, end = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(path, encoding='utf-8').read().splitlines(keepends=True)
out, skipping = [], False
for line in lines:
    if line.strip() == begin:
        skipping = True
        continue
    if skipping and line.strip() == end:
        skipping = False
        continue
    if not skipping:
        out.append(line)
while out and out[-1].strip() == '':
    out.pop()
text = ''.join(out)
if not text.endswith('\n'):
    text += '\n'
open(path, 'w', encoding='utf-8').write(text)
PY
    echo "已从预览 profile 摘掉动态壁纸样品。"
    ;;
  status)
    if present; then echo "预览实例：动态壁纸样品 开"; else echo "预览实例：动态壁纸样品 关"; fi
    ;;
  *)
    echo "用法：bash toggle-wallpaper.sh on|off|status" >&2
    exit 2
    ;;
esac
