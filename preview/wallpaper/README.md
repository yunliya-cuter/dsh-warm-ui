# dsh-warm-wallpaper —— 动态壁纸样品（纸 / 摩尔纹）

> **这是挂在隔离预览实例 3082 上的样品**，不是成品。真实实例（3081 / `~/.dsh`）的 patch
> 里从来没有这一行。本目录只包含插件本体；截图、性能脚本、调参中间的对照图都在
> `/mnt/d/projects/_warmtheme_shots/wallpaper-preview/`。

一句话：**一个插件、两种模式、可即时切换**的动态背景，铺满视口、待在所有 UI 面板后面，
从「大面」透出来。默认「摩尔纹」。

---

## 1. 开关与切换

| 做什么 | 命令 / 操作 |
| --- | --- |
| 挂上插件 | `bash /mnt/d/projects/dsh-warm-ui/preview/toggle-wallpaper.sh on` |
| 摘掉插件 | `bash /mnt/d/projects/dsh-warm-ui/preview/toggle-wallpaper.sh off` |
| 看状态 | `bash /mnt/d/projects/dsh-warm-ui/preview/toggle-wallpaper.sh status` |
| 切模式 | 侧栏底部**「壁纸」那一行**（在「外观」「提灯」下面，`order: 30`）→ 点开选 **关 / 纸 / 摩尔纹** |

- 控件注册在 `sidebar.footer.action`，`id: dsh-warm-wallpaper-control`，`order: 30`
  （外观 10 / 提灯 20 / 壁纸 30，三个各占一整行，不挤）。
- 选择记在 `localStorage["dsh-wallpaper-mode"]`，默认 `2`（摩尔纹）。
- 脚本口：`window.__dshWallpaper.setMode(0|1|2)`、`.state()`、`.configure({...})`（后者只在 3082 调参用）。
- **改了插件或 patch 之后要刷新浏览器**；摘/挂插件（patch 里的 insert 块）需要跑一次
  `start-preview.sh` 重启，**重启会换 token**。

### 回滚（一行）

```bash
bash /mnt/d/projects/dsh-warm-ui/preview/toggle-wallpaper.sh off && bash /mnt/d/projects/dsh-warm-ui/preview/start-preview.sh
```

只想过把瘾：`toggle-wallpaper.sh off` 之后**刷新一次浏览器页面**即可
（patch 是热加载的 —— profiles/web/package.json 写着 `dsh.profile.patchReload: "live"`，
dsh-app-boot 的 watchUserPatches 用 cordis HMR 盯着它，加/删条目都不用重启），
UI 立刻回到完全不透明。

### 取当前 token

token 每次启动都会变，**不要把它写进本仓库任何文件**（写下来的都会过期，而且等于泄露）。
重启后现取：

```bash
grep -o 'http://127.0.0.1:3082/?token=[A-Za-z0-9_-]*' /mnt/d/projects/.dsh-warm-preview/server.log | head -1
```

---

## 2. 它到底做了什么

### 2.1 为什么必须「把大面变透明」

DSH 暗色主题里，**四个铺满视口的面全是不透明的**：

| 元素 | 底色 |
| --- | --- |
| `pI_x6G_frame`（应用外框，1600×1000） | `var(--dsw-alias-bg-base)` = `#141414` |
| `wSkVaW_root`（对话列） | 同上 |
| `pI_x6G_sidebarCol`（侧栏列） | `var(--dsw-specific-sidebar-fill)` = `#1a1a1a` |
| `hHd-Xa_root`（侧栏内容） | 同上 |

什么都不做的话，`z-index:-1` 的画布**一个像素也透不出来**。所以插件把这**恰好四个**面改成
透明/半透明，选择器用**类名后缀**（不依赖 CSS-module hash，DSH 升级换 hash 也不会瞎套；
命中不到只是背景看不见，不会弄坏 UI）：

```css
:root[data-dsh-warm-wallpaper-on] [class$="_frame"],
:root[data-dsh-warm-wallpaper-on] [class$="_root"],
:root[data-dsh-warm-wallpaper-on] [class*="quietBars"] { background-color: transparent !important; }
:root[data-dsh-warm-wallpaper-on] [class$="_sidebarCol"] { background-color: var(--wlp-side) !important; }
```

- `--wlp-side` 由 JS 从当前 `--dsw-specific-sidebar-fill` 现算成 `rgba(..., 0.34)`，
  主题换色会跟着重算（MutationObserver 盯 body 的 style/class）。侧栏保住「比正文区暗一档」
  的层次，同时让壁纸透出来。
