#!/usr/bin/env bash
# 在「工作区内的临时 home」里搭一套可交互预览环境：
#   * 复制真实 profile（含 @gbthui/dsh-auto-review、@dsh-external/dsh-prompt-optimizer）
#   * 只写一份最小的 settings.yaml（主题偏好 = 深色）
#   * 把 dsh-warm-ui 单包以 link 依赖挂进 profile 的 bundles
#     （单包内部会一次带出 shared / wallpaper / brandgag 四个 entry）
# 全程只写工作区内，不碰 ~/.dsh。
#
#   bash /mnt/d/projects/dsh-warm-ui/preview/setup-preview-home.sh
#
# 可用环境变量覆盖：REAL_DSH_HOME（真实 home）、PREVIEW_HOME（预览 home）。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(cd "$HERE/.." && pwd)"
# 共用常量 / patch 片段操作各只有一处定义（scripts/ 下），本脚本只调用。
source "$SRC_DIR/scripts/warm-config.sh"

REAL_HOME="${REAL_DSH_HOME:-$WARM_REAL_HOME_DEFAULT}"
REAL_PROFILE="$REAL_HOME/$WARM_PROFILE_SUBDIR"
# 注：这一行此前**写死**成工作区路径、连覆盖都不允许（没有 `:-` 默认值），与其它 4 个
# 预览脚本"可覆盖"的写法不一致。现在统一成 `${PREVIEW_HOME:-默认}`：默认值一字未变，
# 但 PREVIEW_HOME 从此可覆盖 —— 这是**行为变化**（此前传了也会被这行覆盖掉），
# 登记在此以免将来被当成 bug 回退。
PREVIEW_HOME="${PREVIEW_HOME:-$WARM_PREVIEW_HOME_DEFAULT}"
PREVIEW_PROFILE="$PREVIEW_HOME/$WARM_PROFILE_SUBDIR"

[ -d "$REAL_PROFILE" ] || { echo "找不到真实 profile：$REAL_PROFILE" >&2; exit 1; }

echo "==> 1/5 复制 profile（保留符号链接）"
rm -rf "$PREVIEW_PROFILE"
mkdir -p "$(dirname "$PREVIEW_PROFILE")"
cp -a "$REAL_PROFILE" "$PREVIEW_PROFILE"
echo "    已复制到 $PREVIEW_PROFILE"

echo "==> 1.5/5 迁移旧的多包 warm 依赖（单包 bundle 已内置 shared / wallpaper / brandgag）"
python3 - "$PREVIEW_PROFILE/package.json" <<'PY'
import json, sys
path = sys.argv[1]
with open(path, encoding="utf-8") as f:
    manifest = json.load(f)
for name in ("dsh-warm-shared", "dsh-warm-wallpaper", "dsh-warm-brandgag"):
    manifest.get("dependencies", {}).pop(name, None)
    profile = manifest.setdefault("dsh", {}).setdefault("profile", {})
    profile["bundles"] = [item for item in profile.get("bundles", []) if item != name]
with open(path, "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)
    f.write("\n")
PY
for name in dsh-warm-shared dsh-warm-wallpaper dsh-warm-brandgag; do
  rm -f "$PREVIEW_PROFILE/node_modules/$name"
done

echo "==> 2/5 复制工作区记录 / 会话 / 自定义预设（只读源，写入预览 home）"
rm -rf "$PREVIEW_HOME/storages" "$PREVIEW_HOME/sessions" "$PREVIEW_HOME/.agent-presets"
for item in storages sessions .agent-presets; do
  if [ -e "$REAL_HOME/$item" ]; then
    cp -a "$REAL_HOME/$item" "$PREVIEW_HOME/$item"
    echo "    $item 已复制"
  fi
done

echo "==> 3/5 把发行版 preset 镜像根指向本预览目录"
# patch 里的镜像根有两种历史写法，都要改写：
#   ① 绝对路径（旧版本写死用户名，本机是 /home/dsh/.dsh/...）
#   ② 字面量 `$HOME/.dsh/...`（YAML 里就是这串字符，不展开）
# 两者都从 REAL_HOME 派生，而不是写死 —— 写死用户名在本机凑巧成立，换个 home 就静默
# 改不中，patch 里会留下一条指向不存在目录的镜像根（故障现象是预设列表为空）。
REAL_MIRROR="$REAL_PROFILE/.shipped-presets"
# `${REAL_HOME#"$HOME"}` 自带前导斜杠（本机得到 `/.dsh`），所以这里**不再补斜杠**。
REAL_MIRROR_HOME="\$HOME${REAL_HOME#"$HOME"}/$WARM_PROFILE_SUBDIR/.shipped-presets"
python3 - "$PREVIEW_PROFILE/$WARM_PATCH_NAME" "$PREVIEW_PROFILE/.shipped-presets" \
        "$REAL_MIRROR" "$REAL_MIRROR_HOME" <<'PY'
import sys
path, mirror, real_abs, real_tilde = sys.argv[1:5]
text = open(path, encoding='utf-8').read()
for src in (real_abs, real_tilde):
    if src != mirror:
        text = text.replace(src, mirror)
open(path, 'w', encoding='utf-8').write(text)
print('    已改写镜像根路径')
PY

echo "==> 4/5 复制 settings.yaml，并写入预览实例专用的模型配置"
cp "$REAL_HOME/settings.yaml" "$PREVIEW_HOME/settings.yaml"
python3 "$HERE/apply-preview-settings.py" "$PREVIEW_HOME/settings.yaml"

echo "==> 5/5 确认 dsh-warm-ui 单包已挂进预览 profile"
python3 - "$PREVIEW_PROFILE/package.json" "$SRC_DIR" <<'PY'
import json, sys
path, src = sys.argv[1:3]
with open(path, encoding="utf-8") as f:
    manifest = json.load(f)
deps = manifest.setdefault("dependencies", {})
deps["dsh-warm-ui"] = "link:" + src
profile = manifest.setdefault("dsh", {}).setdefault("profile", {})
bundles = profile.setdefault("bundles", [])
if "dsh-warm-ui" not in bundles:
    bundles.append("dsh-warm-ui")
with open(path, "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)
    f.write("\n")
PY
mkdir -p "$PREVIEW_PROFILE/node_modules"
rm -rf "$PREVIEW_PROFILE/node_modules/dsh-warm-ui"
ln -s "$SRC_DIR" "$PREVIEW_PROFILE/node_modules/dsh-warm-ui"
echo "    已挂载 $SRC_DIR（单包含 shared / wallpaper / brandgag）"

echo
echo "预览 home 就绪：$PREVIEW_HOME"
