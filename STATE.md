# 当前状态与下一步（2026-09-19）

> 这份文件的目的：**上下文被压缩/换新会话之后，靠它就能接着干**，不用重新做一遍审计。
> 一句话现状：**维护性改造（P0 + P1）全部做完并实测通过；死配置 dynbg 已删；
> 跨包重复代码已收进共享包 `dsh-warm-shared` 并迁移完消费方；
> 液态玻璃**不做动效**（2026-09-24 按用户要求删掉「流动层」，只留静止的折射 + 边缘光 + 表面反射）；
> 工具行「优化」胶囊改成按类名清扫 + 换代守卫，重复胶囊不再出现；
> 「输入框经常闪烁」已定案并修完（跨实例换代守卫挂 `window` + 玻璃出错自我卸载 + 可观测出口，
> 实测僵尸世代带来的 DOM 变更 2233 → 71 且静置段为 0）；
> 「输入框玻璃底部曲率过大」已实施（只作用于输入框卡片槽位：`slope ×0.6` + `dispGain ×0.5`，
> 底边带峰值位移 15.97 → 5.32px，而弧的几何/内阴影/圆角/底色一字未动，见 §0.7）；
> 「鼠标在输入框上打字却变透明」已定案并修完（悬停判定被窗口失焦弄丢，只改一处、见 §0.8；
> 第二条路径「假离开」见 §0.9。两笔都已提交：`63f1006` + `c2396b5`）。**
> 「与背景不协调的黑色横带」已按用户要求彻底移除，并把「进行中」改成**行首闪烁橙点 +
> 文字水波**（关掉五族扫光、座位不再画底，见 §0.10，已提交 `37612df`）。**
> 侧栏列表底边那条「分割感」硬缝（原生上色型渐隐带 × 侧栏半透明）已改成内容遮罩，见 §0.11。**
> 静态 15 项 + 真机断言 + 热重载回归全绿，且**没有重启过 dsh web**（也不需要）。**

## 0. 两条平台事实（都实测过，别再用旧说法）

1. **patch 是热加载的，不用重启 dsh web。**
   `~/.dsh/profiles/web/package.json` 里写着 `"patchReload": "live"`，
   `dsh-app-boot` 的 `watchUserPatches()` 用 cordis HMR 盯着 `cordis.patch.yml`，
   改动会事务性地重新应用。实测：往 patch 里加 `dsh-warm-shared`、删 `dsh-warm-dynbg`
   之后**刷新页面**，模块图谱里就已经有共享包、没有 dynbg 了。
   **唯一例外**：改包的 `dsh.client` 清单（例如加 `external`）要重启才生效 ——
   宿主把包元数据缓存在内存里（`dsh-client-modules` 的 `pkgMeta`，键是 loader 行）。\
   （旧文档里"patch 不热加载、必须重启"是错的，已全部改掉。）
2. **每个客户端半边都必须是一个"插件"：导出 `apply`（+ `inject`）。**
   浏览器侧的 `dsh-cordis-client-runner` 会按模块图谱给**每个客户端包**建一条 loader
   条目，并把它的导出当插件 `apply`。只导出工具函数的包会被判成
   `invalid plugin … received object`，而且这个错会**拦住整个宿主启动** ——
   页面只剩「Failed to load plugins」，连会话都进不去。2026-09-19 在共享包上真踩过一次
   （entry id 随机、括号里是包名，就是那句报错）。现在由检查项「客户端插件形状」守着。
3. **Gecko 完全不认 `backdrop-filter` 里的 SVG 滤镜，但认元素自身的 `filter: url(#…)`。**
   2026-09-19 用 `tools/probes/engine-glass.js` 量的矩阵（同一张竖条纹，压玻璃那块
   相对没压那块位移多少）：

   | 滤镜挂在哪 | Chromium（无头 Edge） | Firefox 154（无头） |
   | --- | --- | --- |
   | `backdrop-filter: url(#…)` | feOffset **+12.00px** / feImage **−12.00px** / feTurbulence 打乱图案 | **三种配方全部 0px** |
   | `filter: url(#…)`（元素自身） | 同上全有效 | 全部有效（`feImage` 必须写 `xlink:href`，只写 `href` 等于没有图源） |

   推论（都已落地）：**静止的折射与边缘光也只在 Chromium 看得见** —— Firefox 的玻璃
   只有 blur/tint（引擎表那行 `svgFilter: false`）。唯一能补的路是把滤镜挂在会话内容
   那个大元素上，实测每帧多花 ≥17ms（`tools/probes/glass-cost.js`：中位帧 33ms → 50ms，
   而且只要挂着就付），**决定不做**。

## 0.5 正在做的事（2026-09-24 傍晚，上下文压缩前的交接）

**用户这一轮的两个要求：**

1. **消除输入框边缘的波纹动效** —— ✅ 做完（删掉玻璃的「流动层」）。**不要**用别的动效替代。
2. **消除输入框下方重复的「高级审查」** —— ✅ 做完（那不是文案重复，是工具行里**两颗**「优化」胶囊）。
   用户还要求：不许用 `display:none` 之类掩盖，优先删真正的重复源头。

**成因（都复现过，不是猜）：**

- 波纹动效 = 玻璃「流动层」：`feTurbulence` 噪声 + 一次额外位移，由 20fps 定时器每拍改
  `baseFrequency` / `scale`。实测：用一次性探针拦掉对这两个属性的后续写入，900ms 里拦到
  60–64 次写入（= 每 50ms 一拍，两滤镜 × 两属性）。
- 重复胶囊 = 工具行里多出来的 `.wti-chip` **没有**归属标记 `data-dsh-warm-collapse`（标记是
  后来才加的），而清扫原来只按属性找 → 扫不到它 → 新旧并排。复现（改之前）：往
  `.dpo-controls` 塞一颗无标记同类节点 → 计数立刻 1 → 2，经过一次热重载仍是 2；改之后同一动作
  只在注入那一拍数到 2，下一个 rAF 回到 1 并保持。**这条现在是可复跑的回归探针
  `tools/probes/dup-chip.js`**。

**关键测量（输入框边缘到底谁在动；同一张卡片，Chromium，两相位差分，卡片 x 535..1487）：**

| 状态 | 卡片上沿带（y 388..418） | 卡片整块（y 388..502） |
| --- | --- | --- |
| 壁纸在 + 流动层在（改之前） | **5.73**（26.3% 像素差 >8） | — |
| 壁纸在 + 流动层驱动**冻住** | 5.43（21.7%） | 7.88 |
| **壁纸那层藏掉** + 流动层在 | **0.233**（0.07%） | 1.545 |

读法：边缘的"动"大部分是**会动的壁纸透过玻璃**，不是玻璃自己的动效。所以删掉流动层之后
边缘**仍会**看到壁纸在动 —— 那是壁纸（`dsh-warm-wallpaper`）的，要静止它得关壁纸或改玻璃的
采样方式，两件都改观感，**没有替用户决定**（写进契约 §6 了）。

**「输入框经常闪烁」已定案（2026-09-24 夜，用户贴出控制台）：**

三个不同 `rev` 的 `client.js` **同时活着**，各自在指针移动时抛 `ReferenceError`：

| 报错 | 栈 | 对应哪一版 |
| --- | --- | --- |
| `GLASS_WARP is not defined` | `glassWarpOf` ← `buildGlassMap` ← `bucketFor` ← `dress` ← `sync` ← `hoverTick` ← `onPointerMove` | rev `164c3bf…`：表已删、`glassWarpOf` 还在 |
| `fade is not defined` | `buildGlassMap` | rev `f37608f…`：`const fade` 已删、遮罩块还在 |
| `glassWarpOf is not defined` | `buildGlassFilter` | rev `912cf9f…`：`glassWarpOf` 已删、调用点还在 |

