# dsh-warm-ui 界面契约（人读版）

机器可读的那份是 `contract/ui-contract.json`；这里说清"每个状态应该长什么样"，
以及**为什么**是那样。改设计先改这两份，再改代码。

## 1. 注入节点的规矩（三条，全部由 `tools/check.mjs` 守）

1. **样式表必须自己打 `data-plugin`。** 模块加载器只在工厂返回那一刻认领还没打标的
   `<style>`，热重载也只删 `style[data-plugin=<包名>]`。不打标的表既会被后加载的插件
   错认成自己的、又永远删不掉 —— 每加热更一次 `<head>` 里就多一份完整旧表。
   症状：旧表把玻璃滤镜 svg 撑出 255px 高，页面能往下滚，"壁纸跑到页面下面"。
   **实现只有一份**：`preview/shared/lib/client.js` 的 `createStyleInstaller(包名)`
   （见第 5 节）。各包只调用它，不再自己抄一遍。
2. **每个注入节点必须有归属标记。** 属性 `data-dsh-warm-owner`，值 `包名:节点名`；
   语义标记（CSS/探针用）由每个包的登记表 `NODE_OWNERS` 一行给出，字符串只写一遍。
3. **页面外层的节点只能经挂载助手入文档**（`mountDetached` / `mountLayer` /
   `installStyleSheet`）：贴标 → 钉死定位 → 清扫上一代 → append。裸 append 会被静态检查拦下。

### 登记表（一类节点一行）

| 包 | 节点名 | 语义标记 | 定位 | 说明 |
| --- | --- | --- | --- | --- |
| dsh-warm-ui | `glassSvg` | `data-wta-glass-svg` | 内联 `fixed`，0×0 | 玻璃滤镜定义，只有 `<defs>`，不需要可见区域 |
| dsh-warm-ui | `optimizerPop` | `data-dsh-warm-optimizer-pop` | 内联 `fixed` | 档位/权限下拉，left/top 由 `place()` 按需写 |
| dsh-warm-ui | `guardNote` | `data-dsh-warm-guard-note` | 内联 `fixed`（左下角） | **按需**：只在文档真的溢出时出现，出现即代表某条不变量破了 |
| dsh-warm-ui | `collapseChip` | `data-dsh-warm-collapse` | 无（就在工具行里） | 「优化」胶囊，本来就该参与排版 |
| dsh-warm-wallpaper | `layer` | `data-dsh-warm-wallpaper-layer` | 内联 `fixed` 铺满，`z-index:-1` | 壁纸画布 |

**为什么定位要写内联**：`width="0" height="0"` 这类表现属性在 CSS 里是最低一档，
任何样式规则都能盖掉它（包括热更残留的旧表）。一旦被盖出尺寸，覆盖层就变成文档末尾
一块看不见的空白 —— 页面能滚下去、壁纸露在下面。内联永远赢样式表。

## 2. 工具行三态（`body[data-dsh-warm-dpo]`）

断点**只在第三方插件里**，我们不写媒体查询（写两份迟早对不上）。我们读它渲染出来的
DOM，把结果写到 body 属性上：

| 状态 | 条件 | 期望外观 |
| --- | --- | --- |
| `chip` | 插件渲染出滑杆（宽屏） | 我们的「优化」胶囊在（24px 高），插件两根滑杆都藏起来 |
| `native` | 插件渲染出 `[data-dpo="tier-collapsed"]`（窄屏） | 我们的胶囊不在，权限滑杆藏起来，档位用它自己的窄屏形态 |
| `fallback` | 认不出插件 DOM | 一切原样，我们的胶囊不在（绝不留下点不动的空壳） |

行高 24px 只在 `chip` 态断言（那是我们定的形态）。

### 参考截图（refs/）

| 文件 | 状态 | 怎么拍的 |
| --- | --- | --- |
| `refs/toolbar-chip-wide.png` | `chip`（1752×745 CSS） | `tools/harness.mjs shot ... --width 1752 --height 830` |
| `refs/toolbar-native-narrow.png` | `native`（1180×715 CSS） | `tools/harness.mjs shot ... --width 1180 --height 800` |

两张都是**空会话**页，能同时看到：工具行形态、卡片宽度、壁纸正常。
`fallback` 态没有参考图 —— 它要求把第三方的 DOM 弄坏才复现，属于"出问题时的样子"，
由真机断言（`chipVisible === false`）守。

改设计之后重拍这两张，并把新图连同契约一起提交。

## 3. 输入框宽度：跟着 DSH 自己的偏好走

卡片宽度**不是我们定的**。DSH 的算法（`dsh-client-ui-conversation/lib/client.js`）：

```
--dsh-chat-user-width   = clamp(偏好, 640, 列宽 - 176)      # 有偏好时
                        = clamp(列宽 * 0.64, 680, 920)      # 没有偏好时
--dsh-composer-card-max-width = --dsh-chat-user-width + 32
```

