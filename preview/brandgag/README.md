# dsh-warm-brandgag —— 品牌文字恶搞彩蛋（隔离预览专用）

把 DSH 侧栏左上角的品牌文字换掉：

| 原件 | 恶搞 |
| --- | --- |
| `deepseek` 字标 | `deepsleep` |
| `HARNESS` 圆角徽章 | `遛狗绳` 文字 |

鲸鱼图标**不动**。

> ⚠️ 只挂在**隔离预览实例 3082**（home `/mnt/d/projects/.dsh-warm-preview`）。
> 真实实例（3081，`~/.dsh`）的 patch 里从来没有这一条，所以永远不受影响。
> 被 3081 和 3082 共用的 `/mnt/d/projects/dsh-warm-ui/lib/client.js` **一个字节都没改**。

## 探查结果：这一片没有文本节点，是一整块 SVG

侧栏顶部那一片是**一个 svg sprite**（`<svg width="156" height="24" viewBox="26 0 156 24" aria-hidden="true">`，
挂在 `<span class="hHd-Xa_brandName">` 里，外层是 flex + `gap:6px`）：

```
<svg viewBox="26 0 156 24">
  <path d="M68.416…"/>  ×9   ← "deepseek" 的 9 条字形轮廓（fill=currentColor）
  <g clip-path="url(#dsh-wordmark-whale-clip)">…</g>      ← 鲸鱼（被 clip 裁掉，永不显示）
  <rect x="129.348" y="5.5" width="52" height="14" rx="2" fill="currentColor"/>  ← 徽章底
  <g clip-path="url(#dsh-wordmark-badge-clip)">…</g>      ← "HARNESS" 7 条字形
  <defs>两个 clipPath</defs>
</svg>
```

- 屏幕坐标：svg 在 `(48,24)`，`screenX = 48 + (userX − 26)`。
- 字标字形 user x=27…121.5，基线 y=18.62，**每字步进 12、字面宽 10.4、左边距 0**
  （所以字距就是右边距 1.6；这是手绘字标，不是等宽字体）。
- 徽章矩形 user `129.348…181.348` × `5.5…19.5`，7 个大写字母高 7.2、宽 45.6。
- 没有 `aria-label` / `<title>`（`aria-hidden="true"`），也没有任何文本节点。

## 做法：不重画路径，用它自己已有的字形重新排版

1. 把原字标那 9 条 `path` 隐藏。
2. 在同一个 svg 里插一个 `<g>` 覆盖层，把原字形**克隆 + `translate`** 拼成
   `d e e p s l e e p` —— 全部取自 "deepseek" 已有的轮廓：
   - `d` = `M31.9551…`，`e` = `M49.3786…`（4 份相同副本），
     `p` = `M68.416…`，`s` = `M80.242…`
   - `l` = 字母 **k 的竖笔** `M113.5…`（宽 2.4，正是这个字体的笔画宽度）
   所以字重、字面、圆角、抗锯齿与原字标**逐像素同源**。
3. **`l` 的字格**（第一版在这里翻过车）：原字标 8 个字形的**左边距全是 0**、字面宽
   10.4、步进 12 —— 这个手绘字标的"字距"就是右边距 `GAP = 12 − 10.4 = 1.6`，字形一律
   贴字格左缘。

   - ❌ 第一版给 `l` 也吃满一整格 12、并把 2.4 宽的竖笔在格里居中 → s→l、l→e 各空
     5.6px（正常字距的 3.5 倍），8x 下读成 `deeps l eep`。居中之所以更糟：`s` 的
     1.6 右边距已经先垫在字格外了，再居中就把空白平摊成 s→l = 1.6+1.8 = 3.4、
     l→e = 1.8，左右还不对称。
   - ✅ `l` 的字格 = 笔画宽 + 一个正常字距 = `2.4 + 1.6 = 4.0`，竖笔**贴字格左缘**：
     `s 右缘 85.4 →(1.6)→ 竖笔 87.0…89.4 →(1.6)→ e 左缘 91.0`，两侧间隙都等于 `GAP`。
4. **sprite 加宽量 `GROW` 由排布算出来，不手写**：
   `GROW = 新墨迹右缘 − 原墨迹右缘`。实测 `origRight = 121.516`（原 9 条 path 的 bbox
   右缘）、`newRight = 125.4` → `GROW = 3.884`。sprite 加宽 `GROW`、徽章右移 `GROW`
   （两者必须相等，字标↔徽章间隙才逐像素不变）；`width` 与 `viewBox` 一起改，缩放
   保持严格 1:1。
   > 第一版按"多一个字 = 多 12px"加宽 12px、字距却仍是 12，所以只有 8 个字的宽度被
   > 拉长；现在 `l` 只占 4.0，整块只长 3.884px。
