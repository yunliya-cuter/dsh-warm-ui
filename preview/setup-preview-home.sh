#!/usr/bin/env bash
# 在「工作区内的临时 home」里搭一套可交互预览环境：
#   * 复制真实 profile（含 @gbthui/dsh-auto-review、@dsh-external/dsh-prompt-optimizer）
#   * 只写一份最小的 settings.yaml（主题偏好 = 深色）
#   * 把 dsh-warm-ui 以绝对路径插入该 profile 的 patch
# 全程只写工作区内，不碰 ~/.dsh。
#
#   bash /mnt/d/projects/dsh-warm-ui/preview/setup-preview-home.sh
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REAL_HOME="${REAL_DSH_HOME:-$HOME/.dsh}"
REAL_PROFILE="$REAL_HOME/profiles/web"
PREVIEW_HOME="/mnt/d/projects/.dsh-warm-preview"
PREVIEW_PROFILE="$PREVIEW_HOME/profiles/web"

[ -d "$REAL_PROFILE" ] || { echo "找不到真实 profile：$REAL_PROFILE" >&2; exit 1; }

echo "==> 1/5 复制 profile（保留符号链接）"
rm -rf "$PREVIEW_PROFILE"
mkdir -p "$PREVIEW_HOME/profiles"
cp -a "$REAL_PROFILE" "$PREVIEW_PROFILE"
echo "    已复制到 $PREVIEW_PROFILE"

echo "==> 2/5 复制工作区记录 / 会话 / 自定义预设（只读源，写入预览 home）"
rm -rf "$PREVIEW_HOME/storages" "$PREVIEW_HOME/sessions" "$PREVIEW_HOME/.agent-presets"
for item in storages sessions .agent-presets; do
  if [ -e "$REAL_HOME/$item" ]; then
    cp -a "$REAL_HOME/$item" "$PREVIEW_HOME/$item"
    echo "    $item 已复制"
  fi
done

echo "==> 3/5 把发行版 preset 镜像根指向本预览目录"
python3 - "$PREVIEW_PROFILE/cordis.patch.yml" "$PREVIEW_PROFILE/.shipped-presets" <<'PY'
import sys
path, mirror = sys.argv[1], sys.argv[2]
text = open(path, encoding='utf-8').read()
text = text.replace('/home/dsh/.dsh/profiles/web/.shipped-presets', mirror)
text = text.replace('$HOME/.dsh/profiles/web/.shipped-presets', mirror)
open(path, 'w', encoding='utf-8').write(text)
print('    已改写镜像根路径')
PY

echo "==> 4/5 复制 settings.yaml，并写入预览实例专用的模型配置"
cp "$REAL_HOME/settings.yaml" "$PREVIEW_HOME/settings.yaml"
python3 "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/apply-preview-settings.py" "$PREVIEW_HOME/settings.yaml"

echo "==> 5/5 插入 dsh-warm-ui"
if grep -qF "# >>> dsh-warm-ui >>>" "$PREVIEW_PROFILE/cordis.patch.yml"; then
  echo "    已存在，跳过"
else
  cat >> "$PREVIEW_PROFILE/cordis.patch.yml" <<YAML

# >>> dsh-warm-ui >>>
- insert:
    - id: dsh-warm-ui
      name: $SRC_DIR/lib/index.js
      config: {}
# <<< dsh-warm-ui <<<
YAML
  echo "    已插入（源码路径：$SRC_DIR/lib/index.js）"
fi

echo
echo "预览 home 就绪：$PREVIEW_HOME"