那三个 rev 就是我删「流动层」时**半删状态**的存盘：语法合法（`node --check` 查不出来），只有运行到才抛。
它们能成功 apply —— 首屏那次 `sync()` 时卡片还不存在（`targets()` 为空 → 不调用 `dress`），异常要等
卡片出现 + 指针移动才由 `hoverTick` 抛出；而换代时这些回调（`pointermove` 监听 + rAF）没有被撤掉，
于是成了"僵尸世代"：每个指针移动抛一次，`dress` 中途中断 → 卡片样式停在半成品 → **持续闪烁**。

实测对照：用户页面 5 秒 `domMutations` **1284**；全新页面 + 当前代码 **0**（且 `missingFilter 0`、
`chips 1`、`noise 0` → 当前这一代是好的、也确实加载上了）。

附带查出的真问题：`chipGeneration` 这类计数器写在**工厂体内的模块作用域**（`lib/client.js:1482`），
而热重载会重新执行工厂体 → 每个模块实例各有一份计数 → **跨实例守卫等于不存在**，
注释把它说大了，要改成挂在 `window` 上。

## 0.6 已批准并**已实施完成**：清僵尸 + 跨实例换代守卫 + 出错自愈（2026-09-24 夜）

**目标 / 验收**：① 泄漏的旧世代不能再写页面；② 任一代在重入路径上抛异常时**自我卸载**（而不是每帧重试）；
③ 热重载期间不再留半成品世代。验收 = 用户刷新后 5 秒探测器 `domMutations ≲ 10` 且控制台无红色报错；
两个伪造世代并存时 churn 与 idle 同档；`node tools/check.mjs` 与 `--browser` 全绿；视觉无回归。

**用户侧先做**：硬刷新一次页面 —— 那三个僵尸跑的是**没有守卫的旧代码**，代码救不了，只能刷新清掉。

**代码改动（`lib/client.js`）—— 存盘顺序必须是"先加 → 再切 → 后删"，每一步都保持文件自洽
（半删状态正是这次事故的根）：**

1. **跨实例换代守卫**：在 `ATTR` / `EXTRA_KEY` 附近加一张键名表 + 三个函数 ——
   `GENERATION_KEYS = { glass: "__dshWarmGenGlass", chip: "__dshWarmGenChip" }`、
   `generationOf(key)` / `beginGeneration(key)` / `endGeneration(key, mine)`
   （只有"我本来就是最新一代"时才把号码往后推）。`mountGlass()` 里 `const generation = beginGeneration("glass")`，
   `sync()` 顶部 `if (generation !== generationOf("glass")) return;`（`sync` 是所有重入路径的唯一收口：
   `hoverTick` / `schedule` / `resize` / `scroll` 都走它），`remove()` 里 `endGeneration("glass", generation)`；
   `mountOptimizerCollapse()` 把 `let chipGeneration = 0` 换成同一套（`step()` 现有守卫改读共享值）。
2. **出错自我卸载**：`mountGlass` 的清理收成幂等的命名函数 `remove()`（内部 `dead` 标记），`sync()` 包一层
   `try { … } catch (error) { remove(); reportGlassFailure(error); }`；`reportGlassFailure` 只报一次
   `console.error` 并写 4 的出口。语义：**出错时玻璃整体关掉**（输入框回普通样式），不再每帧闪。
3. **apply 期不留半成品**：`mountExtras()` 用局部 `disposers` 数组边创建边登记（样式表 / svg / 监听 /
   observer / `guardTimer`），先定义 `dispose()`，再把 `paintExtraFlags()` / `mountGlass()` / 首次 `sync()`
   包进 `try { … } catch (error) { dispose(); throw error; }`；返回 `dispose`。
4. **可观测出口**：`window.__dshWarmExtra.glass = { alive: true, generation }`（挂载时）/
   `{ alive: false, generation, error }`（自我卸载时），供探针断言"这一代还活着"。
5. **热路径少写同样的值**：`paintExtraFlags()` 改成"值没变就不写"（`lib/client.js:1934`；它挂在
   指针移动 → `sync()` 这条热路径上）。
6. **静态检查拦半删状态**：`tools/check.mjs` 第 11 项「玻璃无动效」扩成一张"已删标识符表"
   （只扫 `spec.entry` = `lib/client.js`，探针不受影响）：`GLASS_WARP`、`glassWarpOf`、`warpAt`、
   `warpFilterNodes`、`warpNoise`、`warpMask`、`warpField`、`maskUrl`、`warpTimer`、`warpStartedAt`、
   `tickWarp`、`scheduleWarp`、`glassWarp`、`data-wta-glasswarp`、`feTurbulence`。命中即失败并说明原因。

**契约 / 文档**：`contract/ui-contract.json` 加顶层 `lifecycle`（`singleGeneration` / `failSafe` + 本次实测
1284 / 0）；`ui-contract.md` 第 1、6 节补两条不变量与事故记录；`tools/README.md` 探针表加新探针；
`tools/probes/contract.js` 第 ⑨ 节加 `glassLife: { alive, generation }`，`alive !== true` 判违规。

**新增回归探针 `tools/probes/glass-zombie.js`**（提交进仓库）：从 `window.__DSH_BOOT__` 取 `dsh-warm-ui`
的 bundle URL（退路：`performance.getEntriesByType("resource")`）→ `fetch` 源码 → 用假
`__ModuleLoader__` + 假 ctx（`effect: (fn) => fn()`，即永不 dispose）**连续 apply 两次**
（伪造"泄漏的旧世代 + 新世代"）→ 装 `error` 计数器 → 在输入卡片上派发约 200 次 `pointermove` + 等 2 秒 →
返回 `{ errors, domMutations, chips, missingFilter, glassAlive, glassGen, cardFilter }`。
**判据**：改之前两代互删互塞（胶囊 ping-pong）→ `domMutations` 数百；改之后旧世代停手 → 与 idle 同档。
（假 ctx 无 `slots` 不影响：外观面板在无 `slots` 时静默降级，见 `lib/client.js:734`。）

**提交拆两个**：① `lib/client.js` + 契约 + `tools/check.mjs` + `tools/probes/contract.js`；
② `tools/probes/glass-zombie.js` + 文档。**回退**：`git revert` 这两个提交（各自独立）。

**不做**：不重启 `dsh web`；不加依赖；不动 `dsh-prompt-optimizer`；不动壁纸；不改玻璃与工具行的视觉；
不为了让检查通过而改探针的期望值。已知不在计划内：热重载每次仍会重建玻璃 svg 与样式表 →
**每存一次盘输入框仍会闪一下**（HMR 固有，不是这次的 bug）。

### 0.6.1 实施结果（实测数字，不是"应该好了"）

改动落在 `lib/client.js`（6 步存盘，顺序"先加 → 再切 → 后删"）：换代键表 + 三个函数
（`GENERATION_KEYS` / `generationOf` / `beginGeneration` / `endGeneration`，`chipGeneration` 已删）→
玻璃 `sync()` 顶部守卫 → 幂等 `remove(error)`（`dead` 标记）+ `try/catch` + `reportGlassFailure` →
`window.__dshWarmExtra.glass = { alive, generation }`（出错附 `error`）→ `mountExtras` 的
`disposers` 逆序撤 + 装成功才登记包级资源 → `paintExtraFlags()` 值没变就不写。

证据 = 新探针 `tools/probes/glass-zombie.js`（假 loader + 假 ctx 连挂**两代**、`effect` 不给卸载；
120 发指针风暴 + 1.2s 静置 + 1.2s 继续静置）：

| 状态 | 合计 DOM 变更 | 其中 `.wti-chip` 删插 | 静置段 | 继续静置 |
| --- | --- | --- | --- | --- |
| 改前 | **2233** | **868** | （含在合计里，未分段） | — |
| 只加换代守卫（中途量） | 79 | 4 | 未分段 | — |
| 全套改完 | **71** | 4（挂载那一下的换手） | **0** | **0** |
| 单实例基线（对照） | 5 | 0 | 0 | 0 |

