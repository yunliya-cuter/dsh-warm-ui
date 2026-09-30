/* 曲率探针：把在线玻璃滤镜的**位移图**读回来，量「底边折射带」的曲率。
 *
 * 为什么需要它：用户 2026-09-25 报「输入框玻璃底部曲率过大」。这句话落到代码里是
 * GLASS_MATERIAL 的哪个旋钮，**不能靠读注释判断** —— 实测过一次就发现直觉是错的：
 * 按 thickness 折 0.6（70 → 42），峰值位移只从 18.42px 掉到 16.76px（−9%），
 * 因为剖面在被 slope 夹住的那一段根本不随厚度变。所以这一项必须**从生成出来的图里量**：
 *   maxd       峰值位移（px）—— 掰弯多少
 *   ramp       位移随深度的增长率（px/px）—— 就是曲率本身（= 边缘局部放大倍数 − 1）
 *   reach      位移衰减到 1px 以内所需的深度（px）—— 这条带伸进卡片多远
 *   arcPeak    底边 B 通道（压暗/回光剖面）峰值 —— 画出来的那条弧还在不在
 *
 * 读法：feDisplacementMap 的偏移 = scale × (通道/255 − 0.5) = maxd × (通道/128 − 1)，
 * 所以把 feImage 的 data URL 解出来逐像素反算即可 —— 这是**渲染真正用的那张图**，
 * 不是按公式复算的第二份实现（照公式再写一遍就等于又多一个会漂移的真相）。
 *
 * 引擎限制：Gecko 不吃 backdrop-filter 里的 url()（见 GLASS_BACKDROP_ENGINES），
 * 所以这一项只在 Chromium 上有意义；在 Firefox 上会返回 { error: "…没发 url() 滤镜" }。
 *
 * 跑法（Chromium，探针是**函数体**，要先包一层）：
 *   { printf '(async () => {\n'; cat tools/probes/curvature.js; printf '\n})()\n'; } > /tmp/w.js
 *   node.exe _warmtheme_shots/cdp.mjs eval /tmp/w.js --width 1752 --height 830
 
 *
 * 为什么这里的代码是内联的：本文件**不是模块**，而是交给 tools/harness.mjs 的一段
 * **函数体** —— harness 把它包成 `return (async () => { … })()` 用 Marionette 送进
 * 真页面执行，所以它没有 import / require，也没有 node 的 fs / path。取值、常量、
 * 判据只能就地写在这个文件里；凡是"数字与可见性"这类该由一处定义的期望值，一律
 * 走契约（harness 注入为 window.__warmContract），本文件不手抄第二份。
*/
const CARD = '[data-slot="conversation.composer.bar"] [class*="_card"]';
const DEPTH = 24;          // 采样深度：0..24px（bevel 是 18px，留一点余量看带外）
const ARC_DEPTH = 14;      // 找底边弧峰值的深度范围

