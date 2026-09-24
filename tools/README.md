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
| 玻璃无动效 | 契约说 `glass.motion.state = none` 时，代码里不许再出现流动层的配方 / 噪声原语 / 开关（想加回来必须先改契约） |

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
| `probes/contract.js` | 按 `contract/ui-contract.json` 逐条断言（样式归属、节点唯一、脱离文档流、文档不可滚、工具行三态、输入框宽度） |
| `probes/p0-ownership.js` | 快照式体检：把样式表/归属/壁纸/工具行/输入框一次量全（排查用，不做断言） |
| `probes/p0-hmr.js` | 热重载回归：数 `/plugins/events` 的 rebuilt 帧 + 每 3 秒取一次样本（`--hmr` 就是用它） |
| `probes/p0-composer.js` / `p0-composer-set.js` | 量/写 DSH 自己的会话宽度偏好（判断"输入框变宽"到底是谁干的） |
| `probes/engine-glass.js` / `glass-cost.js` | 玻璃的引擎能力矩阵、以及「给 Gecko 补元素级滤镜」这条替代路每帧要付多少（见第 5 节） |

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