把 `document.elementFromPoint` 换成必抛（验"出错自我卸载"）：

| | 未捕获错误 | `console.error` | 出口 `__dshWarmExtra.glass` |
| --- | --- | --- | --- |
| 改前 | **59** | 0 | 不存在 |
| 改完 | **0** | **恰好 1 条**（带「已自我卸载」） | `{ alive: false, generation: 3, error: … }`，胶囊仍 1 颗、卡片仍可用 |

静态检查：第 11 项「玻璃无动效」扩成 15 行的**已删标识符表**（`GLASS_WARP` / `warpAt` /
`warpFilterNodes` / `glassWarpOf` / `warpTimer` / `data-wta-glasswarp` / `feTurbulence` …）——
用合成片段验过它真能点名、且不误伤 `warped` / `maskUrlX` 这类同名前缀。

回归：`node tools/check.mjs --browser` 11 项 + 真机全绿（真机实测 `glassLife = { alive: true, generation: 1 }`、
`chips {byClass:1, marked:1}`、`cardWidth 952`、`overflow 0`）；`--hmr` 绿
（`rebuilt=2 帧`，`{base:1, extra:1, wallpaper:1, unowned:0, owners:4, canvases:1, overflow:0}`），
`lib/client.js` 逐字节还原。

**待用户 / 待办：**

1. **闪烁修复**（§0.6）：✅ 已实施并自测通过。**请硬刷新一次页面**（Ctrl+Shift+R）——
   你那一页现在跑的三代僵尸是老代码，它们不认识新的 `window` 守卫，只有刷新能清掉。
   刷新后请用那 5 秒探测器看 `domMutations`（应 ≲ 10；全新页面实测 0）与控制台有无红色报错。
2. **底部曲率**（§0.7）：✅ 已实施两版并自测通过。**请看三张底角放大对照**（不进仓库）：
   `D:\projects\.edge-preview\pair-before-corner8x.png`（基准）、`pair-gain-corner8x.png`（现在）、
   `pair-arcthin-corner8x.png`（再收窄那条画出来的亮弧的预览）。若"还是太大"，下一刀是
   `dispGain`（0.5 → 0.35，一个数）或 `bevel`（18 → 12，带更窄）；若"过头了"就回 0.7。
3. **输入框宽度**（旧问题，仍未定）：插件没有任何宽度规则，宽度是 DSH 的偏好
   `localStorage['dsh.conversation.contentWidth']`（值 = 卡片宽 − 32，下限 640）。三条路：
   拖宽度手柄 / 写偏好后刷新 / 让插件加上限（要先进契约）。**等用户给目标宽度。**
4. **悬停判定**（§0.8）：✅ 已实施并自测通过。**请确认触发场景**：本地唯一能复现出该症状的是
   「窗口失焦过、之后鼠标又没动过」（点 DevTools / 地址栏 / 切窗口都会失焦；而打字不会重算判定，
   所以状态一直粘着）。若你的现象是别的触发源，按 §0.8 末尾的 console 片段抓一次翻转现场
   （尤其看 `__dshWarmExtra.glass.alive`：`false` 是另一条路径 —— 玻璃自我卸载）。
5. **假离开**（§0.9）：✅ 已修并自测通过，**改动还没提交**（工作树 4 个文件：`lib/client.js`、
   `contract/ui-contract.json`、`tools/check.mjs`、`tools/probes/contract.js`）—— 你说一声我就提交。
   你自己跑诊断片段抓到的现场（13ms 内 20+ 条 `pointerleave`、而 `focus=true`/`hitInCard=true`/`alive=true`）
   就是这次修掉的东西：**指针离开按事件坐标判真假，不按事件名**。

## 0.7 已实施：输入框「底部曲率过大」（2026-09-25）

用户 2026-09-25 报「修掉输入框玻璃效果**底部曲率过大**，做到文字清晰可读，同时保留
肉眼可辨的明显曲率」，中途追加「**我感觉曲率还是太大了**」。

**口径（用户确认过）**：「曲率」= 底边折射带里的**位移幅度**（玻璃底下的背景被掰弯多少）；
要清晰的字 = 输入框 DOM 标签 + 正打字 + 透过玻璃看到的会话正文，三者都要。

**改法**：只动输入框卡片这一个槽位，两个旋钮各改一次、每次量一次 ——

| 阶段 | `slope`（弯得多快） | `dispGain`（弯的总量） | 底边带峰值 | 带内衰减 | 全局 maxd | 弧剖面 |
| --- | --- | --- | --- | --- | --- | --- |
| 基准 | 1.5 | 1 | 15.97px | 2.02px/px | 18.42px | 0.529 |
| 第一版 | ×0.6 → 0.9 | 1 | 10.64px | 1.54px/px | 14.04px | 0.537 |
| 第二版（用户说"还是太大"后） | ×0.6 | ×0.5 | **5.32px** | **0.77px/px** | **7.02px** | **0.537** |

- 已试过并**撤销**的旋钮：`thickness` 70 → 42 —— 峰值只从 18.42px 掉到 16.76px（−9%），
  剖面被 `slope` 夹住的那一段不随厚度变。**"一次只改一个变量、每改一次立刻量"** 挡住的
  就是这种"看起来该有效"的旋钮。
- 弧的几何（`bevel` / `shape` / `edgeW` / `rim` / `shade` / `light`）、5 层内阴影、
  圆角 22px、底色 `.30`：**一字未动**（`box-shadow` 字符串前后逐字节相同）。
  这就是「不许拿曲率换可读性」。
- 实现方式：`GLASS_TARGETS` 变成**槽位行**（`{sel, variant}`），新增槽位覆盖表
  `GLASS_SLOT_VARIANTS = { composer: { scale: { slope: 0.6, dispGain: 0.5 } } }`，
  材质派生统一走 `deriveGlassMaterial(base, spec)`（`scale` 乘 / `set` 换，与 `GLASS_CALM` 共用）。
  任务面板槽位 `variant` 为空 = 保持基准材质（改动只作用于该输入框）。
  `dispGain` 乘在 `feDisplacementMap` 的 `scale` 上，`0` 会被 `|| 1` 当成 1 —— 想"调成
  看不见"只能显式写小数，地板值登记在契约里。

**文字那一半（实测口径）**：输入框 DOM 里的字**永远不被滤波**（可编辑区 `filter` 与
`backdrop-filter` 都是 `none`）。四态：默认 `.30`/`blur 0` 背景 busy 1.235、spread 39.0；
悬浮 `.62`/`blur 4` busy 0.053、spread 11.0；**focus 与正在输入跟默认完全相同**
（插件不监听 focus —— 所以"点进去打字"这一态按默认材质判）。同一张截图里卡外未滤波
壁纸 busy 3.85，卡内 1.235：玻璃自己已把背景乱度压掉 2/3，所以这一版**没有动底色**。

**验证**：静态 12 项（新增第 12 项「底部曲率」：设计数字各出现一次 + 系数不低于地板 +
折射路径与槽位表两行都在）全绿；`--browser` 真机实测 `glassArc { insets: 5, radius: 22,
tint: "rgba(24, 21, 18, .30)" }`（第 ⑪ 段，守引擎无关的那一半）全绿；
`--hmr` 绿（`rebuilt=2`，各包各 1 份、无主样式表 0）。像素/截图证据在
`/mnt/d/projects/.edge-preview/`（不进仓库）：`pair-before-corner8x.png`（基准）、
`pair-gain-corner8x.png`（现在）、`pair-arcthin-corner8x.png`（把那条画出来的亮弧再收窄
变淡的预览，实测只差几个亮度单位）。

**还没做/待用户定**：本轮**没有**动 `tint`（底色）与 `bevel`（带的范围）—— 它们是下一
个单变量；用户若在自己屏幕上仍觉得"太大"，按 `dispGain` 继续往下（契约地板 0.35）
或收窄 `bevel`（18 → 12）。

