/* 元素级滤镜的**帧成本**探针（只对 Gecko 有意义的那条路）。
 *
 * 背景：实测（`engine-glass.js` 矩阵）——
 *   · Gecko 完全不吃 `backdrop-filter: url(#…)`；
 *   · 但吃挂在**元素自己**身上的 `filter: url(#…)`。
 * 于是"Firefox 下玻璃后的文字会不会被扭"只剩一条路：给会话内容那个大元素挂
 * 一条"只有玻璃那一条带有位移"的滤镜。这条路要付的代价是**每帧重新过滤一整块大元素**，
 * 所以必须先量出这个代价，再决定值不值得做。
 *
 * 探针用一块合成的正文块（尺寸与实测正文列同量级）代替真实会话，
 * 三种工况各跑一段 rAF，比较帧间隔：control（无滤镜）/ static（挂滤镜不动）/
 * animated（挂滤镜 + SMIL 动参考图）。合成而不是动真实会话，是为了不碰 DSH 的 DOM。
 */
const TAG = "data-wta-cost-probe";
const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
for (const old of document.querySelectorAll("[" + TAG + "]")) old.remove();

const TEXT_BOX = { w: 1400, h: 640 };
/* 位移幅度与带：只在中段 160px 有位移，模拟"只有玻璃那一条带被扭"。 */
const WARP = { amp: 60, period: 240, scale: 8, band: 240, bandH: 160, speed: 6 };
const FRAMES = { control: 70, static: 70, animated: 70 };

const svgEl = (name, attrs) => {
	const node = document.createElementNS(SVG_NS, name);
	for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, String(v));
	return node;
};

/** 带限位移参考图：带内是一条周期 240px 的正弦（R 通道），带外是中值（= 不动）。 */
function bandMap() {
	const c = document.createElement("canvas");
	c.width = TEXT_BOX.w;
	c.height = TEXT_BOX.h;
	const g = c.getContext("2d");
	g.fillStyle = "rgb(128,128,0)";
	g.fillRect(0, 0, c.width, c.height);
	const top = WARP.band;
	const img = g.createImageData(c.width, WARP.bandH);
	for (let y = 0; y < WARP.bandH; y++) {
		for (let x = 0; x < c.width; x++) {
			const v = 128 + WARP.amp * Math.sin(2 * Math.PI * x / WARP.period);
			const i = (y * c.width + x) * 4;
			img.data[i] = Math.max(0, Math.min(255, Math.round(v)));
			img.data[i + 1] = 128;
			img.data[i + 2] = 0;
			img.data[i + 3] = 255;
		}
	}
	g.putImageData(img, 0, top);
	return c.toDataURL("image/png");
}

const svg = svgEl("svg", TAG);
svg.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;overflow:hidden;pointer-events:none";
const defs = svgEl("defs");
svg.append(defs);
document.body.append(svg);

const filter = svgEl("filter", {
	id: "wta-cost-filter",
	filterUnits: "objectBoundingBox", primitiveUnits: "userSpaceOnUse",
	x: 0, y: 0, width: 1, height: 1, "color-interpolation-filters": "sRGB",
});
const image = svgEl("feImage", { preserveAspectRatio: "none", result: "map", x: 0, y: 0 });
image.setAttribute("href", bandMap());
image.setAttributeNS(XLINK_NS, "xlink:href", image.getAttribute("href"));
/* SMIL：让参考图整体横向漂移 —— 玻璃下的文字就会持续被"推"着走。 */
const drift = svgEl("animate", {
	attributeName: "x", values: "0;" + WARP.period, dur: "2s", repeatCount: "indefinite", begin: "indefinite",
});
image.append(drift);
filter.append(image);
filter.append(svgEl("feDisplacementMap", {
	in: "SourceGraphic", in2: "map", scale: WARP.scale,
	xChannelSelector: "R", yChannelSelector: "G",
}));
defs.append(filter);

/* 合成正文：足够多的高频内容（汉字笔画），尺寸与真实正文列同量级。 */
const wrap = document.createElement("div");
wrap.setAttribute(TAG, "");
wrap.style.cssText = "position:fixed;left:24px;top:24px;width:" + TEXT_BOX.w + "px;height:" + TEXT_BOX.h
	+ "px;overflow:hidden;z-index:2147483000;background:#111;color:#ddd;"
	+ "font:14px/22px system-ui,sans-serif";
const line = "暖色调主题的折射会把玻璃底下的文字掰弯，位移场固定在屏幕坐标里，";
wrap.textContent = Array.from({ length: 40 }, (_, i) => line + "第 " + (i + 1) + " 行").join("\n");
wrap.style.whiteSpace = "pre";
document.body.append(wrap);

const frameStats = (name, frames) => new Promise((done) => {
	const deltas = [];
	let last = 0;
	let left = frames;
	const step = (now) => {
		if (!last) {
			last = now;
		} else {
			deltas.push(now - last);
			last = now;
		}
		/* 每帧都改一次内容位置：模拟"会话在滚动"，逼浏览器重绘 + 重过滤。 */
		wrap.scrollTop = (wrap.scrollTop + 3) % 400;
		if (--left > 0) requestAnimationFrame(step);
		else {
			const sorted = deltas.slice().sort((a, b) => a - b);
			const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
			done({
				stage: name,
				frames: deltas.length,
				median: +at(0.5).toFixed(2),
				p90: +at(0.9).toFixed(2),
				max: +sorted[sorted.length - 1].toFixed(2),
			});
		}
	};
	requestAnimationFrame(step);
});

const stages = [];
stages.push(await frameStats("control（无滤镜）", FRAMES.control));
wrap.style.setProperty("filter", "url(#wta-cost-filter)", "important");
stages.push(await frameStats("static（挂滤镜，参考图不动）", FRAMES.static));
drift.beginElement();
stages.push(await frameStats("animated（SMIL 动参考图）", FRAMES.animated));
wrap.style.removeProperty("filter");

const result = {
	engine: { gecko: (() => { try { return CSS.supports("-moz-appearance", "none"); } catch { return false; } })(), ua: navigator.userAgent },
	textBox: TEXT_BOX,
	warp: WARP,
	stages,
};
window.__wtaCostProbe = result;
return result;
