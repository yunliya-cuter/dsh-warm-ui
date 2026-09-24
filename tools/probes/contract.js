/* 契约探针：按 contract/ui-contract.json（由 harness 注入为 window.__warmContract）
 * 在真 Firefox 里逐条断言，返回 { measured, violations }。
 *
 * 设计意图：**数字与可见性写进契约，探针只负责量**。改设计 = 改契约；
 * 探针不该再出现一个手抄的期望值（那正是"每次都要重新认一遍 UI"的来源）。
 */
const C = window.__warmContract;
if (!C) return { violations: ["契约没注入（harness 读不到 contract/ui-contract.json）"], measured: {} };

const violations = [];
const de = document.documentElement;
const count = (sel) => document.querySelectorAll(sel).length;
const visible = (el) => (el ? getComputedStyle(el).display !== "none" : null);

/* ── ① 样式表：每张一份、都带 data-plugin、没有无主样式表 ─────────────── */
for (const [pkg, spec] of Object.entries(C.packages)) {
  for (const sheet of spec.styleSheets) {
    const id = pkg + "/lib/client.js#" + sheet.name;
    const n = count('style[data-plugin-css="' + id + '"]');
    if (n !== C.invariants.styleTagPerSheet) {
      violations.push("样式表 " + id + " 有 " + n + " 份（应为 " + C.invariants.styleTagPerSheet + " 份）");
    }
    if (count("style[data-plugin=" + JSON.stringify(pkg) + "][" + sheet.marker + "]") !== C.invariants.styleTagPerSheet) {
      violations.push("样式表 " + id + " 没同时带 data-plugin 与 " + sheet.marker);
    }
  }
}
const unowned = [...document.querySelectorAll("style:not([data-plugin])")].length;
if (unowned !== C.invariants.unownedStyleTags) {
  violations.push("有 " + unowned + " 张没有 data-plugin 的样式表（热重载删不掉它们）");
}

/* ── ② 注入节点：每个登记项恰好一个（按需出现的只在出问题时才该存在） ── */
const ownerCounts = {};
for (const [pkg, spec] of Object.entries(C.packages)) {
  const onDemand = spec.onDemandOwnerKeys || [];
  for (const key of spec.ownerKeys) {
    const value = pkg + ":" + key;
    const n = count('[data-dsh-warm-owner="' + value + '"]');
    ownerCounts[value] = n;
    /* 按需节点（如布局守卫角标）在不变量成立时就该是 0 —— 它出现本身
       就意味着某条不变量已经破了，所以期望值取 0 而不是 1。 */
    const expected = onDemand.includes(key) ? 0 : C.invariants.nodePerOwnerKey;
    if (n !== expected) {
      violations.push("注入节点 " + value + " 有 " + n + " 个（应为 " + expected + " 个）");
    }
  }
}

/* ── ③ 脱离文档流的节点必须真是 fixed（不参与排版） ─────────────────── */
const pinned = {};
for (const [pkg, spec] of Object.entries(C.packages)) {
  for (const key of spec.detachedOwnerKeys) {
    const el = document.querySelector('[data-dsh-warm-owner="' + pkg + ":" + key + '"]');
    if (!el) continue;
    const cs = getComputedStyle(el);
    pinned[pkg + ":" + key] = cs.position;
    if (cs.position !== "fixed" && cs.position !== "absolute") {
      violations.push("注入节点 " + pkg + ":" + key + " 的 position 是 " + cs.position + "（脱离文档流的节点必须 fixed/absolute）");
    }
  }
}

/* ── ④ 文档不许可滚（壁纸露在页面下面就是这个） ─────────────────────── */
const overflow = de.scrollHeight - de.clientHeight;
if (overflow !== C.invariants.documentOverflowPx) {
  violations.push("文档比视口高 " + overflow + "px（应为 " + C.invariants.documentOverflowPx + "）");
}

/* ── ⑤ 工具行：状态 + 行高 + 各状态的可见性 ─────────────────────────── */
const state = document.body.getAttribute(C.toolbar.stateAttribute);
if (!C.toolbar.states.includes(state)) {
  violations.push("工具行状态是 " + String(state) + "，不在契约的 " + JSON.stringify(C.toolbar.states) + " 里");
}
const row = document.querySelector(".dpo-controls");
const rowHeight = row ? Math.round(row.getBoundingClientRect().height) : null;
if (state === "chip" && rowHeight !== C.toolbar.rowHeightPx) {
  violations.push("chip 态工具行高 " + rowHeight + "px（应为 " + C.toolbar.rowHeightPx + "px）");
}
const chipVisible = visible(document.querySelector("[data-dsh-warm-owner='dsh-warm-ui:collapseChip']"));
const sliders = [...document.querySelectorAll(".dpo-controls .dpo-slider")].map(visible);
if (state === "chip") {
  if (chipVisible !== true) violations.push("chip 态：我们的「优化」胶囊应该是可见的");
  if (sliders.some((v) => v !== false)) violations.push("chip 态：插件滑杆应该全藏起来，实测 " + JSON.stringify(sliders));
} else if (state === "native" || state === "fallback") {
  if (chipVisible !== false) violations.push(state + " 态：我们的「优化」胶囊应该是隐藏的");
}

/* ── ⑥ 输入框宽度：跟 DSH 自己的偏好走，没偏好时不许超过默认上限 ────── */
const card = document.querySelector('[data-slot="conversation.composer.bar"] [class*="_card"]');
const defaultCap = C.composer.contentDefaultCapPx + 2 * C.composer.sideClearancePx;
let widthPref = null;
try {
  widthPref = window.localStorage.getItem(C.composer.widthPreferenceKey);
} catch (error) {
  widthPref = "读取失败";
}
const cardWidth = card ? Math.round(card.getBoundingClientRect().width) : null;
if (card && (widthPref === null || Number(widthPref) <= 0) && cardWidth > defaultCap) {
  violations.push("没有宽度偏好时卡片宽 " + cardWidth + "px，超过 DSH 默认上限 " + defaultCap + "px");
}