## 0.8 已实施：鼠标在输入框上打字却变透明（悬停判定被窗口失焦弄丢）（2026-09-25）

用户报「输入框在打字的时候会变回透明状态而非模糊状态，尽管我鼠标在输入框上」。

**先复现、再改**：无头 Chromium（与用户 Chrome 同引擎）+ **真鼠标真键盘**，指针停在输入框上
不动 —— 只把鼠标放上去打字**复现不出来**：`data-wta-over` 全程为 1、底色 `.62`、`blur(4px)`，
卡片节点从未被重建。再把「打字能引起的一切 DOM 变动」逐个做一遍也不复位：输入框失焦、
输入框节点删除重插、**整张卡片节点被替换成克隆节点** —— 命中测试扛得住重建
（`elementFromPoint` 只看现在指针底下是什么，不看事件）。

**唯一能产生该症状的路径：窗口失焦** —— 它走的正是
`window.addEventListener("blur", onPointerGone)`：清坐标 + `inside = false`，而**打字不会
重算悬停判定**（只有 `pointermove` 会），于是状态一直粘在「指针不在卡片上」那一档。

| 步骤（真鼠标真键盘，指针不动） | 改前 | 改后 |
| --- | --- | --- |
| 鼠标移到输入框上 | `over=1` / `.62` / `blur 4px` | 同左 |
| 窗口失焦 | **`over=0` / `.30` / `blur 0`** | `over=1` / `.62` / `blur 4px` |
| 真点击回页面（坐标不变） | `.30` / `blur 0` | `.62` / `blur 4px` |
| 打字 a、b、中文提交 | **全程 `.30` / `blur 0`** | 全程 `.62` / `blur 4px` |
| 真鼠标动 1px | `.62` / `blur 4px` | 同左 |

**改法（`lib/client.js`，+19/−2）**：失焦不再走 `onPointerGone`，改走独立的 `onWindowBlur` ——
只丢 `hit` 缓存并**按最后的坐标重算**（`hit = null; sync();`），坐标不清：坐标是几何事实，
不随窗口焦点改变。「真离开文档」只由 `documentElement` 上的 `pointerleave` 判定。直接调
`sync()` 而不走 `scheduleHover()`：后者在 `document.hidden` 时直接返回，而失焦这一拍正是
必须重算的一拍（重算幂等，`dress` 有签名守卫）。

**相邻状态复验（12 拍全对）**：真离开 `pointerleave` 仍回常态；失焦与真离开叠加时真离开赢；
指针移到卡片外回常态、移回来恢复；输入法 composition + 提交不改判定；卡片节点被整体替换后
仍判定悬停、换节点后再失焦仍保持模糊。

**为什么"保持悬停"才是对的**：鼠标的物理位置在失焦前后一点没动，用户看到的画面也没变 ——
状态本来就该跟着几何走，而不是跟着窗口焦点走。

**验证**：静态 13 项（新增第 13 项「悬停判定」，且反向验证过：把缺陷写法放回去立刻报红，
还原后 sha256 一致）全绿；真机 `--browser` 第 ⑫ 段（悬停 → 失焦仍悬停 → 真离开回常态）全绿；
`--hmr` 绿。证据（不进仓库）在 `/mnt/d/projects/.edge-preview/`：`repro.json` /
`repro-after.json`（改前改后逐步时间线）、`beforefix-A|B|C-*.png` 与 `states-after-*.png`
（三种"透明"的对照：悬停 `.62`/`blur 4px`、判定丢失 `.30`/`blur 0`、玻璃自我卸载
`0`/`blur none` —— 第三种是另一条路径）。

**还没确认的**：**用户环境里"窗口为什么失焦"没查**（本地那一拍是人为构造的）。所以 §0.8 末尾
给了一份 console 诊断片段：盯 `[data-wta-over]` 翻转那一刻的 `document.hasFocus()`、
`elementFromPoint` 命中链与 `__dshWarmExtra.glass.alive`。

## 0.9 已修但**尚未提交**：打字时「假离开」把悬停态打回透明（2026-09-25）

用户在自己浏览器里跑诊断片段抓到的现场（根因的直接证据，来自用户贴回的 console）：

```
POINTER-LEAVE ×20+（13ms 内）over=true  bg=.62 blur=4 focus=true hitInCard=true alive=true
OVER-FLIP                    over=false bg=.3  blur=0 focus=true hitInCard=true   ← 一打字就透明
POINTER-ENTER ×30+                                → OVER-FLIP over=true          ← 几秒后又自己回来
```

`focus=true` 排除失焦路径、`hitInCard=true` 说明**指针还在输入框上**、`alive=true` 排除玻璃
自我卸载 —— 只剩一条：**浏览器在指针一动不动时会成串补发 `pointerenter/pointerleave`**
（悬停重算 / 另一个进程的窗口盖在指针上，例如输入法候选窗），而插件**盲信最后到达的那条事件**；
打字不会重算悬停判定（只有 `pointermove` 会），于是状态停在「指针不在玻璃上」那一档。

**判据（实测 · 事件自带坐标）**：真离开的坐标落在视口**外** —— 跳跃式 `pointerleave(1011,1200)`、
扫掠式 `pointerleave(1011,854)`（距最后一次 `pointermove` 仅 51ms），而视口内高只有 830；
假离开的坐标仍在视口内。

**改法（`lib/client.js`，+26/−5，一处）**：`onPointerGone(event)` 先看 `event.clientX/clientY` ——
坐标仍在视口内 = 假离开：保留坐标、只丢 `hit` 缓存并 `scheduleHover()`（几何说了算）；
坐标在视口外 = 真离开：照旧清坐标回常态。

**验证**（同一驱动、改前改后）：

| 步骤 | 改前 | 改后 |
| --- | --- | --- |
| ① 真离开·跳跃（坐标 1200） | `over=0` / `.30` / `blur 0` | 同左（真离开行为没变） |
| ② 真离开·扫掠（坐标 854） | `over=0` / `.30` / `blur 0` | 同左 |
| ③ 假离开（指针停着没动） | **`over=0` / `.30`** | **`over=1` / `.62` / `blur 4px`** |
| ④ 假离开之后打字 | `over=0`（用户报的现象） | `over=1` |

相邻状态 13 拍全对：真离开仍回常态、失焦+真离开叠加时真离开赢、指针移到卡片外回常态/移回恢复、
输入法 composition 与提交不改判定、卡片节点被整体替换后仍判定悬停。

**守卫**：契约 `glass.pointer` 新增 `leaveHandler`（坐标必须参与判定）与 `measured` 口径 +
`tools/check.mjs` 第 13 项 + 真机 `tools/probes/contract.js` 第 ⑫ 段（拆成两条分支：
`afterLeaveIn` 必须 `.62`、`afterLeaveOut` 必须 `.30`）。静态 13 项 / `--browser` / `--hmr` 全绿。

**待办**：改动只在工作树（4 个文件），等用户确认后提交。

## 0.10 已实施：黑带移除 + 「进行中」改成闪烁橙点与文字水波（2026-09-25）

用户报「界面上有一条与背景不协调的黑色横带」，要求**彻底移除**，并「在工具调用等条目的
前面加一个闪烁的红点或橙点」；追问后追加要求：「把扫光关掉，换成让字体像在水波中规律抖动
（频率和扫光一致）」。

**先查证（代码里只有两种「暗带」，都源自同一个 token `--dsw-alias-bg-base`）：**

