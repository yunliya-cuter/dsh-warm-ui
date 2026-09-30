/* 契约探针：按 contract/ui-contract.json（由 harness 注入为 window.__warmContract）
 * 在真 Firefox 里逐条断言，返回 { measured, violations }。
 *
 * 设计意图：**数字与可见性写进契约，探针只负责量**。改设计 = 改契约；
 * 探针不该再出现一个手抄的期望值（那正是"每次都要重新认一遍 UI"的来源）。
 
 *
 * 为什么这里的代码是内联的：本文件**不是模块**，而是交给 tools/harness.mjs 的一段
 * **函数体** —— harness 把它包成 `return (async () => { … })()` 用 Marionette 送进
 * 真页面执行，所以它没有 import / require，也没有 node 的 fs / path。取值、常量、
 * 判据只能就地写在这个文件里；凡是"数字与可见性"这类该由一处定义的期望值，一律
 * 走契约（harness 注入为 window.__warmContract），本文件不手抄第二份。
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

/* ── ⑩ 玻璃的生死出口 ─────────────────────────────────────────────────────
 *
 * 契约 lifecycle 说换代守卫与自我卸载都是 enforced，那运行时就必须能**问**出来：
 * window.__dshWarmExtra.glass 报 { alive, generation }（出错时附 error）。
 * 这是「玻璃悄悄死了、页面只是看起来还行」这类故障唯一的自动判据 ——
 * 没有出口的时候，用户 2026-09-24 那次闪烁只能靠肉眼看出来。
 */
const lifeState = (((C.lifecycle || {}).singleGeneration) || {}).state || null;
const glassLife = (window.__dshWarmExtra && window.__dshWarmExtra.glass) || null;
if (lifeState === "enforced") {
  if (!glassLife) violations.push("契约说换代守卫是 enforced，但 window.__dshWarmExtra.glass 不存在（玻璃没有可观测出口）");
  else if (glassLife.alive !== true) violations.push("玻璃出口报 alive=" + glassLife.alive + "，页面刚加载完不该是死的（error：" + (glassLife.error || "无") + "）");
  else if (!(glassLife.generation >= 1)) violations.push("玻璃出口报 generation=" + glassLife.generation + "，应当 >= 1");
}

/* ── ⑪ 底部曲率：引擎无关的那一半（画出来的弧 / 圆角 / 底色） ───────────────
 *
 * 用户 2026-09-25 报「输入框玻璃底部曲率过大」，修法是把折射的位移幅度折下来 —— 而
 * 折射在 Gecko 上根本不发（GLASS_BACKDROP_ENGINES: svgFilter false），所以**实际降了
 * 多少**只能在 Chromium 侧量（tools/probes/curvature.js 读的是渲染真正用的那张位移图）。
 *
 * 这一项守的是另外那一半，它们在两种引擎上都能问：画弧用的 5 层内阴影、圆角、底色
 * 有没有被"顺便改小"—— 也就是**不许拿曲率换可读性**：折射可以调小，弧不能消失。
 */