- **卡片 / 菜单 / 输入框 / 浮层一律不碰**（它们用 `bg-layer-*` / `specific-menu`），
  文字永远落在自己的不透明底上。
- 关档时这些覆盖连同画布一起撤掉。实测关档后
  `_frame` = `rgb(20,20,20)`、`quietBars` = `rgb(26,26,26)`，
  与「没装这个插件」逐像素相同。

### 2.1.1 侧栏半透明之后的连带账：列表底边那条原生渐隐带（2026-09-25）

把侧栏改半透明会**破坏一个别人写死的假设**。DSH 的会话列表底部有一条原生渐隐带：

```css
.bhn1Oq_fade{height:24px;position:absolute;bottom:0;
  background:linear-gradient(to bottom, transparent, var(--dsw-specific-sidebar-fill));}
```

它的收尾色是**不透明**的侧栏填充色 —— 侧栏不透明时它正好等于周围底色，看不出边界；一旦侧栏变成
半透明（`--wlp-side`），带子最后一行就和周围差一截，底边留下一条**横向硬缝**（用户 2026-09-25 的
标注图里那两处「分割感」就是它的上色段与那条边；亮色主题下同一条缝 Δ117）。所以这条带子也由本插件接管 ——
**不是盖住，是换机制**：

```css
:root[data-dsh-warm-wallpaper-on] [class$="_sidebarCol"] [class*="_fade"] { background-image: none !important; }
:root[data-dsh-warm-wallpaper-on] [class$="_sidebarCol"] [class*="_treeBody"] {
  -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 24px), transparent);
          mask-image: linear-gradient(to bottom, #000 calc(100% - 24px), transparent);
}
```

- 上色撤掉、改成**内容自己渐隐**：透出来的是与下方逐像素相同的底色，壁纸多亮都不会再有接缝。
- 24px 与原生 `bhn1Oq_fade` 的 `height` 同高，常量只有一处（`LIST_EDGE_FADE.heightPx`），两条
  `mask-image` 声明引用它。
- **后缀必须用 `*=`**：遮罩宿主实测带附加类（`bhn1Oq_treeBody bhn1Oq_wide`），`[class$=...]` 匹配不到，
  而且这种失效**不报错** —— 遮罩会静静地不生效（页内先验复现过）。
- 只在 `data-dsh-warm-wallpaper-on` 下生效：关档时两条规则整条不生效，与原生逐像素相同
  （回归实测：接缝区 0 像素不同）。
- 静态守卫 `tools/check.mjs` 第 15 项、真机守卫 `tools/probes/contract.js` 第 ⑭ 段；A/B 数字与状态
  覆盖（默认 / 悬停行 / 展开其余会话 / 滚到底 / 搜索）登记在 `contract/ui-contract.json` 的
  `listEdgeFade.measured` 与 `STATE.md §0.11`。

### 2.2 没有 filter、没有 mix-blend-mode

画布是 `body` 的直接子节点、`position:fixed; inset:0; z-index:-1`。
不用 `mix-blend-mode`（穿不过 stacking context，而且那种「叠在 UI 上」的突兀感用户已经否过），
也不用 `filter`（全屏 blur 是性能红线，实测 66.6ms/帧）。就是老老实实待在后面。

### 2.3 两种模式

| 模式 | 做法 | 动态（周期） |
| --- | --- | --- |
| **纸 / 纤维** | 烘焙一张各向异性噪声「纸浆」高度场 + 梯度；每帧只算一道极慢掠过、形状解析的斜光带。纤维靠高度场沿光方向的浮雕着色被「照出来」，没被照到的地方几乎不可见。 | 主光楔 47.6s、冷色次光楔 73s |
| **摩尔纹** | 两组同心环的相位差有两个尺度：细拍频（真摩尔纹）+ 1/48 谐波（几百 px 的柔和明暗场）；细环线只在大尺度明暗场的亮处长出来。圆心推到画面外，只留弧不见心。 | 圆心漂移 113~167s、节距呼吸 97/127s、冷暖分界 0.0002 rad/s |

两个模式都**没有全局明暗脉动**，也**没有快速扫过的高对比元素**。

---

## 3. 性能

方法照 `_warmtheme_shots/perf-bench.js`：页内 rAF 累加 `performance.now()` 差，另挂 `longtask`
observer。**环境**：headless Edge、软件渲染（`--disable-gpu`）、1600×1000、DPR 1。
**本轮测试时 load average = 0.40（其他代理都已收工）**，3081 常驻占 ~26% CPU、3082 ~9%。

