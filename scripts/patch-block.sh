#!/usr/bin/env bash
# dsh-warm-ui 的 patch 片段操作 —— **标记格式与增/删算法各只有这一处定义**。
#
# 背景：profile 的 `cordis.patch.yml` 靠一对注释标记圈出每个包的插入段：
#     # >>> dsh-warm-ui >>>
#     - insert: ...
#     # <<< dsh-warm-ui <<<
# 此前"拼标记串"和"删标记段"散在多个脚本里（早期还有 install.sh / uninstall.sh，
# 现已删除；现存 setup-preview-home.sh + 3 个 toggle 脚本）：
# 删段的 python 算法**逐字重复了三份**（实测 md5 相同），改一次逻辑要同步改四处，
# 漏一处就会出现"装了删不掉"。这里收敛成单一实现，各脚本只调用。
#
# 用法（本文件**不是可执行脚本**，只被 source）：
#   source "$SRC_DIR/scripts/patch-block.sh"

# ── 标记格式：只在下面两个函数里拼串 ────────────────────────────────────────
# 任何"生成标记"或"识别标记"的地方都必须走这两个函数，否则就又出现了第二处格式定义。
patch_marker_begin() { printf '# >>> %s >>>' "$1"; }
patch_marker_end() { printf '# <<< %s <<<' "$1"; }

# 段标记 ID 必须能安全地出现在标记串里；含换行/`#`/`>` 的值会把段结构写坏，
# 而且是那种"看起来写进去了、删的时候匹配不上"的静默故障，所以在入口就拦掉。
_warm_assert_segment_id() {
  case "$1" in
    '' | *[!A-Za-z0-9._-]*)
      echo "非法的 patch 段 id：'$1'（只允许字母/数字/点/下划线/连字符）" >&2
      return 1
      ;;
  esac
}

# ── 存在性判断 ──────────────────────────────────────────────────────────────
patch_block_present() {
  local patch="$1" id="$2"
  grep -qF "$(patch_marker_begin "$id")" "$patch"
}

# ── 追加一个插入段 ──────────────────────────────────────────────────────────
#   patch_block_add <patch 文件> <id> <入口绝对路径> [说明行 ...]
# 说明行可给 0..n 行，每行会写成一条 `# …` 注释（setup-preview-home 给两行，toggle 各给一行或零行）。
# 段前固定留一个空行，与历史输出逐字一致。
patch_block_add() {
  local patch="$1" id="$2" entry="$3"
  shift 3
  _warm_assert_segment_id "$id" || return 1
  {
    printf '\n%s\n' "$(patch_marker_begin "$id")"
    local line
    for line in "$@"; do
      printf '# %s\n' "$line"
    done
    printf -- '- insert:\n'
    printf '    - id: %s\n' "$id"
    printf '      name: %s\n' "$entry"
    printf '      config: {}\n'
    printf '%s\n' "$(patch_marker_end "$id")"
  } >>"$patch"
}

# ── 删除一个或多个插入段 ────────────────────────────────────────────────────
#   patch_block_remove <patch 文件> <tidy|plain> <id> [id ...]
#
# 收尾策略如实保留两种历史行为（**不要合并**，合并会改动既有输出）：
#   tidy  = 压掉连续空行、并拒绝"只有开始标记没有结束标记"的残缺文件（原 uninstall.sh 用；
#           该脚本已删除，此模式保留给需要"宁可不删也不截断"的调用方）。
#           残缺时**不改写文件**并返回非 0 —— 宁可不删，也不把 patch 截断。
#   plain = 只去掉文件尾部空行（3 个 toggle 用）。toggle 历来不给残缺文件报错，
#           保持原样以免影响它们"on/off 幂等"的既有手感。
patch_block_remove() {
  local patch="$1" tidy="$2"
  shift 2
  local id
  for id in "$@"; do
    _warm_assert_segment_id "$id" || return 1
  done
  python3 - "$patch" "$tidy" "$@" <<'PY'
import sys

path, tidy = sys.argv[1], sys.argv[2] == "tidy"
ids = sys.argv[3:]

lines = open(path, encoding="utf-8").read().splitlines(keepends=True)
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

if tidy:
    # 只收拾因摘除留下的多余空行（连续空行压成一个）
    tidied = []
    for line in out:
        if line.strip() == "" and tidied and tidied[-1].strip() == "":
            continue
        tidied.append(line)
    while tidied and tidied[-1].strip() == "":
        tidied.pop()
    # 残缺检查：开始标记还在，说明对应的结束标记没找到 —— 这段没被完整摘掉。
    # 检查**在写文件之前**做，所以残缺时文件一字未动、并返回非 0（宁可不删，也不截断 patch）。
    bad = [i for i in ids if f"# >>> {i} >>>" in "".join(tidied)]
    if bad:
        raise SystemExit(f"片段 {'、'.join(bad)} 没有结束标记，先手工看一眼 {path}")
    # 尾换行是**无条件**补的（历史行为：原本就以换行结尾时，产物会多出一个空行）。
    # 看着像瑕疵，但它是 tidy 模式既有输出的一部分，改动即行为漂移，故照原样保留。
    remaining = "".join(tidied) + "\n"
else:
    # plain 只去掉尾部空行；尾换行**缺了才补**（与 toggle 脚本既有输出逐字一致）。
    while out and out[-1].strip() == "":
        out.pop()
    remaining = "".join(out)
    if not remaining.endswith("\n"):
        remaining += "\n"

open(path, "w", encoding="utf-8").write(remaining)
PY
}

# ── 把文件结尾的连续空行削成一个换行 ────────────────────────────────────────
# 每追加一段前先做这一步，免得与段前那个空行叠成两个（历史行为，保留）。
patch_trailing_newline_normalize() {
  python3 - "$1" <<'PY'
import sys

path = sys.argv[1]
text = open(path, encoding="utf-8").read()
open(path, "w", encoding="utf-8").write(text.rstrip("\n") + "\n")
PY
}
