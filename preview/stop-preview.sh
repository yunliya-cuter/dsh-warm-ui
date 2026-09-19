#!/usr/bin/env bash
# 停止隔离预览实例（只杀 3082 端口那个，不动你正在用的 3081）。
set -euo pipefail
PATTERN="dsh web --port 308[2]"
if pgrep -f "$PATTERN" >/dev/null 2>&1; then
  pkill -f "$PATTERN"
  sleep 1
  echo "预览实例已停止。"
else
  echo "预览实例本来就没在跑。"
fi