const curvatureState = (((C.glass || {}).curvature) || {}).state || null;
const cardShadow = card ? getComputedStyle(card).boxShadow : "";
const arcInsets = (cardShadow.match(/inset/g) || []).length;
const arcRadius = card ? parseFloat(getComputedStyle(card).borderTopLeftRadius) : null;
const idleTint = card ? card.style.getPropertyValue("--wta-glass-tint-cur").trim() : null;
if (curvatureState === "enforced") {
  const want = (C.glass.curvature || {});
  if (arcInsets < (want.arcInsetLayers || 0)) {
    violations.push("契约说底部曲率 enforced（弧必须还在），但卡片只有 " + arcInsets + " 层 inset（应 ≥ " + want.arcInsetLayers + "）—— 画弧的层被删了");
  }
  if (!/rgba\(255,\s*255,\s*255/.test(cardShadow) || !/rgba\(0,\s*0,\s*0/.test(cardShadow)) {
    violations.push("画弧的内阴影少了亮线或暗线（弧不能靠“淡到看不见”来降）：" + cardShadow);
  }
  if (arcRadius !== want.arcRadiusPx) {
    violations.push("卡片圆角是 " + arcRadius + "px，契约记的是 " + want.arcRadiusPx + "px（弧的几何变了就要先改契约）");
  }
  if (idleTint !== want.idleTint) {
    violations.push("常态底色是 " + idleTint + "，契约记的是 " + want.idleTint + "（改底色 = 改文字与背景的对比，必须先登记）");
  }
}


/* ── ⑫ 悬停判定：窗口失焦不许把「指针还在卡片上」弄丢 ──────────────────────
 *
 * 用户 2026-09-25 报「鼠标停在输入框上打字，输入框由模糊态回退成透明态」。根因是插件把
 * window blur 当成"指针离开文档"，而打字不会重算判定 —— 状态一直粘着，直到鼠标移动。
 * 这一项按插件自己的两条路径复现：① 指针坐标写到卡片上 → 必须是悬停态；
 * ② 窗口失焦 → **仍必须是悬停态**（改前这里是常态，就是用户看到的"变透明"）；
 * ③ 真离开文档（pointerleave）→ 必须回常态（修失焦不能把"真离开"也吃掉）。
 * 判据用 --wta-glass-tint-cur（JS 按状态写的内联变量）：它对两种引擎都一样，而
 * backdrop-filter 里的 url() 只有 Chromium 认。
 */
const pointerState = (((C.glass || {}).pointer) || {}).state || null;
let hoverProbe = null;
if (card && pointerState === "enforced") {
  const want = C.glass.pointer;
  const idleTint = (((C.glass || {}).curvature) || {}).idleTint;
  const tintOf = () => card.style.getPropertyValue("--wta-glass-tint-cur").trim();
  const overNow = () => card.hasAttribute("data-wta-over");
  /* 等两拍：rAF 是插件重算的时机，但无头窗口里 rAF 可能被节流 —— 谁先到算谁，别把断言挂死 */
  const settle = () => new Promise((done) => {
    let fired = false;
    const finish = () => { if (fired) return; fired = true; clearTimeout(timer); done(); };
    const timer = setTimeout(finish, 150);
    requestAnimationFrame(() => requestAnimationFrame(finish));
  });
  const box = card.getBoundingClientRect();
  const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
  hoverProbe = { hover: null, afterBlur: null, afterLeaveIn: null, afterLeaveOut: null };
  window.dispatchEvent(new PointerEvent("pointermove", { clientX: at.clientX, clientY: at.clientY, bubbles: true }));
  await settle();
  hoverProbe.hover = { over: overNow(), tint: tintOf() };
  if (!hoverProbe.hover.over || hoverProbe.hover.tint !== want.calmTint) {
    violations.push("指针移到输入框上之后不是悬停态（over=" + hoverProbe.hover.over + " 底色=" + hoverProbe.hover.tint + "，契约记的悬停底色是 " + want.calmTint + "）");
  }
  window.dispatchEvent(new Event("blur"));
  await settle();
  hoverProbe.afterBlur = { over: overNow(), tint: tintOf() };
  if (!hoverProbe.afterBlur.over || hoverProbe.afterBlur.tint !== want.calmTint) {
    violations.push("窗口失焦之后悬停态丢了（底色 " + hoverProbe.afterBlur.tint + "，应为 " + want.calmTint + "）—— 用户报的「鼠标在输入框上打字却变透明」就是这条：失焦被当成指针离开，而打字不会重算判定");
  }
  /* ③ 假离开：坐标仍在视口内（指针没动 / 被另一个进程的窗口盖住）—— 必须仍是悬停态 */
  document.documentElement.dispatchEvent(new PointerEvent("pointerleave", { bubbles: false, clientX: Math.round(at.clientX), clientY: Math.round(at.clientY) }));
  await settle();
  hoverProbe.afterLeaveIn = { over: overNow(), tint: tintOf() };
  if (!hoverProbe.afterLeaveIn.over || hoverProbe.afterLeaveIn.tint !== want.calmTint) {
    violations.push("坐标仍在视口内的 pointerleave（假离开）之后悬停态丢了（底色 " + hoverProbe.afterLeaveIn.tint + "，应为 " + want.calmTint + "）—— 用户报的「鼠标在输入框上打字却变透明」就是这个：状态交给了最后到达的那条事件");
  }
  /* ④ 真离开：坐标在视口外 —— 必须回常态（修假离开不能把真离开也吃掉） */
  document.documentElement.dispatchEvent(new PointerEvent("pointerleave", { bubbles: false, clientX: -20, clientY: -20 }));
  await settle();
  hoverProbe.afterLeaveOut = { over: overNow(), tint: tintOf() };
  if (hoverProbe.afterLeaveOut.over || (idleTint && hoverProbe.afterLeaveOut.tint !== idleTint)) {
    violations.push("坐标在视口外的 pointerleave（真离开）之后没回常态（底色 " + hoverProbe.afterLeaveOut.tint + "）—— 修假离开不能把真离开也吃掉");
  }
  /* 收尾：指针放回卡片上，别让页面停在常态影响别的断言 */
  window.dispatchEvent(new PointerEvent("pointermove", { clientX: at.clientX, clientY: at.clientY, bubbles: true }));
  await settle();
}

/* ── ⑬ 进行中指示：两种黑带都没了 + 运行条目上有点与水波 ─────────────────
 *
 * 用户 2026-09-25 报「与背景不协调的黑色横带」。代码里两种暗带（座位全宽渐隐带 + 五族行内扫光）
 * 都已按用户要求移除，改成「行首闪烁橙点 + 文字水波」。这一项在真机里断言三件事：
 *   ① 座位的计算样式里**没有**任何背景画法（黑带不许回来，不管哪个相位）；
 *   ② 运行中的条目前缀有点：6px 圆、颜色不是透明、带闪烁动画（外加绝对定位 = 不吃排版）；
 *   ③ 扫光确实关掉（::after content = none）、文字水波在跑且摘要与标题有相位差。
 * 为什么可以造一个 data-state="running" 的探针节点：插件的规则只看属性（[data-state="running"]、
 * 类名后缀 _row/_title/_summary），不看是不是 React 渲染的；真机像素证据（橙色团块落在
 * 行首外挂位置、零位移）在 .edge-preview/_evidence-band.md 里另存。
 */
const busySpec = C.busy || {};
let busyProbe = null;
if (busySpec.state === "enforced") {
  busyProbe = {};
  const seat = document.querySelector('[class*="composerSeat"]');
  busyProbe.seatBg = seat ? getComputedStyle(seat).backgroundImage : "no-seat";
  if (seat && busyProbe.seatBg !== "none") {
    violations.push("输入区座位还在画底（background-image = " + busyProbe.seatBg + "）—— 契约 busy.seatBackground 是 none，那条全宽渐隐带就是用户报的黑色横带");
  }
  const stage = document.createElement("div");
  stage.id = "wta-busy-probe";
  stage.style.cssText = "position:fixed;left:-9999px;top:0;width:400px";
  const root = document.createElement("div");
  root.setAttribute("data-state", "running");
  root.setAttribute("data-tool", "probe");
  const row = document.createElement("div");
  row.className = "probe_row";
  const title = document.createElement("span");
  title.className = "probe_title";
  title.textContent = "进行中";
  const summary = document.createElement("span");
  summary.className = "probe_summary";
  summary.textContent = "probe";
  row.append(title, summary);
  root.appendChild(row);
  stage.appendChild(root);
  document.body.appendChild(stage);
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));

  const dot = getComputedStyle(root, "::before");
  const wantDot = busySpec.dot || {};
  busyProbe.dot = {
    content: dot.content, w: dot.width, h: dot.height, radius: dot.borderRadius, bg: dot.backgroundColor,
    left: dot.left, top: dot.top, position: dot.position, anim: dot.animationName,
    dur: dot.animationDuration, iter: dot.animationIterationCount, dir: dot.animationDirection, op: dot.opacity,
  };
  if (dot.content === "none") {
    violations.push("运行中的条目行首没有点（::before content 是 none）—— 契约 busy.dot 要求它在那里");
  }
  if (wantDot.size && (dot.width !== wantDot.size || dot.height !== wantDot.size)) {
    violations.push("点的尺寸是 " + dot.width + "×" + dot.height + "，契约写的是 " + wantDot.size);
  }
  if (dot.backgroundColor === "rgba(0, 0, 0, 0)") {
    violations.push("点的颜色是透明的 —— 这是「颜色变量写回了 :root」的典型症状：DSH 的语义 token 只定义在 body 上，:root 里 var() 链失效会让整条 background 作废");
  }
  if (dot.position !== "absolute") {
    violations.push("点不是绝对定位（position = " + dot.position + "）—— 那会参与排版、把行内文字挤动");
  }
  if (wantDot.blink && dot.animationName !== wantDot.blink.keyframes) {
    violations.push("点的动画是 " + dot.animationName + "，契约写的是 " + wantDot.blink.keyframes);
  }
  const after = getComputedStyle(row, "::after");
  busyProbe.sweep = { content: after.content, anim: after.animationName };
  if (after.content !== "none") {
    violations.push("行内扫光还在（::after content = " + after.content + "）—— 契约 busy.sweep 是 off，那条 300px 中性黑块会被读成黑色横带");
  }
  const tw = getComputedStyle(title);
  const sw = getComputedStyle(summary);
  busyProbe.wave = {
    title: { anim: tw.animationName, dur: tw.animationDuration, transform: tw.transform },
    summary: { anim: sw.animationName, dur: sw.animationDuration, delay: sw.animationDelay },
  };
  if (busySpec.wave && tw.animationName !== busySpec.wave.keyframes) {
    violations.push("标题的水波动画是 " + tw.animationName + "，契约写的是 " + busySpec.wave.keyframes);
  }
  if (busySpec.wave && tw.animationDuration !== busySpec.wave.duration) {
    violations.push("水波周期是 " + tw.animationDuration + "，契约写的是 " + busySpec.wave.duration + "（用户要求与原扫光同频）");
  }
  if (busySpec.wave && sw.animationDelay === "0s") {
    violations.push("摘要与标题同相位（animation-delay = 0s）—— 那样看不出「波」在走，只像整行一起抖");
  }
  busyProbe.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!busyProbe.reducedMotion && dot.animationName === "none") {
    violations.push("系统没开「减少动态效果」，点的闪烁却是 none —— 动画没生效");
  }
  stage.remove();
}

