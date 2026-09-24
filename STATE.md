# 当前状态与下一步（2026-09-19）

> 这份文件的目的：**上下文被压缩/换新会话之后，靠它就能接着干**，不用重新做一遍审计。
> 一句话现状：**维护性改造（P0 + P1）全部做完并实测通过；死配置 dynbg 已删；
> 跨包重复代码已收进共享包 `dsh-warm-shared` 并迁移完消费方；
> 液态玻璃**不做动效**（2026-09-24 按用户要求删掉「流动层」，只留静止的折射 + 边缘光 + 表面反射）；
> 工具行「优化」胶囊改成按类名清扫 + 换代守卫，重复胶囊不再出现。
> 静态 11 项 + 真机断言 + 热重载回归全绿，且**没有重启过 dsh web**（也不需要）。**

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
  `baseFrequency` / `scale`。实测：这两个属性在 900ms 内被写 60–64 次（`tools/_tmp-freeze.js`
  拦写时数的）。
- 重复胶囊 = 工具行里多出来的 `.wti-chip` **没有**归属标记 `data-dsh-warm-collapse`（标记是
  后来才加的），而清扫原来只按属性找 → 扫不到它 → 新旧并排。复现（改之前）：往
  `.dpo-controls` 塞一颗无标记同类节点 → 计数立刻 1 → 2，经过一次热重载仍是 2（`tools/_tmp-dup.js`）；
  改之后同一动作恒定 1。

**关键测量（输入框边缘到底谁在动；同一张卡片，Chromium，两相位差分，卡片 x 535..1487）：**

| 状态 | 卡片上沿带（y 388..418） | 卡片整块（y 388..502） |
| --- | --- | --- |
| 壁纸在 + 流动层在（改之前） | **5.73**（26.3% 像素差 >8） | — |
| 壁纸在 + 流动层驱动**冻住** | 5.43（21.7%） | 7.88 |
| **壁纸那层藏掉** + 流动层在 | **0.233**（0.07%） | 1.545 |

读法：边缘的"动"大部分是**会动的壁纸透过玻璃**，不是玻璃自己的动效。所以删掉流动层之后
边缘**仍会**看到壁纸在动 —— 那是壁纸（`dsh-warm-wallpaper`）的，要静止它得关壁纸或改玻璃的
采样方式，两件都改观感，**没有替用户决定**（写进契约 §6 了）。

**用户后来问的「输入框经常闪烁」：** 全新页面 + 当前代码，连续 8 秒实测：卡片 / 玻璃 svg /
body / 工具行的 DOM 变更是 **0 次**，卡片引用的滤镜 id 每一拍都在，动画 0 个
（探测器 `tools/_tmp-flicker.js`）。而**在一次热重载期间**同一个探测器量到：玻璃 svg 被换掉
**2** 次、卡片 style/class 被写 **16** 次、body 28 次 —— "每存一次盘闪一下"是热重载的固有代价
（本轮我存了十几次 `lib/client.js`）。删流动层之前那 20fps 的属性写入还会让浏览器每拍重跑
一遍滤镜链，也可能被看成闪烁。**等用户确认：现在不存盘时还闪不闪。**

**待用户 / 待办：**

1. **输入框宽度**（上一轮的旧问题，仍未定）：插件没有任何宽度规则，宽度是 DSH 的偏好
   `localStorage['dsh.conversation.contentWidth']`（值 = 卡片宽 − 32，下限 640）。三条路：
   拖宽度手柄 / 写偏好后刷新 / 让插件加上限（要先进契约）。**等用户给目标宽度。**
2. 「输入框经常闪烁」：等用户确认是不是只在热重载时闪（见上）。

## 1. 这一轮做了什么（可复核）
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
先把壁纸那层藏掉（`tools/_tmp-nowall.js` 的做法：给 `[data-dsh-warm-wallpaper-layer]` 设
`display:none`），再用 `_warmtheme_shots/cdp.mjs both` 跑两次（间隔几秒 = 两个相位），
然后差分卡片区域。**壁纸开着时不能用来判断玻璃动没动** —— 卡片背后那张会动的壁纸会把差异
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
   "行高 24"那条时灵时不灵 —— 这是本轮顺手修的）。

## 6. 硬约束（违反了就是改崩）

1. **不要 kill / 重启 `dsh web` 自己**（agent 的 shell 是它的子进程）——重启只能由用户来做；
2. 不要跑 `dsh --dump-config`（会重写 `cordis.yml`）；
3. 不要读/打印 `~/.dsh/.credentials.yaml` 或任何 key；**不要把带 token 的地址写进仓库任何文件**；
4. 不要动 `~/.dsh/settings.yaml` 里 `dsh-auto-review` 段；
5. 不要动 `/mnt/d/projects/_warmtheme_shots` 里用户自己的文件（只有跑 `_ffup.sh` 那套验证是既定的）；
6. 回复与工具说明一律用中文；界面文案用中文。

## 7. 工作习惯（用户明确要求过的）

- 少硬编码：常数/形态收进表或 `:root` 变量层，新增一种形态 = 加一行；
- 别用像素测量脚本做识别，直接用 `read_image` 看（我是识图模型）；
- 先看现有代码约定再动手；单职责小函数；只给"非显然的为什么"写注释；本地化改动；
- 交付时说清"哪些值被收进了哪张表"、以及哪些结论是**实测**的、哪些只是**推理**；
- **回退点（2026-09-24 = 删流动层 / 修重复胶囊）**：
  - 本轮两个提交：`51cea6e`（重复胶囊）、`8e3a626`（删流动层）；
    想回到"还有流动层"那一版：`git revert 8e3a626`，或 `git switch --detach c7c6525`（只读看）。
- **回退点（上一轮 = 流动层开发前）**：
  - 归档：`.snapshots/_archives/dsh-warm-ui-20260919-135358-pre-glass-distort.tar.gz`
    （sha256 `d4a4a8f523e459de4084e848232a63ba1b1ea61a5fbc6517af958015649c317f`）；
  - 目录快照：`.snapshots/20260919-135358-pre-glass-distort/`（含 `MANIFEST.sha256` 与两份 patch 副本）；
  - git：基线提交 `f636fd2`、tag `pre-glass-distort`（`git switch --detach pre-glass-distort` 即回到改动前）。
- 更早的回退点：`.snapshots/20260919-1230-pre-maintainability/`（维护性改造前的两个客户端包 + 宿主半边）。
