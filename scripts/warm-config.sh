#!/usr/bin/env bash
# dsh-warm-ui 脚本层共用常量 —— **只放数据，不放逻辑**。
#
# 为什么要有这个文件：预览 home 路径、profile 子目录、patch 文件名、预览端口，
# 此前分散在 6 个 preview 脚本 / 1 个 python 脚本里各写一遍（预览 home 一处 6 份）。
# 同一个含义写多遍，改一次就得靠记忆去追所有副本，漏掉一处就是"改了端口却停不掉
# 实例"那类静默故障。这里收敛成单一定义。
#
# 注：正式安装现在走 DSH 原生的 `dsh plugin add`（各包自带 dsh.bundle.patch），
# 不再需要从本仓库往 profile 里写片段的 install.sh / uninstall.sh。
#
# 用法（本文件**不是可执行脚本**，只被 source）：
#   source "$SRC_DIR/scripts/warm-config.sh"   # 仓库根的那些脚本
#   source "$HERE/../scripts/warm-config.sh"   # preview/ 下的脚本
#
# 环境变量覆盖优先级：调用方命令行环境 > 本文件的 *_DEFAULT。各脚本仍按原来的方式
# 用 `${VAR:-$WARM_..._DEFAULT}` 取值，所以"能覆盖"这件事没有变化。

# 真 home 与预览 home 内部结构同构，这两段路径是两边的公共部分。
WARM_PROFILE_SUBDIR="profiles/web"
WARM_PATCH_NAME="cordis.patch.yml"

# 预览实例：工作区内的临时 home + 独立端口（与真实 3081/~/.dsh 完全隔离）。
WARM_PREVIEW_HOME_DEFAULT="/mnt/d/projects/.dsh-warm-preview"
WARM_PREVIEW_PORT_DEFAULT="3082"

# 真实实例（agent 自己跑着的那个）。
WARM_REAL_HOME_DEFAULT="$HOME/.dsh"

# 预览脚本备份原 patch 用的后缀。
WARM_BACKUP_SUFFIX=".bak-dsh-warm-ui"
