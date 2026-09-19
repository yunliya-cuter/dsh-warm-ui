/* 引擎能力矩阵探针：这台浏览器能把「玻璃下的东西」怎么扭。
 *
 * 为什么需要它：`contract/ui-contract.md` 的引擎表（代码里是 GLASS_BACKDROP_ENGINES）
 * 断言 Gecko 吃不下 backdrop-filter 里的 SVG 滤镜 —— 那句话决定了"玻璃下的文字动态
 * 扭曲"能不能在 Firefox 上做出来。它必须是一条**可复现的实测**，而不是注释里的一句话。
 *
 * 探针往页面里塞一张 2×4 的临时矩阵（全部 `position: fixed`，不产生文档溢出），
 * 每格都是同一张竖条纹（周期 48px，远大于被测位移 12px，截图后按相位解得出位移）：
 *
 *   列 = 把滤镜挂在哪   backdrop = `backdrop-filter: url(#…)`（本工程现在这条路）
 *                      element  = `filter: url(#…)`（挂在元素自己身上）
 *   行 = 滤镜配方       offset    feOffset dx=12        → 只测"滤镜到底有没有生效"
 *                      feimage   feImage(参考图) + 位移 → 本工程现在用的配方
 *                      turb      feTurbulence + 位移     → 不用外部图源的配方
 *
 * 读法（截图后逐行做互相关 / 测高频）：
 *   某格相对同行 control 有 ~12px 相位移动 = 这条路 + 这个配方在这台引擎上**有效**。
 *   全为 0 = 这条路完全没生效；只有 feimage 为 0 = 引擎不吃 feImage 的图源。
 */
const TAG = "data-wta-engine-probe";
const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
/* 位移 12px = scale 24 × (255/255 − 0.5)；参考图的中值是 128（= 不动）。 */
const SCALE = 24;
const SHIFT_PX = SCALE / 2;
for (const old of document.querySelectorAll("[" + TAG + "]")) old.remove();

const svgEl = (name, attrs) => {
	const node = document.createElementNS(SVG_NS, name);
	for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, String(v));
	return node;
};

/** 常数位移参考图。两种图源都准备：PNG（canvas 生成）与 SVG（纯文本）。 */
function mapSources() {
	const c = document.createElement("canvas");
	c.width = 2;
	c.height = 2;
	const g = c.getContext("2d");
	g.fillStyle = "rgb(255,128,0)";
	g.fillRect(0, 0, 2, 2);
	const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2">'
		+ '<rect width="2" height="2" fill="rgb(255,128,0)"/></svg>';
	return {
		png: c.toDataURL("image/png"),
		svg: "data:image/svg+xml," + encodeURIComponent(svg),
	};
}
const MAPS = mapSources();

/**
 * 配方表：一列一种滤镜链。每个配方往 filter 里 append 自己的原语，
 * 最后那个原语的输出就是滤镜结果。加一种测法 = 加一行。
 */
const RECIPES = {
	offset: (f) => {
		f.append(svgEl("feOffset", { in: "SourceGraphic", dx: SHIFT_PX, dy: 0 }));
	},
	feimage: (f) => {
		const image = svgEl("feImage", { preserveAspectRatio: "none", result: "map" });
		/* 图源两种写法都写：Gecko 只认 xlink:href，Chromium 两种都认。 */
		image.setAttribute("href", MAPS.png);
		image.setAttributeNS(XLINK_NS, "xlink:href", MAPS.png);
		f.append(image);
		f.append(svgEl("feDisplacementMap", {
			in: "SourceGraphic", in2: "map", scale: SCALE,
			xChannelSelector: "R", yChannelSelector: "G",
		}));
	},
	turb: (f) => {
		f.append(svgEl("feTurbulence", {
			type: "fractalNoise", baseFrequency: "0.02 0.02", numOctaves: 1, seed: 7, result: "map",
		}));
		f.append(svgEl("feDisplacementMap", {
			in: "SourceGraphic", in2: "map", scale: SCALE,
			xChannelSelector: "R", yChannelSelector: "G",
		}));
	},
};