const card = document.querySelector(CARD);
if (!card) return { error: "页面上没有输入卡片（" + CARD + "）" };
const svg = document.querySelector("[data-wta-glass-svg]");
const used = (getComputedStyle(card).backdropFilter.match(/url\("?#([^)"#]+)/) || [])[1] || null;
const filter = used && svg ? svg.querySelector("#" + CSS.escape(used)) : null;
const disp = filter ? filter.querySelector("feDisplacementMap") : null;
const image = filter ? filter.querySelector("feImage") : null;
if (!disp || !image) {
	return { error: "这张滤镜里没有 feDisplacementMap/feImage（Gecko 不发 url() 就是这条）", usedFilter: used };
}

const scale = Number(disp.getAttribute("scale"));
const maxd = scale / 2;
const href = image.getAttribute("href") || image.getAttribute("xlink:href") || "";
const bytes = Uint8Array.from(atob(String(href).split(",")[1] || ""), (c) => c.charCodeAt(0));
const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
const cv = document.createElement("canvas");
cv.width = bitmap.width;
cv.height = bitmap.height;
const ctx = cv.getContext("2d");
ctx.drawImage(bitmap, 0, 0);
const px = ctx.getImageData(0, 0, cv.width, cv.height).data;

const box = card.getBoundingClientRect();
const k = cv.width / box.width;                    // 地图像素 / CSS 像素（buildGlassMap 的分辨率系数）
/** CSS px（元素局部）→ 位移向量 + B 通道剖面值。 */
const at = (cx, cy) => {
	const x = Math.min(cv.width - 1, Math.max(0, Math.round(cx * k)));
	const y = Math.min(cv.height - 1, Math.max(0, Math.round(cy * k)));
	const i = (y * cv.width + x) * 4;
	return { vx: maxd * (px[i] / 128 - 1), vy: maxd * (px[i + 1] / 128 - 1), arc: px[i + 2] / 255 };
};
/** 沿一条竖线从边缘往里采 DEPTH+1 个点。from: "bottom" | "top" */
const column = (x, from) => {
	const out = [];
	for (let d = 0; d <= DEPTH; d++) {
		const y = from === "bottom" ? box.height - 0.5 - d : 0.5 + d;
		const p = at(x, y);
		out.push({ d, dx: +p.vx.toFixed(2), dy: +p.vy.toFixed(2), arc: +p.arc.toFixed(3) });
	}
	return out;
};
/**
 * 折射带（边缘段）：|dy| 从边缘往里**单调下降**的那一段。
 * 为什么必须切段：这条竖线上叠着两个来源 —— 边缘折射剖面（随深度衰减）和
 * 整片透镜 GLASS_LENS（随 v 起伏，会在深处把 dy 拉回反方向）。不切段的话
 * "每像素衰减"的中位数会落进透镜那一段，量出来的是噪声（实测 0.33 就是这么来的）。
 *   peak       边缘处的位移（px）
 *   rampPxPerPx 带内每往里 1px、位移少多少 —— 这就是曲率（= 局部放大倍数 − 1）
 *   reachPx    单调段结束的深度，也就是这条带伸进卡片多远
 */
const edgeBand = (prof) => {
	let end = 0;
	for (let i = 1; i < prof.length; i++) {
		if (Math.abs(prof[i].dy) > Math.abs(prof[i - 1].dy) + 0.05) break;
		end = i;
	}
	const diffs = [];
	for (let i = 1; i <= end; i++) diffs.push(Math.abs(prof[i - 1].dy) - Math.abs(prof[i].dy));
	diffs.sort((p, q) => p - q);
	return {
		peakPx: +Math.abs(prof[0].dy).toFixed(2),
		rampPxPerPx: diffs.length ? +diffs[Math.floor(diffs.length / 2)].toFixed(3) : null,
		reachPx: end,
	};
};
/** 单调段之外的最大 |dy| —— 那是整片透镜的贡献（本次不动它，量出来是为了证明它没被动）。 */
const lensTail = (prof, from) => {
	let peak = 0;
	for (let i = from; i < prof.length; i++) peak = Math.max(peak, Math.abs(prof[i].dy));
	return +peak.toFixed(2);
};
/**
 * 整条边带（扫遍所有 x）的峰值与到达深度 —— 单看一条竖线会被"透镜在某个 x 上的
 * 加成"带偏，所以边带的结论按整条边取。
 *   dyPeakPx |dy| 最大（沿深度方向的掰弯量）
 *   vPeakPx  |位移向量| 最大（= 地图归一化用的那个 maxd，与 feDisplacementMap 对得上）
 *   reachPx  |dy| 仍 ≥ 1px 的最深点
 */
const bandPeak = (from) => {
	const out = { dyPeakPx: 0, vPeakPx: 0, reachPx: null, dyPeakAt: null };
	for (let dx = 0; dx <= Math.floor(box.width) - 1; dx += 2) {
		for (let d = 0; d <= DEPTH; d++) {
			const y = from === "bottom" ? box.height - 0.5 - d : 0.5 + d;
			const p = at(dx + 0.5, y);
			const ady = Math.abs(p.vy), av = Math.hypot(p.vx, p.vy);
			if (ady > out.dyPeakPx) { out.dyPeakPx = ady; out.dyPeakAt = [dx, d]; }
			if (av > out.vPeakPx) out.vPeakPx = av;
			if (ady >= 1 && (out.reachPx === null || d > out.reachPx)) out.reachPx = d;
		}
	}
	out.dyPeakPx = +out.dyPeakPx.toFixed(2);
	out.vPeakPx = +out.vPeakPx.toFixed(2);
	return out;
};
let peak = 0, peakAt = null;
for (let y = 0; y < cv.height; y++) {
	for (let x = 0; x < cv.width; x++) {
		const i = (y * cv.width + x) * 4;
		const len = Math.hypot(maxd * (px[i] / 128 - 1), maxd * (px[i + 1] / 128 - 1));
		if (len > peak) { peak = len; peakAt = [+(x / k).toFixed(1), +(y / k).toFixed(1)]; }
	}
}
const midX = box.width / 2;
const bottom = column(midX, "bottom");
const top = column(midX, "top");
let arcPeak = 0, arcPeakDepth = null;
for (let d = 0; d <= ARC_DEPTH; d++) {
	if (bottom[d].arc > arcPeak) { arcPeak = bottom[d].arc; arcPeakDepth = d; }
}
return {
	usedFilter: used,
	scale,
	maxd: +maxd.toFixed(2),
	map: { w: cv.width, h: cv.height, k: +k.toFixed(3) },
	card: { w: Math.round(box.width), h: Math.round(box.height) },
	registry: {
		tint: card.style.getPropertyValue("--wta-glass-tint-cur"),
		surf: card.style.getPropertyValue("--wta-surf-opacity"),
		backdrop: getComputedStyle(card).backdropFilter,
		insetLayers: (getComputedStyle(card).boxShadow.match(/inset/g) || []).length,
		boxShadow: getComputedStyle(card).boxShadow,
		radius: getComputedStyle(card).borderTopLeftRadius,
		over: card.hasAttribute("data-wta-over"),
	},
	peak: +peak.toFixed(2),
	peakAt,
	bottom,
	top,
	bottomBand: edgeBand(bottom),
	topBand: edgeBand(top),
	bottomEdge: bandPeak("bottom"),
	topEdge: bandPeak("top"),
	bottomLensTailPx: lensTail(bottom, edgeBand(bottom).reachPx + 1),
	topLensTailPx: lensTail(top, edgeBand(top).reachPx + 1),
	arcPeak: +arcPeak.toFixed(3),
	arcPeakDepth,
};
