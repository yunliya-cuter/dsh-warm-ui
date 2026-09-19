#!/usr/bin/env bash
# 把 dsh-warm-ui 接到 web profile 上（幂等；只改一个 patch 文件，不动 node_modules）。
#
#   bash /mnt/d/projects/dsh-warm-ui/install.sh
#
# 装的是**两个**包、按顺序追加：共享包在前、主题包在后（主题的客户端代码 require 共享包）。
# 动态壁纸与文字彩蛋不在本脚本范围内（它们是可选的预览包，各自用预览脚本挂）。
#
# web profile 的 patch 是**热加载**的（profiles/web/package.json 的 dsh.profile.patchReload: "live"，
# 由 dsh-app-boot 的 watchUserPatches 用 cordis HMR 盯着），所以写完刷新一次浏览器页面就生效，
# **不用重启 dsh web**。
# 例外只有一个：改包的 `dsh.client` 清单（例如加 external）要重启才会被重新读取 ——
# 宿主把包元数据缓存在内存里（dsh-client-modules 的 pkgMeta），换 patch 不会让它重读 package.json。
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE_DIR="${DSH_WEB_PROFILE:-$HOME/.dsh/profiles/web}"
PATCH_FILE="$PROFILE_DIR/cordis.patch.yml"

# 一段 = `id|入口（相对仓库）|写在段首的说明`。加一个要装的包 = 加一行。
# 顺序有意义：被依赖的排前面。
SEGMENTS=(
  "dsh-warm-shared|preview/shared/lib/index.js|暖色插件族共用的浏览器侧工具（样式表注入三件套 / 属性名转换）。被主题包依赖，必须排前面。"
  "dsh-warm-ui|lib/index.js|暖色调 + 输入栏工具行整形。源码在工作区：$SRC_DIR"
)

[ -f "$SRC_DIR/lib/index.js" ] || { echo "找不到插件入口：$SRC_DIR/lib/index.js" >&2; exit 1; }
[ -f "$PATCH_FILE" ] || { echo "找不到 profile patch 文件：$PATCH_FILE" >&2; exit 1; }

for segment in "${SEGMENTS[@]}"; do
  IFS='|' read -r id rel comment <<<"$segment"
  entry="$SRC_DIR/$rel"
  [ -f "$entry" ] || { echo "找不到插件入口：$entry" >&2; exit 1; }
  if grep -qF "# >>> $id >>>" "$PATCH_FILE"; then
    echo "patch 片段已存在，跳过：$id"
    continue
  fi
  if [ ! -f "$PATCH_FILE.bak-dsh-warm-ui" ]; then
    cp "$PATCH_FILE" "$PATCH_FILE.bak-dsh-warm-ui"
    echo "已备份原 patch：$PATCH_FILE.bak-dsh-warm-ui"
  fi
  # 先削掉文件末尾的空行，免得和下面 heredoc 开头的空行叠成两个
  # （注意**先读完再打开写**：`open(path,"w")` 会立刻截断文件）
  python3 - "$PATCH_FILE" <<'PY'
import sys
path = sys.argv[1]
text = open(path, encoding='utf-8').read()
open(path, 'w', encoding='utf-8').write(text.rstrip('\n') + '\n')
PY
  cat >> "$PATCH_FILE" <<YAML

# >>> $id >>>
# $comment
# 想恢复原样：删除本段（含上下两行标记）即可；或直接跑 uninstall.sh。
- insert:
    - id: $id
      name: $entry
      config: {}
# <<< $id <<<
YAML
  echo "已写入 patch 片段：$id"
done

echo
echo "接下来：在浏览器刷新一次页面即可看到暖色调与整形后的输入栏（patch 是热加载的，不用重启）。"
echo "撤销：bash $SRC_DIR/uninstall.sh"
