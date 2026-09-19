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

/* ── ⑨ 流动层的引擎门槛：这台引擎上"该不该有流动层"必须与契约一致 ─────────
 *
 * 契约的 `glass.warp.engineSupport` 给每条引擎配方一个 true/false，代码里
 * `GLASS_BACKDROP_ENGINES` 的 `warp` 列照它写；静态检查核对"代码 == 契约"，
 * 这里核对**运行时真的按它走了**：Gecko 上玻璃滤镜里不该出现 feTurbulence
 * （引擎表说它吃不下 backdrop 里的 SVG 滤镜，加了也只是白算一遍）。
 * 另外两半（Chromium 上确实有、以及它确实在动）由 Edge 侧的
 * `tools/probes/glass-warp.js` 量 —— 文件头写了怎么跑。
 */
const glassSvg = document.querySelector("[data-wta-glass-svg]");
const engineName = (() => {
  try { return CSS.supports("-moz-appearance", "none") ? "gecko" : "chromium-webkit"; } catch { return "unknown"; }
})();
const warpSupport = ((C.glass || {}).warp || {}).engineSupport || {};
const warpNoise = glassSvg ? glassSvg.querySelectorAll("feTurbulence").length : null;
const warpDisp = glassSvg
  ? [...glassSvg.querySelectorAll("feDisplacementMap")].filter((d) => d.getAttribute("in2") === "warpNoise").length
  : null;
if (glassSvg) {
  const shouldBeOn = warpSupport[engineName] === true;
  if ((warpNoise > 0) !== shouldBeOn) {
    violations.push("流动层在 " + engineName + " 上的状态与契约不符：滤镜里 feTurbulence 有 " + warpNoise
      + " 个，契约说" + (shouldBeOn ? "该开" : "该关"));
  }
  if (warpNoise !== warpDisp) {
    violations.push("流动层的原语不成对（feTurbulence " + warpNoise + " / 位移 " + warpDisp + "）：噪声源接不上位移就等于白算");
  }
}

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
    glassWarp: { noise: warpNoise, displacement: warpDisp },
    viewport: window.innerWidth + "x" + window.innerHeight,
  },
  violations,
};
