# tools/ —— 验证与检查

这个目录是"改完怎么确认没改坏"的唯一入口。以前验证散在仓库外的临时目录里
（几十个一次性 `_p*.js`），每次都得重新想起来该看哪里；现在两条命令 + 一份契约。

## 1. 静态检查（零依赖，任何 node 都能跑）

```bash
node tools/check.mjs
```

`--browser` 追加真机断言，`--hmr` 再追加"改一次文件 → 看有没有留下上一代东西"的
热重载回归（会临时往插件源码末尾追加一行注释，跑完逐字节还原；万一被中断，
下一次 `node tools/check.mjs` 会自愈式清掉那个标记）。三者可以一起跑：

```bash
DSH_NODE_EXE="/mnt/c/Program Files/nodejs/node.exe" DSH_URL="http://127.0.0.1:3081/?token=<token>" \
  node tools/check.mjs --browser --hmr
```

查五件事，任何一条不过都会点名到文件与原因：

| 检查 | 在防什么 |
| --- | --- |
| 语法 | 五个半包都能过 `node --check`（历史上热更过一份语法错的包） |
| 样式归属 | 每张样式表都打了 `data-plugin` / `data-plugin-css` —— 不打标的表热重载删不掉，会越积越多并把布局撑坏 |
| 注入登记 | 契约里的每个节点登记项在代码里都有对应表行 |
| 标记名 | 契约里的标记属性都在代码里出现（改名必须同步契约） |
| 挂载入口 | 没有裸的 `document.body/head.append`（页面外层节点必须走 `mountDetached` / `mountLayer` / `installStyleSheet`） |
| 变量闭包 | 每张样式表引用的 CSS 变量都在**本表内**有定义（否则整条声明会被复位成 initial） |
| 玻璃无动效 | 契约说 `glass.motion.state = none` 时，代码里不许再出现流动层的配方 / 噪声原语 / 开关 —— 按一张 15 行的**已删标识符表**逐个查（半删状态过得了 `node --check`，只有这张表拦得住） |
| 底部曲率 | 契约 `glass.curvature` 里的每个设计数字（`slope` / `dispGain` / `bevel` / `shape` …）在代码里正好出现一次；槽位系数必须在登记的地板之上 —— 低于地板就是「把曲率调成看不见」来换可读性；折射路径与槽位表两行也必须在 |
| 悬停判定 | 契约 `glass.pointer`：悬停靠「指针坐标 + `elementFromPoint`」而不是 `:hover`；**真离开只认 `documentElement` 的 `pointerleave`**，窗口失焦走独立处理器、只丢命中缓存并按最后的坐标重算 —— 缺陷写法（`blur` 直接接 `onPointerGone`）不许再出现，它就是「鼠标在输入框上打字却变透明」。手感那一半（底色/模糊真变没变）在 `contract.js` 第 ⑫ 段 |
| 进行中指示 | 契约 `busy`：座位不再画全宽渐隐带、五族行内扫光**整条关掉**（`content:none`）、运行条目前缀的橙点颜色**只有一处定义且不许写回 `:root`**（那一层取不到 `--dsw-*` 语义 token，`var()` 链失效会让整条 `background` 作废 ⇒ 点画出来是透明的，实测过）、闪烁/水波节奏必须等于契约里登记的数字。手感那一半（点真的在、水波真的动、零位移）在 `contract.js` 第 ⑬ 段 |

## 2. 真机断言（需要 Windows 侧 Firefox）

```bash
# 1) 起一个属于我们自己的无头 Firefox（带 Marionette 端口），只杀自己 profile 的实例
cd /mnt/d/projects/_warmtheme_shots && MODE=gpu DPR=1.2 ./_ffup.sh 2828 1752 830

# 2) 跑断言（契约由 harness 注入到页面，探针只负责量）
DSH_NODE_EXE="/mnt/c/Program Files/nodejs/node.exe" \
DSH_URL="http://127.0.0.1:3081/?token=<你的 token>" \
node tools/check.mjs --browser
```

窄屏（插件自己的窄屏形态）也跑一遍：

```bash
"/mnt/c/Program Files/nodejs/node.exe" 'D:\projects\dsh-warm-ui\tools\harness.mjs' \
  eval 'D:\projects\dsh-warm-ui\tools\probes\contract.js' \
  --port 2828 --width 1180 --height 800 --url "$DSH_URL"
```

`--width` 是 **CSS 像素**；插件的窄屏断点是 1240，所以 1180 会落进 `native` 态。

## 3. 探针清单