/* ── ⑦ 自检口：变量闭包与布局守卫都不该有内容 ───────────────────────── */
const extra = window.__dshWarmExtra || {};
if (extra.missingCssVars && extra.missingCssVars.length) {
  violations.push("样式表里有未定义又没兜底的变量：" + JSON.stringify(extra.missingCssVars));
}
if (extra.layoutGuard) {
  violations.push("触发了布局守卫：" + JSON.stringify(extra.layoutGuard));
}

/* ── ⑧ 共享包必须真的在模块图谱里 ────────────────────────────────────────
 *
 * 浏览器侧的 `require("dsh-warm-shared")` 能不能成功，前提是图谱里有这一行
 * （patch 里那一行生效了）。实测：本 profile 的 patch 是**热加载**的
 * （profiles/web/package.json 的 `dsh.profile.patchReload: "live"`），
 * 所以改完 patch 刷新页面就该看到这一行，不必重启 dsh web。
 *
 * 这里**不**断言消费方图谱行里的 `external`：包的 `dsh.client` 元数据由宿主缓存
 * （dsh-client-modules 的 pkgMeta，键是 loader 行），热加载 patch 不会让它重读
 * package.json，所以要重启才看得到 external。那条声明由 tools/check.mjs 静态核对
 * （「共享依赖」），这里只看"行在不在"。
 * require 本身是否成功不需要单独断言：它一失败，消费方的工厂就抛，样式表根本不会
 * 出现 —— 上面 ① 的份数断言会立刻红。
 */
const bootRows = window.__DSH_BOOT__ && Array.isArray(window.__DSH_BOOT__.entries) ? window.__DSH_BOOT__.entries : null;
const bootIds = bootRows ? bootRows.map((row) => row.id) : [];
if (!bootRows) violations.push("页面上没有 window.__DSH_BOOT__（拿不到模块图谱，无法核对共享包的接线）");
for (const [pkg, spec] of Object.entries(C.packages)) {
  if (spec.role === "shared" && bootRows && !bootIds.includes(pkg)) {
    violations.push("模块图谱里没有共享包 " + pkg + "（patch 里那一行没生效 —— 看 patch 与 profile 的 patchReload）");
  }
}

/* ── ⑨ 玻璃不做动效 + 工具行只有一颗胶囊 ──────────────────────────────────
 *
 * 用户 2026-09-24 报两件事并要求"直接去掉 / 只留一个"：输入框边缘的波纹动效、
 * 输入框下方重复的「优化」胶囊。波纹动效的来源是原来的「流动层」（噪声位移 +
 * 定时驱动），已整层删除；静态那一半（代码里不许再有配方/原语/开关）由
 * `tools/check.mjs` 的「玻璃无动效」守，这里核对**运行时也真的没有**：
 *   - 玻璃滤镜 svg 里 0 个 feTurbulence（这层唯一的噪声源）
 *   - body 上没有 data-wta-glasswarp（开关标记要一起删）
 *   - 工具行里 .wti-chip 恒为 1（多出来那颗是旧版本遗留、没有归属标记的同类节点）
 */
const glassSvg = document.querySelector("[data-wta-glass-svg]");
const engineName = (() => {
  try { return CSS.supports("-moz-appearance", "none") ? "gecko" : "chromium-webkit"; } catch { return "unknown"; }
})();
const motionState = ((C.glass || {}).motion || {}).state || null;
const noisePrims = glassSvg ? glassSvg.querySelectorAll("feTurbulence").length : null;
const flowDisps = glassSvg
  ? [...glassSvg.querySelectorAll("feDisplacementMap")].filter((d) => d.getAttribute("in2") === "warpNoise").length
  : null;
const flowFlag = document.body.hasAttribute("data-wta-glasswarp");
if (motionState === "none") {
  if (noisePrims) violations.push("契约说玻璃不做动效，但滤镜里还有 " + noisePrims + " 个 feTurbulence（流动层没删干净）");
  if (flowDisps) violations.push("滤镜里还有流动层的位移（in2=warpNoise 的 feDisplacementMap " + flowDisps + " 个）");
  if (flowFlag) violations.push("body 上还挂着 data-wta-glasswarp（流动层的开关标记没删干净）");
} else if (motionState === null) {
  violations.push("契约里缺 glass.motion.state —— 玻璃动不动必须是一条登记过的事实");
}
const chipsByClass = count(".wti-chip");
const chipsMarked = count("[data-dsh-warm-collapse]");
if (chipsByClass !== 1) violations.push("工具行里 .wti-chip 有 " + chipsByClass + " 颗，只该有一颗");
if (chipsMarked !== 1) violations.push("带归属标记的胶囊有 " + chipsMarked + " 颗，只该有一颗");

return {
  measured: {
    state,
    rowHeight,
    chipVisible,
    sliders,
    overflow,
    unownedStyleTags: unowned,
    ownerCounts,
    pinned,
    cardWidth,
    widthPref,
    defaultCap,
    bootIds,
    engine: engineName,
    glassMotion: { state: motionState, noise: noisePrims, flowDisplacement: flowDisps, bodyFlag: flowFlag },
    chips: { byClass: chipsByClass, marked: chipsMarked },
    viewport: window.innerWidth + "x" + window.innerHeight,
  },
  violations,
};