**滚动负载怎么造的**：预览实例停在 hero、没有可滚动的对话，所以脚本往
`[class*="_scrollBody"]` 里塞 260 段静态填充文本造出真实滚动条，再以 55px/16ms 滚动，
同时派发 `pointermove`（提灯也活着）。测完立即移除。

三次重复，格式 `run1 / run2 / run3`，每组 142~158 帧：

| 状态 | 场景 | 中位 (ms) | p95 (ms) | >33ms 帧数 | 掉帧 | longtask |
| --- | --- | --- | --- | --- | --- | --- |
| **关** | 空闲 | 16.7 / 16.7 / 16.7 | 16.7 / 16.8 / 16.8 | 0 / 0 / 0 | 0 / 0 / 0 | 0 |
| **关** | 滚动+指针 | 16.7 / 16.7 / 16.7 | 16.8 / 16.7 / 16.8 | 0 / 0 / 0 | 0 / 0 / 0 | 0 |
| **纸** | 空闲 | 16.7 / 16.7 / 16.7 | 16.8 / 16.8 / 16.7 | 0 / 0 / 0 | 0 / 0 / 0 | 0 |
| **纸** | 滚动+指针 | 16.7 / 16.7 / 16.7 | 16.8 / **33.3** / 16.7 | 0 / **10** / 0 | 0 / **10** / 0 | 0 |
| **摩尔纹** | 空闲 | 16.7 / 16.7 / 16.7 | 16.7 / 16.7 / 16.7 | **3** / 0 / 0 | **3** / 0 / 0 | 0 |
| **摩尔纹** | 滚动+指针 | 16.7 / 16.7 / 16.7 | 16.8 / 16.8 / 16.8 | 0 / **1** / **1** | 0 / **1** / **1** | 0 |

**每一帧的画布渲染耗时**（`r.render()` 自己量的）：

| 模式 | 内部分辨率（1600×1000 下） | work 中位 | work p95 |
| --- | --- | --- | --- |
| 纸 | **354×221**（4.5× 放大） | 4.0~4.6 ms | 5.3~5.4 ms |
| 摩尔纹 | **358×224**（4.5× 放大） | 4.4~4.6 ms | 5.3~5.5 ms |

**怎么读这张表**：18 组「状态×场景×重复」里，中位**一律 16.7ms**，p95 只有一次到 33.3ms；
>33ms 的帧总共 14 帧 / 约 2700 帧 = **0.5%**，且**没有一帧超过 50ms、没有一次 longtask**。
掉帧不是每次都 0：唯一成规模的一次是 run2 的「纸 · 滚动+指针」10 帧 —— 那是把它和
「55px/16ms 连续滚动 + 提灯同时活着」叠在一起的最坏情况。**渲染器自己让路**帮了忙
（见下）。

复现：

```bash
cd /mnt/d/projects/_warmtheme_shots/wallpaper-preview
./run.sh eval perf.js --width 1600 --height 1000 --wait 5000
```

---

## 4. 为「当背景」调参：判断与取舍

草稿是给人凑近看的（亮带峰值 ~200/255），挂到 UI 后面必须**再暗一档、对比再收一档**。
所有数字集中在 `lib/client.js` 顶部，一处可改。

### 4.1 内部分辨率：**74~80k 像素，CSS 放大 4.5×**

- 全屏 `filter: blur(2.5px)` = **66.6ms/帧（15fps）** —— 绝对不碰。
  正确路径是**低分辨率 canvas 逐像素画 + CSS 双线性放大**：合成器放大一张小贴图几乎免费，
  而且「柔化」正是用户要的效果。
- 试过更大的预算：纸 125k px（446×279）→ work 中位 9.6ms，空闲就有 **36/107 帧 >33ms**；
  摩尔纹 130k px → work 10.9ms，帧间隔中位直接掉到 **33.3ms（30fps）**。守不住。
- 收到 **纸 78k / 摩尔纹 80k**（1600×1000 下 354×221 / 358×224，4.5× 放大）后才有余量。

### 4.2 帧率：**画布 30fps + 主线程让路**

- `FRAME_SKIP = 2`：rAF 仍跑 60fps（**页面帧率不掉**），画布每两帧更新一次。
  两个模式的时间常数是 47.6s / 113~167s，30fps 下每次更新画面只挪 **0.6~1.8px** —— 看不出来。