- 偏好键：`localStorage["dsh.conversation.contentWidth"]`（拖动会话宽度手柄才会写）。
- 没有偏好时上限就是 `920 + 32 = 952px`，与会话正文列同宽（正文列也用它）。
- **实测**（2026-09-19，真 Firefox）：
  - 无偏好、窗口 1752 → 卡片 952px；
  - 偏好 1200、窗口 1752（列宽 1472）→ 卡片 1232px = 1200 + 32；
  - 同一份偏好 1200、窗口 1200（列宽 920）→ 卡片 776px = (920 − 176) + 32。

也就是说：**"进了 plan 模式输入框变宽"= 同一份偏好被更宽的可用列放了出来**，
不是插件干的（插件不写这两个变量、也没有任何一条宽度规则）。
要回到默认宽度：把宽度手柄拖回去，或者在控制台执行

```js
localStorage.removeItem("dsh.conversation.contentWidth"); location.reload();
```

## 4. 全局不变量（真机断言）

| 不变量 | 期望 | 为什么 |
| --- | --- | --- |
| 文档溢出 | 0px | 一旦能滚，壁纸就会露在页面下面 |
| 每张样式表份数 | 1 | 热更残留会互相抢规则 |
| 无主样式表（没 `data-plugin`） | 0 | 那些表热重载删不掉 |
| 每个登记节点份数 | 1（按需节点为 0） | 两代节点同时存在会导致"守卫对着上一代读问题" |
| `missingCssVars` | 空 | 未定义又没兜底的变量会让整条声明被复位 |
| `layoutGuard` | 无 | 它一出现就说明上面某条破了 |

## 5. 共享代码与依赖方向（`dsh-warm-shared`）

被两个以上包用到的**平台约定**放在 `preview/shared`（包名 `dsh-warm-shared`），不在各包抄一遍：

| 共享的东西 | 为什么必须是同一份 |
| --- | --- |
| `createStyleInstaller(包名)` | 第 1 节的三件套；抄错一次就是"样式表删不掉/被错认"，两个线上 bug 都出在这里 |
| `cssPropertyName` | camelCase → kebab 的命名规则：内联样式与生成的 CSS 必须用同一条规则，否则表里和 DOM 里对不上 |

依赖方向**单向**：`dsh-warm-ui` / `dsh-warm-wallpaper` → `dsh-warm-shared`（不允许反向、不允许环）。
声明一条依赖要**三处同时改**，`tools/check.mjs` 的「共享依赖」一条逐条核对：

1. 代码：工厂体里 `require("dsh-warm-shared")`；
2. 本包 `package.json`：`dsh.client.external: ["dsh-warm-shared"]`（宿主据此把依赖行排在本包之前）；
3. 契约：`packages.<包>.requires: ["dsh-warm-shared"]`。

同一条检查还会拦下"依赖方又自己实现一遍注入三件套"（代码里再出现 `dataset.plugin =`）。

**不放进共享包的东西**：`NODE_OWNERS` 登记表、`pinOverlay`/`pinLayer`、`sweepOwned`/`sweepLayers`、
`checkCssVars` —— 它们看着像，但每个包的清扫副作用不同（壁纸要顺带清渲染器缓存），
硬抽一层只会多一层间接。共用的**约定**写在契约里，代码保持各包自洽。

## 6. 液态玻璃的「流动层」（`GLASS_WARP`）

玻璃底下看到的东西除了被折射掰弯，还会**缓慢地游动**。用户的要求原话是
"能看清字，但要明显看得出在动" —— 静止的折射只有一个歪掉的像，读起来是一块板子。

数据只在 `GLASS_WARP` 表里（machine 版在 `ui-contract.json` 的 `glass.warp`）：

| 字段 | 值 | 含义 |
| --- | --- | --- |
| 配方 | `ripple` | 表的一行；换一种流动 = 加一行 |
| `amp` | 4.2px | 额外位移的峰值（叠在折射上；噪声波长约 180px，所以是缓波不是抖动） |
| `period` | 9s | 一次完整流动的秒数 |
| `fps` | 20 | 每拍要让浏览器重跑一遍滤镜链，所以**故意低频** |
| `ampSwing` / `freqSwing` | 0.6 / 0.45 | 幅度与噪声频率各自摆动的比例（两条错相，才像流动） |

### 三道门（`tools/check.mjs` 的「动效门槛」守着）

1. **系统设置**：`prefers-reduced-motion: reduce` 时驱动不写属性；
2. **开关**：`localStorage['dsh-warm-x-glassWarp'] = 0`（`EXTRA_DEFAULTS` 里的一行），改完刷新页面；
3. **引擎列**：`GLASS_BACKDROP_ENGINES[].warp` 逐行表态，契约的 `glass.warp.engineSupport`
   是它的对照表 —— 加一条引擎配方就**被迫**回答一次"这台引擎能不能做流动层"。