/** 一条滤镜：区域取元素自身边界盒，颜色空间固定 sRGB（与线上实现一致）。 */
function buildFilter(id, recipe) {
	const f = svgEl("filter", {
		id,
		filterUnits: "objectBoundingBox",
		primitiveUnits: "userSpaceOnUse",
		x: 0, y: 0, width: 1, height: 1,
		"color-interpolation-filters": "sRGB",
	});
	RECIPES[recipe](f);
	return f;
}

const svg = svgEl("svg", TAG);
svg.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;overflow:hidden;pointer-events:none";
const defs = svgEl("defs");
svg.append(defs);
document.body.append(svg);

/** 矩阵：一行一格。`via` 决定滤镜挂在哪，`recipe` 决定滤镜链。 */
const MATRIX = [
	{ col: 0, row: 0, name: "backdrop-control", via: "none" },
	{ col: 0, row: 1, name: "backdrop-offset", via: "backdrop", recipe: "offset" },
	{ col: 0, row: 2, name: "backdrop-feimage", via: "backdrop", recipe: "feimage" },
	{ col: 0, row: 3, name: "backdrop-turb", via: "backdrop", recipe: "turb" },
	{ col: 1, row: 0, name: "element-control", via: "none" },
	{ col: 1, row: 1, name: "element-offset", via: "element", recipe: "offset" },
	{ col: 1, row: 2, name: "element-feimage", via: "element", recipe: "feimage" },
	{ col: 1, row: 3, name: "element-turb", via: "element", recipe: "turb" },
];
const CELL = { w: 800, h: 88, gap: 8, x0: 24, y0: 24, colGap: 56 };
const STRIPES = "repeating-linear-gradient(90deg,#000 0 24px,#fff 24px 48px)";

for (const cell of MATRIX) {
	cell.x = CELL.x0 + cell.col * (CELL.w + CELL.colGap);
	cell.y = CELL.y0 + cell.row * (CELL.h + CELL.gap);
	const box = document.createElement("div");
	box.setAttribute(TAG, "");
	box.style.cssText = "position:fixed;z-index:2147483000;background-color:#000;"
		+ "background-image:" + STRIPES + ";width:" + CELL.w + "px;height:" + CELL.h + "px;"
		+ "left:" + cell.x + "px;top:" + cell.y + "px";
	if (cell.via === "none") {
		document.body.append(box);
		cell.filterId = null;
		continue;
	}
	const id = "wta-probe-" + cell.name;
	defs.append(buildFilter(id, cell.recipe));
	cell.filterId = id;
	if (cell.via === "backdrop") {
		const lens = document.createElement("div");
		lens.setAttribute(TAG, "");
		lens.style.cssText = "position:absolute;inset:0;background:rgba(0,0,0,0);"
			+ "backdrop-filter:url(#" + id + ");-webkit-backdrop-filter:url(#" + id + ")";
		box.append(lens);
	} else {
		box.style.setProperty("filter", "url(#" + id + ")", "important");
	}
	document.body.append(box);
}

/* 等两帧：backdrop-filter 要等合成器抓一次背景。 */
await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));

const supports = {};
for (const [key, value] of Object.entries({
	"backdrop-filter": "url(#a)",
	"-webkit-backdrop-filter": "url(#a)",
	filter: "url(#a)",
})) {
	try {
		supports[key] = CSS.supports(key, value);
	} catch (error) {
		supports[key] = "throw:" + error.message;
	}
}

const result = {
	engine: {
		gecko: (() => { try { return CSS.supports("-moz-appearance", "none"); } catch { return false; } })(),
		ua: navigator.userAgent,
		dpr: devicePixelRatio,
		viewport: { w: innerWidth, h: innerHeight },
	},
	supports,
	shiftPx: SHIFT_PX,
	scale: SCALE,
	cell: CELL,
	rows: MATRIX.map((c) => Object.assign({}, c, {
		rect: { x: c.x, y: c.y, w: CELL.w, h: CELL.h },
	})),
};
window.__wtaEngineProbe = result;
return result;
