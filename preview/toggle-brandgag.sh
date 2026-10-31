#!/usr/bin/env bash
# dsh-warm-brandgag 已并入 dsh-warm-ui 单包（2026-10-31）。
#
# 旧版本里这个脚本往预览 profile 的 cordis.patch.yml 单独追加一条 insert；
# 现在主包的 cordis.patch.yml 会用相对路径 entry 自动挂载全部子插件，再单独
# 追加会生成重复 entry（DSH 启动时会出现重复 id / 装配失败）。
#
# 保留本脚本只为让旧命令有明确反馈；不要再恢复下面那套 patch_block_add 逻辑。
set -euo pipefail
echo "dsh-warm-brandgag 已并入 dsh-warm-ui 单包，无需单独开关。" >&2
exit 0
