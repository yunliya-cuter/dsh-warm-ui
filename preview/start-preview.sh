#!/usr/bin/env bash
# 启动隔离预览实例（端口 3082，home = /mnt/d/projects/.dsh-warm-preview）。
# 与真实实例（3081 / ~/.dsh）完全隔离：不同的 home、不同的端口、不同的 profile 副本。
#
#   bash /mnt/d/projects/dsh-warm-ui/preview/start-preview.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 共用常量只有一处定义（scripts/ 下），本脚本只调用。
source "$HERE/../scripts/warm-config.sh"

PREVIEW_HOME="${PREVIEW_HOME:-$WARM_PREVIEW_HOME_DEFAULT}"
PORT="${PREVIEW_PORT:-$WARM_PREVIEW_PORT_DEFAULT}"
LOG="$PREVIEW_HOME/server.log"

[ -d "$PREVIEW_HOME/$WARM_PROFILE_SUBDIR" ] || {
  echo "预览 home 还不存在，先跑：bash $HERE/setup-preview-home.sh" >&2
  exit 1
}

bash "$HERE/stop-preview.sh" >/dev/null 2>&1 || true
: > "$LOG"

DSH_HOME="$PREVIEW_HOME" setsid nohup dsh web --port "$PORT" --no-open >>"$LOG" 2>&1 &
disown || true

for _ in $(seq 1 90); do
  grep -q "http://127.0.0.1:$PORT" "$LOG" 2>/dev/null && break
  sleep 1
done

if grep -q "http://127.0.0.1:$PORT" "$LOG"; then
  echo "预览实例已启动（home: $PREVIEW_HOME）"
  grep -o "http://127.0.0.1:$PORT/?token=[A-Za-z0-9_-]*" "$LOG" | head -1
  echo
  echo "日志：$LOG    停止：bash $HERE/stop-preview.sh"
else
  echo "启动失败或超时，日志尾部：" >&2
  tail -20 "$LOG" >&2
  exit 1
fi
