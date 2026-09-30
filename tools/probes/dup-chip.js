/* 重复胶囊回归：工具行里的「优化」胶囊恒为一颗。
 *
 * 用户 2026-09-24 截图报「输入框下方重复的『高级审查』」。真相不是文案重复，而是工具行里
 * 两颗一模一样的「优化」胶囊：多出来的那颗是旧版本插件留下的同类节点，**没有**归属标记
 * `data-dsh-warm-collapse`，而挂载时的清扫原来只按这个属性找 —— 扫不到它，新胶囊插进去
 * 之后两颗并排待着（成因与修法见 contract/ui-contract.md 第 2 节）。
 *
 * 这个探针做一件事：往 `.dpo-controls` 里塞一颗**没有标记**的同类节点（等价于"上一代遗留"），
 * 然后每 250ms 数一次 `.wti-chip`。修好之后应该只在注入那一拍数到 2，随后回到 1 并保持；
 * 想在探针跑的时候顺带验证"热重载也救得回来"，就同时在另一边改一次插件源码
 * （`node tools/check.mjs --hmr` 用的是同一招：尾部追加注释、跑完逐字节还原）。
 *
 * 跑法：harness `eval`（真 Firefox）；Chromium 用 `_warmtheme_shots/cdp.mjs both`，
 * 记得先把本文件包成 `(async () => { … })()`（见 tools/README.md 第 5 节）。
 * 它只在一个一次性的浏览器实例里改 DOM，不改代码、不写配置。
 
 *
 * 为什么这里的代码是内联的：本文件**不是模块**，而是交给 tools/harness.mjs 的一段
 * **函数体** —— harness 把它包成 `return (async () => { … })()` 用 Marionette 送进
 * 真页面执行，所以它没有 import / require，也没有 node 的 fs / path。取值、常量、
 * 判据只能就地写在这个文件里；凡是"数字与可见性"这类该由一处定义的期望值，一律
 * 走契约（harness 注入为 window.__warmContract），本文件不手抄第二份。
*/
const TICKS = 24;
const STEP_MS = 250;
const countPills = () => ({
	pills: document.querySelectorAll(".wti-chip").length,
	marked: document.querySelectorAll("[data-dsh-warm-collapse]").length,
});
const controls = document.querySelector(".dpo-controls");
const samples = [{ t: 0, injected: false, ...countPills() }];
if (controls) {
	const stale = document.createElement("div");
	stale.className = "wti-chip";
	stale.innerHTML =
		'<button type="button" class="wti-btn"><span class="wti-k">优化</span>' +
		'<span class="wti-v">高级 · 审查</span><span class="wti-caret">▾</span></button>';
	controls.prepend(stale);
}
samples.push({ t: 0, injected: true, ...countPills() });
for (let i = 0; i < TICKS; i += 1) {
	await new Promise((r) => setTimeout(r, STEP_MS));
	samples.push({ t: (i + 1) * STEP_MS, injected: true, ...countPills() });
}
const bar = document.querySelector(".dpo-controls");
return {
	injected: !!controls,
	samples,
	pillsInBar: bar ? bar.querySelectorAll(".wti-chip").length : null,
	barText: bar ? bar.textContent.replace(/\s+/g, " ").trim() : null,
	settledTo: samples[samples.length - 1].pills,
};
