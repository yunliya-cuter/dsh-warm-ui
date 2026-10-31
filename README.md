# dsh-warm-ui

> 一个 [DSH（DeepSeek Harness）](https://github.com/deepseek-ai) Web GUI 客户端插件包：
> **暖色主题** + **液态玻璃材质** + **输入栏工具行整形** + **动态壁纸** + **品牌彩蛋**。

给 DSH Web GUI 换一套**暖色调**，并把输入栏工具行里那簇第三方控件**压扁、对齐、去发光**。
这是一个**单包多插件**的 bundle：暖色系列的全部 4 个插件都随 `dsh-warm-ui` 一起发布、一起挂载。

- 暖色：整站色阶从冷蓝灰换成暖褐灰，强调色从品牌蓝换成暖琥珀；明暗两套主题同时生效。
- 整形：输入栏里 `prompt-optimizer` 的两个滑杆 + 档位胶囊 + 模型胶囊 + 帮助圆钮，改成 24px 高、
  无发光、无胶囊底色的一组安静控件，并在它与左侧 DSH 原生「访问模式」之间加一条发丝分隔线。
- 动效：输入框里是**弹簧光标**（打字常亮、停手 500ms 才闪、横移是滑过去而不是瞬移）+
  框内与正文的**选区高亮**（位置/宽度弹簧驱动）；颜色从当前主题的强调色派生，浓度一个变量可调，
  外观面板里有「动效 关/开」。尊重系统「减少动态效果」，关掉即完全回到浏览器原生。
- 玻璃：输入卡片/菜单的折射、边缘光、表面反射（Chromium 独有；Firefox 平台不支持 SVG 滤镜
  作为 backdrop，那里只有 blur/tint。见 `contract/ui-contract.md` 第 6 节）。

## 环境要求

| 项 | 要求 |
| --- | --- |
| DSH | `>=0.1.7-rc.2 <0.3.0`（实测于 `0.1.7-rc.2` 与 `0.2.1-rc.3`） |
| profile | `web`（本插件只在 Web GUI 里有意义） |
| 浏览器 | Chromium 系（玻璃效果）；Firefox 可用但无折射层 |
| 运行时依赖 | [`dsh-warm-shared`](#它依赖什么) 已作为子包随本包发布，**不需要单独安装** |

`peerDependencies` 里声明了两个宿主框架包作为**能力来源**（不是硬性安装要求，DSH 自带）：

| peer | 用途 |
| --- | --- |
| `@deepseek-ai/dsh-client-ui-theme` | `ctx.theme.overrideTokens` —— 暖色 token 的写入通道 |
| `@deepseek-ai/dsh-client-ui-slots` | `sidebar.footer.action` —— 左下角「外观」换档面板 |

> 只有以 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 开头的 peer 会被 DSH 做版本校验
> （见 `dsh-app-boot` 的 `evaluatePluginCompatibility`），所以上面这两条是**声明意图 + 让
> 版本不匹配时 DSH 能提前告警**，不会挡住安装。

## 它导出什么

| 入口 | 文件 | 说明 |
| --- | --- | --- |
| `.` | `lib/index.js` | **host 半边**：空插件，只为了让 loader 有一条 entry（`dsh-client-modules` 按 loader entry 扫描 `dsh.client` 声明，没有它就不会有客户端模块） |
| `./client` | `lib/client.js` | **浏览器半边**：全部实际行为都在这里 |
| `./cordis.patch.yml` | `cordis.patch.yml` | 包自带的组合补丁层，声明暖色系列 4 个 loader entry |
| `./package.json` | `package.json` | |

`dsh.bundle.patch` 指向包内的 `cordis.patch.yml`，这是 DSH **标准插件包**的挂载方式
（与 `@gbthui/dsh-auto-review`、`@dsh-external/dsh-prompt-optimizer` 同一写法）——
装完由 DSH 自己把包名写进 profile 的 bundles，用户不需要手改配置。

`dsh-warm-ui` 不只是主题本体：它是一个**单包多插件 bundle**。`package.json` 的 `files`
同时发布 `preview/shared`（共享模块）、`preview/wallpaper`（动态壁纸）、
`preview/brandgag`（品牌彩蛋）；`cordis.patch.yml` 用相对路径 entry 把这几个子包
一起插进组合树。所以安装/卸载永远只面对一个包名：`dsh-warm-ui`。

## 为什么没有构建步骤

**源码就是产物。** 这个仓库**没有** `tsconfig` / rollup / vite / esbuild / tsup 任何构建配置，
也不需要 —— DSH 的客户端 bundle 是**按请求逐字节读盘**的（实测：从 `lib/client.js` 取的原文
片段在服务器返回的 bundle 里 100% 命中），格式本身就是平台要求的
`window.__ModuleLoader__.load({ id, factory })` 工厂式 CJS。

所以：**clone 下来即可用，不必 build**。改动 `lib/client.js` → 刷新浏览器即生效。

## 它依赖什么

`dsh-warm-shared`（同仓库 `preview/shared/`）是**必需的**运行时依赖，它只有 97 行、导出 2 个函数
（`createStyleInstaller` / `cssPropertyName`），被收拢在这里的理由是**一个真实线上 bug**：
样式表必须打上 `data-plugin` / `data-plugin-css` 标记，漏掉会导致热重载删不掉旧表，
旧表把玻璃滤镜 svg 撑出 255px，用户看到的就是「壁纸跑到页面下面」。实现只有一份，
消费方就不能各抄一遍。它现在作为 `dsh-warm-ui` 的包内子目录一起发布，不再要求用户
额外安装一条 `#path:preview/shared` spec。

一条依赖要在**三处同时成立**（`node tools/check.mjs` 的「共享依赖」一条会核对）：

1. 代码：工厂体里 `require("dsh-warm-shared")`；
2. 清单：本包 `package.json` 的 `dsh.client.external`（宿主靠它把依赖行排在本包之前）；
3. 契约：`contract/ui-contract.json` 的 `requires`。

## 它还改了什么（技术细节）

> 液态玻璃的折射与"流动层"（玻璃底下的内容持续轻微游动）写在
> `contract/ui-contract.md` 第 6 节：数字、三道门、以及**为什么 Firefox 没有这一层**（实测）。

### 1. 暖色：叠一层 theme token

DSH 的配色是两级变量：`--dsw-static-*`（色阶）→ `--dsw-alias-*`（语义别名）。别名基本都写成
`var(--dsw-static-…)`，所以只替换三条色阶就能带动整站：

| 覆盖的色阶 | 原值 | 现值 |
| --- | --- | --- |
| `--dsw-static-neutral-bluish-*` | 冷蓝灰（`#151517` / `#2c2c2e` …） | 暖褐灰（`#17130e` / `#2d261e` …） |
| `--dsw-static-neutral-*` | 纯灰（行内代码、滚动条） | 暖灰 |
| `--dsw-static-deepseek-*` | 品牌蓝（发送按钮、滑杆、链接） | 暖琥珀 / 赤陶 |
| `--shiki-token-*`（样式表内） | 冷色语法高亮 | Gruvbox 取向的暖色语法高亮 |

写入走官方扩展点 `ctx.theme.overrideTokens(source, tokens)`（theme 服务会把值写成 `body`
上的内联样式，稳定压过基础样式表，并与明暗主题切换自动重组）。DSH 升级后这套接口仍在，插件不会失效。

### 2. 输入栏整形：一张作用域受限的样式表

只作用于输入栏里的 `.dpo-controls`（即 `prompt-optimizer` 在工具行里渲染的那一簇），
插件自己的浮层 / 弹窗不受影响。用双写类名（`.dpo-controls.dpo-controls`）抬特异性，
稳压插件自带的媒体查询断点。

窄窗口下两个滑杆原本会被挤扁、滑块越界压到相邻按钮，所以宽屏（≥1241px）把「档位 / 权限」
收进一颗 24px 的**「优化」胶囊**，点开是一个向上展开的小弹层（内部点击仍转发给插件原本的
刻度按钮，状态机与落盘完全照旧）；选完一项弹层立即收起，点空白处或按 Esc 也会收起。
≤1240px 时胶囊让位给插件自带的窄屏形态，同样没有滑杆可被挤扁。
万一插件的 DOM 结构变了、探测不到刻度按钮，插件会自动退回原样（滑杆回来、胶囊隐藏），
不会留下一个点不动的空壳。

### 3. 动效层：弹簧光标 + 选区高亮

一张独立样式表（MOTION_STYLESHEET，标记 data-dsh-warm-motion）+ 一个独立引擎
（createMotionApi），挂在 body[data-wta-motion] 下。关掉开关时引擎整个销毁：
图层移除、两个属性摘掉，原生光标与原生选中色立刻回来。

**做什么**

| 场景 | 行为 |
|---|---|
| 光标 | 自绘 2px 竖条，横向位置由弹簧驱动（response 0.3s、临界阻尼不过冲）；打字期间常亮，停手 500ms 后按 1.06s 周期闪 |
| 框内选区 | 位置与宽度弹簧（0.2s，拖选 0.1s）、透明度 0.12s 淡入；跨行时每行各自一块 |
| 正文选区 | 同上，覆盖整页；被包住的嵌套矩形会去掉，上限 200 块 |

范围是**全站所有可编辑区**：textarea、单行 input、[contenteditable]（DSH 的输入框是 Lexical
contenteditable）。单行/多行输入框走「隐形镜面」量取（同字体同内边距的隐藏 div + Range 矩形），
contenteditable 直接量 Selection。

**为什么高亮不会把字染色**

自绘层画在文字**上面**（不重排宿主 DOM），靠 mix-blend-mode 把它变成"垫在下面"的观感：
亮色主题 multiply（白底压成暖米色，深字几乎不变）、暗色 screen（暗底提亮，亮字几乎不变）。
3082 实测：选中前后文字色只差 +2~3 级，而原生蓝色选中会让文字 +20 级。

**颜色从哪来**

--wta-motion-sel-fill = color-mix(in srgb, var(--dsw-alias-state-business-primary)
var(--wta-motion-sel-strength), transparent)。强调色由暖色 token 提供（暖琥珀），所以换暖度档位、
换明暗主题都会自动跟随。浓度只有 --wta-motion-sel-strength 一个旋钮（默认 34%，是在真实暖色
对话框上对比 18 / 26 / 34 / 42 四档定的）。

**改这张表/这段代码前必须知道的两件事**（都踩过）

1. 图层必须是 display: contents。position: fixed 的包裹层会被浏览器单独合成，内层
   mix-blend-mode 的"背景"变成透明的自己 —— 高亮退化成一块盖住文字的不透明色块
   （实测：整行只剩一个 RGB 值，字全被吃掉）。
2. ::selection 的开关属性挂在 <html> 上，所以那条规则**不能**写成
   body[...] [data-wta-motion-sel] ::selection —— <html> 不是 body 的后代，规则永远不匹配，
   结果是自绘高亮和原生蓝叠成两层（3082 实测）。

**自检口**

```js
window.__dshWarmMotion.get()          // { enabled, layer, engine }
window.__dshWarmMotion.diagnostics()  // { mode, boxes, paintedRects, caret, nativeSel, error }
window.__dshWarmMotion.set(0)         // 等价于点外观面板里的「关」
```

**降级**：prefers-reduced-motion: reduce 时引擎不接管（CSS 也把图层 display:none），
两个方向都监听 change；任何一步抛错都会摘掉属性退回原生，不会出现"没有光标"的输入框。

## 定稿的默认值（2025-09-13 评审结果）


配色是一轮轮在隔离预览里挑出来的，最终烧死成下面这几个默认值；每一档都能用
`localStorage` 临时改（键名见表），不用重新构建：

| 维度 | 默认 | localStorage 键 | 说明 |
| --- | --- | --- | --- |
| 面亮 | 0 夜间 | `dsh-warm-surface` | 白天把底色整体抬亮，见下 |
| 暖度 | 3 中性面 + 暖点缀 | `dsh-warm-level` | 面用中性暖灰，只有强调色留暖琥珀 |
| 字亮 | 3 中暗 −20% | `dsh-warm-text` | 只压最亮的几档文字，层级不乱 |
| 字色 | 0 冷（贴近 DSH 默认灰） | `dsh-warm-tint` | 看着眼熟、最不容易累；暖色文字会发涩 |
| 加粗 | 1 暖·极弱 | `dsh-warm-bold` | 见下 |
| 标题 | 4 中性纯灰·更暗 −20% | `dsh-warm-heading` | 见下 |

### 面亮：白天 / 夜间

深色主题的底色是很暗的 `#141414`。环境光一强，屏幕比周围暗一大截，眼睛要在两者之间来回
适应，看久了发闷。面亮档不是"把亮度乘个系数"——近黑处乘 1.3 几乎看不出来（`#141414` →
`#1b1b1b`），而是在线性空间往一个暖灰里混，每档的绝对提亮量肉眼可辨：

| 档 | 底色 | 面板色 | 正文对比 |
| --- | --- | --- | --- |
| 0 夜间 | `#141414` | `#212121` | 14.08:1 |
| 1 微亮 | `#201f1d` | `#282726` | 12.59:1 |
| 2 亮（白天常规） | `#292724` | `#2f2d2a` | 11.38:1 |
| 3 更亮 | `#312e2a` | `#35332f` | 10.32:1 |
| 4 最亮 | `#393631` | `#3c3934` | 9.19:1 |

只作用于"面"，不动文字；提亮后若觉得字发灰，把「字亮」调小（数字越小越亮）。

### 换档入口：侧栏底部的「外观」

DSH 的侧栏底部有一个官方插槽 `sidebar.footer.action`，插件在那里注册了一行
「外观 · 当前档」按钮（React 组件，不依赖任何 CSS Module 哈希类名）。点开是一个向上
展开的面板，六个维度各一行小圆钮，点一下立即生效、写进 `localStorage`，刷新与重启都还在。
面板点空白处或按 Esc 收起；拿不到插槽/React 时该面板自动不挂，主题本身不受影响。

选择只存在**这台浏览器**里；要让所有设备开箱就是这个档，把对应 `*_LEVELS` 表里的默认值
改成选中的档即可（`currentXxx()` 的第二个参数）。

### 加粗为什么改成"同亮度换色相"

深色底上笔画一变粗就发亮发胀（光晕），单纯压暗又会把强调感一起压没。所以加粗保留字重、
把色相挪到暖侧（≈40°）、**亮度贴住正文**（实测 0.98~1.03 倍），只靠彩度分级控制强调强弱：
色相对比走的是另一条感知通路（红-绿/蓝-黄对手通道），可以在不变亮的前提下制造强调。
默认第 1 档（`#e1dfda`）几乎只差一点点暖，安静但足够区分。

### 标题为什么要单独压暗

标题（h1~h6）在 DOM 里的颜色和正文**完全一样**，它显亮是因为 19px + 700 字重铺成了一整块
"亮面"。所以标题档位只做减法：压亮度为主。默认第 4 档是「中性纯灰、比正文暗 20%」
（`#cccccc`，对底 ≈11.4:1，仍远高于 AA）。
**不推荐**用暖色标题：同一屏里正文冷、标题暖会让视线来回时睫状肌跟着色差反复微调，
实测会发涩——暖色那两档只作对照保留。

## 安装

**只装一个包**：

```bash
dsh plugin add --profile web 'git+https://github.com/yunliya-cuter/dsh-warm-ui.git'
```

从 fork 安装时把 `yunliya-cuter` 换成你自己的账号即可。装完 **不用手改任何配置**：
包自带 `dsh.bundle.patch`，DSH 会在安装后自动把 `dsh-warm-ui` 写进 profile 的
`dsh.profile.bundles`（`dsh-app-boot` 的 `reconcileProfilePlugins`：
「New bundle dependencies activate automatically」），并在进程内重新装配。浏览器按一次 **F5** 即可。

本包的 `cordis.patch.yml` 会一次插入 4 个 entry：

| entry id | 实际插件 |
| --- | --- |
| `dsh-warm-shared` | 共享样式表注入模块 |
| `dsh-warm-ui` | 暖色主题 + 玻璃 + 输入栏整形 |
| `dsh-warm-brandgag` | 品牌文字彩蛋 |
| `dsh-warm-wallpaper` | 动态壁纸（纸 / 摩尔纹） |

> **从旧的多包版本升级**：如果你之前分别装过 `dsh-warm-shared`、`dsh-warm-wallpaper`、
> `dsh-warm-brandgag`，先把它们从 profile 里卸掉，再装本版；否则同名 entry 会被重复插入。
>
> ```bash
> dsh plugin remove --profile web dsh-warm-shared dsh-warm-wallpaper dsh-warm-brandgag
> dsh plugin add --profile web 'git+https://github.com/yunliya-cuter/dsh-warm-ui.git'
> ```

### 验证装好了

打开页面后，左下角应出现 **「外观 · <当前档>」** 一行（本插件注册到 `sidebar.footer.action`）；
点开「外观」面板，里面应能看到 **「壁纸」** 分组；侧栏品牌徽章应显示 **「遛狗绳」**；
整站强调色变成暖琥珀、输入卡片带玻璃质感即为生效。控制台可查：

```js
window.__DSH_BOOT__.entries.filter((e) => e.id.startsWith("dsh-warm-")).map((e) => e.id)
// => ["dsh-warm-shared", "dsh-warm-ui", "dsh-warm-brandgag", "dsh-warm-wallpaper"]
window.__dshWarmExtra.glass   // => { alive: true, generation: 1 }
window.__dshWarmAppearance.ids() // => ["dsh-warm-wallpaper"]（壁纸分组已并进外观面板）
```

## 卸载

```bash
dsh plugin remove --profile web dsh-warm-ui
```

bundles 与 `node_modules` 会被自动清理，刷新页面即回出厂配色。如果 profile 里还留着旧版
分开安装的三个子包，再补一条：

```bash
dsh plugin remove --profile web dsh-warm-shared dsh-warm-wallpaper dsh-warm-brandgag
```

## 从本地工作区开发（改代码即时生效）

不想走 git 安装、就在本仓库上改代码时，直接把**本地路径**作为 spec 装进来：

```bash
dsh plugin add --profile web "$(pwd)"
```

`dsh plugin add` 接受本地绝对路径（会做成 `link:` 依赖），`preview/shared`、`preview/wallpaper`、
`preview/brandgag` 都通过主包的相对路径 entry 加载。改完 `lib/client.js`（或其他子包的
`lib/client.js`）**刷新浏览器**即可生效（客户端 bundle 由 webserver 按请求读盘，不用重启服务）。

> 注意：改了包的 `dsh.client` 清单（例如动 `external`）需要**重启** dsh 才会被重新读取 ——
> 宿主把包元数据缓存在内存里，换 patch 不会让它重读 `package.json`。


## 想自己调

改 `lib/client.js` 里的几张表即可（都在文件开头，带中文注释）：

- `WARM_NEUTRAL`：暖中性色阶。想更浓就往橙红方向推色相，想更淡就把彩度往灰收。
- `WARM_GRAY`：行内代码 / 滚动条用的暖灰。
- `WARM_ACCENT`：强调色（发送按钮、滑杆、链接）。
- `WARMTH_LEVELS` / `TEXT_LEVELS` / `TINT_LEVELS` / `SURFACE_LEVELS`：暖度、字亮、字色、面亮的档位定义。
- `BOLD_LEVELS` / `HEADING_LEVELS`：加粗与标题的档位定义。
- `GLASS_MATERIAL` / `GLASS_CALM`：玻璃的材质（斜面、厚度、压暗、回光、阅读态系数）。
- `GLASS_WARP`：玻璃的**流动**配方（幅度 `amp`、周期 `period`、帧率 `fps`、两条摆动）。
  想更明显就加 `amp`，想更慢就加 `period`；`ampSwing`/`freqSwing` 给 0 = 只呼吸或只变形。
  这一层在 Firefox 上不生效（平台不支持，见上），改了只在 Chromium 看得到。
- `STYLESHEET` 里的 `.dpo-controls` 段落：输入栏控件的高度、滑杆宽度、字号等。

日常换档不用改代码：侧栏底部的「外观」面板点一下即可（记在浏览器里）。
临时试档也可以在控制台执行 `localStorage['dsh-warm-surface']='2'` 之后刷新
（键名见上表；清掉键就回到烧死的默认值）。

改完**不用重装**：直接刷新浏览器页面就会重新拉取 `lib/client.js`（客户端 bundle 由
webserver 按请求读盘，服务端只在 HMR 里按内容变更推送）。

## 预览（不实装也能看）

`/mnt/d/projects/_warmtheme_shots/` 下有一套无头 Edge + CDP 的小工具，可以在**不改 profile**
的前提下，把这份插件的真实代码注入到真实页面里预览：

```bash
# 空态整页（暖色）
"/mnt/c/Program Files/nodejs/node.exe" cdp.mjs shot out.png --plugin "D:\\projects\\dsh-warm-ui\\lib\\client.js"
# 浅色方案
... --scheme light
# 局部放大 3 倍：--clip "x,y,w,h" --scale 3
# 点某个按钮再截图：--click "会话默认" --after 2500
# 冷色残留扫描（0 = 没有漏掉的蓝色元素）
... eval cool-audit.js --plugin ...
```

## 改完怎么确认没改坏

```bash
node tools/check.mjs              # 静态：语法 / 样式归属 / 客户端插件形状 / 注入登记 / 挂载入口 /
                                  #       变量闭包 / 契约数字 / 共享依赖 / 探针可解析 / 玻璃无动效
node tools/check.mjs --browser    # 追加真机断言（需要 Windows 侧 Firefox + Marionette，见 tools/README.md）
```

玻璃**不做动效**（2026-09-24 按用户要求删掉了「流动层」，见 `contract/ui-contract.md` 第 6 节）：
现在只有静止的折射 + 边缘光 + 表面反射。想确认
「这台引擎到底吃不吃 backdrop 里的 SVG 滤镜」，跑 `tools/probes/engine-glass.js`
（Firefox 不吃，所以那边只有 blur/tint），命令见 `tools/README.md` 第 5 节。

**「UI 应该长什么样」写在一份契约里**（`contract/ui-contract.json` 机器可读 +
`contract/ui-contract.md` 人读版）：工具行三态的外观、行高、注入节点的登记表、
全局不变量（文档不可滚、每张样式表一份、每个节点一个）。改设计**先改契约再改代码**，
静态检查与真机断言会跟着契约走 —— 不用再去别处找回"原来是什么样"。

### 注入节点与样式表的三条规矩（都由检查脚本守）

1. 每张样式表自己打 `data-plugin` / `data-plugin-css`（照 DSH 官方客户端包的写法）。
   不打标的话，热重载删不掉它 —— 旧表会在 `<head>` 里越积越多，把玻璃滤镜 svg 撑出
   高度，页面就能往下滚、"壁纸跑到页面下面"。
2. 每个注入节点带 `data-dsh-warm-owner`（值 `包名:节点名`），登记在各自的
   `NODE_OWNERS` 表里；同类节点在挂载前先清扫上一代，永远只有一个。
3. 页面外层的节点只能经 `mountDetached` / `mountLayer` / `installStyleSheet` 入文档，
   定位一律写**内联**（内联永远赢样式表，热更残留也赢不了）。

### 输入框在 plan 模式下变宽是怎么回事

不是本插件干的。卡片宽度由 DSH 自己的会话宽度偏好决定：

```
--dsh-chat-user-width = clamp(偏好, 640, 列宽 - 176)    # 有偏好
                      = clamp(列宽 * 0.64, 680, 920)    # 没有偏好
卡片宽度 = --dsh-chat-user-width + 32
```

偏好键是 `localStorage['dsh.conversation.contentWidth']`（拖会话宽度手柄才会写）。
进 plan 模式后可用列变宽，同一份偏好不再被列宽夹住，于是卡片跟着变宽。
回到默认宽度：

```js
localStorage.removeItem('dsh.conversation.contentWidth'); location.reload();
```

实测数据（真 Firefox，2026-09-19）：无偏好 1752 窗口 → 952px；偏好 1200、列宽 1472 →
1232px；同一份偏好、列宽 920 → 776px。

## 已知依赖

- `ctx.theme.overrideTokens`（`@deepseek-ai/dsh-client-ui-theme` 的公开扩展点）。
- `prompt-optimizer` 的 `.dpo-*` 类名（整形目标）。该类名若改名，整形段失效但暖色不受影响。
- `.uV2eYG_tools`（conversation 插件的 CSS Module 哈希类名），只用于把工具行间距收 12px → 10px；
  哈希变了也只是这一条失效。
- **平台约定（踩过坑，别忘）**：客户端半边必须导出 `apply` / `inject` —— 浏览器侧的
  `dsh-cordis-client-runner` 会把每个客户端模块的导出当插件 apply，缺 `apply` 会拦住**整个宿主启动**
  （页面只剩「Failed to load plugins」）。工具型包（`preview/shared`）也要写一对空实现。
- **平台约定**：`cordis.patch.yml` 是**热加载**的（`dsh.profile.patchReload: "live"`），
  加/删条目刷新页面即可；但改包的 `dsh.client` 清单（如 `external`）要重启才会被重新读取。
- **平台能力（实测）**：Firefox 完全不认 `backdrop-filter` 里的 `url(#…)`（三种配方位移全为 0），
  Chromium 认。所以"玻璃底下的内容被扭 / 在动"这件事只在 Chromium 上看得见 —— 见
  `contract/ui-contract.md` 第 6 节与 `tools/probes/engine-glass.js`。

## 包结构（单包多插件）

以下 4 个包都**随 `dsh-warm-ui` 一起发布**；其中前三个是主包的子目录，由主包的
`cordis.patch.yml` 相对路径 entry 一起挂载，只有 `dsh-warm-ui` 需要被安装：

| 包 | 包内位置 | 说明 |
| --- | --- | --- |
| `dsh-warm-ui` | 仓库根 | 暖色 token 层 + 输入栏工具行整形（界面主体） |
| `dsh-warm-wallpaper` | `preview/wallpaper` | 动态壁纸（关 / 纸 / 摩尔纹） |
| `dsh-warm-shared` | `preview/shared` | **共享客户端模块**：样式表注入三件套 + camelCase→kebab。被上面两个包依赖 |
| `dsh-warm-brandgag` | `preview/brandgag` | 文字彩蛋（独立，不依赖共享包） |
| `dsh-warm-dynbg` | `preview/dynbg` | **已停用**：什么都不画的空壳，2026-09-19 起已从两份 patch 里摘除，只作历史保留；`private: true`，不会进包 |

依赖方向是单向的：`warm-ui` / `wallpaper` → `shared`。要声明一条依赖，**三处同时改**，
少一处都是「看起来能跑、换个时机就崩」：

1. 代码：工厂体里 `require("dsh-warm-shared")`（浏览器侧靠它拿实现）；
2. 本包 `package.json` 的 `dsh.client.external`（宿主侧靠它把依赖行排在本包之前）；
3. 契约 `contract/ui-contract.json` 的 `requires`（静态检查靠它核对上面两处，并禁止依赖方再抄一份实现）。

`node tools/check.mjs` 的「共享依赖」一条就是核对这三处的；注入三件套的写法也只在共享包里核对一次。

## 还没做的

没有压着的结构改动了。要做新功能之前，先读 `STATE.md`（当前状态 + 实测证据 + 硬约束）
与 `contract/ui-contract.md`（UI 应该长什么样）。