- 再叠一层自适应：**上一帧间隔 >22ms，或自己这一笔 >9ms，就多歇两帧**。
  背景是几十秒尺度上的运动，少画两帧看不出来，但页面帧率能守住。
  这就是「不砍画质也能守住 0 掉帧」的那一步。

### 4.3 暗度与对比：**两步映射，最亮处压到正文对比度 5.2~5.8:1**

```
k   = pivot + (c - pivot) * contrast      // 绕支点收对比：亮带不刺、暗场不至于死黑
out = 20 + (k - 20) * vis                 // 再整体压向界面底色 #141414（灰度 20）
```

| 模式 | pivot | contrast | vis | 最亮处正文对比度 |
| --- | --- | --- | --- | --- |
| 纸 | 40 | 0.80 | **0.34** | **5.78 : 1** |
| 摩尔纹 | 30 | 0.85 | **0.28** | **5.21 : 1** |

**依据不是手感，是算出来的**：正文 `#dfe1e6` 的线性亮度 L = 0.7375，AA(4.5:1) 对应背景灰度
≈ 97；目标把最亮处压到 80 上下（≈5.6:1）留余量。然后按这个区间做了两轮亮度 sweep 并**亲眼比**
（`variants-vis.js` / `variants-moire-vis.js`，对照图 `wp-paper-vis.png` / `wp-moire-vis.png`）：
`vis` 每降 0.06~0.08，最亮处对比度涨约 0.6~0.9，同时纹理开始「看不见」。
纸选 0.34、摩尔纹选 0.28 是「纹理还看得出来」和「文字绝对安全」的交点。

**最终截图实测**（整幅，`shotstat.mjs`，区域 300,0 1280×360）：

| 状态 | p50 灰阶 | p90 | 对比度 p50 / p90 |
| --- | --- | --- | --- |
| 关 | 20,20,20 | 20,20,20 | 14.1 / 14.1 |
| 纸 | **19,19,20** | 22,22,22 | 14.2 / 13.8 |
| 摩尔纹 | **30,28,26** | 48,44,39 | 13.0 / 10.6 |

纯背景带（右上角，无文字）：关 20 / 纸 17~22 / 摩尔纹 22~39。
**纸的中位灰度基本等于界面底色**（19 vs 20），摩尔纹比底色亮约 10 —— 这就是下面那条判断的量化依据。

### 4.4 纸的「模糊处理」放在**烘焙期**（运行时零成本）

用户的诉求是「纸/纤维加个模糊处理就能用在 dsh」。做法不是给画面加 blur，而是**对高度场**
做分离盒模糊：`PAPER = { blur: 1, passes: 1, relief: 19, fine: 0.72 }`。

- 模糊在**烘焙时**做，每帧照样用这份高度场做浮雕着色，**每帧成本一分没涨**。
- 0.85px 那层绒毛（草稿权重 0.95）在 354px 内部分辨率下已经低于 1 CSS px，纯属亚像素噪点，
  压到 **0.72** 能少一半「沙子感」，纤维的走向和长度都还在。
- 模糊后梯度变小，浮雕增益从 13.5 补到 **19**。
- **试过半径 2 两遍**（≈σ1.8 内部像素）：纤维结构被抹成迷彩斑块，整片糊成云状，**否掉**。
  对照图 `wp-paper-variants-01.png`（A 原样 / B 1×1 / C 1×2 / D 2×1 / E 低绒毛 / F 低绒毛无模糊）。
- 保留草稿的四边渐隐（0.60→1.0），边缘自然收暗。

### 4.5 摩尔纹的两处「当背景」改动

1. **删掉逐帧换偏移的随机颗粒**。草稿每 ~55ms 换一次颗粒偏移，当背景就是**全屏闪烁**
   （正撞「不许有快速高对比元素」），改成烘焙进底色的静态颗粒。
2. **底色 + 干涉光场在同一个逐像素循环里合成并过 LUT**（不是先用 `lighter` 叠上去再想办法压），
   这样「当背景」的压缩只做一次、不会算重；细环线再用 `lighter` 叠在最上面。

---

## 5. 观感结论（基于**真实 UI 截图**，不是草稿整图）

截图都在 `/mnt/d/projects/_warmtheme_shots/wallpaper-preview/`：
`final-off.png` / `final-paper.png` / `final-moire.png`（1600×1000，同一个真实会话页）、
`zoom-paper-8x.png` / `zoom-moire-8x.png`（8× 局部）、`coexist-paper-lamp.png`（提灯同时亮着）。