**关掉时不给滤镜链加任何原语**（不是"加一条幅度 0 的位移"）：画面与没有这一层时逐像素相同。

### 为什么 Firefox 没有这一层（实测，不是猜）

| 滤镜挂在哪 | Chromium（无头 Edge） | Firefox 154（无头） |
| --- | --- | --- |
| `backdrop-filter: url(#…)` | ✓ `feOffset` +12.00px、`feImage` −12.00px、`feTurbulence` 打乱图案 | ✗ **三种配方全部 0px** |
| `filter: url(#…)`（元素自身） | ✓ | ✓（`feImage` 要给 `xlink:href`，只写 `href` 等于没有图源） |

量法：`tools/probes/engine-glass.js`（同一张竖条纹，压了玻璃的那块相对没压的那块位移多少）。
Firefox 唯一的替代路是"把带限位移挂在会话内容那个大元素上"，实测每帧多花 ≥17ms
（`tools/probes/glass-cost.js`：中位帧 33ms → 50ms，而只要挂着就付这个钱），
会把滚动帧率砍半 —— 所以**不做**，Firefox 的玻璃保持静止的折射。

Chromium 侧"确实在动"怎么验：`tools/probes/glass-warp.js` 把**插件自己那条滤镜**挂到
探针自造的一块条纹上（父子关系保证条纹真在 backdrop 里），两次不同时刻的截图做差分；
参考图 `refs/glass-warp-phase-a.png` / `-b.png`。注意真实卡片**量不了**：它背后是会变的
会话内容，而给它另铺底纹也不行（卡片在 app 根的层叠上下文里，body 级注入的 z-index 压得住
整棵 app，却进不了卡片的 backdrop）。

| 参考图 | 截图那一刻的驱动值（`readable.after`） | 两次之间的差异（夹具区 900×140） |
| --- | --- | --- |
| `refs/glass-warp-phase-a.png` | `baseFrequency` 0.003287 / `scale` 8.100 | 平均像素差 13.32；5.2% 的像素差 >8；逐窗口位移差 −2…+2 px |
| `refs/glass-warp-phase-b.png` | `baseFrequency` 0.006667 / `scale` 5.738 | （同上，两图互为对照） |

两次跑的相位是"距挂载多少秒"决定的，所以每次复跑的数值会变（另一次收尾复跑：7.88 / 3.1%）。
**关键是同一对截图里的对照区**（`60,600,300,714`，没有玻璃）差 0.02 / 0.0% —— 说明两次加载
除了夹具之外逐像素相同，夹具那点差异只可能来自流动层。

> **量这个的时候别踩的坑**：夹具是借用**插件的真滤镜**，而那条滤镜是按**另一个元素**的尺寸
> 建的（卡片），两次加载之间卡片高度可能差几像素 → 静态折射跟着变一点 → 夹具上**到处**都有
> 几个像素的差（连玻璃最外圈也有，实测 15 上下）。所以"带内相位差"**不能**用来判断
> 边缘干不干净 —— 那件事要靠下面这张对照图 + 遮罩图素值（边缘 0 / 中心 255，实测）。

### 边缘不能加噪声（`edgeMask`，2026-09-19 用户报「玻璃边缘有奇怪的条纹」）

位移要**采样 backdrop**，而 backdrop 只有元素框以内那一块。噪声是双向位移，靠边的地方
"朝外"那半边会采到框外 —— 浏览器只能把框外的采样夹到最近的一行/一列，于是那一条带上的
背景被**重复拉伸**。用户截图里"任务 10 已完成"这条**在玻璃上方**的文案被拖进了玻璃内部，
就是它；玻璃上沿尤其明显，因为玻璃正压在会话文字上。（静态折射没这个问题：它的位移方向
本来就朝玻璃内部。）

修法：`buildGlassMap` 顺手按**几何**生成一张 1/4 分辨率的灰度遮罩（框边 0、离框
`max(bevel, amp × fadeFactor)` px 以内 1），像地图一样挂进滤镜，再用一条 `feComposite
arithmetic`（`0.5 + 遮罩×(噪声−0.5)`）把噪声乘进去。框边那一圈**一点噪声都不加**，
中间照旧流动。顺带玻璃那圈锐利高光也不再被噪声糊掉。

| 参考图 | 是什么 |
| --- | --- |
| `refs/glass-edge-mask-off.png` | 修复前（`ab52799`，还没有遮罩）：上沿 3× 放大 —— 棋盘格最上面一行被拉成一条**连续白带** |
| `refs/glass-edge-mask-on.png` | 修复后：同一位置是**干净的棋盘格**，只有静态折射的轻微弯折 |

