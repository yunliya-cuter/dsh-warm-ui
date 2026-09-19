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
PREVIEW_HOME="${PREVIEW_HOME:-/mnt/d/projects/.dsh-warm-preview}"
PATCH="$PREVIEW_HOME/profiles/web/cordis.patch.yml"
BEGIN="# >>> dsh-warm-ui >>>"
END="# <<< dsh-warm-ui <<<"
MODE="${1:-status}"

[ -f "$PATCH" ] || { echo "找不到预览 patch：$PATCH" >&2; exit 1; }

present() { grep -qF "$BEGIN" "$PATCH"; }

case "$MODE" in
  on)
    if present; then echo "本来就是开的，无需改动。"; exit 0; fi
    cat >> "$PATCH" <<YAML

$BEGIN
- insert:
    - id: dsh-warm-ui
      name: $SRC_DIR/lib/index.js
      config: {}
$END
YAML
    echo "已把 dsh-warm-ui 插回预览 profile —— 刷新浏览器即可看到暖色。"
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
    echo "已从预览 profile 摘掉 dsh-warm-ui —— 刷新浏览器即回到出厂配色。"
    ;;
  status)
    if present; then echo "预览实例：暖色开（dsh-warm-ui 在 patch 里）"; else echo "预览实例：暖色关（出厂配色）"; fi
    ;;
  *)
    echo "用法：bash toggle-warm-ui.sh on|off|status" >&2
    exit 2
    ;;
esac