/* ── ⑭ 列表底边渐隐：原生「上色型」fade 被内容遮罩替换 ───────────────────
 *
 * 用户 2026-09-25 报「箭头指的两处有分割感」。定位：DSH 原生 .bhn1Oq_fade 的收尾色写死为
 * **不透明**的 --dsw-specific-sidebar-fill，而壁纸插件把侧栏列改成半透明（--wlp-side =
 * rgba(填充色, .34)）⇒ 带子最后一行不再等于周围的真实底色，底边留一条横向硬缝
 * （合成底放大后实测：暗色 Δ7、亮色 Δ117）。
 * 这一项在真机里断言：开档时——原生 fade 不再上色、内容容器有 24px 遮罩；关档时——两者都还原。
 * **遮罩必须打在 _treeBody 上、且用子串匹配**（它带 bhn1Oq_wide 附加类，[class$=...] 会静静失效，
 * 探针里复现过这个假阴性）。
 */
const listFadeSpec = C.listEdgeFade || {};
let listEdgeProbe = null;
if (listFadeSpec.state === "enforced") {
  listEdgeProbe = {};
  const on = document.documentElement.hasAttribute("data-dsh-warm-wallpaper-on");
  listEdgeProbe.wallpaperOn = on;
  const fade = document.querySelector('[class*="_fade"]');
  const tbody = document.querySelector('[class*="_treeBody"]');
  listEdgeProbe.hasFade = !!fade;
  listEdgeProbe.hasTreeBody = !!tbody;
  if (!fade || !tbody) {
    violations.push("侧栏里找不到 " + (fade ? "" : "_fade ") + (tbody ? "" : "_treeBody")
      + " —— 列表底边渐隐的宿主变了，契约 listEdgeFade 的 fadeSuffix/containerSuffix 要跟着改");
  } else {
    const fadeBg = getComputedStyle(fade).backgroundImage;
    const tcs = getComputedStyle(tbody);
    const mask = tcs.maskImage && tcs.maskImage !== "none" ? tcs.maskImage : tcs.webkitMaskImage;
    listEdgeProbe.fadeBg = fadeBg;
    listEdgeProbe.mask = mask;
    const px = String((listFadeSpec.height || {}).px);
    if (on) {
      if (fadeBg !== "none") {
        violations.push("壁纸开着，原生渐隐带还在上色（background-image = " + fadeBg
          + "）—— 它的收尾色是不透明的侧栏填充色，底边会留一条硬缝（契约 listEdgeFade）");
      }
      if (!mask || mask === "none") {
        violations.push("壁纸开着，内容容器没有遮罩（mask-image = " + mask + "）—— 内容不再渐隐");
      } else if (String(mask).indexOf(px + "px") === -1) {
        violations.push("遮罩里找不到 " + px + "px 的渐隐高度（mask-image = " + mask
          + "）—— 契约 listEdgeFade.height 要求与原生 bhn1Oq_fade 同高");
      }
    } else {
      if (mask && mask !== "none") violations.push("壁纸关着，内容容器还有遮罩（mask-image = " + mask + "）—— 关档必须与原生逐像素相同");
      if (fadeBg === "none") violations.push("壁纸关着，原生渐隐带却不上色了 —— 关档必须与原生逐像素相同");
    }
  }
}

