/* 流动层（GLASS_WARP）在真机上的行为与代价。
 *
 * 三件事必须分开量，不然"看起来在动"永远只是印象：
 *   ① 滤镜图里真的多出了那两个原语（feTurbulence + feDisplacementMap）；
 *   ② 驱动真的在改它们的属性（相隔 400ms 取两次值，看有没有变）；
 *   ③ 这一层要付多少帧时间（把驱动停掉再量一次，同一个页面里做 A/B）。
 * "画面确实被推动了"是像素层面的事，由两张不同时刻的截图对比给出 ——
 * 见 tools/README.md 第 5 节（那一步要用到截图，探针自己读不到像素）。
 *
 * 玻璃元素不按选择器找，而是按"我们自己写上去的那条内联 backdrop-filter"找：
 * 探针不该抄一份选择器，也不该假设 DSH 的 DOM 结构。
 */
const TAG = "data-wta-glass-warp-probe";
for (const old of document.querySelectorAll("[" + TAG + "]")) old.remove();

const WARP_KEY = "dsh-warm-x-glassWarp";
const glassSvg = document.querySelector("[data-wta-glass-svg]");
const filters = glassSvg ? Array.from(glassSvg.querySelectorAll("filter")) : [];
const noiseNodes = glassSvg ? Array.from(glassSvg.querySelectorAll("feTurbulence")) : [];
const warpNodes = glassSvg
	? Array.from(glassSvg.querySelectorAll("feDisplacementMap")).filter((d) => d.getAttribute("in2") === "warpNoise")
	: [];

/* 玻璃元素按"我们自己写上去的那条内联 backdrop-filter"找：卡片本身没有 data-slot
   （data-slot 在它的祖先上），所以不去抄一份选择器，也不假设 DSH 的 DOM 结构。
   认 `wta-glass-`（滤镜 id 的前缀）而不是认 `url(#…)` —— 浏览器把内联值序列化成
   `url("#wta-glass-0-full")`，带引号，按 `url(#` 匹配会一个都找不到。 */
const glassEls = Array.from(document.querySelectorAll('[style*="wta-glass-"]')).filter((el) =>
	String(el.style.getPropertyValue("backdrop-filter") || "").includes("wta-glass-"));

/** 当前两个被驱动的属性值。 */
const readWarp = () => ({
	baseFrequency: noiseNodes.map((n) => n.getAttribute("baseFrequency")),
	scale: warpNodes.map((d) => d.getAttribute("scale")),
});

const before = readWarp();
await new Promise((done) => setTimeout(done, 400));
const after = readWarp();

/** 量一段 rAF 的帧间隔（毫秒）。 */
const frameStats = (label, frames) => new Promise((done) => {
	const deltas = [];
	let last = 0;
	let left = frames;
	const step = (now) => {
		if (last) deltas.push(now - last);
		last = now;
		if (--left > 0) requestAnimationFrame(step);
		else {
			const sorted = deltas.slice().sort((a, b) => a - b);
			const at = (q) => +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))].toFixed(2);
			done({ stage: label, frames: deltas.length, median: at(0.5), p90: at(0.9), max: +sorted[sorted.length - 1].toFixed(2) });
		}
	};
	requestAnimationFrame(step);
});

const withWarp = await frameStats("warp 驱动开着", 60);
/* 停掉驱动但不摘掉原语：开关是 tickWarp 每拍都读的，所以这样能单独量"动画"的代价。 */
let previous = null;
let toggled = false;
try {
	previous = window.localStorage.getItem(WARP_KEY);
	window.localStorage.setItem(WARP_KEY, "0");
	toggled = true;
} catch (error) { /* 隐私模式：忽略，A/B 那一段就不做 */ }
await new Promise((done) => setTimeout(done, 200));
const stopped = toggled ? await frameStats("驱动停掉（原语还在）", 60) : null;
if (toggled) {
	try {
		if (previous === null) window.localStorage.removeItem(WARP_KEY);
		else window.localStorage.setItem(WARP_KEY, previous);
	} catch (error) { /* 同上 */ }
}

const rects = glassEls.map((el) => {
	const r = el.getBoundingClientRect();
	return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
});

/* ── 测量夹具 ────────────────────────────────────────────────────────────
 * 把**插件自己那条滤镜**（wta-glass-*-full）挂到探针自造的一块条纹上：
 * 夹具里条纹是玻璃的父元素，父子关系保证它确实落在 glass 的 backdrop 里 ——
 * 于是"两个时刻的画面差异"只可能来自流动层。
 *
 * 为什么不直接量真实卡片：
 *   ① 卡片背后是会话内容，两次加载之间它自己就在变（实测会话区像素差 11.7，
 *      比玻璃区还大），结论会被污染；
 *   ② 想给卡片铺一层自己的底纹也不行 —— 卡片在 app 根的层叠上下文里，
 *      body 级注入的 z-index 再高也压在整棵 app 之上（实测：条纹把卡片盖住，
 *      连输入框都看不见了，而卡片自己的 backdrop 里根本没有那些条纹）。
 */
const srcFilter = filters.find((f) => f.id.endsWith("-full"));
const FIXTURE = { x: 24, y: 24, w: 900, h: 140 };
let fixtureRect = null;
if (srcFilter) {
	const fixture = document.createElement("div");
	fixture.setAttribute(TAG, "");
	fixture.style.cssText = "position:fixed;z-index:2147483000;background-color:#000;"
		+ "background-image:repeating-linear-gradient(90deg,#000 0 24px,#fff 24px 48px);"
		+ "left:" + FIXTURE.x + "px;top:" + FIXTURE.y + "px;width:" + FIXTURE.w + "px;height:" + FIXTURE.h + "px";
	const lens = document.createElement("div");
	lens.setAttribute(TAG, "");
	lens.style.cssText = "position:absolute;inset:0;background:rgba(0,0,0,0);"
		+ "backdrop-filter:url(#" + srcFilter.id + ");-webkit-backdrop-filter:url(#" + srcFilter.id + ")";
	fixture.append(lens);
	document.body.append(fixture);
	const r = fixture.getBoundingClientRect();
	fixtureRect = { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
}

const result = {
	engine: {
		gecko: (() => { try { return CSS.supports("-moz-appearance", "none"); } catch { return false; } })(),
		ua: navigator.userAgent,
		dpr: devicePixelRatio,
		viewport: { w: innerWidth, h: innerHeight },
	},
	filters: filters.length,
	feTurbulence: noiseNodes.length,
	warpDisplacement: warpNodes.length,
	readable: { before, after, changed: JSON.stringify(before) !== JSON.stringify(after) },
	frameStats: [withWarp, stopped].filter(Boolean),
	glassRects: rects,
	fixtureFilter: srcFilter ? srcFilter.id : null,
	fixtureRect,
	reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
};
window.__wtaGlassWarpProbe = result;
return result;
