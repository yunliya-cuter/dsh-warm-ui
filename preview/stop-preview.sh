#!/usr/bin/env bash
# 停止隔离预览实例（默认只杀 3082 端口那个，不动你正在用的 3081）。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 共用常量只有一处定义（scripts/ 下），本脚本只调用。
source "$HERE/../scripts/warm-config.sh"

PORT="${PREVIEW_PORT:-$WARM_PREVIEW_PORT_DEFAULT}"

# 端口来自变量，所以匹配式必须**动态拼**：把末位字符写成方括号类（3082 → 308[2]）。
# 这不是花招，是防自杀：pgrep/pkill -f 会匹配到**自己**的命令行，而它此刻含的是
# 字面量 `308[2]`，不匹配正则 `308[2]`（那要求末位是一个 2）—— 于是不会杀掉自己。
# 反过来若直接把端口写成明文，pkill 会连自己一起杀，脚本半途死掉、且报错难查。
# 端口末位本身是数字，构造成 `[...]` 是安全的；非数字末位（不该出现）则退回明文。
last="${PORT: -1}"
head="${PORT%?}"
if [[ "$last" =~ ^[0-9]$ ]]; then
  PATTERN="dsh web --port ${head}[${last}]"
else
  PATTERN="dsh web --port ${PORT}"
fi

if pgrep -f "$PATTERN" >/dev/null 2>&1; then
  pkill -f "$PATTERN"
  sleep 1
  echo "预览实例已停止。"
else
  echo "预览实例本来就没在跑。"
fi
