#!/usr/bin/env bash
# 卸载 dsh-warm-ui：移除 profile patch 里的片段（幂等）。
#
#   bash /mnt/d/projects/dsh-warm-ui/uninstall.sh
#
# 移除后**刷新一次浏览器页面**即可回到出厂配色（patch 是热加载的，不用重启 dsh web）；
# 插件源码仍留在工作区，随时可以再装回来。
set -euo pipefail

PROFILE_DIR="${DSH_WEB_PROFILE:-$HOME/.dsh/profiles/web}"
PATCH_FILE="$PROFILE_DIR/cordis.patch.yml"

# 与 install.sh 同一张表（id 一一对应）。装了什么就撤什么，顺序无关。
SEGMENT_IDS=(dsh-warm-ui dsh-warm-shared)

[ -f "$PATCH_FILE" ] || { echo "找不到 profile patch 文件：$PATCH_FILE" >&2; exit 1; }

if ! grep -qF "# >>> ${SEGMENT_IDS[0]} >>>" "$PATCH_FILE"; then
  echo "patch 里没有 dsh-warm-ui 片段，无需卸载。"
  exit 0
fi

backup="$PATCH_FILE.bak-dsh-warm-ui-uninstall-$(date +%Y%m%d-%H%M%S)"
cp "$PATCH_FILE" "$backup"

python3 - "$PATCH_FILE" "${SEGMENT_IDS[@]}" <<'PY'
import sys
path, ids = sys.argv[1], sys.argv[2:]
lines = open(path, encoding='utf-8').read().splitlines(keepends=True)
begins = {f"# >>> {i} >>>": i for i in ids}
out, skipping = [], None
for line in lines:
    stripped = line.strip()
    if skipping is None and stripped in begins:
        skipping = begins[stripped]
        continue
    if skipping is not None:
        if stripped == f"# <<< {skipping} <<<":
            skipping = None
        continue
    out.append(line)
for i in ids:
    if f"# >>> {i} >>>" in ''.join(out):
        raise SystemExit(f"片段 {i} 没有结束标记，先手工看一眼 {path}")
# 只收拾因摘除留下的多余空行（连续空行压成一个），并保证以单个换行结尾
tidied = []
for line in out:
    if line.strip() == '' and tidied and tidied[-1].strip() == '':
        continue
    tidied.append(line)
while tidied and tidied[-1].strip() == '':
    tidied.pop()
open(path, 'w', encoding='utf-8').write(''.join(tidied) + '\n')
PY

echo "已移除 patch 片段：${SEGMENT_IDS[*]}（备份：$backup）"
echo "刷新页面即可回到出厂配色（patch 是热加载的，不用重启）。"
