# 当前状态与下一步（2026-09-19）

> 这份文件的目的：**上下文被压缩/换新会话之后，靠它就能接着干**，不用重新做一遍审计。
> 一句话现状：**维护性改造（P0 + P1）全部做完并实测通过；死配置 dynbg 已删；
> 跨包重复代码已收进共享包 `dsh-warm-shared` 并迁移完消费方；
> 液态玻璃新增「流动层」——玻璃底下的内容持续轻微游动（Chromium 生效，Firefox 平台不支持，实测见 §0.3）。
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

   推论（都已落地）："玻璃底下的东西被扭 / 在动"只在 Chromium 看得见；Firefox 唯一的
   替代路是把带限位移挂在会话内容那个大元素上，实测每帧多花 ≥17ms
   （`tools/probes/glass-cost.js`：中位帧 33ms → 50ms，而且只要挂着就付），**决定不做**。

## 1. 这一轮做了什么（可复核）

**A. 本轮新增：液态玻璃的「流动层」（用户要的新功能）**

要求原话：*"我希望玻璃下的文字会轻微扭曲并处于动态扭曲。在能看清字的前提下，
扭曲程度也能让我明显看见在动态扭曲。"*

- 做法：在折射之后叠一条 `feTurbulence` + `feDisplacementMap` 的**低频噪声位移**，
  由一个 20fps 的定时器驱动它的 `baseFrequency`（变形）与 `scale`（呼吸）缓慢摆动，
  两条摆动错相（`phaseStep`）——合起来才是"流动"而不是"心跳"。
- 数字全在 `GLASS_WARP` 表（一行一个配方：`amp` 4.2px / `period` 9s / `fps` 20 /
  `ampSwing` 0.6 / `freqSwing` 0.45）；全局幅度走 `GLASS_MATERIAL.warpAmp`，
  阅读态按 `GLASS_CALM.scale.warpAmp`（0.35）折下去 —— 鼠标扫上来时它自己安静下来。
- 三道门：`prefers-reduced-motion`、`localStorage['dsh-warm-x-glassWarp']`、
  引擎表的 `warp` 列（契约 `glass.warp.engineSupport` 是对照表）。关掉时**不加任何原语**
  → 与改动前逐像素相同。新检查项「动效门槛」逐条核对。
- 为什么用噪声而不是再写一条正弦：`GLASS_LENS` 那几个形状是**屏幕坐标里的固定图案**，
  要让它动就得按帧重建整张地图（`buildGlassMap` + `toDataURL`，这里最贵的一步）；
  噪声是滤镜原语自己生成的，驱动它只要每拍改两个属性。

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
| 静态（`node tools/check.mjs`） | **11 项全绿**（新增「动效门槛」；探针 3 个） |
| 真机断言（`--browser`，视口取自契约 `viewports.wide`） | `chip` 态、行高 24、胶囊在、两根滑杆藏、卡片 952px、溢出 0、无主样式表 0、每个登记节点 1 个；`engine: gecko` 且 `glassWarp: {noise: 0, displacement: 0}`（**引擎门槛真的生效**） |
| 模块图谱（同一拍实测） | 有 `dsh-warm-shared`、没有 `dsh-warm-dynbg` |
| 热重载回归（`--hmr`） | `rebuilt=2` 帧；每拍 `base/extra/wallpaper` 各 1 份、无主 0、画布 1、溢出 0 |
| 流动层（无头 Edge，两相位夹具差分） | 滤镜里 `feTurbulence` ×2、位移 ×2；驱动值确实在变；两时刻 平均像素差 **7.88–13.32**、3.1–5.2% 像素差>8、逐窗口位移 −2…+2px；**同图的对照区**（无玻璃）0.02 / 0.0% |
| 参考截图 | `contract/refs/toolbar-chip-wide.png`、`toolbar-native-narrow.png`、`glass-warp-phase-a.png` / `-b.png`（都自己看过） |

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

**流动层（只在 Chromium 看得见）另有一条**：把探针包成 `(async () => { … })()`，
用 `_warmtheme_shots/cdp.mjs both` 跑两次（间隔几秒 = 两个相位），再差分截图：

```bash
{ printf '(async () => {\n'; cat probes/glass-warp.js; printf '\n})()\n'; } > tools/_tmp-wrap.js
"/mnt/c/Program Files/nodejs/node.exe" 'D:\projects\_warmtheme_shots\cdp.mjs' both \
  'D:\projects\dsh-warm-ui\tools\_tmp-wrap.js' 'D:\projects\dsh-warm-ui\tools\_tmp-a.png' --wait 5000
# 再跑一次 --wait 11000 → _tmp-b.png，然后比这两张的夹具区域（40,40,860,140）
```

**为什么不在真实卡片上量**：卡片背后的会话内容两次加载之间自己就会变（实测会话区
像素差 11.7，比玻璃区还大）；给它另铺底纹也不行 —— 卡片在 app 根的层叠上下文里，
body 级注入的 z-index 压住的也是整棵 app，进不了卡片的 backdrop。

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
8. **持续动效必须带三道门**：`prefers-reduced-motion`、单独开关（登记在 `EXTRA_DEFAULTS`）、
   引擎表逐行表态；关掉时**不加原语**（= 与没有这一层逐像素相同）。数字只在契约里定一次；
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
- **回退点（本轮 = 流动层开发前）**：
  - 归档：`.snapshots/_archives/dsh-warm-ui-20260919-135358-pre-glass-distort.tar.gz`
    （sha256 `d4a4a8f523e459de4084e848232a63ba1b1ea61a5fbc6517af958015649c317f`）；
  - 目录快照：`.snapshots/20260919-135358-pre-glass-distort/`（含 `MANIFEST.sha256` 与两份 patch 副本）；
  - git：基线提交 `f636fd2`、tag `pre-glass-distort`（`git switch --detach pre-glass-distort` 即回到改动前）。
- 更早的回退点：`.snapshots/20260919-1230-pre-maintainability/`（维护性改造前的两个客户端包 + 宿主半边）。