| 候选 | 来源 | 形态（实测） |
| --- | --- | --- |
| ① 座位全宽渐隐带 | DSH `dsh-client-ui-conversation/lib/client.js:14652` 的 `.wSkVaW_root[data-phase=active] .wSkVaW_composerSeat` ＋ 插件原来的覆盖 | **1310×172px 暖黑** `rgba(16,14,12)`，顶 54px 斜坡到 `.46`；插件那条覆盖**不受 `data-phase` 限制**（连空会话 hero 态也在画） |
| ② 五族行内扫光 | `o3BgMG`（工具）/ `CY-8Ka`（bash）/ `_5OnbHa`（命令卡，`/compact` 的「正在压缩…」就是它）/ `lcKema`（推理）/ `iWrAna`（skill）各一条 `[data-state=running]:after` | **300×24px 中性黑** `color(srgb .078 .078 .078 / .6)` = `#141414@60%`，2.6s 扫一次 |

用户判断「那条黑带是扫光」；静态 + 截图像素证据指向座位带（截图里是**全宽 + 暖色**，
而扫光是 300px 宽 + 中性色）。**两条都不符合「与主题协调」，按用户要求两条都去掉** ——
所以归属分歧不影响修法；A/B 原始数字（同页面先后截图，消除动态墙纸漂移）留在
`.edge-preview/_evidence-band.md`。

**改法（只动 `lib/client.js` 一个文件）：**

- 座位：`background: none !important`（只换视觉；节点、占位、padding/margin 一律不碰），
  并删掉 `--wta-seat-*` 四个常量（删规则就删常数，否则又留下「用了却没定义」的坑）。
- 扫光：`[data-state="running"] [class*="_row"]::after` ＋ `[data-state="running"][class*="_root"]::after`
  → `content: none !important`（**整条去掉**，不是停动画 —— 停住的 300px 暗块更难看）。
- 进行中指示：`[data-state="running"]::before` 行首橙点（`--dsw-alias-state-warn-primary` = `#f59e0b`，
  6px 圆（2026-09-25 用户要求「小一点」，8px → 6px）、绝对定位、`wta-busy-blink` 1s alternate
  opacity .35→1 —— 与 DSH 输入框那颗 pending 点同规格）
  ＋ `_title` / `_summary` 走 `wta-busy-wave`（2.6s，**与原扫光同频**，振幅 ±1px，摘要差半拍 ⇒ 波从左往右走）。
- 新增增强项 `busy: 1`（`body[data-wta-busy]`）：关掉即回到 DSH 原生（扫光回来、无点无水波）。

**验收（逐条实测，不是"应该好了"）：**

| 口径 | 结果 |
| --- | --- |
| 零位移 | 同一行 非运行→运行→非运行，行与内层盒逐值相同 `(512,300,846,24)` |
| 座位带 | `background-image: none`；关掉它只影响座位区（座位区 Δ+1.60、卡外左侧 Δ+2.06、正文区 **Δ+0.01**） |
| 橙点（像素级） | 三条克隆行行首各一颗 **6×6**：`(501,309)` / `(501,341)` / `(501,373)`（工具 / bash / 推理）。点的中心在行首左侧 8px —— 尺寸收小时外挂距离一起收 1px，中心没动 |
| 真机运行态 | 新会话跑 `bash sleep`，运行行 `::before` = 8×8（当时尺寸，现 6px）/ `rgb(245,158,11)` / `left:-12px`，`::after content: none`，水波 2.6s，座位 `background-image: none`（`real-running2.png`） |
| 扫光 | 五个族的 `::after` 都是 `content: none` |
| 水波 | 三拍 `transform` = −0.136px / −0.999px / −0.606px（文字确实在起伏） |
| reduced-motion | `animation-name` 全变 `none`、点 `opacity 1` 仍在 ⇒ 「动画停，但仍看得出进行中」 |
| 亮 / 暗主题 | 都验过：`seat.bg none`、点在、水波在（`#f59e0b` 两个主题同值） |

**真机（Firefox / Gecko）**：`--browser` 的 `busyIndicator` =
`{seatBg:"none", dot:{8px→6px/50%/rgb(245,158,11)/left:-12px→-11px/absolute/wta-busy-blink 1s/infinite/alternate},
sweep:{content:"none"}, wave:{title 2.6s, summary delay −0.4333s}}`。

**真机抓到的第二个事实（差点被当成"例外"放过去）**：跑 `bash` 的 `sleep` 时，
`document.querySelectorAll('[data-state="running"]')` **只有 `CY-8Ka_root` 一个** ——
也就是说那一行就是**顶层条目**，不是「嵌在工具行里的细节行」（我原先的推断是错的），
而它自身 `overflow:hidden` 会把行首外挂的点一起裁掉。它裁的本是那条扫光（300px、从 `left:-300px`
扫进来），扫光整条关掉后这层裁剪再无存在理由 ⇒ 放开 `overflow: visible`（不碰 padding / 间隙 /
尺寸 ⇒ 零位移；对其他族无操作，实测它们的 root 本来就是 visible）。放开后像素复核：三条克隆行的
行首各一颗 6×6 橙点（`(501,309)` / `(501,341)` / `(501,373)`，中心与 8px 版一致 = 只变小没挪位），真机现场（新会话跑 `bash sleep`）
也拍到运行行的点、水波与「座位无底」。

**范围边界（如实登记）**：流式正文 / 重试行 `[data-active]` / 等待确认不带 `data-state`，
不在这一族里（想扩要单独走一轮）。

**一个踩过的坑（已修，值得记）**：橙点颜色最初定义在 `:root` 里，而 DSH 的语义 token 只定义在
`body` 上 ⇒ `var()` 链在计算值阶段失效 ⇒ 整条 `background` 被丢弃 ⇒ **点画得出来却是透明的**
（尺寸/圆角都对，只有颜色没了）。实测 `getComputedStyle(html)` 取 `--dsw-alias-state-warn-*` 为空、
`body` 里是 `#f59e0b`。所以颜色定义挂在 `body[data-wta-busy="1"]` 上，第 14 项检查也会拦「写回 `:root`」。

> ⚠️ 写这一段 CSS 时踩过一个坑：注释里写了反引号（模板字符串里就是它自己），
> 直接把 `EXTRA_STYLESHEET` 截断 —— 被检查项 1「语法」（`node --check`）当场拦下。
> 在这个文件里改注释的唯一纪律：**CSS 模板里不要出现反引号**。

**守卫**：契约 `busy`（`must` / `forbidden` / `dot` / `wave` / `knownExceptions` / `measured`）＋
`tools/check.mjs` 第 14 项（含「颜色 token 全源码只出现一次」「不许写回 `:root`」「节奏数字必须等于契约」）＋
真机探针 `tools/probes/contract.js` 第 ⑬ 段。静态 14 项 / `--browser` / `--hmr` 全绿；
`--hmr` 跑完 `lib/client.js` 逐字节还原（sha256 前缀 `f96ec8157144`）。

**提交与回退点**：一笔 —— `37612df`「修：黑带移除 + 「进行中」改成行首闪烁橙点与文字水波」。
回退点 = 上一笔 `c2396b5`（再往前 `63f1006` → `c1b4d37`）。

## 0.11 已实施：侧栏列表底边那条硬缝（原生「上色型」渐隐带）（2026-09-25）

用户发来带两处红色箭头的标注图：「箭头指的两处地方看起来有分割感，请解决」。

**箭头判读（先把指向钉死，再动手）**：把标注图里的红像素做连通域，取每个箭头的尖端与箭尾
（上箭头尖端 device (260,634)、下箭头 (292,762)）。判读结果：**两处是同一处缺陷的两侧**
（上箭头指那条暗带本体、下箭头指紧贴「外观」行的硬边）。依据：① 该范围内逐行扫描
（阈值 1/255，x∈[0,190) 与 [210,300)）**只有 y≈723.5 这一条边**，其余全是 ±1 抖动；
② 它的左端止于 device x≈18（= CSS 12 = 原生 fade 的 `left:0` + 侧栏 12px 内边距），底边 = 侧栏
`regionArea` 底 = `footArea` 顶。**若这两处其实不是同一条边，需用户指明后再改**（方案里已写明）。