| 探针 | 用途 |
| --- | --- |
| `probes/contract.js` | 按 `contract/ui-contract.json` 逐条断言（样式归属、节点唯一、脱离文档流、文档不可滚、工具行三态、输入框宽度、底部曲率、悬停判定、进行中指示） |
| `probes/p0-ownership.js` | 快照式体检：把样式表/归属/壁纸/工具行/输入框一次量全（排查用，不做断言） |
| `probes/p0-hmr.js` | 热重载回归：数 `/plugins/events` 的 rebuilt 帧 + 每 3 秒取一次样本（`--hmr` 就是用它） |
| `probes/p0-composer.js` / `p0-composer-set.js` | 量/写 DSH 自己的会话宽度偏好（判断"输入框变宽"到底是谁干的） |
| `probes/engine-glass.js` / `glass-cost.js` | 玻璃的引擎能力矩阵、以及「给 Gecko 补元素级滤镜」这条替代路每帧要付多少（见第 5 节） |
| `probes/curvature.js` | **底部曲率**：把当前卡片用的那条 `url(#…)` 滤镜的 `feImage` **位移图**解回来，逐像素反算 maxd、底边/顶边沿深度 0..24px 的 \|dy\| 剖面、带内每像素衰减（曲率）、透镜尾巴、B 通道弧峰值。这是量「曲率到底降了多少」的唯一口径 —— 按公式复算一遍等于又多一个会漂移的真相。**只在 Chromium 上有意义**（Gecko 不发 `url()`，会返回 `{ error: … }`）：先包成 `(async () => { … })()`，再 `cdp.mjs eval` |
| `probes/dup-chip.js` | 重复胶囊回归：往 `.dpo-controls` 塞一颗**没有归属标记**的同类节点（= 旧版本遗留），每 250ms 数一次 `.wti-chip` —— 应当只在注入那一拍是 2，随后恒为 1 | Firefox：`harness.mjs eval`；Chromium：`cdp.mjs both`（先包成 `(async () => { … })()`） |
| `probes/glass-zombie.js` | 僵尸世代回归：假 loader + 假 ctx 连挂**两代**（`effect` 不给卸载，等价于热重载漏掉了旧实例），在输入卡片上打 120 发指针风暴，按阶段数 DOM 变更、按来源归因（`.wti-chip` 删插 / 属性重复写），最后把 `elementFromPoint` 换成必抛来验"出错自我卸载" | 同上；判定看**静置段**（改完应为 0），另看 `throwOnce`：未被捕获错误 0、`console.error` 恰好 1 条、`__dshWarmExtra.glass.alive === false` |

## 3b. 重拍契约参考截图

```bash
# chip 态（宽屏，空会话）→ contract/refs/toolbar-chip-wide.png
"/mnt/c/Program Files/nodejs/node.exe" 'D:\projects\dsh-warm-ui\tools\harness.mjs' \
  shot 'D:\projects\dsh-warm-ui\contract\refs\toolbar-chip-wide.png' \
  --port 2828 --width 1752 --height 830 --url "$DSH_URL"

# native 态（窄屏，插件的窄屏形态）→ contract/refs/toolbar-native-narrow.png
... shot ... --width 1180 --height 800 ...
```

拍完**必须自己 `read_image` 看一眼**再提交（截图是给人看的证据，不能只信断言）。

## 4. 热重载回归怎么做

**平时用 `node tools/check.mjs --hmr`**（自动改文件 → 等重建 → 取样 → 还原）就够了。
想手工观察时按下面来（约 9 秒出结果）：

```bash
# A) 先把探针挂上（约 9 秒后返回），同时在 B) 里改插件文件触发重建
"/mnt/c/Program Files/nodejs/node.exe" 'D:\projects\dsh-warm-ui\tools\harness.mjs' \
  eval 'D:\projects\dsh-warm-ui\tools\probes\p0-hmr.js' --port 2828 --url "$DSH_URL" &

# B) 两秒后改一次、六秒后再改一次（改动内容随意，只要真变了；改完记得还原）
sleep 2.5; printf '\n/* hmr-touch */\n' >> lib/client.js
sleep 3.5; printf '\n/* hmr-touch */\n' >> preview/wallpaper/lib/client.js
```

**通过标准**：`rebuilt` 帧数 ≥ 1（证明真的热更了），且每一拍样本里
`base / extra / wallpaper` 各为 1、`unownedStyleTags` 为 0、`canvases` 为 1、`overflow` 为 0。

## 5. 玻璃：这台引擎吃不吃 backdrop 里的 SVG 滤镜

玻璃的折射与边缘光都是 SVG 滤镜（`backdrop-filter: url(#…)`），**这台引擎吃不吃**只能真机量
（`contract/ui-contract.md` 第 6 节有结论表）。玻璃本身**不做动效**（原来的「流动层」已删），
所以这一节现在只回答「静止的折射在不在」：

| 探针 | 回答什么 | 怎么跑 |
| --- | --- | --- |
| `probes/engine-glass.js` | 引擎能力矩阵：`backdrop-filter: url(#…)` 与 `filter: url(#…)`，配 `feOffset` / `feImage` / `feTurbulence` 三种配方，各自位移多少 | Firefox：`harness.mjs both <out.png> <probe>`（见第 2 节）；Chromium：`_warmtheme_shots/cdp.mjs both`（探针要先包成 `(async () => { … })()`） |
| `probes/glass-cost.js` | 「给 Gecko 补一条元素级滤镜」这条替代路每帧要付多少（中位帧 33ms → 50ms，所以不做） | 同 Firefox 的 `eval` |

历史上还有一个 `probes/glass-warp.js`（量「流动层」有没有真的在动），它随那一层一起删了；
当时的两个相位参考图留在 `contract/refs/glass-warp-phase-*.png`，只作为「那层长什么样」的历史。

**为什么不在真实卡片上量**：卡片背后是会变的会话内容（两次加载之间它自己就变了，实测
会话区像素差 11.7，比玻璃区还大）；想给它另铺一层底纹也不行 —— 卡片在 app 根的层叠
上下文里，body 级注入的 z-index 再高压住的也是整棵 app，进不了卡片的 backdrop
（实测：条纹盖住了卡片，条纹本身一点没被折射）。

## 6. 契约在哪

`contract/ui-contract.json` 是"UI 应该长什么样"的机器可读版本；`contract/ui-contract.md`
是人读版。**改设计先改契约，再改代码** —— 契约变了，静态检查与真机断言会一起跟着变，
不用去别处找回期望值。

## 7. 硬约束（违反了就是改崩）

1. 不要重启、不要 kill 任何 `dsh web` 进程（agent 的 shell 是它的子进程）。
2. 不要跑 `dsh --dump-config`（会重写 `cordis.yml`）。
3. 不要读/打印 `~/.dsh/.credentials.yaml` 或任何 key。
4. 不要把带 token 的页面地址写进仓库里的任何文件。
5. 截图必须自己 `read_image` 看，不要用像素脚本代替判断。