/* ── ⑮ 卡片包含块：固定定位后代不许被卡片挤到视口外 ───────────────────────
 *
 * 用户 2026-09-27 报「右下角箭头/停止按钮亮起时悬停其上，画面反复切换」。根因是
 * 模糊写在了卡片自己身上：带 backdrop-filter ≠ none 的元素会成为**固定定位后代的
 * 包含块**，而 DSH 的 Tooltip 气泡（.bubble）正是 position:fixed、却渲染在卡片内部
 * ⇒ 气泡的视口 left/top 被按卡片坐标系解释 ⇒ 落到视口外 ⇒ 撑出溢出 ⇒ 卡片位移
 * ⇒ 指针被甩出按钮 ⇒ 气泡撤销 ⇒ 回弹 ⇒ 自激。
 *
 * 这一项在真机里断言**机制**（与视口高度无关，只看属性对不对）：
 *   ① 契约登记的 layerTargets 有对应槽位时，卡片自己**不带** backdrop-filter，
 *      而是 `isolation:isolate`；
 *   ② 存在模糊层（[data-wta-glass-layer]），它承载着 backdrop-filter，且是卡片的
 *      **兄弟**（parentElement 相同）并排在卡片**之前**；
 *   ③ **不出现在视口外的 tooltip**：卡片内的 fixed 后代若被包含块错位，它的 rect
 *      会落到视口外 —— 这条正是用户看到抽搐时同时存在的那个更严重的 bug。
 *      只在 tooltip 存在时断言（它按需出现，不该为它造一个）。
 *   ④ 层的几何与卡片对齐（差 ≤ 1px）：层是模糊的载体，错位就会露出没糊的边。
 */