**用户图的尺子**：`-20%` 文本 device 宽 37px ÷ 实测 CSS 宽 25.27px ⇒ **DPR = 1.5**，CSS 视口
1280×576.7；侧栏被拖窄到 263.3px（比探测实例的 280px 窄 16.7px —— `-20%` 右对齐的位置正好差这
16.7px，对得上）。

**成因（真机探针量到的，不是推的）**：

| 事实 | 值 | 出处 |
| --- | --- | --- |
| 原生渐隐带 | `.bhn1Oq_fade{height:24px;background:linear-gradient(to bottom, transparent, var(--dsw-specific-sidebar-fill))}` | DSH `dsh-client-ui-workspace/lib/client.js:1219` |
| 它的收尾色 | `rgb(26,26,26)`（**不透明**） | 真机 `getComputedStyle(fade).backgroundImage` |
| 侧栏底色 | `rgba(26,26,26,0.34)`（半透明） | `preview/wallpaper/lib/client.js` 的 `[class$="_sidebarCol"]` 规则 + 现算的 `--wlp-side` |
| 接缝 | `y478=26,26,26 → y479=34,32,30`（单行硬跳变） | 用户图像素剖面（x=60） |

⇒ 带子最后一行的颜色 ≠ 它周围的真实底色。侧栏不透明时两者相等（DSH 自己的前提），改成半透明之后就露出来。
亮色主题下同一条缝是 `220,222,227 → 101,100,99`（Δ117）—— 比暗色刺眼得多。

**改法（只动 `preview/wallpaper/lib/client.js`：+2 条规则 +1 个常量）：**

- 撤掉原生那层上色：`[class$="_sidebarCol"] [class*="_fade"] { background-image: none !important; }`
- 改成内容容器自己渐隐：`[class*="_treeBody"]` 上
  `mask-image: linear-gradient(to bottom, #000 calc(100% - 24px), transparent)`（`-webkit-` 前缀同写）。
  **这不是"盖住"**：没有任何东西被画到背景上，透出来的是与下方逐像素相同的底色。
- 24px 收进 `LIST_EDGE_FADE = { heightPx: 24 }`（与原生 fade 的 height 同高，只写一遍）。
- 两条规则都门控在 `:root[data-dsh-warm-wallpaper-on]` 下 ⇒ 关档时与原生逐像素相同。

**踩到的坑（已写进契约当守卫）**：`[class$="_treeBody"]` **命中不到** —— 该元素实测带附加类
（`bhn1Oq_treeBody bhn1Oq_wide`）。这种失效不报错，遮罩会静静地不生效（页内先验第一版就是空的，
`maskOn: none` 才暴露）。所以必须用子串匹配 `[class*="_treeBody"]`，第 15 项检查专门拦它。

**验证（全在最终文件上跑）**：

- A/B（1280×577、DPR 1；用「合成暖底」复现用户那种亮壁纸 —— **复现手段，不进插件**）：暗色
  改前 Δ=(7,5,4)、逐行 `y478=26,26,26 → y479=34,32,30` ⇒ 改后 Δ=(0,0,0)、逐行连续；
  亮色 改前 Δ=(-109,-112,-117) ⇒ 改后 Δ=(0,0,0)。真壁纸：暗色 改前 Δ≤4 ⇒ 改后 1~2（抖动）；
  亮色 改前 Δ=124 ⇒ 改后 1~2。
- **真 DPR=2**（Edge `--force-device-scale-factor=2` + `Emulation.setDeviceMetricsOverride(deviceScaleFactor:2)`，
  页面自报 dpr 2、图 2560×1154、边缘在 y=958 —— 不是把 1x 图放大）：改前五处 Δ 全为 (8,6,4) ⇒ 改后全为 (0,0,0)。
- 状态覆盖（改后）：默认 / 悬停会话行 / 展开其余 23 个会话（会话行 6→29）/ 展开后滚到底
  （`bhn1Oq_list.scrollTop 747`）/ 搜索框展开 —— x=8/20/250/275 四处 Δ 全为 (0,0,0)。
- 关档回归（撤 ON 属性）：接缝区逐像素 0 不同；全图仅 84px 不同（0.0114%，包围盒 = 会话行的相对时间
  文字，两次跑相隔一分钟，本就该变）。
- 静态 15 项（新增第 15 项「列表底边渐隐」）/ `--browser`（真 Gecko：`fadeBg: none`、
  `mask: linear-gradient(rgb(0,0,0) calc(100% - 24px), rgba(0,0,0,0))`）/ `--hmr`（rebuilt=2 帧、
  文件逐字节还原）全绿。

**如实登记的边界**：① 用户那张图左边缘还有一条浅灰圆角竖条（device x0..9 / y294..572），我们的无头
环境**不复现**（`direction` 非 RTL、文档不可滚），疑为浏览器/系统滚动条 —— 不在箭头所指范围，本轮不动；
② 遮罩让 `_treeBody` 成为合成层，其中若有弹层会被那 24px 底带淡化 —— 原生那条"上色"带本来也盖同一条
24px（更钝），风险等价；③ 展开态真正的滚动容器是 `bhn1Oq_list`（探针按 `scrollHeight > clientHeight`
找到的），`[class*="Oq_list"]` 会先匹配到 `_listArea` —— 取值都按前者。

**守卫**：契约 `listEdgeFade`（`must` / `forbidden` / `height` / `suffixMatchWhy` / `measured`）＋
`tools/check.mjs` 第 15 项 ＋ 真机探针 `tools/probes/contract.js` 第 ⑭ 段；文档同步
`contract/ui-contract.md §11`、`preview/wallpaper/README.md §2.1.1`、`tools/README.md`。

**提交与回退点**：本轮改动一笔提交（等用户确认后执行）；回退点 = `828b19d`（橙点 6px 那一笔，工作树干净）。

## 0.12 已实施：动效层（弹簧光标 + 选区高亮）（2026-10-31）

**需求**：把 More 设置向导 2026-10-25 版那套输入框动效（弹簧光标 + 框内/正文选区动画高亮）
搬进 warm-ui。用户明确三点：在 3082 真实页面上定色、颜色从 warm-ui 的强调色 token 派生、
跟随主题（不写死暖色常量）。

**结构**：第三张样式表 `MOTION_STYLESHEET`（标记 `data-dsh-warm-motion`）+ 引擎 `createMotionApi`，
由 `mountMotion()` 挂在 `apply()` 里，开关是 `body[data-wta-motion]`（`EXTRA_DEFAULTS.motion`，默认 1）。
外观面板新增「动效」分组一行「光标·选区 关/开」——注意：**注册任何分组都会让面板多出分组标题与
分隔线**（`grouped = appearanceSections.length > 0`），所以侧栏底部那行面板从此是分组样式，这是可见变化。

**两个真机 bug（都记进 README 了）**：
1. 图层不能是 `position: fixed` 的包裹层 —— 会被单独合成，`mix-blend-mode` 的 backdrop 变透明，
   高亮退化成盖住文字的不透明色块（整行只剩一个 RGB 值）。改成 `display: contents` 才对。
2. `::selection` 的开关属性挂在 `<html>` 上，规则不能写成 `body[...] [attr] ::selection`
   —— `<html>` 不是 body 后代，规则永不匹配，结果是自绘高亮与原生蓝叠成两层。

**第三个坑（不是 bug，是判据错）**：判断亮/暗不能用 body 底色亮度 —— DSH 的 body 底色是
`transparent`（真正上色的是更下层），按 transparent 算恒为黑，亮色主题会被判成暗色、blend 用错。
改成"底色透明就按文字色反推"。

**实测数据（3082，1440×900 无头 Chrome）**：

| 项 | 数值 |
|---|---|
| 光标几何 | 与浏览器插入点矩形逐像素一致（279 / 124 / 18） |
| 光标横移 | 461→278.5，约 420ms 收敛，无过冲 |
| 闪烁 | 停手 518ms 后开始（设定 500ms） |
| 选区块 vs 浏览器行盒 | 精确 = 行盒外扩 2px（`l-2 t-2 w+4 h+4`），滚动 260px 后仍对齐 |
| 文字被染色 | 选中前后 +2~3 级；原生蓝色选中 +20 级 |
| 打字帧耗时 A/B | 关 29.71ms / 开 30.21ms（p50 32 / 29.7）—— 增量 ≈ 0.5ms |