5. 徽章保留原 `rect`（形状/圆角/底色都不动），只隐藏里面那 7 条字母，换成居中的
   SVG `<text>遛狗绳</text>`，`fill` 沿用原来那 7 条 path 用的
   `var(--dsw-alias-label-primary-inverted)`，因此**明暗两套主题下都自动是反色**。
6. 徽章文字再做一层**墨迹光学微调**（`BADGE_NUDGE_X/Y`）：em 盒居中并不等于墨迹居中，
   8x 逐像素量出来偏左 0.6、偏下 0.75，补掉后四边留白都是 1.25px。

## 实测数字（3082 上 DOM + 8x 像素双重核对）

| 项 | 值 |
| --- | --- |
| 字距 s→l / l→e / e→e（DOM） | **1.596 / 1.600 / 1.587** px |
| 字距 s→l / l→e / e→e（8x 像素列剖面，取 x-height 带） | **1.625 / 1.625 / 1.500** px |
| 旧版 s→l / l→e | 5.6 / 5.6 px（已修） |
| 字标↔徽章间隙 | 未改 **7.831** → 恶搞 **7.830**（差 0.001px） |
| `GROW` / sprite 宽 | 3.884 / `156 + 3.884 = 159.884`（`width == viewBox 宽`） |
| 品牌 span | `clientWidth == scrollWidth == 160`，无溢出、无裁切 |
| 徽章右缘 → 折叠按钮 | 207.223 → 240，余 **32.8px**（品牌按钮右缘 232，也没顶到） |
| 徽章墨迹居中 | 四边留白 1.25 / 1.25 / 1.25 / 1.25 px，中心偏差 <0.03px |
| 整页像素差分 | 891 px 全落在品牌行 (49,28,159,18)，**品牌区外 0 px** |

只改 DOM（不碰 React）；React 若重挂这个 svg，`MutationObserver` 会重铺一遍。
排版参数（`START_X` / `ADVANCE` / `GLYPH_W` / `GAP` / `BADGE_*` / `BADGE_NUDGE_*`）
都在 `lib/client.js` 顶部；`l` 的字格与 `GROW` 是**派生量**，改 `GAP` 或笔画宽会自动跟着变。
改完**刷新浏览器**即生效，不用重启预览。

## 开关 / 回滚

```bash
# 查看状态
bash /mnt/d/projects/dsh-warm-ui/preview/toggle-brandgag.sh status

# 彻底关掉（改回原样）
bash /mnt/d/projects/dsh-warm-ui/preview/toggle-brandgag.sh off
bash /mnt/d/projects/dsh-warm-ui/preview/start-preview.sh   # 重启预览（会打印新 token）
```

`off` 只删预览 patch 里 `# >>> dsh-warm-brandgag >>>` … `# <<< dsh-warm-brandgag <<<`
之间的那一块；重启后插件不再加载，界面回到 `deepseek` / `HARNESS`。

**不改配置的临时关法**（只对当前这个页面有效，刷新即恢复）：

```js
window.__dshBrandgag.off()   // 立刻还原，并阻止 React 重渲染后重新铺上
window.__dshBrandgag.on()    // 再铺回来
```

彻底删干净：`toggle-brandgag.sh off` + 重启，然后删掉本目录，
（可选）删掉 `preview/toggle-brandgag.sh`。共用文件从未被改动，无需还原任何东西。

## 文件

- `package.json` —— 与 `preview/dynbg/package.json` 同构，带 `dsh.client.platform: "web"`
- `lib/index.js` —— host 半边，空实现（只为让 loader 有一条 entry）
- `lib/client.js` —— 客户端半边，真正干活

核查脚本与截图在 `/mnt/d/projects/_warmtheme_shots/brandgag/`：
`compare.png`（8x 原版/恶搞并排）、`before8x.png` / `after8x.png`、
`before.png` / `after.png`（整页）、`after_light8x.png`（亮色主题）、`diff.png`（像素差分）；
`probe1/probe2.js`（DOM 探查）、`badge_ink.js` / `redink.js` + `inkbox.mjs`（徽章墨迹居中）、
`colgaps.mjs`（像素列剖面量字距）、`gap_ab.js`（同一页面里 A/B 量间隙）、
`png.mjs` / `diff.mjs`（自写 PNG 编解码 + 差分）、`compare.html`（拼图页）。