const cbSpec = ((C.glass || {}).containingBlock) || {};
let containingBlockProbe = null;
if (cbSpec.state === "enforced" && card) {
  containingBlockProbe = {};
  const wantLayer = (cbSpec.layerTargets || []).some((sel) => {
    try { return card.matches(sel); } catch { return false; }
  });
  containingBlockProbe.isLayerTarget = wantLayer;
  const cs = getComputedStyle(card);
  containingBlockProbe.card = { backdropFilter: cs.backdropFilter, isolation: cs.isolation };
  if (wantLayer) {
    if (cs.backdropFilter !== "none") {
      violations.push("composer 卡片自己带着 backdrop-filter（" + cs.backdropFilter
        + "）—— 它会成为固定定位后代的包含块，把 Tooltip 气泡挤到视口外并撑出溢出（契约 glass.containingBlock）");
    }
    if (cs.isolation !== "isolate") {
      violations.push("composer 卡片没有 isolation:isolate（实测 " + cs.isolation
        + "）—— 模糊移到兄弟层后，卡片的层叠上下文要靠它保住，[data-wta-surf] 的 z-index:-1 + mix-blend-mode:screen 依赖它");
    }
    const layer = document.querySelector("[data-wta-glass-layer]");
    containingBlockProbe.layer = layer ? {
      parentSame: layer.parentElement === card.parentElement,
      beforeCard: (layer.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING) > 0,
      backdropFilter: getComputedStyle(layer).backdropFilter,
      rect: (() => { const r = layer.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })(),
      cardRect: (() => { const r = card.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })(),
    } : null;
    if (!layer) {
      violations.push("找不到模糊层 [data-wta-glass-layer] —— 契约 glass.containingBlock 要求模糊外置到卡片的兄弟层");
    } else {
      if (getComputedStyle(layer).backdropFilter === "none") {
        violations.push("模糊层上没有任何 backdrop-filter —— 模糊既不在卡片上、也不在层上，玻璃等于失效");
      }
      if (layer.parentElement !== card.parentElement) {
        violations.push("模糊层不是卡片的兄弟（parentElement 不同）—— 放进卡片内部等于让卡片再次成为 fixed 后代的包含块");
      }
      if (!((layer.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING) > 0)) {
        violations.push("模糊层没有排在卡片**之前**（DOM 在后 = 画在上层）—— 层会盖住卡片内容");
      }
      const a = layer.getBoundingClientRect();
      const b = card.getBoundingClientRect();
      if (Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1
        || Math.abs(a.width - b.width) > 1 || Math.abs(a.height - b.height) > 1) {
        violations.push("模糊层与卡片没对齐（层 " + JSON.stringify([Math.round(a.x), Math.round(a.y), Math.round(a.width), Math.round(a.height)])
          + " vs 卡片 " + JSON.stringify([Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]) + "）—— 错位会露出没糊的边");
      }
    }
  }
  /* ③ 视口外的 tooltip：这是「包含块错位」的直接症状，也是抽搐链的第一环。
     只在它真出现时判 —— 气泡是按需渲染的，没有它不代表没问题,所以记 measured 不报违规。 */
  containingBlockProbe.viewport = window.innerWidth + "x" + window.innerHeight;
  containingBlockProbe.outsideTooltips = [...document.querySelectorAll('[role="tooltip"]')]
    .filter((tip) => {
      const r = tip.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      return r.left < 0 || r.top < 0 || r.right > window.innerWidth || r.bottom > window.innerHeight;
    })
    .map((tip) => { const r = tip.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)]; });
  if (containingBlockProbe.outsideTooltips.length) {
    violations.push("有 " + containingBlockProbe.outsideTooltips.length + " 个 tooltip 落在视口外（"
      + JSON.stringify(containingBlockProbe.outsideTooltips) + "，视口 " + containingBlockProbe.viewport
      + "）—— 卡片又成了固定定位后代的包含块（契约 glass.containingBlock）");
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
    glassMotion: { state: motionState, noise: noisePrims, flowDisplacement: flowDisps, bodyFlag: flowFlag },
    chips: { byClass: chipsByClass, marked: chipsMarked },
    glassLife: glassLife ? { alive: glassLife.alive, generation: glassLife.generation } : null,
    glassArc: { insets: arcInsets, radius: arcRadius, tint: idleTint },
    glassHover: hoverProbe,
    busyIndicator: busyProbe,
    listEdgeFade: listEdgeProbe,
    containingBlock: containingBlockProbe,
    viewport: window.innerWidth + "x" + window.innerHeight,
  },
  violations,
};