**回退**：`git revert <本次提交>`；或外观面板「动效 → 关」（等价 `window.__dshWarmMotion.set(0)`）。

## 1. 这一轮做了什么（可复核）

**A. 2026-09-24：删掉玻璃「流动层」+ 修工具行重复胶囊**

流动层当初是用户点名要的（*"玻璃下的文字会轻微扭曲并处于动态扭曲…"*）；2026-09-24 用户改口
要它消失（*"消除输入框边缘波纹动效"*、*"不要用另一套动效替代"*）。删掉的东西：

- 代码：`GLASS_WARP` 配方表、`warpAt` / `warpFilterNodes` / `glassWarpOf`、20fps 驱动定时器与
  驱动登记表、`GLASS_MATERIAL.warp`/`warpAmp`、`GLASS_CALM.scale.warpAmp`、引擎表的 `warp` 列、
  `EXTRA_DEFAULTS.glassWarp`、`buildGlassMap` 里的边缘遮罩（它只为那层存在）。
- 契约 / 检查 / 探针：`glass.warp` → `glass.motion.state = "none"`（带三条 codeGuards 与实测数字）；
  检查项「动效门槛」→「玻璃无动效」；`tools/probes/glass-warp.js` 删除；真机断言第 ⑨ 节反过来
  核对"运行时也没有噪声原语 / 开关标记 / 多出来的胶囊"。
- 与基线的关系：`git diff f636fd2 -- lib/client.js` 只剩 `sizeKey` 重构与两处注释
  （13 insertions / 212 deletions），也就是玻璃回到"流动层之前"的样子。

重复胶囊（用户说的「重复的高级·审查」）= 工具行里两颗 `.wti-chip`。修法：清扫按**类名**
（不只按归属属性，否则扫不到旧版本遗留的无标记节点）+ **换代守卫**（只有最新一代能写工具行，
避免两个活实例互相删/塞）。见契约第 2 节与 `sweepOptimizerChips` 的注释。

**B. 上一轮的维护性改造（已完成态，细节见下面）**
**B. 上一轮的维护性改造（已完成态，细节见下面）**

根因（都来自代码，不是猜测）：

1. **样式表没打 `data-plugin`** → 模块加载器只在工厂返回那一刻认领还没打标的 `<style>`
   （`dsh-client-modules: claimStyles`），热重载只删 `style[data-plugin=包名]`
   （`dsh-client-hmr: removeOwnedStyles`）。我们的表在 `apply` 里才插 → 每加热更一次
   `<head>` 里多一份完整旧表；旧表把玻璃滤镜 svg 撑出 255px，页面能往下滚 =
   「壁纸跑到页面下面」。而且后加载的插件会把我们的表错认成自己的。
2. **挂载不幂等、没有换代清扫** → 两代节点/样式同时存在，是「修来修去」的来源。
3. **布局守卫写外来节点的内联样式** → 把壁纸画布 `display:none` 掉 = 「壁纸没了」。

修法（现在都由检查脚本守）：

- 样式表按 DSH 官方写法自己打 `data-plugin` + `data-plugin-css`，并在模块作用域插入；
  实现**只有一份**，在 `preview/shared/lib/client.js`（见第 3 节）；
- 注入节点登记在每包的 `NODE_OWNERS` 表里，带 `data-dsh-warm-owner="包名:节点名"`，
  挂载前先清扫同类旧节点（`sweepOwned` / `sweepLayers`）；
- 页面外层节点只能经 `mountDetached` / `mountLayer` / `installStyleSheet` 入文档，定位写内联；
- 布局守卫只对自己带归属标记的节点动手，别人的节点**只报告**；
- CSS 变量自检改成**逐表**（以前只扫增强表、跨表合并定义，基础表漏定义查不出来）。

实测证据（真 Firefox 1752×745 + 无头 Edge，2026-09-19 收尾那次）：

| 项 | 结果 |
| --- | --- |
| 静态（`node tools/check.mjs`） | **11 项全绿**（第 11 项 =「玻璃无动效」；探针 2 个） |
| 真机断言（`--browser`，视口取自契约 `viewports.wide`） | `chip` 态、行高 24、胶囊在、两根滑杆藏、卡片 952px、溢出 0、无主样式表 0、每个登记节点 1 个；`glassMotion: {state: none, noise: 0}`、`chips: {byClass: 1, marked: 1}`（**删干净了**） |
| 模块图谱（同一拍实测） | 有 `dsh-warm-shared`、没有 `dsh-warm-dynbg` |
| 热重载回归（`--hmr`） | `rebuilt=2` 帧；每拍 `base/extra/wallpaper` 各 1 份、无主 0、画布 1、溢出 0 |
| 闪烁探测（Chromium，8 秒） | 静止页面：DOM 变更 0 次、滤镜 id 每拍都在、动画 0；热重载期间：玻璃 svg 换 2 次、卡片 style 写 16 次（= 存盘闪一下的来源） |
| 参考截图 | `contract/refs/toolbar-chip-wide.png`、`toolbar-native-narrow.png`；`glass-warp-phase-a/b.png`、`glass-edge-mask-off/on.png` 只作被删那层的历史 |

## 2. 输入框在 plan 模式下变宽的结论（已实测，不是我们干的）

```
--dsh-chat-user-width = clamp(偏好, 640, 列宽 - 176)   # 有偏好时
                      = clamp(列宽 * 0.64, 680, 920)   # 没有偏好时
卡片宽度 = --dsh-chat-user-width + 32
```

偏好键 `localStorage['dsh.conversation.contentWidth']`（拖会话宽度手柄才会写）。
实测：无偏好 952px；偏好 1200 + 列宽 1472 → 1232px；同一份偏好 + 列宽 920 → 776px。
**进 plan 模式后可用列变宽，同一份偏好不再被夹住**，所以看起来"变宽了"。
要回到默认：`localStorage.removeItem('dsh.conversation.contentWidth'); location.reload();`

## 3. 两件结构改动：都已完成

**① 删死配置 `dsh-warm-dynbg` —— ✅ 完成**
两份 patch（3081 `~/.dsh/profiles/web/`、3082 `.dsh-warm-preview/profiles/web/`）里的
`dsh-warm-dynbg` 段已整段删除，`preview/toggle-dynbg.sh` 也删了，`preview/dynbg/` 只作历史存档。
删后两份 patch 均为 `dsh-warm-shared` → `dsh-warm-ui` → `dsh-warm-brandgag` → `dsh-warm-wallpaper`。

**② 跨包重复代码收进共享客户端模块 `dsh-warm-shared` —— ✅ 完成并实测**

- 新包：`preview/shared/`（`package.json` / `lib/index.js` / `lib/client.js` / `README.md`），
  两份 patch 都把它放在最前面；两个消费方的 `package.json` 里加了
  `dsh.client.external: ["dsh-warm-shared"]`（宿主据此排依赖行的先后，重启后生效）。
- 收拢的**只有**两份真重复：`installStyleSheet`（逐字节重复的那一份，现在叫
  `createStyleInstaller(包名)`）与 `cssPropertyName`（同一规则写了两遍）。
  实测 `mixLinear` / `withAlpha` / `checkCssVars` **各只有一份**，不是重复，留在原包 ——
  边界写在 `contract/ui-contract.md` 第 5 节（各包清扫副作用不同，硬抽只会多一层间接）。
- 消费方改法（工厂体里取，不写"本地降级实现"——那等于把重复抄回来）：
  `const { createStyleInstaller, cssPropertyName } = require("dsh-warm-shared");`
  `const installStyleSheet = createStyleInstaller(PACKAGE_ID);`