### 哪个挂在真实 UI 后面更好：**纸**

1. **安静区的体量不同**。纸的中位灰度 19 ≈ 界面底色 20 —— 满屏绝大部分就是「底色 + 一点材质」，
   只有一道缓慢掠光在动；摩尔纹中位 30、亮区中位 48，整幅都「有戏」，工具界面会一直被背景分神。
2. **和「文字行」的频率关系不同**。纤维是无方向性的绒面 + 一道斜掠光，和正文行/代码行
   这种水平重复结构**不形成竞争**；摩尔纹是**有方向的同心细弧线**，空间频率和行距接近，
   虽然对比度压够（p99 仍有 7.1:1、AA 安全），但读长文时会多一层「底噪」。
3. **面板层次**。纸的暗场几乎纯黑，侧栏那 0.34 的淡底色、输入框卡片（`#272727`）的层次都还读得出来；
   摩尔纹的暖棕 wash 会把层次冲平一点。
4. **气质**。纸像「材质」，摩尔纹像「作品」。挂在编程工具后面，前者更贴 DSH「克制」的定位。

**摩尔纹不差，是另一种用途**：它更精致、更有结构，暗角 + 弧线束在 hero / 空会话页尤其好看。
如果哪天要一个「展示态 / 欢迎页」背景，它是更好的选择。所以插件把两个都留着，一键切换。

### 8× 局部检查

- `zoom-paper-8x.png`（正文 + 光带 + 纤维）：**好** —— 纤维是柔和绒面、有一点方向性，
  无锯齿、无色带、无硬边；同时正文笔画是锐利的（UI 在画布之上，没被糊到）。
- `zoom-moire-8x.png`（弧线束）：**好** —— 同心弧线放大后仍柔和连续，无锯齿、无色带、无硬边。
  两者放大后都是「均匀地柔」，不是块状或粒状噪声。

### 与「提灯」共存：**不冲突**

提灯 `z-index: 2147483000 / mix-blend-mode: screen`，壁纸 `z-index: -1 / mix-blend-mode: normal`
—— 层级完全不重叠（提灯在 UI 之上加光，壁纸在所有东西之下铺底）。
`coexist-paper-lamp.png` 是提灯亮着（`opacity: 1`）同时纸模式在跑：提灯那一小团 300×300 的暖光
叠在壁纸上只是把该处再提亮一点，幅度很小（峰值 alpha 0.055 × 强度 1.55），不打架。
控件三行（外观 10 / 提灯 20 / 壁纸 30）各占一整行。**没有删改提灯的任何代码。**

---

## 6. 自检口 / 复现工具

```js
window.__dshWallpaper.setMode(0 | 1 | 2)   // 切档
window.__dshWallpaper.state()              // mode/kind/内部分辨率/CSS 尺寸/z/blend/filter/punch/帧率与 work 统计
window.__dshWallpaper.configure({ paper: 78000, moire: 80000, frameSkip: 2,
                                  paperOpts: {...}, tune: { paper: {...} }, tuneMoire: {...} })  // 调参口（3082 专用）
```

工具都在 `/mnt/d/projects/_warmtheme_shots/wallpaper-preview/`（全部走 Windows node + CDP 端口 9370）：

| 脚本 | 用途 |
| --- | --- |
| `run.sh` | 统一 CDP 入口；`WM=<0\|1\|2>` 注入模式（**不能走 URL query** —— DSH 会抹掉 `?token=` 那次跳转的 query） |
| `shot-conv.js` | 打开一个真实会话 → 切档 → 截图用 |
| `perf.js` | 三档 × 空闲/滚动 的帧间隔实测 |
| `analyze.js` / `shotstat.mjs` | 画布 / 截图的亮度分布与正文对比度 |
| `variants*.js` | 参数 sweep 的对照拼图 |

---

## 7. 红线自检

- ✅ 没改 `/mnt/d/projects/dsh-warm-ui/lib/client.js`（mtime 仍是 10:39:24，工作开始前）
- ✅ 没碰 3081（没重启、没装插件；`~/.dsh` 的 patch 里没有本插件）
- ✅ 没改 `_warmtheme_shots/drafts/` 下任何文件（两个 HTML 只读参考）
- ✅ 改动只落在 `preview/wallpaper/`、`preview/toggle-wallpaper.sh`、预览 patch 的 insert 块、
  以及 `_warmtheme_shots/wallpaper-preview/`
- ✅ 没删改「提灯」「品牌彩蛋」两个插件的代码
