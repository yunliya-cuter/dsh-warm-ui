#!/usr/bin/env bash
# 在「隔离预览实例」里开关品牌文字恶搞彩蛋（dsh-warm-brandgag）。
# 本脚本只动**预览 home**（.dsh-warm-preview）里的那一条；3081 真实实例的 patch 里
# 也挂着这个包，那个不归本脚本管（要改就去改 ~/.dsh/profiles/web/cordis.patch.yml）。
#
#   bash toggle-brandgag.sh on      # 挂上彩蛋
#   bash toggle-brandgag.sh off     # 摘掉彩蛋
#   bash toggle-brandgag.sh status
#
# 加/删条目**不用重启预览**：patch 是热加载的（见 install.sh 头部那段说明），
# 改完刷新一次浏览器页面就生效。只改 brandgag/lib/client.js 也是刷新即热重载。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$HERE/brandgag"
PREVIEW_HOME="${PREVIEW_HOME:-/mnt/d/projects/.dsh-warm-preview}"
PATCH="$PREVIEW_HOME/profiles/web/cordis.patch.yml"
BEGIN="# >>> dsh-warm-brandgag >>>"
END="# <<< dsh-warm-brandgag <<<"
MODE="${1:-status}"

[ -f "$PATCH" ] || { echo "找不到预览 patch：$PATCH" >&2; exit 1; }

present() { grep -qF "$BEGIN" "$PATCH"; }

case "$MODE" in
  on)
    if present; then echo "本来就是开的，无需改动。"; exit 0; fi
    cat >> "$PATCH" <<YAML

$BEGIN
# 品牌文字恶搞彩蛋：deepseek → deepsleep，HARNESS → 狗圈。只在预览 home 里挂。
- insert:
    - id: dsh-warm-brandgag
      name: $PKG_DIR/lib/index.js
      config: {}
$END
YAML
    echo "已把品牌彩蛋挂进预览 profile —— 执行 bash $HERE/start-preview.sh 重启后生效。"
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
    echo "已从预览 profile 摘掉品牌彩蛋 —— 执行 bash $HERE/start-preview.sh 重启后彻底恢复。"
    ;;
  status)
    if present; then echo "预览实例：品牌彩蛋 开"; else echo "预览实例：品牌彩蛋 关"; fi
    ;;
  *)
    echo "用法：bash toggle-brandgag.sh on|off|status" >&2
    exit 2
    ;;
esac