- 契约 `contract/ui-contract.json`：共享包 `role: shared`、两个消费方 `requires`；
  检查项「共享依赖」核对三处（代码 `require` / 清单 `external` / 契约 `requires`），
  并禁止消费方再自己写一遍 `dataset.plugin =`。
- `install.sh` / `uninstall.sh` 改成装/卸**两个**包（共享包在前）；脚本只在临时副本上
  验过往返（装→幂等→卸，YAML 可解析），**没有对着真实 profile 跑过**。

## 4. 怎么验证（一条命令一条命令来）

```bash
# 静态（零依赖，几秒）
node tools/check.mjs

# 真机断言 + 热重载回归（需要 Windows 侧 Firefox；--hmr 会临时改一行源码再逐字节还原）
cd /mnt/d/projects/_warmtheme_shots && MODE=gpu DPR=1.2 ./_ffup.sh 2828 1752 830
DSH_NODE_EXE="/mnt/c/Program Files/nodejs/node.exe" \
DSH_URL="http://127.0.0.1:3081/?token=<你的 token>" \
node tools/check.mjs --browser --hmr
```

token 每次启动都会变，现取（**别写进仓库任何文件**）：
`grep -o 'http://127.0.0.1:3081/?token=[A-Za-z0-9_-]*' /mnt/d/WSL/logs/dsh-web-3081.log | head -1`

WebGL 截图必须真 Firefox（无头 Chromium 的 WebGL 是死的）。窄屏用 `--width 1180`
（`--width` 是 CSS 像素；插件的窄屏断点是 1240）。截图后**自己 `read_image` 看**。

**输入框边缘"有没有在动"怎么量**（Chromium；玻璃的动效已删，这条现在用来确认**没有**）：
先把壁纸那层藏掉（一条：`document.querySelector('[data-dsh-warm-wallpaper-layer]').style.display = 'none'`），
再用 `_warmtheme_shots/cdp.mjs both` 跑两次（间隔几秒 = 两个相位），然后差分卡片区域
（卡片实测是 x 535..1487 / y 388..502）。**壁纸开着时不能用来判断玻璃动没动** —— 卡片背后那张会动的壁纸会把差异
抬到 5.7，玻璃自身那点只有 0.23（见 §0.5 的表）。

## 5. 必须守的不变量（`tools/check.mjs` 在守，别绕过）

1. 每张样式表自带 `data-plugin` / `data-plugin-css`，且注入实现只有一份（共享包里）；
2. 每个注入节点带 `data-dsh-warm-owner`，同类**永远只有一个**（挂载前清扫上一代）；
3. 页面外层节点只能经挂载助手入文档，定位写**内联**（内联永远赢样式表，含热更残留）；
4. 契约 `contract/ui-contract.json` 是"UI 应该长什么样"的唯一来源：**改设计先改契约再改代码**；
5. 每个客户端半边都导出 `apply` / `inject`（否则 runner 判它非法，**整个宿主启动被拦住**）；
6. 跨包依赖要在**三处**同时登记（代码 `require` + 本包 `package.json` 的 `dsh.client.external`
   + 契约的 `requires`），且消费方不得再抄一份注入三件套；
7. `tools/probes/*.js` 是**函数体**（harness 塞进 async 箭头函数跑），`node --check` 对它们无效 ——
   检查项「探针」按同一种包装提前解析；
8. **玻璃不做动效**：契约 `glass.motion.state = "none"` 时，代码里不许再出现流动层的
   配方 / 噪声原语 / 开关（检查项「玻璃无动效」+ 真机断言第 ⑨ 节各守一半）。想加回来必须先改契约；
9. 真机断言的视口取自契约 `viewports.wide`（不然同一份断言会随窗口大小落到 `chip` 或 `native`，
   "行高 24"那条时灵时不灵 —— 这是本轮顺手修的）；
10. **壁纸开档时，侧栏列表底边只能靠内容遮罩渐隐**：原生 `.bhn1Oq_fade` 的收尾色是不透明的
   `--dsw-specific-sidebar-fill`，在侧栏半透明之后会在底边留一条硬缝（检查项「列表底边渐隐」+
   真机断言第 ⑭ 段各守一半）。遮罩宿主的类名带附加类 ⇒ **后缀匹配只能用 `*=`**；
    两条规则必须门控在 `:root[data-dsh-warm-wallpaper-on]` 下（关档要与原生逐像素相同）。

## 6. 硬约束（违反了就是改崩）

1. **不要 kill / 重启 `dsh web` 自己**（agent 的 shell 是它的子进程）——重启只能由用户来做；
2. 不要跑 `dsh --dump-config`（会重写 `cordis.yml`）；
3. 不要读/打印 `~/.dsh/.credentials.yaml` 或任何 key；**不要把带 token 的地址写进仓库任何文件**；
4. 不要动 `~/.dsh/settings.yaml` 里 `dsh-auto-review` 段；
5. 不要动 `/mnt/d/projects/_warmtheme_shots` 里用户自己的文件（只有跑 `_ffup.sh` 那套验证是既定的）；
6. 回复与工具说明一律用中文；界面文案用中文。

## 7. 工作习惯（用户明确要求过的）

- **改 `lib/client.js` 时每一步存盘都要是自洽状态**：先加新东西 → 再切调用点 → 最后删旧的。
  半删状态（删了定义没删调用）能过 `node --check`，但热重载进浏览器后会变成"僵尸世代"：
  每帧抛异常 + 卡片样式停在半成品 = 输入框持续闪烁（2026-09-24 真踩过，见 §0.5）。
  检查项「玻璃无动效」现在会把已删标识符的回归拦下来，但存盘顺序仍要靠人守。

- 少硬编码：常数/形态收进表或 `:root` 变量层，新增一种形态 = 加一行；
- 别用像素测量脚本做识别，直接用 `read_image` 看（我是识图模型）；
- 先看现有代码约定再动手；单职责小函数；只给"非显然的为什么"写注释；本地化改动；
- 交付时说清"哪些值被收进了哪张表"、以及哪些结论是**实测**的、哪些只是**推理**；
- **回退点（2026-09-24 夜 = 修「输入框闪烁」）**：
  - 本轮提交：`50e6349`（换代守卫挂 window + 玻璃自我卸载 + 出口 + 契约 lifecycle +
    已删标识符表）、`e44e3f0`（回归探针 `probes/glass-zombie.js` + 契约第 7 节 + 工具文档）；
    想整段退回去：`git revert e44e3f0 50e6349`（先退文档再退代码），或
    `git switch --detach 45fd6ed`（只读看"修之前"的样子）。
  - 注意：`50e6349` 之后的代码**不允许**再出现半删状态存盘 —— 第 11 项检查会立刻报红。
- **回退点（2026-09-24 = 删流动层 / 修重复胶囊）**：
  - 本轮提交：`51cea6e`（重复胶囊）、`8e3a626`（删流动层）、`ebead85`（回退点文档）、
    `bf43ce7`（回归探针 `probes/dup-chip.js` + 清脚手架）；
    想回到"还有流动层"那一版：`git revert 8e3a626`，或 `git switch --detach c7c6525`（只读看）。
- **回退点（上一轮 = 流动层开发前）**：
  - 归档：`.snapshots/_archives/dsh-warm-ui-20260919-135358-pre-glass-distort.tar.gz`
    （sha256 `d4a4a8f523e459de4084e848232a63ba1b1ea61a5fbc6517af958015649c317f`）；
  - 目录快照：`.snapshots/20260919-135358-pre-glass-distort/`（含 `MANIFEST.sha256` 与两份 patch 副本）；
  - git：基线提交 `f636fd2`、tag `pre-glass-distort`（`git switch --detach pre-glass-distort` 即回到改动前）。
- 更早的回退点：`.snapshots/20260919-1230-pre-maintainability/`（维护性改造前的两个客户端包 + 宿主半边）。
