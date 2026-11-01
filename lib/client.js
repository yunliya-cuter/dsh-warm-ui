/**
 * dsh-warm-ui —— 浏览器半边。
 *
 * 做两件事，都挂在同一个 effect 上（插件卸载即整层撤掉，不留痕迹）：
 *
 * 1. 暖色调：用 ctx.theme.overrideTokens 叠一层 token。DSH 的配色全部走
 *    `--dsw-static-*`（色阶）→ `--dsw-alias-*`（语义别名）两级变量；别名基本
 *    都是 `var(--dsw-static-…)` 引用，所以只要把冷灰（neutral-bluish）和品牌蓝
 *    （deepseek）两条色阶换成暖色阶，整套界面（侧栏、卡片、边框、文字、按钮、
 *    滑杆、代码块底色）自动跟着暖起来，且明暗两套主题同时生效。
 *    覆盖由 theme 服务写成 body 上的内联样式，稳定压过基础样式表。
 *
 * 2. 输入栏工具行整形：给第三方控件（prompt-optimizer 的 .dpo-*）去发光、压扁、
 *    与 DSH 原生控件对齐。只作用于输入栏里的那一簇控件（.dpo-controls），
 *    插件自己的浮层/弹窗不受影响。
 *
 * 3. 档位 / 权限收进下拉：把 prompt-optimizer 那两根滑杆换成一颗 24px 胶囊，
 *    展开后是可点选的「档位 / 权限」两行。这样窄窗口下不会再出现滑杆被挤扁、
 *    滑块压在档位文字上的问题。选项点击直接代理到插件自己的刻度按钮，
 *    状态机、落盘、联动（档位=关闭 → 权限置灰）仍完全归插件所有。
 */
window.__ModuleLoader__.load({
	id: "dsh-warm-ui",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		/** 同一个值同时用于明暗两套主题（DSH 的静态色阶本来就明暗共用一套）。 */
		const both = (value) => ({ light: value, dark: value });

		/* 外观面板走官方插槽（React 组件）。拿不到 React 时整个面板降级为不挂，
		   主题本身不受影响。 */
		let React = null;
		try {
			React = require("react");
		} catch (error) {
			React = null;
		}
		const h = React ? React.createElement : null;

		/** 换档后通知面板重渲染（面板自己订阅）。 */
		const LEVEL_LISTENERS = new Set();
		/** 由 apply() 注入的重铺 token 函数。 */
		let repaint = null;

		/**
		 * 暖中性色阶（替代 --dsw-static-neutral-bluish-*）：冷蓝灰 → 暖褐灰。
		 * 由深到浅的明度次序保持与原色阶一致，因此对比度关系不变。
		 */
		const WARM_NEUTRAL = {
			"00": "#fffdf8", // 纯白（暖）
			"50": "#fbf8f1", // 主文字（暗色主题）/ 基底（亮色主题）
			"60": "#f8f3e9",
			"75": "#f6f0e4",
			"100": "#f1e9d9",
			"150": "#ece2d0",
			"200": "#e6dbc7",
			"300": "#d0c3ab",
			"400": "#b4a48c",
			"500": "#9b8b74",
			"600": "#83745f", // 次要文字（暗色主题）
			"700": "#5f5142",
			"750": "#453a2e",
			"800": "#352d24", // 浮层 / 选择器底色
			"850": "#2d261e", // 输入框 / 次级面板
			"875": "#26201a", // 卡片 / 主面板
			"900": "#1e1913", // 侧栏
			"950": "#17130e", // 应用基底
			"1000": "#0e0b08",
		};

		/** 暖灰阶（替代 --dsw-static-neutral-*）：行内代码、滚动条等中性部件。 */
		const WARM_GRAY = {
			"00": "#fffdf9",
			"50": "#faf7f1",
			"100": "#f4f0e8",
			"150": "#ece7dd",
			"200": "#e3ddd1",
			"250": "#dad3c5",
			"300": "#d0c8b8",
			"400": "#a89e8c",
			"500": "#857b6a",
			"550": "#6f6656",
			"600": "#5c5446",
			"700": "#443e33",
			"800": "#2f2a23",
			"850": "#282420",
			"900": "#171512",
			"1000": "#0d0c0a",
		};

		/**
		 * 强调色阶（替代 --dsw-static-deepseek-*）：品牌蓝 → 暖琥珀/赤陶。
		 * 发送按钮、滑杆、链接、气泡、选中态都取这一条。
		 */
		const WARM_ACCENT = {
			"50": "#fdf4e7",
			"100": "#fae7cd",
			"200": "#f5d3a5",
			"300": "#eeb977",
			"400": "#e59f52", // 暗色主题的强调色
			"450": "#d98f42",
			"500": "#c67c2e", // 亮色主题的强调色
			"600": "#a86426",
			"800": "#6c3d19",
			"900": "#4b2a12",
		};

		/* ── 暖度档位（可在地址栏用 #暖度=1 之类实时切换，用来 A/B 对比） ────────
		   0 现状（全暖）· 1 字中性（暗色主题的文字档去黄，面仍留暖）
		   2 半中性（整体往中性拉一半）· 3 中性面 + 暖点缀（灰阶全中性，强调色仍暖）
		   做法：把每个色阶值按 t 往"同亮度的中性灰"上拉，t 越大越中性。
		   因为中性灰与原文的相对亮度相同，拉的过程基本不损失对比度。 */

		/** #rgb/#rrggbb → [r,g,b]。 */
		const hexToRgb = (hex) => {
			const v = hex.replace("#", "");
			const full = v.length === 3 ? v.split("").map((c) => c + c).join("") : v;
			const n = parseInt(full, 16);
			return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
		};
		/** [r,g,b] → #rrggbb。 */
		const rgbToHex = (rgb) =>
			"#" + rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
		const srgbToLinear = (c) => {
			const v = c / 255;
			return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
		};
		const linearToSrgb = (c) => {
			const v = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
			return Math.max(0, Math.min(255, v * 255));
		};
		/** 相对亮度（WCAG）。 */
		const relLuminance = (rgb) =>
			0.2126 * srgbToLinear(rgb[0]) + 0.7152 * srgbToLinear(rgb[1]) + 0.0722 * srgbToLinear(rgb[2]);
		/** 把颜色往同亮度的中性灰拉 t（0=原样，1=完全中性）。 */
		function towardNeutral(hex, t) {
			if (!t) return hex;
			const rgb = hexToRgb(hex);
			const gray = linearToSrgb(relLuminance(rgb));
			return rgbToHex(rgb.map((c) => c + (gray - c) * t));
		}
		/** 只改亮度、不动色相：把线性亮度乘 k（k<1 变暗）。 */
		function scaleLuminance(hex, k) {
			if (k === 1) return hex;
			const rgb = hexToRgb(hex);
			return rgbToHex(rgb.map((c) => linearToSrgb(srgbToLinear(c) * k)));
		}
		/** 在线性空间按 t 混合两色：两者亮度相同时，混完亮度也不变。 */
		function mixLinear(a, b, t) {
			if (!t) return a;
			const ra = hexToRgb(a).map(srgbToLinear);
			const rb = hexToRgb(b).map(srgbToLinear);
			return rgbToHex(ra.map((v, i) => linearToSrgb(v + (rb[i] - v) * t)));
		}
		/**
		 * 给颜色加冷/暖倾向，并把亮度拉回原值：
		 * 冷 = 压红、抬蓝（DSH 默认那种偏蓝灰），暖 = 抬红、压蓝（原来的暖褐）。
		 * 亮度归一化保证"换色调"不会顺带改变明度与对比度。
		 * @param {string} hex 基准色。
		 * @param {"cool"|"warm"|"neutral"} dir 方向。
		 * @param {number} strength 0~1。
		 */
		function tintColor(hex, dir, strength) {
			if (!strength || dir === "neutral") return hex;
			const rgb = hexToRgb(hex);
			const linear = rgb.map(srgbToLinear);
			const want = relLuminance(rgb);
			const vector = dir === "cool" ? [0.972, 0.999, 1.052] : [1.16, 1.005, 0.78];
			const shifted = linear.map((v, i) => Math.max(0, v * (1 + (vector[i] - 1) * strength)));
			const got =
				0.2126 * shifted[0] + 0.7152 * shifted[1] + 0.0722 * shifted[2];
			const factor = got > 0 ? want / got : 1;
			return rgbToHex(shifted.map((v) => linearToSrgb(Math.min(1, v * factor))));
		}

		/** 暖度档位定义：t 针对中性色阶；强调色始终保留暖橙。 */
		const WARMTH_LEVELS = {
			0: { name: "现状（全暖）", neutral: 0 },
			1: { name: "字中性（面留暖）", neutral: 0.85, textOnly: true },
			2: { name: "半中性", neutral: 0.55 },
			3: { name: "中性面 + 暖点缀", neutral: 1 },
			4: { name: "冷面（接近 DSH 默认灰）", neutral: 1, coolSurface: true },
		};

		/**
		 * 高亮文字档位：只压最亮的那几档（正文/标题用的 00~200），
		 * 中间两档（300/400，次要文字与三级文字）跟着按 35% 的比例微降，
		 * 这样"正文 > 次要 > 三级"的层级不会被压反；最淡文字（600）不参与。
		 * 六档、每档约差 6% 亮度 —— 实测"略亮/略暗"之间需要更细的颗粒度。
		 */
		const TEXT_STEPS = ["00", "50", "60", "75", "100", "150", "200"];
		const MID_TEXT_STEPS = ["300", "400"];
		const TEXT_LEVELS = {
			0: { name: "原亮度", short: "原", k: 1 },
			1: { name: "微暗 -8%", short: "-8%", k: 0.92 },
			2: { name: "略暗 -14%", short: "-14%", k: 0.86 },
			3: { name: "中暗 -20%", short: "-20%", k: 0.8 },
			4: { name: "较暗 -26%", short: "-26%", k: 0.74 },
			5: { name: "最暗 -32%", short: "-32%", k: 0.68 },
		};

		/**
		 * 文字色调档位：冷 = 往 DSH 默认那种偏蓝灰的方向偏（看着眼熟），
		 * 暖 = 原来的暖褐方向，中性 = 纯灰。偏移在亮度归一化之后做，
		 * 所以换色调不会改变你已经选好的明度与对比度。
		 */
		const TINT_LEVELS = {
			0: { name: "冷（接近 DSH 默认）", short: "冷", dir: "cool", s: 0.85 },
			1: { name: "中性（纯灰）", short: "灰", dir: "neutral", s: 0 },
			2: { name: "微暖", short: "微暖", dir: "warm", s: 0.35 },
			3: { name: "暖", short: "暖", dir: "warm", s: 0.7 },
		};

		/**
		 * 输入栏工具行的形态。写在 body 上，样式表只认这个属性。
		 *
		 * 为什么是"读结果"而不是"判宽度"：prompt-optimizer 是按**它自己的断点**
		 * 决定渲染「两根滑杆」还是「收起的迷你档位」的。我们原来在样式表里抄了一份
		 * 同样的断点（1240/1241）来藏滑杆，于是有了两处真相 —— 一旦错位，就会出现
		 * 「插件按宽屏渲染出滑杆、我们按窄屏判定」的组合，用户看到的就是
		 * 胶囊和两根滑杆同时挤在一行、模型选择被挤到第二行。
		 * 现在只读它**渲染出来的 DOM**（档位是滑杆？还是那颗迷你按钮？），断点这个数字
		 * 只活在插件自己那边。
		 *   chip     档位是滑杆（宽屏）→ 两根滑杆都藏，档位/权限由我们的胶囊一肩挑
		 *   native   档位是收起的迷你按钮（窄屏）→ 只藏权限那根，我们的胶囊让位
		 *   fallback 两样都探测不到（插件没装 / DOM 变了）→ 原样交还插件
		 */
		const OPTIMIZER_LAYOUT = {
			attribute: "data-dsh-warm-dpo",
			chip: "chip",
			native: "native",
			fallback: "fallback",
		};

		/** 由上面的表生成三条形态规则，状态名与属性名都不在 CSS 里手抄第二份。 */
		function optimizerLayoutRules() {
			const body = (state) => 'body[' + OPTIMIZER_LAYOUT.attribute + '="' + state + '"] ';
			const slider = ".dpo-controls .dpo-slider";
			const chip = ".wti-chip";
			return [
				/* 藏滑杆：宽屏两根全藏；窄屏只藏权限那根（档位那根插件已经收成按钮了）。
				   !important 是必须的，两层原因：
				    ① 插件自带样式表里写着 .dpo-slider{display:inline-flex}；
				    ② 我们自己上一代热更留在 head 里的旧表，可能带着更高特异度或更晚出现。
				   我们这张表是最后插进 head 的，同特异度下按顺序也是我们赢。 */
				body(OPTIMIZER_LAYOUT.chip) + slider + ",",
				body(OPTIMIZER_LAYOUT.native) + slider + '[data-dpo="perm"] {',
				"  display: none !important;",
				"}",
				/* 胶囊两个方向都写死，不留"没人管"的空档 */
				body(OPTIMIZER_LAYOUT.chip) + chip + " { display: flex !important; }",
				body(OPTIMIZER_LAYOUT.native) + chip + " { display: none !important; }",
				/* fallback 放最后：它表示"读不懂插件的 DOM"，此时一切以插件原样为准 */
				body(OPTIMIZER_LAYOUT.fallback) + slider + " { display: inline-flex !important; }",
				body(OPTIMIZER_LAYOUT.fallback) + chip + " { display: none !important; }",
			].join("\n");
		}

		/**
		 * 加粗档位：色相固定暖侧（≈40°）、亮度贴住正文，只调"彩度"来控制强调强度。
		 * 为什么这么做：亮度对比才是光晕/眩光的来源，色相对比走另一条通路（红-绿/蓝-黄
		 * 对手通道），可以在不更亮的前提下制造强调；但色觉的空间分辨率低，所以强度靠
		 * 彩度分级（而不是把颜色调艳或提亮），字重始终保留。实测亮度都在正文的 0.98~1.03 倍。
		 * 正文是冷灰（216~223°），暖侧色相距离最大、最容易区分。
		 *
		 * strong 是强调色（strong / b）的深/浅两套值。这里是它**唯一**的存档处：
		 * 样式表里那几条落地规则由本表生成（见 boldStrongRules），不再手写一份。
		 * 顺带修掉两处旧账：颜色原先只活在 CSS 里，而 weight 字段谁都没读过
		 * （五行同样的死数据）；0 档故意不给 strong —— 那一档的定义就是"只靠字重"。
		 */
		const BOLD_LEVELS = {
			0: { name: "同正文（对照，只靠字重）" },
			1: { name: "暖·极弱（色差很小）", strong: { dark: "#e1dfda", light: "#4a4238" } },
			2: { name: "暖·弱（默认）", strong: { dark: "#e6e1d3", light: "#57462c" } },
			3: { name: "暖·中", strong: { dark: "#ede2c8", light: "#6a5636" } },
			4: { name: "暖·强（琥珀，最显眼）", strong: { dark: "#ffe0a8", light: "#8a5a00" } },
		};
		/** 强调色落地规则：一行档位 → 深/浅两条规则。加档位只动上面那张表。 */
		function boldStrongRules() {
			return Object.entries(BOLD_LEVELS)
				.filter(([, row]) => row.strong)
				.map(([level, row]) =>
					'body[data-ds-dark-theme][data-dsh-warm-bold="' + level + '"] { --dsh-warm-strong: ' + row.strong.dark + '; }\n'
					+ 'body:not([data-ds-dark-theme])[data-dsh-warm-bold="' + level + '"] { --dsh-warm-strong: ' + row.strong.light + '; }')
				.join("\n");
		}

		/**
		 * 标题档位：标题（h1~h6）字号大、字重 700，即使颜色和正文一样也会变成
		 * 一整块"亮面"，加上它天生是结构强调（有字号/字重撑着），所以这里只做减法：
		 * 压亮度（k）为主。
		 * 色相默认跟随正文（冷灰）——同一屏里正文冷、标题暖会造成"冷暖对立"，
		 * 视线来回时睫状肌要跟着色差反复微调，实测会发涩；所以暖色只留两个对照档。
		 * 基准取"正文当前的实测色"，所以换暖度/字亮/字色后标题会跟着一起动。
		 */
		const HEADING_LEVELS = {
			0: { name: "现状（与正文同色）", k: 1 },
			1: { name: "冷灰 · 微暗 -10%", k: 0.9 },
			2: { name: "冷灰 · 暗 -16%", k: 0.84 },
			3: { name: "冷灰 · 更暗 -20%（原暖档4 的暗度）", k: 0.8 },
			4: { name: "中性纯灰 · 更暗 -20%", k: 0.8, neutral: true },
			5: { name: "暖 · 暗 -12%（对照）", tint: 0.85, k: 0.88 },
			6: { name: "暖 · 更暗 -20%（你说眼睛不舒服的那档）", tint: 0.85, k: 0.8 },
		};

		/**
		 * 面亮档位（白天 / 夜间）：环境光强的时候，纯黑底会让整块屏幕比周围环境暗很多，
		 * 眼睛要在"屏幕暗"和"环境亮"之间来回适应，看久了发闷。
		 * 做法不是乘系数——近黑处乘 1.3 也几乎看不出来（#141414 → #1b1b1b），
		 * 而是在线性空间往一个暖中性灰里混（mix），每一档的绝对提亮量都肉眼可辨。
		 * 只作用于"面"（>600 的深色阶），文字亮度仍然由「字亮」那一行控制。
		 */
		const SURFACE_LIFT = "#4a463f";
		const SURFACE_LEVELS = {
			0: { name: "现状（夜间）", short: "夜", mix: 0 },
			1: { name: "微亮（白天弱光）", short: "微亮", mix: 0.12 },
			2: { name: "亮（白天常规）", short: "亮", mix: 0.24 },
			3: { name: "更亮（白天强光）", short: "更亮", mix: 0.38 },
			4: { name: "最亮（逆光/靠窗）", short: "最亮", mix: 0.55 },
		};

		/** 当前生效档位（null = 还没读过）。默认：暖度 3 + 字亮 3 + 字色冷（DSH 那种）。 */
		let activeWarmth = null;
		let activeText = null;
		let activeTint = null;
		let activeBold = null;
		let activeHeading = null;
		let activeSurface = null;

		/** 从 localStorage（或地址栏参数）里挑一个合法档位。 */
		function pickLevel(raw, table, fallback) {
			const m = new RegExp(`(?:warm|text)=(\\d)`).exec(raw || "");
			if (m && table[m[1]]) return Number(m[1]);
			const only = /^(\d)$/.exec((raw || "").trim());
			if (only && table[only[1]]) return Number(only[1]);
			return fallback;
		}
		const readNumber = (key, fallback) => {
			try {
				return localStorage.getItem(key) ?? fallback;
			} catch (error) {
				return fallback;
			}
		};
		const writeNumber = (key, value) => {
			try {
				localStorage.setItem(key, String(value));
			} catch (error) {
				/* 存不下就只在本次生效 */
			}
		};

		/** 当前暖度（默认 3：中性面 + 暖点缀，用户实测最舒服的一档）。 */
		function currentWarmth() {
			if (activeWarmth === null) {
				activeWarmth = pickLevel(location.search + location.hash, WARMTH_LEVELS, null)
					?? pickLevel(readNumber("dsh-warm-level", "3"), WARMTH_LEVELS, 3);
			}
			return activeWarmth;
		}

		/** 当前字亮（默认 3：-20%，实测"略亮/略暗"之间的甜点）。 */
		function currentText() {
			if (activeText === null) {
				activeText = pickLevel(location.search + location.hash, TEXT_LEVELS, null)
					?? pickLevel(readNumber("dsh-warm-text", "3"), TEXT_LEVELS, 3);
			}
			return activeText;
		}

		/** 当前文字色调（默认 0：偏冷的 DSH 灰，看着眼熟）。 */
		function currentTint() {
			if (activeTint === null) {
				activeTint = pickLevel(readNumber("dsh-warm-tint", "0"), TINT_LEVELS, 0);
			}
			return activeTint;
		}

		/** 当前加粗档位（默认 1：暖·极弱，字重保留、几乎不加彩度）。 */
		function currentBold() {
			if (activeBold === null) {
				activeBold = pickLevel(readNumber("dsh-warm-bold", "1"), BOLD_LEVELS, 1);
			}
			return activeBold;
		}

		/** 当前标题档位（默认 4：中性纯灰、比正文暗 20%）。 */
		function currentHeading() {
			if (activeHeading === null) {
				activeHeading = pickLevel(readNumber("dsh-warm-heading", "4"), HEADING_LEVELS, 4);
			}
			return activeHeading;
		}

		/** 当前面亮档位（默认 0：夜间原样；白天建议 2~3）。 */
		function currentSurface() {
			if (activeSurface === null) {
				activeSurface = pickLevel(readNumber("dsh-warm-surface", "0"), SURFACE_LEVELS, 0);
			}
			return activeSurface;
		}

		/** 切换档位并记住选择。 */
		function setWarmth(level) {
			activeWarmth = WARMTH_LEVELS[level] ? level : currentWarmth();
			writeNumber("dsh-warm-level", activeWarmth);
		}
		function setText(level) {
			activeText = TEXT_LEVELS[level] ? level : currentText();
			writeNumber("dsh-warm-text", activeText);
		}
		function setTint(level) {
			activeTint = TINT_LEVELS[level] ? level : currentTint();
			writeNumber("dsh-warm-tint", activeTint);
		}
		function setBold(level) {
			activeBold = BOLD_LEVELS[level] ? level : currentBold();
			writeNumber("dsh-warm-bold", activeBold);
		}
		function setHeading(level) {
			activeHeading = HEADING_LEVELS[level] ? level : currentHeading();
			writeNumber("dsh-warm-heading", activeHeading);
		}
		function setSurface(level) {
			activeSurface = SURFACE_LEVELS[level] ? level : currentSurface();
			writeNumber("dsh-warm-surface", activeSurface);
		}

		/** 面板每一行：一个维度 + 它的档位表与读写函数。 */
		const APPEARANCE_ROWS_ALL = [
			{ key: "surface", label: "面亮", table: SURFACE_LEVELS, get: currentSurface, set: setSurface },
			{ key: "warmth", label: "暖度", table: WARMTH_LEVELS, get: currentWarmth, set: setWarmth },
			/* summary: true = 侧栏那一行的摘要显示这一档（表里指定，不靠数组顺序）。
			   只有它一个标着，面板行的增删改序都不会让摘要莫名换内容。 */
			{ key: "text", label: "字亮", table: TEXT_LEVELS, get: currentText, set: setText, summary: true },
			{ key: "tint", label: "字色", table: TINT_LEVELS, get: currentTint, set: setTint },
			{ key: "bold", label: "加粗", table: BOLD_LEVELS, get: currentBold, set: setBold },
			{ key: "heading", label: "标题", table: HEADING_LEVELS, get: currentHeading, set: setHeading },
		];

		/**
		 * 面板上**实际显示**的行 —— 目前只留「字亮」。
		 *
		 * 用户 2026-09-19 的原话：「在这一堆里面我只要留字亮」。之前六行全放的那一版
		 * 把侧栏弹层撑到 250px 高，窗口矮一点就会被视口切掉尾巴（弹层是 fixed，
		 * 切掉的行既看不见也点不到）。一行既顺了用户的意思，也让弹层永远装得下。
		 *
		 * 注意：显示与否只是**面板上画不画这一行**。档位表、读写函数、localStorage、
		 * token 管线对这六个维度全都完整保留 —— 剩下五行按各自默认值照常生效，
		 * 所以"隐藏"不等于"配色变了"。想把哪一行要回来，把 key 加回这个数组即可，
		 * 别的都不用动。
		 */
		const APPEARANCE_ROWS_SHOWN = ["text"];
		const APPEARANCE_ROWS = APPEARANCE_ROWS_ALL.filter((row) => APPEARANCE_ROWS_SHOWN.includes(row.key));

		/** 换档：落盘（各 set* 已写 localStorage）→ 重铺 token → 通知面板。 */
		function pickLevelAndRepaint(row, level) {
			row.set(level);
			if (repaint) repaint();
			for (const fn of LEVEL_LISTENERS) fn();
		}

		/* ── 外观面板的分组扩展点 ────────────────────────────────────────────
		 *  侧栏底部一行 42px 是很贵的版面：提灯、壁纸如果各自再占一行，三行就把
		 *  侧栏底挤满了，而且三套几乎一样的弹层各写一遍。所以这里开一个**纯增量**
		 *  的扩展点 —— 别的插件把自己的档位作为「一组」注册进来，直接长在这个
		 *  面板里，底部只留一行「外观」。
		 *
		 *  硬约定：**没有任何注册者时，面板与此前逐像素一致** —— 分组标题和分隔线
		 *  一律不画。真实实例 3081 上只有本插件，「提灯 / 壁纸」两个分组都不会出现，
		 *  所以 3081 的观感一个像素都不变。
		 *
		 *  分组的形状（外部插件只描述数据，不碰 DOM）：
		 *    {
		 *      id: "dsh-warm-wallpaper",
		 *      title: "壁纸",
		 *      rows: [{ key, label, get: () => 当前值,
		 *               set: (v) => 落盘并重铺,
		 *               options: [{ value, text, title }] }]
		 *    }
		 *  档位在任何别处被改动（快捷键、localStorage、自检口），调一下
		 *  `window.__dshWarmAppearance.notify()` 面板就会重渲染。
		 */
		const appearanceSections = [];
		const SECTION_LISTENERS = new Set();
		const notifyPanel = () => {
			for (const fn of SECTION_LISTENERS) fn();
			for (const fn of LEVEL_LISTENERS) fn();
		};
		/** 挂到 window 上供别的插件取用；拿不到也不影响面板本身。 */
		window.__dshWarmAppearance = {
			/** 注册一组档位；同 id 重复注册等于覆盖。返回卸载函数。 */
			register(section) {
				if (!section || !section.id || !Array.isArray(section.rows)) return () => {};
				const at = appearanceSections.findIndex((s) => s.id === section.id);
				if (at >= 0) appearanceSections[at] = section;
				else appearanceSections.push(section);
				notifyPanel();
				let alive = true;
				return () => {
					if (!alive) return;
					alive = false;
					const i = appearanceSections.findIndex((s) => s.id === section.id);
					if (i >= 0) appearanceSections.splice(i, 1);
					notifyPanel();
				};
			},
			/** 档位变了以后调一下，面板会重渲染（高亮/摘要才会跟着动）。 */
			notify: notifyPanel,
			count: () => appearanceSections.length,
			/**
			 * 这一组还在不在面板上。
			 *
			 * 为什么需要它：分组是**注册者自己**在某次 apply 里注册的，而插件热重载
			 * 会先跑旧实例的清理（等于注销）再跑新实例。只要新实例在走到注册那一步
			 * 之前抛了、或者顺序被打乱，分组就没了 —— 而它管的那个功能往往还活着
			 * （画布、rAF 都在跑），于是表现成「功能好好的，面板里那一行不见了」。
			 * 有了这个查询，注册者可以在任意时刻自检并补注册，不需要谁去记住状态。
			 */
			has: (id) => appearanceSections.some((s) => s.id === id),
			/** 当前挂着的分组 id 列表（自检用）。 */
			ids: () => appearanceSections.map((s) => s.id),
		};

		/**
		 * 外观控制面板：注册进侧栏底部的 `sidebar.footer.action` 插槽（DSH 官方扩展点，
		 * 用 React 组件，所以不依赖任何 CSS Module 哈希类名）。
		 * 收起时只是一行「外观 · 当前档」；展开后六个维度各一行小圆钮，点一下立即生效。
		 */
		function AppearanceControl() {
			const [open, setOpen] = React.useState(false);
			const [, force] = React.useState(0);
			const rowRef = React.useRef(null);
			const popRef = React.useRef(null);

			// 换档（含外部插件注册进来的分组）后重渲染，保证高亮与摘要文字跟着变
			React.useEffect(() => {
				const fn = () => force((x) => x + 1);
				LEVEL_LISTENERS.add(fn);
				SECTION_LISTENERS.add(fn);
				return () => {
					LEVEL_LISTENERS.delete(fn);
					SECTION_LISTENERS.delete(fn);
				};
			}, []);

			/** 弹层贴在按钮上方（侧栏在底部，所以向上展开），并夹在视口内。 */
			const place = React.useCallback(() => {
				const el = rowRef.current;
				const pop = popRef.current;
				if (!el || !pop) return;
				const rect = el.getBoundingClientRect();
				const left = Math.max(8, Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8));
				const top = Math.max(8, rect.top - pop.offsetHeight - 6);
				pop.style.left = `${Math.round(left)}px`;
				pop.style.top = `${Math.round(top)}px`;
			}, []);

			React.useLayoutEffect(() => {
				if (!open) return undefined;
				place();
				const onMove = () => place();
				window.addEventListener("resize", onMove);
				window.addEventListener("scroll", onMove, true);
				return () => {
					window.removeEventListener("resize", onMove);
					window.removeEventListener("scroll", onMove, true);
				};
			}, [open, place]);

			React.useEffect(() => {
				if (!open) return undefined;
				const onDown = (event) => {
					if (rowRef.current?.contains(event.target) || popRef.current?.contains(event.target)) return;
					setOpen(false);
				};
				const onKey = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				document.addEventListener("pointerdown", onDown, true);
				document.addEventListener("keydown", onKey, true);
				return () => {
					document.removeEventListener("pointerdown", onDown, true);
					document.removeEventListener("keydown", onKey, true);
				};
			}, [open]);

			/* 一行档位：一个标签 + 若干选项。
			   配色那组是数字圆钮（表达"连续档位"）；外部插件注册进来的组是**等宽
			   分段控件**（表达"离散选择"），并且带一条凹陷轨道 —— 两种形状是有意
			   的区分，而不是随手换样式。 */
			const safeGet = (row) => {
				try {
					return row.get();
				} catch (error) {
					return undefined;
				}
			};
			const rowLine = (row, groupId, mode) => {
				const buttons = (row.options || []).map((opt) =>
					h(
						"button",
						{
							key: String(opt.value),
							type: "button",
							title: opt.title || opt.text,
							"data-on": String(safeGet(row) === opt.value),
							onClick: () => {
								row.set(opt.value);
								notifyPanel();
							},
						},
						opt.text,
					),
				);
				return h(
					"div",
					{ className: "wta-line", key: groupId + ":" + row.key, "data-seg": String(mode === "segment") },
					h("span", { className: "wta-key" }, row.label),
					mode === "segment" ? h("div", { className: "wta-seg" }, buttons) : buttons,
				);
			};

			const groups = [
				{
					id: "dsh-warm-ui-tone",
					title: "配色",
					mode: "digits",
					rows: APPEARANCE_ROWS.map((row) => ({
						key: row.key,
						label: row.label,
						get: row.get,
						set: (v) => pickLevelAndRepaint(row, v),
						/* 侧栏那一行的摘要用：取当前档位的短名 */
						short: () => row.table[row.get()]?.short,
						/* 哪一行喂给侧栏摘要 —— 由档位表指定（见 APPEARANCE_ROWS_ALL） */
						summary: row.summary === true,
						options: Object.keys(row.table).map((level) => ({
							value: Number(level),
							text: level,
							title: row.table[level].name,
						})),
					})),
				},
				...appearanceSections.map((s) => ({
					id: s.id,
					title: s.title,
					mode: "segment",
					rows: s.rows,
				})),
			];

			/* 有外部注册者才画分组标题和分隔线 —— 一个都没有时，
			   面板与从前逐像素一致（真实实例 3081 就是这种情况）。 */
			const grouped = appearanceSections.length > 0;
			const body = [];
			for (const g of groups) {
				if (grouped) body.push(h("div", { className: "wta-group", key: g.id + ":title" }, g.title));
				for (const row of g.rows) body.push(rowLine(row, g.id, g.mode));
			}

			/* 摘要取「面板上真的看得到的那一行」的短名 —— 已经不在面板上的档位
			   不该继续出现在这里，否则那行值指向一个点不到的东西。
			   取哪一行是**数据**定的（档位表里的 summary:true），不是"数组里第一个
			   碰巧有短名的"：面板行的顺序会随版式调整，靠顺序会让摘要莫名其妙地
			   从"字亮 -20%"变成"面亮 夜"。没有标记时才退回老行为。 */
			const allRows = groups.flatMap((g) => g.rows);
			const shortOf = (r) => {
				try {
					return typeof r.short === "function" ? r.short() : null;
				} catch (error) {
					return null;
				}
			};
			const summary =
				allRows.filter((r) => r.summary === true).map(shortOf).find((s) => s) ||
				allRows.map(shortOf).find((s) => s) ||
				"";
			return h(
				React.Fragment,
				null,
				h(
					"button",
					{
						ref: rowRef,
						type: "button",
						className: "wta-row",
						"aria-haspopup": "menu",
						"aria-expanded": String(open),
						title: "外观：配色档位（面亮 / 暖度 / 字亮 / 字色 / 加粗 / 标题）",
						onClick: () => setOpen((v) => !v),
					},
					h("span", { className: "wta-icon", "aria-hidden": "true" }, SUN_ICON),
					h("span", { className: "wta-label" }, "外观"),
					h("span", { className: "wta-value" }, summary),
				),
				open
					? h(
							"div",
							{ ref: popRef, className: "wta-pop", role: "menu" },
							body,
							h(
								"div",
								{ className: "wta-tip" },
								grouped ? "点一下即切换，立即生效并记在这台浏览器里" : "点数字即切换，立即生效并记在这台浏览器里",
							),
						)
					: null,
			);
		}

		/** 侧栏底部的按钮行图标（16px，跟随文字颜色）。 */
		const SUN_ICON = h
			? h(
					"svg",
					{ width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg" },
					h("circle", { cx: 8, cy: 8, r: 3.2, stroke: "currentColor", strokeWidth: 1.3 }),
					h("path", {
						d: "M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.13 1.13M11.67 11.67l1.13 1.13M12.8 3.2l-1.13 1.13M4.33 11.67L3.2 12.8",
						stroke: "currentColor",
						strokeWidth: 1.3,
						strokeLinecap: "round",
					}),
				)
			: null;

		/**
		 * 把外观面板挂到侧栏底部插槽。拿不到 slots/React 就静默跳过（主题照常生效）。
		 * @param {object} ctx 客户端 cordis 上下文。
		 * @returns {() => void} 卸载函数。
		 */
		function mountAppearanceControl(ctx) {
			if (!React || !ctx.slots || typeof ctx.slots.inject !== "function") return () => {};
			try {
				const dispose = ctx.slots.inject("sidebar.footer.action", () =>
					ctx.slots.register(
						{ name: "sidebar.footer.action", id: "dsh-warm-ui-appearance", order: 10 },
						AppearanceControl,
					),
				);
				return typeof dispose === "function" ? dispose : () => {};
			} catch (error) {
				return () => {};
			}
		}

		/** 拼装覆盖表：色阶 + 少量仍是写死字面量的语义 token。 */
		function buildTokens() {
			const tokens = {};
			const level = WARMTH_LEVELS[currentWarmth()] || WARMTH_LEVELS[3];
			const text = TEXT_LEVELS[currentText()] || TEXT_LEVELS[3];
			const tint = TINT_LEVELS[currentTint()] || TINT_LEVELS[0];
			const surface = SURFACE_LEVELS[currentSurface()] || SURFACE_LEVELS[0];
			/** 先按暖度去黄，再按字亮压亮度；压暗只作用于暗色主题的高亮文字档。 */
			const tune = (value, step, theme) => {
				let out = value;
				const warmed = level.textOnly ? theme === "dark" && Number(step) <= 600 : true;
				if (level.neutral && warmed) out = towardNeutral(out, level.neutral);
				let factor = 1;
				if (theme === "dark" && text.k !== 1) {
					if (TEXT_STEPS.includes(step)) factor = text.k;
					else if (MID_TEXT_STEPS.includes(step)) factor = 1 - (1 - text.k) * 0.35;
				}
				if (factor !== 1) out = scaleLuminance(out, factor);
				// 冷面档：只把"面"（750 及更深的档）往冷灰偏，文字交给「字色」那一行
				if (level.coolSurface && theme === "dark" && Number(step) > 600) {
					out = tintColor(out, "cool", 0.6);
				}
				// 字色：整条文字色阶（≤600）按选定方向偏色，亮度保持不变
				if (theme === "dark" && Number(step) <= 600 && tint.dir !== "neutral" && tint.s > 0) {
					out = tintColor(out, tint.dir, tint.s);
				}
				// 面亮：白天把"面"整体往暖灰里抬（近黑处乘系数看不出来，混色才有效）
				if (theme === "dark" && Number(step) > 600 && surface.mix > 0) {
					out = mixLinear(out, SURFACE_LIFT, surface.mix);
				}
				return out;
			};
			for (const [step, value] of Object.entries(WARM_NEUTRAL))
				tokens[`--dsw-static-neutral-bluish-${step}`] = {
					light: tune(value, step, "light"),
					dark: tune(value, step, "dark"),
				};
			for (const [step, value] of Object.entries(WARM_GRAY))
				tokens[`--dsw-static-neutral-${step}`] = {
					light: tune(value, step, "light"),
					dark: tune(value, step, "dark"),
				};
			for (const [step, value] of Object.entries(WARM_ACCENT)) tokens[`--dsw-static-deepseek-${step}`] = both(value);

			// 最淡一档文字（caption）原本略低于小字 AA 4.5:1，单独校准到刚好过线
			tokens["--dsw-alias-label-caption"] = {
				light: scaleLuminance(tune(WARM_NEUTRAL["600"], "600", "light"), 0.86),
				dark: scaleLuminance(tune(WARM_NEUTRAL["600"], "600", "dark"), 1.17),
			};

			// 基础样式表里少数直接写死颜色的语义 token，一并改暖，避免漏出冷色。
			Object.assign(tokens, {
				// 拖放遮罩 / 思考态渐变（原值是冷灰与纯白字面量）
				"--dsw-alias-bg-mask-drop": { light: "#fffdf8b3", dark: "#1e1913b3" },
				"--dsw-linear-gradient-think": {
					light: "linear-gradient(180deg, #fffdf8 20.19%, #fffdf800 100%)",
					dark: "linear-gradient(180deg, #17130e 20.19%, #17130e00 100%)",
				},
				"--dsw-linear-think-select": {
					light: "linear-gradient(180deg, #f6f0e4 20.19%, #f6f0e400 100%)",
					dark: "linear-gradient(180deg, #26201a 20.19%, #26201a00 100%)",
				},
				// 悬浮工具栏按钮的半透明灰
				"--dsw-alias-button-tool-bar-fill": both("#5f514280"),
				"--dsw-alias-button-tool-bar-hover": both("#5f514299"),
				"--dsw-alias-button-tool-bar-fill-invisible": both("#241d175c"),
				// 亮色主题里带蓝调的悬停底色
				"--dsw-alias-interactive-bg-hover": { light: "#33261a0f", dark: "#ffffff14" },
				"--dsw-alias-interactive-bg-active": { light: "#33261a1a", dark: "#ffffff24" },
				"--dsw-alias-interactive-bg-hover-accent": { light: "#33261a24", dark: "#ffffff3d" },
			});

			// 标题色：正文用的那两档（暗 = bluish-50 / 亮 = bluish-1000）经过同一套 tune()
			// 之后就是"正文当前的实际颜色"，拿它当基准做减法即可。
			// 为什么不读 DOM：首次绘制时本插件的 token 还没落地，getComputedStyle 读到的
			// 是 DSH 原值（暗色下接近 #fafafa），算出来会偏亮一大截。
			const heading = HEADING_LEVELS[currentHeading()] || HEADING_LEVELS[0];
			if (heading.k !== 1 || heading.neutral || heading.tint) {
				const shape = (value) => {
					const out = heading.neutral
						? towardNeutral(value, 1)
						: heading.tint
							? tintColor(value, "warm", heading.tint)
							: value;
					return heading.k === 1 ? out : scaleLuminance(out, heading.k);
				};
				const baseStep = (theme) => (theme === "dark" ? "50" : "1000");
				const headingColor = (theme) =>
					shape(tune(WARM_NEUTRAL[baseStep(theme)], baseStep(theme), theme));
				tokens["--dsh-warm-heading"] = {
					light: headingColor("light"),
					dark: headingColor("dark"),
				};
			}
			return tokens;
		}

		/**
		 * 输入栏工具行的整形样式表。
		 * 目标：去掉发光/胶囊底色/渐变球，控件降到 24px 高、与 DSH 原生控件同节奏；
		 * 用双写类名（.dpo-controls.dpo-controls）抬特异性，稳压插件自带的媒体查询。
		 */
		const STYLESHEET = `
/* ── 变量层（只服务这张基础样式表）──────────────────────────────────────
   不跟 EXTRA_STYLESHEET 的变量层合并：那张表是"扩展功能"才挂载的，挂载顺序也不
   保证，而这里的规则必须始终成立。常数收在这里，改一处就全改。 */
:root {
  /* 面板要压住 DSH 自己的所有浮层（它自己的浮层最高用到 1e6 量级） */
  --wta-pop-z: 2147483000;
  /* 悬停/选中的过渡：整张表里所有小控件共用同一条节奏 */
  --wta-hover-dur: 0.16s;
  --wta-hover-ease: ease;
  /* 工具行里所有小控件（我们的胶囊 + 插件那些控件）统一高度。
     这就是契约里的 toolbar.rowHeightPx，由 tools/check.mjs 核对两边相等 ——
     改高度只改这里一处，别在规则里再写 24px。 */
  --wta-ctl-h: 24px;

  /* ── 浮层面板的玻璃底（用户 2026-09-30 报「整体透明度过高」）──────────
     症状：外观面板（.wta-pop）把下面的会话列表文字透出来，与面板自己的
     行文字叠在一起，读不清。实测这三处弹层原来都是
     background: var(--dsw-specific-menu) = #43454a73（**α=0.45**），
     而 backdrop-filter 是 none —— 45% 的纯色底、又没有模糊，所以底下
     的字是"半透出来"而不是"糊掉"，正好卡在最难读的档位。

     基准取自**输入卡片悬停态**（GLASS_CALM）。2026-09-30 在 3081 上实测，
     悬停时卡片那层玻璃的 backdrop-filter 完整体是
       blur(4px) saturate(1.12) brightness(1) url(#wta-glass-3-calm)
     其中 tint 的 α=0.62、blur 4px 来自
     GLASS_CALM.set，saturate(1.12) 来自中央饱和 GLASS_MATERIAL.sat。
     这里只对齐"底色 + 模糊 + 饱和"，**不带折射**（url(#…)）—— 弹层面积小、
     行文字密，折射会把字形边缘掰虚；而且它俩的定位基准不同（卡片在
     文档流里，弹层是 fixed 挂在 body 上），折射参数不通用。
     色相**不动**：仍用 DSH 菜单 token 的 #43454a，只把 α 从 0.45 提到 0.62
     —— 本次只改"透明度过高"，不顺手改配色。

     为什么这里加 blur 有效，而命令菜单（/）那条注释说 blur 贡献恒为 0：
     命令菜单渲染在 composer 卡片**内部**，卡片自己有 backdrop-filter、
     因而是 backdrop root，其内部没有可采样的页面内容。这三个弹层都是
     mountDetached(document.body, …) 挂在 body 上的，祖先链上没有
     backdrop root（实测 .wta-pop 的 backdropRoot = null），所以采得到。 */
  --wta-float-fill: #43454a9e;                  /* α=0.62，与 GLASS_CALM.set.tint 同档 */
  --wta-float-blur: blur(4px) saturate(1.12);   /* 与悬停态同档：blur 取自 GLASS_CALM，saturate 取自 GLASS_MATERIAL.sat */
}

/* ── 输入栏工具行：整体节奏 ─────────────────────────────────────────── */
.uV2eYG_tools { gap: 10px; }

/* ── prompt-optimizer 控件簇：压扁、对齐、去装饰 ───────────────────── */
.dpo-controls.dpo-controls {
  gap: 6px;
  height: var(--wta-ctl-h);
  align-items: center;
}
/* 与左侧 DSH 原生「访问模式」选择器之间加一条发丝线 */
.dpo-controls.dpo-controls::before {
  content: "";
  flex: 0 0 auto;
  width: 1px;
  height: 14px;
  margin: 0 4px 0 2px;
  background: var(--dsw-alias-border-l2);
}

/* 滑杆：静音轨道 + 实心小圆点（原来是渐变发光球） */
.dpo-controls .dpo-slider { height: var(--wta-ctl-h); }
.dpo-controls .dpo-slider-track {
  flex: 0 0 64px;
  min-width: 0;
  height: 14px;
}
.dpo-controls .dpo-slider-track::before {
  top: 6px;
  height: 3px;
  border-radius: 999px;
  background: var(--dsw-alias-border-l2);
}
.dpo-controls .dpo-slider-fill {
  top: 6px;
  height: 3px;
  border-radius: 999px;
  background: var(--dsw-alias-state-business-primary);
  box-shadow: none;
}
.dpo-controls .dpo-slider-thumb {
  top: 1px;
  width: 12px;
  height: 12px;
  margin-left: -6px;
  background: var(--dsw-alias-state-business-primary);
  box-shadow: 0 0 0 2px var(--dsw-specific-input-major, var(--dsw-alias-bg-base));
}
.dpo-controls .dpo-slider:hover .dpo-slider-thumb {
  transform: none;
  box-shadow:
    0 0 0 2px var(--dsw-specific-input-major, var(--dsw-alias-bg-base)),
    0 0 0 4px var(--dsw-alias-interactive-bg-hover);
}
/* 档位刻度点：4px → 3px，再淡一点 */
.dpo-controls .dpo-stop::after {
  top: 6px;
  width: 3px;
  height: 3px;
  margin-left: -1.5px;
  opacity: 0.5;
  background: var(--dsw-alias-label-caption);
}

/* 档位文字：去掉琥珀/蓝底胶囊，改成安静的次要文字；并挪到自己滑杆的前面，
   让每档读作「档位名 + 滑杆」而不是夹在两根滑杆中间 */
.dpo-controls .dpo-slider-value {
  order: -1;
  min-width: 24px;
  padding: 0;
  border: 0;
  background: none;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0;
  color: var(--dsw-alias-label-secondary);
}
/* 两根滑杆之间多留一点气口 */
.dpo-controls .dpo-slider + .dpo-slider { margin-left: 4px; }

/* ── 档位 / 权限：两根滑杆收进一个下拉胶囊 ─────────────────────────────
   宽屏：原位滑杆退役（仍留在 DOM 里当点击代理），只留一颗 24px 胶囊；
   窄屏 ≤1240px（与插件自己的 matchMedia 同断点）：插件会搬出它自带的
   「档位」胶囊 + 含两根滑杆的弹层，本胶囊让位，原位权限滑杆也一起收起来，
   于是窄窗口下同样没有滑杆可被挤扁。
   注意：两条媒体查询必须排在本节所有 .wti-* 基础规则之后 —— 同为单类选择器时
   靠源码顺序决胜，写在前面会被后面的基础规则盖掉。 */

.wti-chip {
  position: relative;
  display: flex;
  flex: 0 0 auto;
  align-items: center;
}
.wti-btn {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  height: var(--wta-ctl-h);
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition:
    color var(--wta-hover-dur) var(--wta-hover-ease),
    background var(--wta-hover-dur) var(--wta-hover-ease);
}
.wti-btn:hover,
.wti-btn[aria-expanded="true"] {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.wti-k {
  color: var(--dsw-alias-label-caption);
  font-size: 10px;
}
.wti-caret {
  font-size: 9px;
  opacity: 0.6;
}

/* 弹层挂在 body 上，position:fixed ⇒ 不会被输入栏的 overflow 裁掉 */
.wti-pop {
  position: fixed;
  z-index: var(--wta-pop-z);
  min-width: 208px;
  padding: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  /* 底色与模糊见 :root 的 --wta-float-fill 说明（对齐输入卡片悬停态的 α=0.62 + blur(4px)）。 */
  background: var(--wta-float-fill, var(--dsw-specific-menu, var(--dsw-alias-bg-layer-3)));
  -webkit-backdrop-filter: var(--wta-float-blur);
  backdrop-filter: var(--wta-float-blur);
  box-shadow: var(--dsw-shadow-lv3, 0 12px 32px #00000059);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
}
.wti-pop[hidden] { display: none; }
/* 布局守卫角标：只在「文档比视口高、页面能滚下去」时出现。
   定位由 JS 的 NODE_OWNERS.guardNote 内联写死（保证它自己不参与排版），这里只管长相。 */
.wta-guard {
  max-width: 60vw;
  padding: 4px 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--wta-float-fill, var(--dsw-specific-menu, var(--dsw-alias-bg-layer-3)));
  -webkit-backdrop-filter: var(--wta-float-blur);
  backdrop-filter: var(--wta-float-blur);
  box-shadow: var(--dsw-shadow-lv3, 0 8px 20px #00000059);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wti-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.wti-row + .wti-row { margin-top: 6px; }
.wti-label {
  flex: 0 0 28px;
  color: var(--dsw-alias-label-caption);
  font-size: 10px;
}
.wti-opt {
  flex: 1 1 0;
  min-width: 0;
  height: var(--wta-ctl-h);
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: none;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition:
    color var(--wta-hover-dur) var(--wta-hover-ease),
    background var(--wta-hover-dur) var(--wta-hover-ease),
    border-color var(--wta-hover-dur) var(--wta-hover-ease);
}
.wti-opt:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.wti-opt[data-on="true"] {
  background: var(--dsw-alias-interactive-bg-hover);
  border-color: var(--dsw-alias-border-l2);
  color: var(--dsw-alias-state-business-primary);
  font-weight: 500;
}
.wti-opt[disabled] {
  opacity: 0.4;
  cursor: default;
}
.wti-opt[disabled]:hover {
  background: none;
  color: var(--dsw-alias-label-secondary);
}
.wti-hint {
  margin-top: 6px;
  padding: 0 2px;
  color: var(--dsw-alias-label-caption);
  font-size: 10px;
  line-height: 1.4;
}

/* ── 外观面板：侧栏底部一行「外观」按钮 + 向上展开的档位面板 ─────────────
   走 DSH 官方插槽（sidebar.footer.action），所以只用语义 token 上色，
   不依赖任何 CSS Module 哈希类名。 */
.wta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 42px;
  padding: 0 10px;
  border: 0;
  border-radius: 10px;
  background: none;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 1;
  text-align: left;
  cursor: pointer;
  transition:
    background var(--wta-hover-dur) var(--wta-hover-ease),
    color var(--wta-hover-dur) var(--wta-hover-ease);
}
.wta-row:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.wta-icon {
  display: flex;
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
}
.wta-label {
  flex: 1 1 auto;
}
.wta-value {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-caption);
  font-size: 11px;
}
.wta-pop {
  position: fixed;
  z-index: var(--wta-pop-z);
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 240px;
  /* 弹层是 fixed 且向上展开，窗口一矮就会被视口下沿切掉尾巴 —— 被切掉的行
     既看不见也点不到（place() 只能把它整体上移到 top:8，救不了"装不下"）。
     所以给它一个视口上限 + 自己滚动：行数以后再加也永远够得着。
     上限写成 calc(100vh - 16px) 而不是某个像素数：与窗口高度联动，不写死。 */
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  padding: 9px 10px 7px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  /* 用户 2026-09-30 报「整体透明度过高」指的就是这一块：原来 α=0.45 且没有模糊，
     下面的会话列表文字半透上来与面板文字重叠。改成与输入卡片悬停态同档的
     α=0.62 + blur(4px)（见 :root 的 --wta-float-fill 说明）。 */
  background: var(--wta-float-fill, var(--dsw-specific-menu, var(--dsw-alias-bg-layer-3)));
  -webkit-backdrop-filter: var(--wta-float-blur);
  backdrop-filter: var(--wta-float-blur);
  box-shadow: var(--dsw-shadow-lv3, 0 8px 20px #00000059);
}
.wta-line {
  display: flex;
  align-items: center;
  gap: 2px;
}
.wta-key {
  width: 30px;
  flex: 0 0 auto;
  color: var(--dsw-alias-label-caption);
  font-size: 11px;
}
/* 分组标题 + 分隔线：只有别的插件注册了分组才会出现（见 __dshWarmAppearance）。
   一个注册者都没有时这些元素根本不存在，面板与从前逐像素一致。
   标题在左、细线一路通到右边缘 —— 比"通栏横线 + 标题压在上面"轻，也不割裂。 */
.wta-group {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 9px;
  color: var(--dsw-alias-label-caption);
  font-size: 10px;
  letter-spacing: 0.08em;
  line-height: 1;
}
.wta-group::after {
  content: "";
  flex: 1 1 auto;
  height: 1px;
  background: var(--dsw-alias-border-l1);
}
.wta-pop > .wta-group:first-child {
  margin-top: 1px;
}

/* 离散选择（提灯 / 壁纸）：等宽分段控件，坐在一条浅凹陷的轨道上。
   与上面「数字圆钮」的连续档位在形状上明确分开 —— 这是有意的区分。 */
.wta-line[data-seg="true"] {
  gap: 0;
}
.wta-seg {
  display: flex;
  flex: 1 1 auto;
  gap: 2px;
  padding: 2px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.05);
}
body:not([data-ds-dark-theme]) .wta-seg {
  background: rgba(0, 0, 0, 0.045);
}
/* 用 [data-seg="true"] 把特异度抬到 .wta-line button 之上 —— 后者在同文件里
   排在更后面，同特异度会把它这里的 height / border-radius 盖掉。 */
.wta-line[data-seg="true"] button {
  flex: 1 1 0;
  min-width: 0;
  width: auto;
  height: 20px;
  padding: 0 4px;
  border-radius: 10px;
  font-size: 11px;
  white-space: nowrap;
}
.wta-line button {
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  transition:
    background var(--wta-hover-dur) var(--wta-hover-ease),
    color var(--wta-hover-dur) var(--wta-hover-ease);
}
.wta-line button:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.wta-line button[data-on="true"] {
  background: var(--dsw-alias-interactive-bg-hover-accent);
  color: var(--dsw-alias-state-business-primary);
  font-weight: 600;
}
.wta-tip {
  margin-top: 4px;
  color: var(--dsw-alias-label-caption);
  font-size: 10px;
  line-height: 1.5;
}

/* ── 加粗：深色底上笔画变粗会"发亮发胀"，所以强调改用"同亮度的暖色相"。
   色相固定 ≈40°，只靠彩度分级。色值在 BOLD_LEVELS 表里，这张表展开成下面
   这几条规则（加一档 = 表里加一行），这里只负责把它落成 --dsh-warm-strong。 */
${boldStrongRules()}
strong,
b {
  color: var(--dsh-warm-strong, inherit);
}

/* ── 标题：19px/700 本身就构成一整块"亮面"，即使颜色与正文相同也会显亮显胀，
   所以单独给它一档（压亮度为主、可选暖偏）。变量由 paint() 按正文实测色算出来，
   换暖度/字亮/字色时会跟着一起动。 */
[class*="_markdown_"] :where(h1, h2, h3, h4, h5, h6) {
  color: var(--dsh-warm-heading, inherit);
}
[class*="_markdown_"] :where(h1, h2, h3, h4, h5, h6) :where(strong, b) {
  color: inherit;
}

/* 工具行形态：由 body 上的 data-dsh-warm-dpo 决定（JS 读插件实际渲染出的 DOM 后写，
   三态见 OPTIMIZER_LAYOUT）。这里**不用媒体查询** —— 断点写两份迟早对不上。
   规则由 optimizerLayoutRules() 按那张表生成，状态名不在这里手抄。 */
${optimizerLayoutRules()}

/* 模型选择 / 帮助按钮：带边框的胶囊 → 无边框 ghost */
.dpo-controls .dpo-model {
  height: var(--wta-ctl-h);
  max-width: 120px;
  padding: 0 6px;
  gap: 4px;
  border: 0;
  background: none;
  box-shadow: none;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}
.dpo-controls .dpo-model:hover,
.dpo-controls .dpo-model[data-open="true"] {
  transform: none;
  border-color: transparent;
  box-shadow: none;
  color: var(--dsw-alias-label-primary);
}
.dpo-controls .dpo-help {
  width: 22px;
  height: 22px;
  border: 0;
  background: none;
  box-shadow: none;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}
.dpo-controls .dpo-help:hover {
  transform: none;
  border-color: transparent;
  box-shadow: none;
  color: var(--dsw-alias-label-primary);
}

/* ── 代码高亮（shiki）：原来是一组写死的冷色字面量，换成暖色（Gruvbox 取向）── */
body {
  --shiki-token-constant: #b57614;
  --shiki-token-string: #79740e;
  --shiki-token-comment: #928374;
  --shiki-token-keyword: #9d0006;
  --shiki-token-parameter: #af3a03;
  --shiki-token-function: #b57614;
  --shiki-token-string-expression: #427b58;
  --shiki-token-punctuation: #7c6f64;
  --shiki-token-link: #af3a03;
}
body[data-ds-dark-theme] {
  --shiki-token-constant: #d79921;
  --shiki-token-string: #b8bb26;
  --shiki-token-comment: #928374;
  --shiki-token-keyword: #fb4934;
  --shiki-token-parameter: #fe8019;
  --shiki-token-function: #fabd2f;
  --shiki-token-string-expression: #8ec07c;
  --shiki-token-punctuation: #a89984;
  --shiki-token-link: #fe8019;
}
`;

		/** 样式表节点标记，便于在 DevTools 与检查脚本里一眼认出本插件注入的规则。 */

		/* ══ 动效层（2026-10-31） ════════════════════════════════════════════
		 * 独立一张样式表 + 独立 JS 引擎（见 createMotionApi 与 mountMotion），
		 * 与上面的「体验增强层」互不引用。
		 * 所有规则都挂在 body[data-wta-motion] 下：属性是 JS 按开关写的，
		 * 关掉即整体失效，DOM 与"没装这一层"一致。
		 *
		 * 三条实测结论，改这张表前先读：
		 *   1. 图层必须 display:contents。position:fixed 的包裹层会被单独合成，
		 *      内层 mix-blend-mode 的"背景"变成透明的自己 —— 高亮退化成一块盖住
		 *      文字的不透明色块（3082 实测：整行只剩一个 RGB 值，字全被吃掉）。
		 *   2. 高亮色**不写死**。取 --dsw-alias-state-business-primary（warm-ui 已把
		 *      品牌蓝换成暖琥珀），用 color-mix 加透明度铺开：换暖度档位、换主题、
		 *      换强调色都会自动跟随。浓度只有 --wta-motion-sel-strength 一个旋钮。
		 *   3. 颜色与混合模式必须声明在图层上而不是 :root —— --dsw-* 语义 token
		 *      定义在 body，写在 :root 会取不到，var() 链失效会让整条声明作废。
		 */
		const MOTION_STYLESHEET = `
:root {
  /* 弹簧：response = 收敛到目标的特征时间（秒），越小越快 */
  --wta-motion-caret-response: .3;
  --wta-motion-caret-damping: 1;
  --wta-motion-sel-response: .2;
  --wta-motion-drag-response: .1;
  --wta-motion-fade: .12;
  --wta-motion-blink-delay: 500;
  --wta-motion-blink-dur: 1.06s;
  /* 积分器：子步长与单帧上限 */
  --wta-motion-substep: .0041666667;
  --wta-motion-max-dt: .064;
  /* 几何 */
  --wta-motion-caret-w: 2px;
  --wta-motion-caret-radius: 1px;
  --wta-motion-sel-radius: 3px;
  --wta-motion-sel-pad-x: 2px;
  --wta-motion-sel-pad-y: 1px;
  --wta-motion-z: 2147482500;
  /* 高亮浓度：唯一旋钮。34% 是在 3082 真实暖色对话框上对比 18/26/34/42 四档选定的 */
  --wta-motion-sel-strength: 34%;
}

body[data-wta-motion="1"] .wta-m-layer { display: contents; }

body[data-wta-motion="1"] .wta-m-layer,
body[data-wta-motion="1"] .wta-m-boxes {
  --wta-motion-caret-color: var(--dsw-alias-state-business-primary, #e59f52);
  /* 亮色：multiply 把白底压成暖米色，深字几乎不变 */
  --wta-motion-sel-fill: color-mix(in srgb, var(--dsw-alias-state-business-primary, #e59f52) var(--wta-motion-sel-strength), transparent);
  --wta-motion-sel-blend: multiply;
}
body[data-wta-motion="1"] .wta-m-layer[data-tone="dark"],
body[data-wta-motion="1"] .wta-m-boxes[data-tone="dark"] {
  /* 暗色：screen 提亮暗底，亮字几乎不变（实测文字只 +2~3 级） */
  --wta-motion-sel-blend: screen;
}

/* 光标：外层管位置与淡出，内层管闪烁 —— 必须两层。CSS 动画优先级高于内联 opacity，
   写在同一层会互相覆盖（一个永远闪不起来，或者一个永远淡不出去）。 */
/* 外层**不能有底色**：闪烁动画在内层，内层 opacity 掉到 0 时外层如果还留着底色，
   屏幕上看就是一根常亮的实心竖条 —— 「光标不闪」的真身（2026-11-01 实测：
   内层 opacity 在 1/0 之间稳定跳变，外层 opacity 恒为 1、backgroundColor 是实色，
   所以一个像素都不会跟着变）。颜色只给内层。 */
body[data-wta-motion="1"] .wta-m-caret {
  position: fixed; left: 0; top: 0;
  width: var(--wta-motion-caret-w);
  margin-left: calc(var(--wta-motion-caret-w) / -2);
  border-radius: var(--wta-motion-caret-radius);
  z-index: var(--wta-motion-z);
  opacity: 0;
  pointer-events: none;
  will-change: transform;
}
body[data-wta-motion="1"] .wta-m-caret-bar {
  display: block; width: 100%; height: 100%;
  border-radius: inherit; background: var(--wta-motion-caret-color);
}
body[data-wta-motion="1"] .wta-m-caret-bar[data-blink="1"] {
  animation: wta-motion-blink var(--wta-motion-blink-dur) steps(1, end) infinite;
}
@keyframes wta-motion-blink {
  0%, 49.99% { opacity: 1; }
  50%, 100% { opacity: 0; }
}

/* 高亮块容器。
   默认挂在 body 上（块用视口坐标，position: fixed）；
   滚动的正文会把容器搬进滚动容器（data-mode="content"，块用内容坐标、position: absolute），
   这样浏览器滚内容时块跟着同一次合成一起走 —— 不会出现"橙框慢半拍"。 */
body[data-wta-motion="1"] .wta-m-boxes { display: contents; }
body[data-wta-motion="1"] .wta-m-boxes[data-mode="content"] {
  display: block;
  position: absolute; left: 0; top: 0; width: 0; height: 0;
  overflow: visible; pointer-events: none;
}
body[data-wta-motion="1"] .wta-m-boxes[data-mode="content"] .wta-m-sel { position: absolute; }

/* 选区块：位置与宽度由弹簧驱动，高度/行位瞬时落点（跨行时不该"长"出来） */
body[data-wta-motion="1"] .wta-m-sel {
  position: fixed; left: 0; top: 0;
  width: 0; height: 0;
  border-radius: var(--wta-motion-sel-radius);
  background: var(--wta-motion-sel-fill);
  mix-blend-mode: var(--wta-motion-sel-blend);
  z-index: var(--wta-motion-z);
  opacity: 0;
  pointer-events: none;
  will-change: transform, width, opacity;
}

/* 只有真的画出了高亮，才关掉原生选中色；画不出来时属性被摘掉，原生色立刻回来。
   注意属性挂在 <html> 上 —— 所以这里**不能**用 body[...] 去门禁：<html> 不是 body
   的后代，那样写规则永远不匹配（3082 实测：自绘高亮在，原生蓝也还在，叠成两层）。
   属性只在本层活着且真的画出东西时才存在，本身就是开关，不需要再套一层。 */
html[data-wta-motion-sel] ::selection,
html[data-wta-motion-sel]::selection {
  background: transparent !important;
  color: inherit !important;
}

/* 同上：只有真的画出了光标，才关掉原生光标 */
body[data-wta-motion="1"] [data-wta-motion-field] { caret-color: transparent !important; }

/* 量取用的隐形镜面：与输入框同字体、同内边距，只为拿 Range 矩形 */
body[data-wta-motion="1"] .wta-m-mirror {
  position: fixed; left: 0; top: 0; width: 0; height: 0;
  overflow: hidden; visibility: hidden;
  white-space: pre-wrap; word-break: break-word;
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  body[data-wta-motion="1"] .wta-m-layer { display: none; }
}
`;

		const STYLE_ATTRIBUTE = "data-dsh-warm-ui";

		/**
		 * 文案彩蛋：把某个词换掉（左=原文，右=替换）。
		 * 「深度求索中...」是 DSH 自己的本地化键 chat.deepDiving，locale 服务不允许
		 * 覆盖别人已注册的命名空间，所以这里在渲染后改写文本节点；React 只按自己的
		 * 虚拟 DOM 做 diff，不会把我改过的文本再写回去（除非该文案本身变了）。
		 */
		const TEXT_REPLACEMENTS = [["深度求索中...", "吃大白饭中......"]];

		/**
		 * 监听 DOM，把 TEXT_REPLACEMENTS 里的文案就地替换掉。
		 * 只处理新增节点与被改动的文本节点，并按帧合并，避免流式输出时反复全页扫描。
		 * @returns {() => void} 卸载函数。
		 */
		function mountTextReplacements() {
			/** 只取原文那一列，避免每处都重建数组。 */
			const FROM = TEXT_REPLACEMENTS.map(([from]) => from);
			/** 这段文本里有没有需要替换的原文。 */
			const needsWork = (text) => !!text && FROM.some((from) => text.includes(from));
			/** 把一段文本里的原文全换掉；没变时返回同一个字符串引用。 */
			const rewrite = (text) => {
				let next = text;
				for (const [from, to] of TEXT_REPLACEMENTS) {
					if (next.includes(from)) next = next.split(from).join(to);
				}
				return next;
			};

			const replaceIn = (node) => {
				if (node.nodeType === 3) {
					const text = node.nodeValue;
					if (!needsWork(text)) return;
					const next = rewrite(text);
					if (next !== text) node.nodeValue = next;
					return;
				}
				if (node.nodeType !== 1) return;
				/* 先问一次整棵子树的文本（textContent 是原生实现，比逐节点走
				   TreeWalker 快一个量级）；不含原文就整棵跳过 —— 新增节点绝大多数
				   都属于这一类，于是绝大多数时候这里只是一次字符串查找。 */
				if (!needsWork(node.textContent)) return;
				const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
				for (let leaf = walker.nextNode(); leaf; leaf = walker.nextNode()) {
					const text = leaf.nodeValue;
					if (!needsWork(text)) continue;
					const next = rewrite(text);
					if (next !== text) leaf.nodeValue = next;
				}
			};
			replaceIn(document.body);
			let frame = 0;
			const pending = new Set();
			const flush = () => {
				frame = 0;
				const nodes = [...pending];
				pending.clear();
				for (const node of nodes) if (node.isConnected) replaceIn(node);
			};
			const queue = (node) => {
				pending.add(node);
				if (!frame) frame = window.requestAnimationFrame(flush);
			};
			const observer = new MutationObserver((records) => {
				for (const record of records) {
					/* 我们自己写回 nodeValue 也是一次 characterData 变更，会再产生一条
					   记录。等这条记录送到这里时，节点的值已经是替换后的文本、不再含
					   原文 —— 所以拿「当前值还需不需要替换」当过滤条件，就把这个自我
					   触发的回路断掉了。改之前每个被替换的节点都会白白多走一整轮
					   rAF + TreeWalker，流式输出时等于把这份开销翻倍。 */
					if (record.type === "characterData") {
						if (needsWork(record.target.nodeValue)) queue(record.target);
					} else {
						for (const node of record.addedNodes) queue(node);
					}
				}
			});
			observer.observe(document.body, { childList: true, subtree: true, characterData: true });
			return () => {
				if (frame) window.cancelAnimationFrame(frame);
				observer.disconnect();
			};
		}

		/** 档位 / 权限可选值：id 是插件刻度按钮的 data-dpo，label 是兜底中文名。
		 *  档位已被 prompt-optimizer 精简为「关闭 / gaol high」两档（原普通、高级已删除，
		 *  极端改名为 gaol high）；这里同步，避免留下点不动的死选项。 */
		const TIER_OPTIONS = [
			{ id: "tier-off", label: "关闭" },
			{ id: "tier-extreme", label: "gaol high" },
		];
		const PERMISSION_OPTIONS = [
			{ id: "perm-review", label: "审查" },
			{ id: "perm-auto", label: "自动" },
		];

		/** 插件自己渲染过的档位/权限中文名；以它为准，插件改名或本地化也能跟上。 */
		const seenLabels = new Map();

		/** @param {string} id 刻度按钮的 data-dpo 值。 */
		const stopNode = (id) => document.querySelector(`[data-dpo="${id}"]`);

		/**
		 * 读一次插件当前状态（状态只认插件写在自己 DOM 上的 data-on / data-disabled）。
		 * @returns {{tier: object|null, perm: object|null, tierDisabled: boolean,
		 *   permDisabled: boolean, usable: boolean, narrow: boolean}}
		 *   usable=false 表示探测不到刻度按钮（插件没装或 DOM 变了）；
		 *   narrow=true 表示插件自己进了窄屏形态（档位换成胶囊 + 弹层）。
		 */
		function readOptimizerState() {
			const pick = (options) =>
				options.find((option) => stopNode(option.id)?.dataset.on === "true") || null;
			const tier = pick(TIER_OPTIONS);
			const perm = pick(PERMISSION_OPTIONS);
			const learn = (option, selector) => {
				const text = document.querySelector(selector)?.textContent?.trim();
				if (option && text) seenLabels.set(option.id, text);
			};
			learn(tier, '[data-dpo="tier-value"]');
			learn(perm, '[data-dpo="perm-value"]');
			const slider = (name) =>
				document.querySelector(`.dpo-controls > .dpo-slider[data-dpo="${name}"]`);
			const narrow = !!document.querySelector('[data-dpo="tier-collapsed"]');
			/* 形态以插件渲染出的 DOM 为准：档位是滑杆=宽屏形态，是迷你按钮=窄屏形态 */
			const layout = slider("tier")
				? OPTIMIZER_LAYOUT.chip
				: (narrow ? OPTIMIZER_LAYOUT.native : OPTIMIZER_LAYOUT.fallback);
			return {
				tier,
				perm,
				tierDisabled: slider("tier")?.dataset.disabled === "true",
				permDisabled: slider("perm")?.dataset.disabled === "true",
				/* 哨兵用**当前唯一非关闭档**的刻度按钮：档位表精简后索引 1 已是 extreme，
				   改用 find 取非 off 的那一档，将来增删档位不会再让哨兵指错。 */
				usable: !!stopNode((TIER_OPTIONS.find((o) => o.id !== "tier-off") || {}).id) && !!stopNode(PERMISSION_OPTIONS[0].id),
				narrow,
				layout,
			};
		}

		/** @param {{id: string, label: string}} option 选项定义。 */
		const labelOf = (option) => seenLabels.get(option.id) || option.label;

		/* ══ 世代（generation）：谁是最新一代，只有它允许写页面 ══════════════════
		   热重载换掉的是**模块实例**：旧实例的 pointermove 监听、rAF、MutationObserver
		   都还在跑，而它的代码已经过期。所以"现在活着的是第几代"绝不能记在模块作用域
		   的变量里 —— 新模块从 0 开始数，两代互不认识，就会你删我的、我插你的：
		   2026-09-24 用户报的「输入框经常闪烁」就是这么来的（旧实例还在按老代码写同一个
		   输入框，工具行里那颗「优化」胶囊被几代反复删插）。
		   计数挂在 window 上，同一页面里所有模块实例共用一套号码。
		   契约条目见 contract/ui-contract.json 的 lifecycle.singleGeneration。 */
		const GENERATION_KEYS = {
			glass: "__dshWarmGenGlass",
			chip: "__dshWarmGenChip",
		};
		/** 某条线索现在最新的是第几代（没记过就是 0）。 */
		function generationOf(name) {
			return Number(window[GENERATION_KEYS[name]]) || 0;
		}
		/** 我这一代上位：号码 +1 记回 window，返回我的号码。 */
		function beginGeneration(name) {
			const next = generationOf(name) + 1;
			window[GENERATION_KEYS[name]] = next;
			return next;
		}
		/** 我这一代退位：只有我仍是最新一代时才把号码往后推（卸载/挂载顺序被打乱也不误伤新一代）。 */
		function endGeneration(name, generation) {
			if (generation === generationOf(name)) window[GENERATION_KEYS[name]] = generation + 1;
		}

		/** 「优化」胶囊的类名：建节点与清扫都用它（见 sweepOptimizerChips）。 */
		const CHIP_CLASS = "wti-chip";

		/**
		 * 撤掉 `root` 里所有同类胶囊（`keep` 那颗除外），返回撤掉几个。
		 *
		 * 为什么清扫要按**类名**而不是只按归属标记（`sweepOwned`）：标记是后来才加的，
		 * 页面里可能还留着更早一代插件造出来的同类节点 —— 它没有 `data-dsh-warm-collapse`，
		 * 只按属性扫永远扫不到，于是新胶囊插进去之后两颗并排待着。
		 * 2026-09-24 用户截图报的「重复的高级·审查」就是它（复现见 tools/_tmp 探针的做法：
		 * 塞一颗没有标记的同类节点进 .dpo-controls，再触发一次热重载）。
		 *
		 * 为什么必须有换代守卫（`generationOf("chip")`）才敢互相清扫：两个活着的实例会
		 * "你删我的、我塞回我的"变成每帧互相打架。所以只有**最新一代**允许写工具行。
		 */
		function sweepOptimizerChips(root, keep) {
			let removed = 0;
			for (const el of (root || document).querySelectorAll("." + CHIP_CLASS)) {
				if (el === keep) continue;
				el.remove();
				removed += 1;
			}
			return removed;
		}

		/**
		 * 把两根滑杆收进一颗下拉胶囊：
		 * 胶囊插进 .dpo-controls 最前（滑杆由样式表藏起来，仍在 DOM 里），
		 * 弹层挂在 body 上（position:fixed，不受输入栏 overflow 影响）。
		 * 选项被点击时直接 click 插件自己的刻度按钮 —— 状态机、落盘、联动
		 * 全部照旧，本插件只是换了个更省地方的入口。
		 * @returns {() => void} 卸载函数（撤掉节点、监听与观察器）。
		 */
		function mountOptimizerCollapse() {
			/* 换代：上一代留下的同类节点（含只有类名、没有归属标记的老节点）先全部撤掉。 */
			const generation = beginGeneration("chip");
			sweepOptimizerChips(document, null);
			const chip = document.createElement("div");
			chip.className = CHIP_CLASS;
			tagOwner(chip, "collapseChip");

			const trigger = document.createElement("button");
			trigger.type = "button";
			trigger.className = "wti-btn";
			trigger.setAttribute("aria-haspopup", "menu");
			trigger.setAttribute("aria-expanded", "false");
			const key = document.createElement("span");
			key.className = "wti-k";
			key.textContent = "优化";
			const value = document.createElement("span");
			value.className = "wti-v";
			const caret = document.createElement("span");
			caret.className = "wti-caret";
			caret.textContent = "▾";
			trigger.append(key, value, caret);
			chip.append(trigger);

			const pop = document.createElement("div");
			pop.className = "wti-pop";
			pop.setAttribute("role", "menu");
			setOverlayHidden(pop, true);
			const hint = document.createElement("div");
			hint.className = "wti-hint";

			/** 两行选项：档位 4 档、权限 2 档。 */
			const groups = [
				{ axis: "tier", title: "档位", options: TIER_OPTIONS },
				{ axis: "perm", title: "权限", options: PERMISSION_OPTIONS },
			].map(({ axis, title, options }) => {
				const row = document.createElement("div");
				row.className = "wti-row";
				const caption = document.createElement("span");
				caption.className = "wti-label";
				caption.textContent = title;
				row.append(caption);
				const nodes = options.map((option) => {
					const node = document.createElement("button");
					node.type = "button";
					node.className = "wti-opt";
					node.setAttribute("role", "menuitemradio");
					node.dataset.stop = option.id;
					node.textContent = option.label;
					node.addEventListener("click", () => {
						stopNode(option.id)?.click();
						// 选完立即收起：弹层压在输入栏上方，留着会挡住/误点到输入框
						sync();
						close();
						// 插件是异步回写的：隔一会儿再校一次，以它渲染出的文字为准
						window.setTimeout(sync, 80);
						window.setTimeout(sync, 320);
					});
					row.append(node);
					return node;
				});
				pop.append(row);
				return { axis, options, nodes };
			});
			pop.append(hint);

			/**
			 * 弹层只在**目标插件的控件真的在页面上**时才挂在 body 上。
			 *
			 * 为什么不在建好后无条件挂上：这个弹层的唯一用途是承载目标插件的
			 * 档位/权限选项。插件没装时，挂一个永远打不开的浮层等于在页面上留下
			 * 一件只为别人准备的结构 —— 用户与脚本都该看到「没装就没有」。
			 * 挂载/摘除都跟着 .dpo-controls 的有无走（见 step()），所以插件
			 * 后装（或先装后卸）时这里会自然跟上，不需要重新加载页面。
			 * @param {boolean} mounted 目标控件是否存在。
			 */
			function followControls(mounted) {
				if (mounted) {
					/* 只有真的不在文档里才重挂：mountDetached 会先清扫同类节点，
					   对已挂着的自己调一次等于自杀。 */
					if (!pop.isConnected) mountDetached(document.body, pop, "optimizerPop");
				} else if (pop.isConnected) {
					pop.remove();
				}
			}

			/** 把弹层贴到胶囊正上方（输入栏在底部，所以向上展开），并夹在视口内。 */
			function place() {
				const rect = trigger.getBoundingClientRect();
				const left = Math.max(8, Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8));
				const top = Math.max(8, rect.top - pop.offsetHeight - 8);
				pop.style.left = `${Math.round(left)}px`;
				pop.style.top = `${Math.round(top)}px`;
			}

			function close() {
				if (pop.hidden) return;
				setOverlayHidden(pop, true);
				trigger.setAttribute("aria-expanded", "false");
			}

			function open() {
				if (!pop.hidden || !readOptimizerState().usable) return;
				sync();
				setOverlayHidden(pop, false);
				trigger.setAttribute("aria-expanded", "true");
				place();
			}

			/** 按插件状态刷新胶囊文字、选项高亮与禁用联动。 */
			function sync() {
				const state = readOptimizerState();
				// 窄屏是插件自己的场子（档位胶囊 + 含两根滑杆的弹层），不算「探测不到」
				document.body.setAttribute(OPTIMIZER_LAYOUT.attribute, state.layout);
				if (!state.usable) {
					close();
					if (!state.narrow) return;
				}
				const parts = [];
				if (state.tier) parts.push(labelOf(state.tier));
				if (state.perm) parts.push(labelOf(state.perm));
				const text = parts.join(" · ") || "—";
				if (value.textContent !== text) value.textContent = text;
				const title = `提示词优化：档位 ${state.tier ? labelOf(state.tier) : "—"} · 权限 ${state.perm ? labelOf(state.perm) : "—"}（点击调整）`;
				if (trigger.title !== title) trigger.title = title;
				for (const group of groups) {
					const disabled =
						group.axis === "tier" ? state.tierDisabled : state.permDisabled;
					const active = group.axis === "tier" ? state.tier : state.perm;
					group.options.forEach((option, index) => {
						const node = group.nodes[index];
						const label = labelOf(option);
						if (node.textContent !== label) node.textContent = label;
						const on = active?.id === option.id;
						if (node.dataset.on !== String(on)) node.dataset.on = String(on);
						node.setAttribute("aria-checked", String(on));
						if (node.disabled !== disabled) node.disabled = disabled;
					});
				}
				const next = state.tier?.id === "tier-off"
					? "档位为「关闭」时不拦截发送，权限不生效"
					: "「审查」= 优化后先给你确认再发送；「自动」= 直接替换原文发送";
				if (hint.textContent !== next) hint.textContent = next;
			}

			trigger.addEventListener("click", (event) => {
				event.stopPropagation();
				if (pop.hidden) open();
				else close();
			});
			const onPointerDown = (event) => {
				if (chip.contains(event.target) || pop.contains(event.target)) return;
				close();
			};
			const onKeyDown = (event) => {
				if (event.key === "Escape") close();
			};
			const onViewportChange = () => close();
			document.addEventListener("pointerdown", onPointerDown, true);
			document.addEventListener("keydown", onKeyDown, true);
			window.addEventListener("resize", onViewportChange);
			window.addEventListener("scroll", onViewportChange, true);

			/** 插件每次重渲染（换会话、切窄屏、改档位）都在这里跟一遍。 */
			let frame = 0;
			function step() {
				frame = 0;
				/* 被换代了就彻底停手：旧实例的 rAF / 观察器可能还在跑，但它不许再碰工具行。
				   号码存在 window 上，所以"上一代"包括**热重载换掉模块**留下的老实例 —— 那正是
				   用户看到的胶囊互相删插。 */
				if (generation !== generationOf("chip")) return;
				const controls = document.querySelector(".dpo-controls");
				if (!controls) {
					/* 目标插件不在（没装 / 被卸）：本插件为它准备的东西一样都不留 ——
					   胶囊、弹层、body 上的形态属性全部撤掉，页面回到「没装过本插件
					   的适配层」的样子。这一步让「插件有无」不影响本项目的产物。 */
					if (chip.isConnected) chip.remove();
					followControls(false);
					close();
					document.body.removeAttribute(OPTIMIZER_LAYOUT.attribute);
					return;
				}
				followControls(true);
				/* 工具行里只留我们这一颗：顺手撤掉这一代之后冒出来的同类节点。
				   只扫工具行内部 —— 外面即便有同类节点也不在排版里，扫全文档白花时间。 */
				sweepOptimizerChips(controls, chip);
				if (chip.parentElement !== controls) controls.prepend(chip);
				sync();
				if (!pop.hidden) place();
			}
			const schedule = () => {
				if (frame) return;
				frame = window.requestAnimationFrame(step);
			};
			const observer = new MutationObserver((records) => {
				// 自己写自己的节点不算变化，否则会自激
				if (records.every((r) => chip.contains(r.target) || pop.contains(r.target))) return;
				schedule();
			});
			observer.observe(document.body, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: ["data-on", "data-disabled"],
			});
			step();

			return () => {
				/* 我是最新一代才把号码往后推：这样就算卸载与新挂载的顺序被打乱，
				   新那一代也不会被我误判成"旧货"而停手。 */
				endGeneration("chip", generation);
				if (frame) window.cancelAnimationFrame(frame);
				observer.disconnect();
				document.removeEventListener("pointerdown", onPointerDown, true);
				document.removeEventListener("keydown", onKeyDown, true);
				window.removeEventListener("resize", onViewportChange);
				window.removeEventListener("scroll", onViewportChange, true);
				document.body.removeAttribute(OPTIMIZER_LAYOUT.attribute);
				chip.remove();
				pop.remove();
			};
		}

		/* ══ 体验增强层（2026-09-13 第二批） ════════════════════════════════
		 * 在既有配色之上再加一层「读起来舒服 / 看起来精致」的东西。
		 * 设计原则：**纯增量**。不动上面任何一行既有逻辑，全部靠
		 *   ① 一张独立的 <style>（data-dsh-warm-extra 标记，删掉即无痕）
		 *   ② body 上的 data-wta-* 属性做开关
		 * 每一项都能单独关掉，关掉后 DOM 与「没装这一层」一致。
		 *
		 * 为什么用 body 属性而不是直接改 CSS 文件：DSH 的样式是 CSS Module，
		 * 类名带 hash 前缀（`EvIC1a_` / `wSkVaW_`），升级就会变。所以这里一律
		 * 用**类名后缀**（`[class*="composerSeat"]`）和 **data-slot 锚点**
		 * （`[data-slot="conversation.input.dock"]`）—— 这两类都活得比 hash 久。
		 * ══════════════════════════════════════════════════════════════════ */

		/** 增强项的默认值。0 = 关，1 = 开。
		    这里只列**真的还有实现**的项 —— 原来还挂着 guard / spine / fail /
		    hero / daylight / breath 六项，但它们既没有 JS，也没有能被命中的选择器：
		    属性写在 body 上，什么都不会发生。留着只会让"这层有哪些功能"读起来是假的，
		    所以一并删掉。想加回一项，正确顺序是"先有实现，再在这里登记"。 */
		const EXTRA_DEFAULTS = {
			glass: 1,    // 液态玻璃：输入区 / 任务面板 / 悬停卡片（静态：折射 + 边缘光 + 表面反射）
			busy: 1,     // 进行中指示：关掉五族行内扫光 + 运行中条目前缀闪烁橙点 + 文字水波抖动
			narrow: 0,   // 行宽：1 = 收窄到约 48 汉字/行
			motion: 1,   // 动效：弹簧光标 + 选区高亮（关掉即完全回到浏览器原生）
		};

		/** 本层所有 DOM 钩子的前缀：元素属性一律 data-wta-*，避免与 DSH 撞名。 */
		const ATTR = "data-wta-";
		const EXTRA_KEY = (key) => "dsh-warm-x-" + key;

		/** 读一项开关；localStorage 不可用（隐私模式）时退回默认值，不抛。 */
		function readExtra(key) {
			try {
				const raw = localStorage.getItem(EXTRA_KEY(key));
				const n = raw === null ? EXTRA_DEFAULTS[key] : Number(raw);
				return Number.isFinite(n) ? n : EXTRA_DEFAULTS[key];
			} catch (error) {
				return EXTRA_DEFAULTS[key];
			}
		}
		/* 原来这里还有 cssNumber()（把只写在 CSS 变量层里的数字读回 JS，避免同一个
		   常数两边各存一份）和 writeExtra()（落盘开关）。前者唯一的用户是已删除的
		   paintGuard，后者的用户是那个从来没做出来的开关面板 —— 都成了零引用的
		   死函数。等真的有 JS 需要读 CSS 里的数字时再把 cssNumber 拿回来。 */

		/**
		 * 增强层的样式表。所有规则都挂在 body[data-wta-*] 下，
		 * 属性一撤规则就整体失效 —— 这就是「可逆」的机制。
		 */
		const EXTRA_STYLESHEET = `
/* ── 变量层 ─────────────────────────────────────────────────────────────
   所有可调数值集中在这里，下面每条规则只引用变量。
   要调材质（更透 / 更糊 / 更亮 / 高光更强 / 动画更快）只改这一段。
   命名空间统一 --wta-，与 DSH 自己的 --dsw-* token 不冲突。
   几何类（正文列位置、羽化宽度）由 JS 读这里，避免两边各写一份。 */
:root {
  /* 玻璃的**颜色**不在这里 —— 底色与表面反射强度都是"状态量"，由 JS 按
     GLASS_MATERIAL / GLASS_CALM 写成元素上的两个内联变量：
       --wta-glass-tint-cur   当前底色（常态 / 阅读态）
       --wta-surf-opacity     当前表面反射强度
     为什么挪去 JS：原先"阅读态"靠一条更靠后的选择器去覆盖本体，可是它的
     优先级 (0,2,1) 低于本体规则 (0,3,1)，两条都带 !important 时本体赢 ——
     实测 hoverProbe.changed = false，表现就是「扫上来只有光消失、底色不变暗」。
     状态放进内联变量之后，选择器优先级再也打不着它。 */
  --wta-glass-drop: 0 1px 2px rgba(0, 0, 0, .50), 0 22px 50px -16px rgba(0, 0, 0, .70);
  --wta-glass-ease: cubic-bezier(.22, .8, .3, 1);
  --wta-glass-dur: .42s;              /* 表面反射让位 / 回归 */

  /* ── 进行中指示（2026-09-25）────────────────────────────────────────────
     一处定义 = 一个含义：点的颜色/尺寸、闪烁节奏、水波节奏与振幅都只在这里写一次。
     颜色单独定义在下面的 body 规则里（**不能写在这一段 :root 里**，原因见那条规则的注释）。
     节奏：闪烁 1s —— 与 DSH 输入框里那颗 pending 点同规格（ease-in-out、alternate、
           opacity .35→1）；
     尺寸：6px（2026-09-25 用户要求「小一点」，由 8px 收到 6px）。外挂距离跟着收 1px
           （12 → 11）：点的**中心**仍在行首左侧 8px 处，即只变小、不挪位。
           水波 2.6s —— **与原扫光的周期一致**（用户要求同频），振幅 ±1px，
           只走 transform（合成器，不触发布局），所以不会把整行抖散。 */
  --wta-busy-dot-size: 6px;
  --wta-busy-dot-out: 11px;
  --wta-busy-blink-dur: 1s;
  --wta-busy-blink-min: .35;
  --wta-busy-wave-dur: 2.6s;
  --wta-busy-wave-amp: 1px;

  /* ── 底部「座位」：那条全宽渐隐带 **已按用户要求移除**（2026-09-25）──────
     它原来负责「把滚到输入区底下的正文渐隐压暗」。实测形态：1310×172px 暖黑
     （rgba(16,14,12)，顶 54px 斜坡、底 .46），全页唯一一条「输入区全宽带」；
     A/B 证据在 .edge-preview/_evidence-band.md（关掉它只影响座位区：正文区像素 Δ=0.01）。
     现在座位**不再画底**，只保留占位与盒模型（只换视觉，不碰 padding/margin/节点）。
     代价如实记下：滚到输入区底下的正文会在玻璃卡片底下透出模糊影子。
     教训（留档）：--wta-seat-* 曾经被误删过一次 —— var() 指向未定义的变量会让
     **整条声明作废**（属性回 initial），当时的表象是「输入区底下不再渐隐」。
     这次是常数与规则一起删，不会再出现「用了却没定义」。 */

  /* ── 会话气泡（悬停卡片）──────────────────────────────────────────────
     实测底色 rgb(39,39,39) 偏冷，漂在暖环境里是一块冷灰；这里给它一点暖底 + 模糊。
     同样踩过上面那个坑（变量被删、规则还在 → 底色变全透明）。 */
  --wta-bubble-tint: rgba(255, 250, 244, .09);
  --wta-bubble-blur: 20px;
  --wta-bubble-sat: 1.22;
  --wta-bubble-lift: 1.08;
  --wta-float-panel-tint: rgba(255, 250, 244, .16);
  --wta-float-panel-blur: 22px;
  --wta-float-panel-sat: 1.16;
  --wta-float-panel-lift: 1.04;
  --wta-float-panel-edge: rgba(255, 255, 255, .20);
  --wta-float-panel-shadow: 0 1px 1px rgba(255, 255, 255, .08) inset, 0 -1px 0 rgba(0, 0, 0, .18) inset, 0 12px 28px -18px rgba(0, 0, 0, .78);
  --wta-float-bubble-edge: rgba(255, 255, 255, .14);
  --wta-float-bubble-shadow: 0 1px 1px rgba(255, 255, 255, .06) inset, 0 -1px 0 rgba(0, 0, 0, .14) inset, 0 10px 24px -18px rgba(0, 0, 0, .68);

  /* ── 命令模式（/）菜单的「厚玻璃」─────────────────────────────────────
     与 goal 同一套语言，但**必须自己把底做厚**，原因见下面那条规则的长注释：
     菜单在输入卡片内部，卡片的 backdrop-filter 让卡片成了 backdrop root，
     菜单自己的 backdrop-filter 因此采不到页面背景（实测贡献恒为 0）。
     所以可读性完全由这层底色的不透明度决定 —— goal 靠 blur 拿到的观感，
     这里靠底色拿到。三个数都是量出来的，见 §「命令模式菜单」那段规则。 */
  --wta-slash-fill: rgba(43, 40, 37, .94);
  --wta-slash-edge: rgba(255, 255, 255, .18);
  --wta-slash-shadow: 0 1px 1px rgba(255, 255, 255, .10) inset, 0 -1px 0 rgba(0, 0, 0, .22) inset, 0 18px 40px -22px rgba(0, 0, 0, .82);

  /* ── 表面反射（光源在玻璃表面上的镜面像）────────────────────────────
     层数与内容都是数据：JS 的 SURFACE_LAYERS 是**数组**，join 成一个字符串
     写进 --wta-surf-image。加一层、删一层、换光向都只动那个数组，这条 CSS 不用改。
     光向与光斑指向必须一致：光在右上而光斑在别处，读起来就是「两个光源」——
     上一版那盏暖灯丑、以及"左上角还有一道光"，都是同一个错。 */
  --wta-surf-blend: screen;
  --wta-surf-image: none;

  /* 行宽 */
  --wta-narrow-width: 680px;
}

/* ── 1. 液态玻璃 ────────────────────────────────────────────────────────
   折射算法改编自 VII-Cae/hyalite--liquid-glass（MIT License，202★，2026-09）
   https://github.com/VII-Cae/hyalite--liquid-glass
   只取它的「位移图 + 滤镜链 + 边缘内阴影」三段；原库 51KB 里的 watch /
   materialize / twoPass 平滑 / 环形去饱和 / 材质缓存都没有搬 —— DSH 里
   只有两个元素要用，缓存按尺寸分桶就够了。

   为什么要换掉自己写的那一版：旧版是「一圈线性衰减的亮环 + 一条亮线一条暗线」。
   那在物理上等于**没有光源**，所以怎么调都是贴纸。玻璃板真正的四个来源是：
     ① Snell 折射剖面  offset = (厚度 + 斜面高度)·tan(α−β)，位移在斜面上持续累积
     ② 菲涅尔损耗      边缘因反射损失能量 → 相乘压暗（不是画一条暗线）
     ③ 焦散能量补偿    放大处按 ds/dd 把背景能量摊薄（这是"透过玻璃"的物理签名）
     ④ 方向性光源      light 只照亮朝向光的那半边边缘 —— 均匀亮环与一块板的分水岭
   另外补了原作者没做的**表面反射**：暗背景上没有光可以弯，玻璃看得见靠的是
   光斑在它表面上的镜面像（见 SURFACE_LAYERS）。

   几何参数不是照抄原库默认值：它的 bevel 37 是给大卡片调的，放在 92px 高的
   输入条上等于整条都是斜面、没有平整中央区。这里按「bevel ≈ 高度的 1/5」重调。

   位移图与滤镜由 JS 按元素**实际尺寸**生成（见 mountGlass），所以 CSS 只管
   底色、表面反射图层、和状态切换。带 url() 的 backdrop-filter 与方向性的
   box-shadow 都由 JS 写内联 !important（内联 important 胜过作者样式表 important）。 */
body[data-wta-glass="1"] [class*="composerSeat"] {
  /* 座位**不再画那条全宽渐隐带**（2026-09-25，用户报「与背景不协调的黑色横带」）。
     实测它是 1310×172px 的暖黑（rgba(16,14,12)，顶 54px 斜坡到 .46），
     关掉只影响座位区、正文区像素 Δ=0.01（A/B 见 .edge-preview/_evidence-band.md）。
     只换视觉：背景设 none，节点/占位/padding/margin 一律不碰。 */
  background: none !important;
  /* 注：这里原来是「渐变 + backdrop-filter: blur(22px) saturate(1.2) brightness(1.1)」。
     backdrop-filter 早在 2026-09-19 就删了（用户标注「这里有割裂感」：座位几乎整幅宽，
     那层模糊在它的上边界突然生效，横向硬边就来自它）；渐变留到 2026-09-25 也删了。
     历史教训留档：座位上原先还有 --wta-seat-blur/-sat/-lift 三个变量，删 backdrop-filter
     时一并删掉 —— 常数与规则必须同生共死，否则 var() 指向未定义会让整条声明作废。 */
}

/* ── 进行中指示（2026-09-25）────────────────────────────────────────────────
   改造前「进行中」在界面上一共画了两种暗带，都不是用户要的：
     ① 座位那条全宽渐隐带（上面已移除）；
     ② DSH 行内的「扫光」：300px 宽的中性黑块（实测 color(srgb .078 .078 .078 / .6)
        = #141414 @60%，每 2.6s 从左扫到右），共五族：
        o3BgMG（工具）· CY-8Ka（bash 样例）· _5OnbHa（命令卡，含 /compact 的「正在压缩…」）
        · lcKema（推理行）· iWrAna（skill 卡片）。
   现在：扫光全关 → 行首一颗闪烁橙点 + 条目文字按水波节奏轻轻起伏。
   锚点为什么是 [data-state="running"]：DSH 只在这些运行条目上用它（另加 cordis /
   present 卡片），一条选择器等于整族（DSH 自己是三个包各写一条）；类名带 CSS Module
   哈希前缀，属性活得比哈希久。
   爆炸半径已穷举：全前端「选择器里带 _row/_root 的 :after」只有这五族的扫光 + 它们的
   reduced-motion 兜底（共 8 条），所以 content:none 打不到别的东西（见 _evidence-band.md）。 */
body[data-wta-busy="1"] [data-state="running"] [class*="_row"]::after,
body[data-wta-busy="1"] [data-state="running"][class*="_root"]::after {
  /* 关扫光用 content:none 整条去掉，不是只停动画 —— 停住的 300px 暗块比扫过去更难看。
     第二行是 bash 样例行：它的 data-state 与 overflow:hidden 在**同一个元素**上
     （所以下面还要专门把那层裁剪放开，否则它会把行首的点一起裁掉）。 */
  content: none !important;
}

/* bash 样例行自己就是裁剪容器：它原来裁的是那条扫光（300px 宽、从 left:-300px 扫进来），
   而现在扫光整条关掉了 —— 这层裁剪再没有存在理由，却会把行首外挂的点一起裁掉。
   真机实测（2026-09-25）：跑 bash 的 sleep 时**这一行就是顶层条目**（不是嵌在工具行里的
   细节行 —— 真机里 data-state=running 的元素只有它一个），所以必须放开，不能只登记成例外。
   只放开 overflow，不碰 padding / 间隙 / 尺寸 —— 与「零位移」那条验收一致。
   对其他族是无操作（它们的 root 本来就是 overflow:visible，实测过）。 */
body[data-wta-busy="1"] [data-state="running"][class*="_root"] { overflow: visible; }

/* 点的颜色：**必须挂在 body 上，不能写进 :root**。
   实测（2026-09-25）：DSH 的语义 token 定义在 body 上 —— getComputedStyle(html)
   .getPropertyValue('--dsw-alias-state-warn-*') = ""，同一个值在 body 里 = #f59e0b
   （这里故意不写全名：契约 busy.dot.colorToken 要求它全源码只出现一次 = 换色只改一行）。
   var() 链在 :root 上取不到被引用的变量 ⇒ 自定义属性变成「保证无效值」⇒ 继承给后代后
   background: var(--wta-busy-dot) 整条声明作废 ⇒ 点画得出来却是**透明**的
   （尺寸/圆角都对，只有颜色没了）。这就是本仓库反复记的那类「无声失效」，所以：
   一处定义（还是只有一处），但作用域选在 token 真正存在的层级。换红只改这一行。 */
body[data-wta-busy="1"] { --wta-busy-dot: var(--dsw-alias-state-warn-primary); }

/* 行首的橙点：绝对定位、不参与排版（不改行高、不挤位、状态切换不跳动），只闪 opacity。
   行首留白实测 = 232px（行的 left 512 − 列容器 left 280），12px 外挂远远够用、不会被裁。 */
body[data-wta-busy="1"] [data-state="running"] { position: relative; }
body[data-wta-busy="1"] [data-state="running"]::before {
  content: "";
  position: absolute;
  left: calc(-1 * var(--wta-busy-dot-out));
  top: calc((24px + var(--dsh-content-font-delta, 0px)) / 2 - var(--wta-busy-dot-size) / 2);
  width: var(--wta-busy-dot-size);
  height: var(--wta-busy-dot-size);
  border-radius: 50%;
  background: var(--wta-busy-dot);
  animation: var(--wta-busy-blink-dur) ease-in-out infinite alternate wta-busy-blink;
}

/* 文字水波：标题与摘要差半拍 ⇒ 看起来是一道波从左往右走过整行。
   只动 transform，不碰布局 ⇒ 不位移、不抖动、不重排。 */
body[data-wta-busy="1"] [data-state="running"] [class*="_title"],
body[data-wta-busy="1"] [data-state="running"] [class*="_summary"] {
  animation: var(--wta-busy-wave-dur) ease-in-out infinite wta-busy-wave;
}
body[data-wta-busy="1"] [data-state="running"] [class*="_summary"] {
  animation-delay: calc(-1 * var(--wta-busy-wave-dur) / 6);
}

/* keyframes 写在自己的命名空间里：DSH 那颗 pending 点的 keyframes 带 CSS Module 哈希
   前缀（升级 DSH 就改名），所以照抄规格、不照抄名字。 */
@keyframes wta-busy-blink { from { opacity: var(--wta-busy-blink-min); } to { opacity: 1; } }
@keyframes wta-busy-wave {
  0%, 100% { transform: translateY(0); }
  25% { transform: translateY(calc(-1 * var(--wta-busy-wave-amp))); }
  75% { transform: translateY(var(--wta-busy-wave-amp)); }
}

/* 尊重系统「减少动态效果」：动画停，但「进行中」照样看得见 ——
   点变成一颗不闪的橙点（opacity 1），文字保持原样，行内摘要仍然写着在做什么。 */
@media (prefers-reduced-motion: reduce) {
  body[data-wta-busy="1"] [data-state="running"]::before { animation: none; }
  body[data-wta-busy="1"] [data-state="running"] [class*="_title"],
  body[data-wta-busy="1"] [data-state="running"] [class*="_summary"] { animation: none; }
}

/* 玻璃本体：输入卡片 + 任务面板。position:relative 是给表面反射图层当包含块。 */
body[data-wta-glass="1"] [data-slot="conversation.composer.bar"] [class*="_card"],
body[data-wta-glass="1"] [data-slot="conversation.input.dock"] [class*="_root"] {
  position: relative;
  /* 底色由 JS 按状态写进 --wta-glass-tint-cur：常态一档、阅读态一档。
     不写兜底值 —— 没有兜底就没有第二处要同步的常数；而这条规则本身挂在
     body[data-wta-glass="1"] 下，属性是 JS 写的，所以"JS 没跑"时它根本不生效。 */
  background-color: var(--wta-glass-tint-cur) !important;
  /* 底色不再用 background-image 画"假高光"——表面反射是独立的图层（可单独调、可关），
     塞进 background-image 就没法只改它而不动底色了。 */
  background-image: none !important;
  /* 底色**故意不给过渡**：它的值来自 var()，而未注册的变量改值不会稳定地
     驱动 background-color 的过渡 —— 实测变量 70ms 就更新了，实际生效的底色
     却卡在旧值上直到 400~500ms。那半秒空窗正好被读成
     「打字时透明度有时跳回鼠标不在输入框上的样子」。
     过渡交给 box-shadow 和表面反射（那两个是写死的属性，过渡可靠）。 */
  transition: box-shadow var(--wta-glass-dur) var(--wta-glass-ease);
}

/* 表面反射：光源在玻璃表面上的镜面像。
   整个 background-image 就是一个变量 --wta-surf-image（JS 把 SURFACE_LAYERS
   数组 join 出来），所以层数在这里是未知的、也不需要知道。
   z-index:-1 是关键：玻璃有 backdrop-filter，本身是层叠上下文，所以 -1 的子树
   会画在**玻璃底色之上、输入框内容之下** —— 光斑不会盖住文字。
   混合模式 screen（加光）：对已经很亮的像素几乎不动，只抬暗部，
   所以文字不被染色、字形边缘不会出现暖色光晕。
   不透明度同理由 JS 按状态写 --wta-surf-opacity（阅读态让位给文字）。 */
[data-wta-surf] {
  position: absolute; inset: 0; border-radius: inherit;
  pointer-events: none; z-index: -1;
  mix-blend-mode: var(--wta-surf-blend);
  background-image: var(--wta-surf-image);
  opacity: var(--wta-surf-opacity, 1);
  transition: opacity var(--wta-glass-dur) var(--wta-glass-ease);
}

/* 注：这里原本是「阅读态」的两条覆盖规则（底色变实 + 表面反射让位）。
   底色那条**从来没生效过** —— 它的优先级低于上面的本体规则，两条都 !important
   时本体赢，所以实测 hoverProbe.changed = false，用户看到的就是
   「鼠标扫上来只有光消失、字反而更看不清」。现在两个状态量都由 JS 写内联变量，
   不需要选择器，这两条规则删掉。 */

/* ── 1b. 去掉输入框的占位提示语 ─────────────────────────────────────────
   要删的是**同一处提示文案的两个版本**（DSH 按场景换文案）：
     「发消息或创建任务, / 调用指令, @ 文件或对话」
     「描述你想要构建的内容, / 调用指令, @ 文件或对话」
   实测它是一个真实节点（类名后缀 _placeholder，851x24，颜色 rgb(126,127,130)），
   所以直接不让它显示即可 —— 不碰 DSH 的文案表、不碰 React 树，也不把文字
   写进样式表：将来 DSH 换文案，这条规则照样管用。
   只限定在输入区内部；侧栏搜索框的提示语是原生 placeholder 属性
   （类名 _searchInput），类名不同，不受影响。 */
[data-slot="conversation.composer.bar"] [class*="_placeholder"],
[data-slot="conversation.input.dock"] [class*="_placeholder"],
[class*="composerSeat"] [class*="_placeholder"] { display: none !important; }

/* 会话悬停卡片：实测底色 rgb(39,39,39)、暖差 0 —— 漂在暖环境里是一块冷灰。
   浮层不参与长时间阅读，单独给一点暖不会累。
   它 position 是 static，塞不了绝对定位的图层，所以这里只做模糊 + 暖底，
   不上折射（顺带也省掉一份滤镜）。 */
body[data-wta-glass="1"] [class*="_bubble"] {
  background-color: var(--wta-bubble-tint) !important;
  -webkit-backdrop-filter: blur(var(--wta-bubble-blur)) saturate(var(--wta-bubble-sat)) brightness(var(--wta-bubble-lift));
  backdrop-filter: blur(var(--wta-bubble-blur)) saturate(var(--wta-bubble-sat)) brightness(var(--wta-bubble-lift));
  box-shadow: var(--wta-float-bubble-shadow) !important;
  isolation: isolate;
}

/* Goal and task surfaces are denser than message bubbles: they carry state and
   controls, so their edge needs to read as a stable panel without becoming an opaque card. */
body[data-wta-glass="1"] [data-goal-bar] [class*="_bar"],
body[data-wta-glass="1"] [data-queue-dock] [class*="_panel"],
body[data-wta-glass="1"] [data-slot="conversation.input.dock"] [class*="_root"] {
  background-color: var(--wta-float-panel-tint) !important;
  -webkit-backdrop-filter: blur(var(--wta-float-panel-blur)) saturate(var(--wta-float-panel-sat)) brightness(var(--wta-float-panel-lift));
  backdrop-filter: blur(var(--wta-float-panel-blur)) saturate(var(--wta-float-panel-sat)) brightness(var(--wta-float-panel-lift));
  border: .5px solid var(--wta-float-panel-edge) !important;
  box-shadow: var(--wta-float-panel-shadow) !important;
  isolation: isolate;
}

/* Keep editable goal text crisp and preserve the native focus treatment. */
body[data-wta-glass="1"] [data-goal-bar] [class*="_bar"] [class*="_objectiveInput"] {
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  box-shadow: none !important;
}

/* ── 命令模式（/）菜单：与 goal 对齐的厚玻璃 ─────────────────────────────
   用户 2026-09-27 报「透明背景下命令模式输入栏可读性差」，要求「改成与 goal 界面
   一致的厚玻璃」。

   **为什么不能照抄 goal 的写法**（这是本条的核心，做过四组对照实验）：
   goal 的厚玻璃 = .bar 上 isolation:isolate + ::before 挂
   background:var(--dsw-specific-menu) + backdrop-filter:var(--dsw-menu-backdrop-filter)。
   菜单（MenuSurface）的结构**一模一样**：.surface 有 isolation:isolate，
   .material 是 z-index:-1 的子层挂同一个 backdrop-filter。
   把 goal 的原配方逐属性复制成一个悬浮块，量「透过它看到的背景条纹对比度」(grad，
   越低=糊得越彻底=越可读；裸条纹是 32.1)：
     放在 conversation.input.dock（= goal 的真实位置，卡片**外**）→ grad = 0    ← 完美
     放在 composer 卡片**内**（= 菜单的真实位置）              → grad = 15.7 ← blur 失效
   再逐层把祖先链上所有可能形成 backdrop root 的属性（isolation / backdrop-filter /
   filter / transform / will-change / contain / mix-blend-mode / perspective /
   clip-path / mask / container-type / opacity …共 18 类）**全部中和**，grad 仍 = 26.3；
   把菜单 material 的底色 alpha 归零、只留 blur(40px)，grad = 32.8 = 等于裸条纹。
   结论：**菜单自己的 backdrop-filter 在这个位置贡献恒为 0**，不是被某个属性挡住的，
   而是卡片（它有 backdrop-filter）一旦成为 backdrop root，其**内部没有可采样的内容**。
   证据 45% 底色的实测 grad=18.17，与"条纹对比度按 (1−alpha) 线性衰减"的预测完全吻合。

   于是修法只有一条路：**不依赖 blur，把底色做厚**。goal 靠 blur 得到的观感，
   这里靠不透明度得到。三个取值都是量出来的：
     fill  .94 → 暖底压到几乎不透明，grad 4.05（原生 .45 是 18.17）
     边缘与投影沿用 goal 的 elevation 语言（外描边 + 内高光 + 落影），
       但比 float-panel 那套略重 —— 菜单是一大块 343px 高的面板，
       同样的描边在大面积上会显得没边。
   注意 !important 必要：MenuSurface 的 .material 有自己的 background/backdrop-filter，
   而本规则作用在 .surface 上；两者不是同一元素，这里只覆盖 .surface 这一层，
   「.material」 那层由下面第二条规则压平，避免两层底色叠加把 alpha 推高。 */
body[data-wta-glass="1"] [data-trigger-menu] {
  background-color: var(--wta-slash-fill) !important;
  border: .5px solid var(--wta-slash-edge) !important;
  box-shadow: var(--wta-slash-shadow) !important;
  isolation: isolate;
}

/* 「.material」 是 MenuSurface 画底+模糊的那一层。既然在卡片内它采不到背景（上面那段
   实测），就把它彻底停用 —— 留着它只会让底色叠成两层（.94 之上再叠 .45）。
   用 「background: none」 而不是改 alpha：这条规则要表达的是"这层不参与绘制"。 */
body[data-wta-glass="1"] [data-trigger-menu] > [aria-hidden="true"]:first-child {
  background: none !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}

/* 菜单里的分组标题（"指令" / "跳转"）原生是 tertiary 色，压在厚底上偏灰。
   只提亮这一档，不动条目文字色（那是菜单的可读主体，由 DSH 自己保证）。 */
body[data-wta-glass="1"] [data-trigger-menu] [class*="_groupLabel"],
body[data-wta-glass="1"] [data-trigger-menu] [class*="_sectionTitle"] {
  color: var(--dsw-alias-label-secondary) !important;
}

/* 注：这里原本有一层「流动高光」（::after + @keyframes wta-flow 两团软晕漂移）。
   已删除 —— 它和新的**表面反射图层**是同一件事的两种做法，留着会互相打架；
   而「流动感」现在来自更本质的地方：会话内容往玻璃底下滚时被折射掰弯，
   那个变形本身就是动的，不需要再叠一层匀速漂移的假光带。 */

/* ── 2. 行宽 ────────────────────────────────────────────────────────────
   实测正文列 max-width 844.8px / 字号 14px → 约 58~60 汉字一行，
   中文舒适区一般 30~45 字。收窄到 680px（约 48 字）能明显减少回扫。
   [data-chat-flow] 是稳定 data 锚点，不用 hash 类名。 */
body[data-wta-narrow="1"] [data-chat-flow] { max-width: var(--wta-narrow-width) !important; }

/* ── 3. 已删除：柔光罩三件套（背景让位 / 晨昏 / 呼吸） ──────────────────
   原来这里是三个铺满视口、z-index 为负的罩子，其中「背景让位」靠
     backdrop-filter: blur(9px) + mask 只糊正文列，削掉壁纸的高频颗粒。

   为什么整组删掉（2026-09-19）：
     ① 用户报「背景出不来了，要用滚轮往下滑才能看到背景」。这个罩子是**唯一**
        一个压在壁纸画布上方、又带 backdrop-filter 的全屏元素。backdrop-filter
        要求浏览器把身后的内容（这里是每帧更新的 WebGL 画布）抓进一张纹理；
        一旦那一步没跟上，正文列显示的就是一份过期/空白底 —— 而滚动会强制
        重新合成，于是表现成"滚一下背景才出来"。本地无头浏览器截图每次都要
        重新合成，所以永远复现不出来，这个坑只能靠"删掉可疑的全屏 backdrop"
        来关掉，不能靠调参数。
     ② 它换来的只是"正文列后面的纤维糊一点"，而这件事在壁纸那头有一个
        确定、零风险的等价做法：直接调低纸纹的高频振幅（见 wallpaper 的
        PAPER.fine / TUNE.paper）。把效果放回**源头**，就不需要一层全屏滤镜。
     ③ 晨昏 / 呼吸两项从来没写 JS，属性写了、选择器一个都命中不了，是死代码。

   删掉后不再需要给壁纸画布指定层级（原来把它压到 -4 是为了给罩子腾 -3..-1），
   画布回到 wallpaper 插件自己的 z-index 定义，两个插件之间少一处隐性耦合。 */

/* ── 4/5/6. 已删除：回合脊、失败标色、空状态工作台 ──────────────────────
   这三段 CSS 加起来约 90 行，规则都挂在 [data-wta-run] / [data-wta-failrow] /
   [data-wta-hero-panel] 上。全仓库没有任何一处给元素加过这三个属性，也没有
   对应的 JS —— 在真实 DOM 里实测命中数为 0（document.querySelectorAll
   三个选择器都返回空）。也就是说不存在"删了会掉功能"的可能，它们只是把
   样式表撑大、让人误以为有这三项功能。 */
`;

		/** 把开关写进 body 属性 —— 样式表里所有规则都由这些属性驱动。 */
		function paintExtraFlags() {
			const b = document.body;
			for (const key of Object.keys(EXTRA_DEFAULTS)) {
				const value = String(readExtra(key));
				/* 值没变就不写：写一个一模一样的值同样会产生一条 attribute 变更记录，
				   MutationObserver 型的补光/布局守卫会被自己激起来（僵尸世代在位时更是每帧
				   都写一遍 —— 那是"每帧都在动"的燃料之一）。 */
				if (b.getAttribute(ATTR + key) !== value) b.setAttribute(ATTR + key, value);
			}
		}

		/* ══════════════════════════════════════════════════════════════════════
		   液态玻璃：折射算法改编自 VII-Cae/hyalite--liquid-glass
		   （MIT License，202★，2026-09）
		   https://github.com/VII-Cae/hyalite--liquid-glass

		   原库 51KB，含 watch / materialize / twoPass 抗锯齿 / 环形去饱和 /
		   材质缓存一整套；DSH 里只有两个元素要用，所以只搬三段核心：
		     ① buildGlassMap     逐像素算「位移场 + 有符号边缘剖面」
		     ② buildGlassFilter  把地图接成滤镜链（模糊 → 位移 → 压暗 → 补光）
		     ③ glassEdgeShadow   锐利外线交给 CSS 内阴影（滤镜画的半像素线活不下来）

		   为什么值得搬：自己写的那一版是「线性衰减的亮环 + 一条亮线一条暗线」，
		   那在物理上等于**没有光源**，所以怎么调都像贴纸。玻璃板的四个来源是 ——
		     Snell 折射剖面 / 菲涅尔损耗 / 焦散能量补偿 / 方向性光源。
		   ══════════════════════════════════════════════════════════════════════ */

		/** 折射的物理参数。
		    数值不是照抄原库默认值：它的 bevel 37 是给大卡片调的，放在 92px 高的
		    输入条上等于整条都是斜面、没有平整中央区。这里按「bevel ≈ 高度的 1/5」重调。 */
		const GLASS_MATERIAL = {
			bevel: 18,          // 斜面宽度 px（同时被夹到短边的一半）
			thickness: 70,      // 玻璃厚度 px —— 决定边缘把背景往里拉多远
			slope: 1.5,         // 位移衰减上限 px/px，等于边缘局部放大倍数-1 的封顶。
			                    // 原库给到 2.7（3.7 倍）在扁面板上把 13px 的字边缘撕开成几条，
			                    // 实测太狠；1.5 让边缘最狠处约 2.5 倍，厚度还在但字不烂。
			shape: "squircle",  // 斜面剖面：circle | squircle（苹果用的）| lip
			lens: "flow",       // 整片透镜的形状，键名取自 GLASS_LENS（见那张表的说明）
			lensAmp: 1,         // 整片透镜的全局倍数（形状表里的振幅本身已经是 px）
			dispGain: 1,         // 位移场整体倍数：边缘带与整片透镜一起乘。1 = 不动。
			                    // 为什么单独一个旋钮：slope 只压"弯得多快"（边缘的增长率），
			                    // 弯的**总量**由这里定 —— 用户 2026-09-25 报「曲率还是太大」，
			                    // 要降的就是总量。0 取不到（buildGlassFilter 里 `|| 1`），
			                    // 所以"调成看不见"只能显式调小，地板值写在契约 glass.curvature.floors。
			blur: 0,            // 中央霜度 px。**静止态必须为 0**：模糊会把要看的扭曲
			                    // 一起糊掉（实测 1px 就能把 13px 汉字的峰值从 225 砍到 90），
			                    // 材质感交给折射去给，不靠模糊。阅读态才加糊（见 GLASS_CALM）。
			dispersion: 0,      // 色散 = 通道分离的像素数。原库给 1.6（配着模糊用的）。
			                    // 静止态一去掉模糊，通道分离就在每条笔画上留一道彩虹边：
			                    // 实测 1.6 和 0.5 都明显，看着像坏了不像玻璃，所以给 0。
			                    // 要找回彩边就把这个数字调上去，代价是背景文字会花。
			shade: 0.46,        // 边缘压暗量（焦散 + 菲涅尔损耗，按调好的比例一起给）
			rim: 1.76,          // 边缘回光量（宽菲涅尔辉光 + 细镜面线）
			edgeW: 6,           // 压暗与辉光向内伸多远 px（故意用绝对值）
			edge: 0.32,         // CSS 外线强度，0 = 关掉
			light: 45,          // 光源方向：0 正上，正角度顺时针。+45° = 右上角
			/* 下面三个是"背景透过率"的调法。lift / sat 原本是 1.06 / 1.25，
			   实测把壁纸的暖光带**提亮**了 —— 那片亮被读成"玻璃上有一道光"，
			   而它其实只是背景。现在不放大背景（lift 1）、少加味（sat 1.12），
			   靠 tint 把背景压住。tint 也不能压太狠：折射要有东西可掰，
			   背景压没了就等于"扭曲存在但看不见"（.40 那一版就是这样，实测
			   卡片上方的正文对比度掉到几乎为 0）。 */
			sat: 1.12,          // 中央饱和度
			lift: 1,            // 中央提亮（1 = 不放大背景）
			tint: "rgba(24, 21, 18, .30)",   // 常态底色：压住背景又不压死
			surf: 1,            // 表面反射强度（常态满亮）
		};
		/** 阅读态（鼠标扫上来）的系数：乘在常态上。
		    写成系数而不是另一套绝对值 —— 以后调常态时阅读态自动跟随，不会两边各调各的。
		    scale 里的项是"乘"，set 里的项是"换"。tint / surf 必须放在 set 里：
		    底色一变实，折射带来的噪声就同时被压掉，读自己打的字才不费劲。 */
		const GLASS_CALM = {
			scale: { thickness: 0.42, rim: 0.68, edge: 0.68, shade: 0.7, lensAmp: 0.3 },
			set: { dispersion: 0, blur: 4, tint: "rgba(22, 19, 17, .62)", surf: 0.3 },
		};
		/**
		 * 引擎能力表：backdrop-filter 里吃得下 SVG 滤镜（url(#…)）吗？
		 *
		 * 2026-09-19 在真 Firefox 154 + 真显卡（AMD R9 200 / ANGLE D3D11，
		 * WebGL 正常）上量出来的三件事：
		 *   1. 壁纸本身在 Firefox 里完全正常 —— 画布满屏、纹理清晰、会话顶部和
		 *      底部都看得见。所以「背景出不来」不是壁纸画不出来。
		 *   2. 同一块玻璃，Chromium 上背景被掰弯（折射看得见），Firefox 上
		 *      **什么都不发生**：在壁纸上压一块只有 url() 的贴片，高频从 1.28
		 *      掉到 0.89（等于被压平），换成纯 blur(6px) 是 0.90 —— 也就是说
		 *      Firefox 把 url() 那半条当成了"糊一下"，折射一点没做。
		 *   3. 而常态材质的 blur 是 0（设计上"质感交给折射给，不靠模糊"），
		 *      两条一叠加，Firefox 上的玻璃就退化成一块平的半透明色板。
		 *
		 * 所以按引擎发两套配方：吃得下 url() 的照旧走折射；吃不下的**不发 url()**
		 * ——那条在 Firefox 上只会白压平背景，同时把每档尺寸一次的 buildGlassMap
		 * 也整个省掉。
		 *
		 * 2026-09-19 用 `tools/probes/engine-glass.js` 把"认不认 url()"量成了三行矩阵
		 * （同一张竖条纹，压玻璃的那块相对没压的那块位移多少）：
		 *
		 *   backdrop-filter: url(#…)   配方 feOffset dx=12    feImage+位移   噪声+位移
		 *     Chromium（无头 Edge）        +12.00px ✓          −12.00px ✓    图案打乱 ✓
		 *     Firefox 154（无头）              0px              0px             0px
		 *   filter: url(#…)（元素自身）
		 *     两个引擎                      +12.00px ✓          ±12px ✓       图案打乱 ✓
		 *
		 * 也就是说：Gecko **完全不认** backdrop 里的 SVG 滤镜（不是"只认一半"）。
		 * 这条结论今天仍然成立，而且和"玻璃动不动"无关 —— 它决定的是**静止的折射**
		 * 在 Firefox 上到底有没有（答案：没有），`svgFilter` 就是这一列。
		 *
		 * 加引擎 / 改配方 = 加一行，别把判断散进 dress()。
		 */
		const GLASS_BACKDROP_ENGINES = [
			{
				name: "gecko",
				/* Gecko 是唯一认 -moz-appearance 的引擎 —— 比解析 UA 串稳，
				   对面那个串以后还会变，这个属性不会。 */
				match: () => {
					try { return CSS.supports("-moz-appearance", "none"); } catch { return false; }
				},
				svgFilter: false,
				/* 补的模糊半径。给 0：常态 blur 0、阅读态 blur 4 本来就是设计好的
				   "静止清 / 扫上来霜"，既然折射缺席，就**不要再往背景上加糊** ——
				   用户要的正是"透过玻璃看见壁纸"。这个旋钮留着是为了以后哪台引擎
				   需要别补法时改一个数就行。 */
				blurOffset: 0,
			},
			{
				name: "chromium-webkit",
				match: () => true,
				svgFilter: true,
				blurOffset: 0,
			},
		];
		/** 第一行匹配上的就是这次要用的配方。 */
		const GLASS_ENGINE = GLASS_BACKDROP_ENGINES.find((row) => row.match())
			|| GLASS_BACKDROP_ENGINES[GLASS_BACKDROP_ENGINES.length - 1];
		/**
		 * 表面反射：光源在玻璃表面上的镜面像。
		 *
		 * 是**数组**不是对象：层数由它决定，CSS 只认一个 --wta-surf-image。
		 * 加一层、删一层、换光向都只动这个数组。
		 *
		 * 只用两层，而且都必须压在右上角 —— 光在右上、光斑在别处，读起来就是
		 * 「两个光源」（上一版那盏暖灯、以及原先铺在左下角的那层暖光都是这个错）。
		 * 面板又扁又宽（实测 877×98），所以：
		 *   main   光源的像，一个小而紧的核（只靠一层宽衰减会摊成抹痕）
		 *   streak 沿上沿的镜面线，做成**线性**渐变：右端亮、往左 40% 收干净，
		 *          比再叠一个径向光斑更像"上棱边在反光"。
		 */
		const SURFACE_LAYERS = [
			"radial-gradient(11% 104% at 100% -28%, rgba(255,253,250,.46), rgba(255,253,250,0) 74%)",
			"linear-gradient(248deg, rgba(255,255,255,.22), rgba(255,255,255,0) 40%)",
		];
		/**
		 * 整片透镜的形状表 —— 这是"输入框底下的字会动"的来源。
		 *
		 * 为什么需要它：折射剖面只作用在离边 `bevel` 以内的一圈（见 buildGlassMap
		 * 的 `depth < B`）。平板中央的位移恒为 0，物理上没错，但用户看到的就是
		 * 「输入框正下方的字一点没动」。这一项给整个面加一个低频位移场。
		 *
		 * 每个形状都是 (u, v, r, row) => [位移 x, 位移 y]，单位就是 **px**；
		 * u/v 是以中心为原点、按半宽半高归一的坐标（边缘 = ±1），r = hypot(u, v)。
		 * 返回的向量**已经是位移方向**，取负号 = 朝玻璃内部采样 = 放大。
		 * 全局倍数在 GLASS_MATERIAL.lensAmp（阅读态按 GLASS_CALM.scale.lensAmp 折下去）。
		 *
		 *   none  关掉（rows 少一个 off 标记就白跑一遍两趟编码，所以留个开关）
		 *   dome  圆顶：中央恰好为 0、越靠边越大。注意它**解决不了**"中间的字不动"
		 *         —— 顶点处斜率就是 0，实测中间行和没有玻璃时逐像素相同。
		 *   wave  只随 x 变的正弦横波。实测能掰动中间，但方向是纯横向错切：
		 *         13px 的字被错开 2~3px，笔画直接撕开；而且它**不随 y 变**，
		 *         正文上下滚动时位移场一动不动，"动态"是假的不说，还更难读。
		 *   flow  随 v 起伏的纵向疏密带 + 一点横向漂移（默认就是这个）。
		 *         为什么纵向更好读：字被纵向压扁/拉长时笔画还是完整的，辨识度几乎不掉；
		 *         横向错切会把笔画搬出原来的列，才真的糊。
		 *         为什么它天生是"动态"的：位移场固定在屏幕坐标里，正文一滚，
		 *         同一行字就依次穿过密带和疏带 —— 压扁、拉开，再压扁。
		 *         ax/ay 是横向/纵向振幅 px，freqU/freqV 是各自走过几个半波。
		 */
		const GLASS_LENS = {
			none: { off: true, vec: () => [0, 0] },
			dome: {
				ax: 14, ay: 14, exp: 1.6,
				vec: (u, v, r, L) => {
					if (r < 1e-4) return [0, 0];
					const m = Math.pow(Math.min(1, r / Math.SQRT2), L.exp);
					return [-u / r * m * L.ax, -v / r * m * L.ay];
				},
			},
			wave: {
				ax: 14, freqU: 1.4,
				vec: (u, v, r, L) => [-Math.sin(u * Math.PI * L.freqU) * L.ax, 0],
			},
			flow: {
				ax: 9, ay: 6.5, freqU: 1.3, freqV: 2,
				vec: (u, v, r, L) => [
					-Math.sin(u * Math.PI * L.freqU) * L.ax,
					-Math.sin(v * Math.PI * L.freqV) * L.ay,
				],
			},
		};
		/**
		 * 边缘光的**数据表**：一行一层，顺序 = 由外到内。
		 *   alpha  不透明度（再乘 GLASS_MATERIAL.edge —— 那个值是"整体强度"旋钮，
		 *          所以下面这些数字都是相对比例，改 edge 一处就能整体加减）
		 *   blur   阴影模糊半径 px
		 *   spread 扩张 px
		 *   dir    true = 跟着光源走（朝光那侧亮）；false = 四周一样
		 *   dark   true = 黑色阴影（做压暗），false = 白色（做回光）
		 *
		 * 只有 `dir: false` 的**轮廓线**允许"四周一样"，而且必须很淡 ——
		 * 原先那条整圈 0.5px、α .23 的白线就是"到处都有灯"的来源之一，
		 * 在扁面板上尤其明显（上下两条长边同时亮）。
		 */
		const GLASS_EDGE_SHADOWS = [
			{ alpha: 0.32, blur: 0, spread: 0.5, dir: false },          // 轮廓线：只求"看得出边界"
			{ alpha: 0.94, blur: 0, spread: 0.5, dir: true },           // 朝光那侧的镜面线
			{ alpha: 0.20, blur: 8, spread: 0, dir: true },             // 朝光那侧的柔辉
			{ alpha: 0.09, blur: 10, spread: 2, dir: false },           // 极淡整体起边（压锯齿）
			{ alpha: 0.16, blur: 0, spread: 1.5, dir: false, dark: true }, // 内侧暗线，给厚度一个收口
		];
		/** 元素拿不到 border-radius 时的兜底圆心半径；正常走 computed style，不写死。 */
		const GLASS_RADIUS_FALLBACK = 22;
		const N_GLASS = 1.5;                    // 普通玻璃折射率
		const GLASS_ABSORB = 0.50 / 0.46;       // 菲涅尔透射损耗，占 shade 的比例
		const GLASS_GLOW = 0.40 / 1.76;         // 宽菲涅尔辉光，占 rim 的比例
		const GLASS_SHARP = 44;                 // 细镜面线的锐度指数
		const GLASS_LIP = 0.3;                  // lip 剖面中段下凹的深度
		const GLASS_MAP_PX = 320000;            // 地图降采样上限（约 565×565）
		const GLASS_STEP = 0.25;                // 位移表采样步长 px
		/**
		 * 玻璃本体要覆盖的槽位：**一行 = 一个选择器 + 它用的材质变体**。
		 * 加一处玻璃元素 = 加一行；变体表见 GLASS_SLOT_VARIANTS（空字符串 = 基准材质）。
		 *
		 * 为什么材质要按槽位分：玻璃的旋钮是「一个元素一类观感」的，而用户的约束是
		 * 「改动只作用于该输入框」—— 输入卡片要调，不该顺手把任务面板一起改掉。
		 *
		 * `layer: true` = 该槽位的模糊**不写在目标元素上**，而是外置到卡片外面的
		 * 兄弟层（理由见 LAYER_ATTR 的注释；目标成了 fixed 后代的祖先时就必须外置）。
		 * 没有这个标记的槽位走原路径，上面那条「只改该输入框」的约束因此仍然成立。
		 */
		const GLASS_TARGETS = [
			{ sel: '[data-slot="conversation.composer.bar"] [class*="_card"]', variant: "composer", layer: true },
			{ sel: '[data-slot="conversation.input.dock"] [class*="_root"]', variant: "" },
		];
		/**
		 * 槽位材质变体表：**一行 = 一个槽位的覆盖**，形状与 GLASS_CALM 完全一致
		 * （scale 是乘、set 是换），所以两种派生共用 deriveGlassMaterial 一处机制。
		 *
		 * composer：2026-09-25 用户确认「输入框玻璃底部曲率过大」。两个旋钮分工不同，
		 * 一次只动一个、每动一次都量：
		 *   slope    位移随深度的增长率（= 边缘局部放大倍数 − 1 的封顶）：1.5 → 0.9（×0.6）
		 *   dispGain 位移场整体倍数（边缘带 + 整片透镜一起乘）：1 → 0.5（×0.5）
		 * 第一版只动 slope 之后用户说「还是太大」—— 那说明要降的是弯的**总量**，于是再加上
		 * dispGain。弧的几何（bevel / shape / edgeW / rim / shade / light）与画弧用的 5 层
		 * inset 一字不动：下缘弧度必须仍然肉眼可辨 —— **不许拿曲率换可读性**。
		 *
		 * 实测记录（为什么不是 thickness）：先按 thickness（70 → 42）做过一版，峰值位移只从
		 * 18.42px 掉到 16.76px（−9%）—— 剖面在被 slope 夹住的那一段不随厚度变，所以那一版
		 * 撤销、厚度回基准。改一个变量就量一次，正是为了挡住这种"看起来该有效"的旋钮。
		 */
		const GLASS_SLOT_VARIANTS = {
			composer: { scale: { slope: 0.6, dispGain: 0.5 } },
		};
		const SURF_ATTR = "data-wta-surf";
		const OVER_ATTR = "data-wta-over";
		/**
		 * 承载 `backdrop-filter` 的**卡片外面的**兄弟层。
		 *
		 * 为什么模糊必须离开卡片（2026-09-27 用户报的「悬停右下角按钮时画面反复切换」）：
		 * 带 `backdrop-filter ≠ none` 的元素会成为**固定定位后代的包含块**（CSS 规范）。
		 * 而 DSH 的 Tooltip 气泡（`.bubble`）正是 `position:fixed`、却渲染在卡片**内部**
		 * 的 `.uV2eYG_trailing` 里 —— 它的视口 left/top 被按卡片坐标系解释，于是落到
		 * 视口外（实测：`add` 的气泡 y=831，视口内高只有 802）。气泡同时撑出可滚动
		 * 溢出，卡片因此位移 2px；指针停在按钮边缘时就被这次位移甩出去：
		 * mouseleave → 气泡撤销 → 布局回弹 → 指针又落回按钮 → 500ms 后气泡再出现。
		 * 实测翻转 17 次 / 4.8s，周期 ≈267ms，与 `Tooltip` 的 `delayMs:500` 同源。
		 *
		 * 修法：模糊交给**没有后代**的兄弟层，卡片自己只留 `isolation:isolate`
		 * （它不是包含块、也不截断 backdrop 采样，所以观感逐像素不变：实测差异 0.01%）。
		 * 每张玻璃卡片一份，所以不进 NODE_OWNERS（那张表登记的是单例注入节点，见先例
		 * SURF_ATTR / OVER_ATTR）；位置由 ensureLayer 按卡片实际 rect 写。
		 */
		const LAYER_ATTR = "data-wta-glass-layer";
		/**
		 * 尺寸桶键：玻璃的地图与滤镜按元素**实际尺寸**建，所以"这个元素属于哪一桶"
		 * 必须是一条规则。建桶（bucketFor）与"要不要重套"（dress 的签名）两处都用它 ——
		 * 两处各写一遍取整规则的话，某天只改一处，元素就会每帧重建一次滤镜（卡顿，
		 * 而且 defs 里堆出几十条同尺寸滤镜）。
		 */
		const sizeKey = (w, h) => Math.round(w) + "x" + Math.round(h);

		const SVG_NS = "http://www.w3.org/2000/svg";
		const svgEl = (name, attrs) => {
			const node = document.createElementNS(SVG_NS, name);
			for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
			return node;
		};
		/** 只取某一个通道的 feColorMatrix（色散要把 R/G/B 三次位移分别摘出来再相加）。 */
		const CHANNEL_ONLY = {
			R: "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0",
			G: "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0",
			B: "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0",
		};

		/** 圆角矩形有向距离场（负 = 在内部）。 */
		function glassSDF(W, H, R) {
			return (x, y) => {
				const dx = x - W / 2, dy = y - H / 2;
				const qx = Math.abs(dx) - (W / 2 - R), qy = Math.abs(dy) - (H / 2 - R);
				return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - R;
			};
		}
		/** 斜面高度剖面：t=0 在外缘（最低），t=1 在与平板相接的内缘。 */
		const glassHeightCircle = (t) => Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));
		const glassHeightSquircle = (t) => Math.pow(Math.max(0, 1 - Math.pow(1 - t, 4)), 0.25);
		function glassHeightFn(shape) {
			if (shape !== "lip") return shape === "squircle" ? glassHeightSquircle : glassHeightCircle;
			/* 凸边：中段向外凸出去，斜率在两端都归零，接缝才不会出现折痕 */
			return (t) => glassHeightCircle(t) + GLASS_LIP * Math.pow(Math.sin(Math.PI * t), 2) * Math.cos(Math.PI * t);
		}
		/** 菲涅尔反射率（非偏振平均）：掠射 →1，正入射 →0.04。 */
		function glassFresnel(angle) {
			const a = Math.abs(angle);
			const st = Math.sin(a) / N_GLASS;
			if (st >= 1) return 1;
			if (a < 1e-4) return 0.04;
			const b = Math.asin(st);
			const rs = Math.sin(a - b) / Math.sin(a + b), rp = Math.tan(a - b) / Math.tan(a + b);
			return Math.min(1, (rs * rs + rp * rp) / 2);
		}
		/** Snell：垂直视线在斜面折射后穿过剩余厚度，横移 offset = 剩余厚度 × tan(α−β)。 */
		function glassProfile(d, B, T0, H) {
			const x = Math.min(1, Math.max(0, d / B)), e = 1e-3;
			const x1 = Math.min(1, x + e), x0 = Math.max(0, x - e);
			const alpha = Math.atan((H(x1) - H(x0)) / (x1 - x0));
			const beta = Math.sign(alpha) * Math.asin(Math.min(1, Math.sin(Math.abs(alpha)) / N_GLASS));
			return { disp: (T0 + B * glassHeightCircle(x)) * Math.tan(alpha - beta), alpha };
		}
		/** 光源方向单位向量：0° 正上，正角度顺时针。 */
		const glassLightOf = (deg) => {
			const a = deg * Math.PI / 180;
			return [Math.sin(a), -Math.cos(a)];
		};

		/**
		 * 造位移图。返回 dataURL + 归一化用的最大位移。
		 *
		 * 编码（feDisplacementMap 的约定）：
		 *   R/G = 0.5 + 位移 ÷ maxd × 0.5   —— 0.5 表示不位移；方向是**向内**，
		 *                                     所以边缘起放大作用（这是厚玻璃的成像规律）
		 *   B   = 0.5 + 有符号边缘剖面 × 0.5 —— 128 以上补光，128 以下相乘压暗
		 * 边缘剖面四项的来历（缺一项都会变成"描边"而不是"玻璃"）：
		 *   caustic  屏幕点 d 处采样 d + m(d)，ds/dd = 1 + m′ < 1 ⇒ 背景被放大、能量摊薄
		 *   loss     菲涅尔反射掉的那部分不透射，所以边缘要暗
		 *   glow+line 宽辉光 + 细镜面线，两项合成回光
		 * 四项统一乘 exp(−2.5·d/edgeW) 窗口 —— 故意用**绝对像素**：一条白线和它下面
		 * 那条暗发丝线在任何尺寸下都只有一两个像素，跟着 bevel 缩放会变成一条灰带。
		 */
		function buildGlassMap(W, H, radius, o) {
			const B = Math.max(1, Math.min(o.bevel, Math.floor(Math.min(W, H) / 2) - 1));
			const Hf = glassHeightFn(o.shape);
			const N = Math.ceil(B / GLASS_STEP);
			const tab = new Float64Array(N + 1);
			tab[N] = 0;
			/* 从内缘往外建表，并夹住斜率：slope > 1 时同一块背景会出现两次，就是"液态漩涡" */
			for (let i = N - 1; i >= 0; i--) {
				tab[i] = Math.min(glassProfile(i * GLASS_STEP, B, o.thickness, Hf).disp, tab[i + 1] + o.slope * GLASS_STEP);
			}
			let maxd = 1e-6;
			for (let i = 0; i <= N; i++) maxd = Math.max(maxd, Math.abs(tab[i]));
			const lerpTab = (t, d) => {
				const f = Math.min(N - 1e-6, Math.max(0, d) / GLASS_STEP);
				const i = Math.floor(f), u = f - i;
				return t[i] * (1 - u) + t[i + 1] * u;
			};

			const edge = new Float64Array(N + 1);
			for (let i = 0; i <= N; i++) {
				const d = i * GLASS_STEP;
				const p = glassProfile(d, B, o.thickness, Hf);
				const gain = Math.max(0.02, 1 + (tab[Math.min(N, i + 1)] - tab[i]) / GLASS_STEP);
				/* 滤镜链在 sRGB 里插值，线性光下的比值要重新编码，否则 0.15 的增益会渲染成近黑轮廓 */
				const gainS = Math.pow(gain, 1 / 2.2);
				const win = Math.exp(-2.5 * d / o.edgeW);
				const facing = Math.max(0, Math.sin(p.alpha));   // 只有朝外的斜面才吃光
				edge[i] = ((glassFresnel(p.alpha) * o.rim * GLASS_GLOW + Math.pow(facing, GLASS_SHARP) * o.rim)
					- ((1 - gainS) * o.shade + glassFresnel(p.alpha) * o.shade * GLASS_ABSORB)) * win;
			}

			const sdf = glassSDF(W, H, radius);
			/* 方向场用更大的圆角：转角处法线才不会跳变（原库 rule 3） */
			const cap = Math.min(W, H) / 2 - 0.5;
			const sdfDir = glassSDF(W, H, Math.min(radius + B, cap));
			const k = Math.min(1, Math.sqrt(GLASS_MAP_PX / (W * H)));
			const MW = Math.max(2, Math.round(W * k)), MH = Math.max(2, Math.round(H * k));
			const canvas = document.createElement("canvas");
			canvas.width = MW; canvas.height = MH;
			const ctx = canvas.getContext("2d");
			const img = ctx.createImageData(MW, MH);
			const data = img.data;
			const e = 0.5, L = glassLightOf(o.light);
			/* 整片透镜：形状来自 GLASS_LENS 表，幅度 = lensAmp × 该形状的 amp。
			   它和边缘项不一样 —— 方向是"由中心指向外"，和 SDF 法线不同向，所以
			   位移必须按**向量**累加、最后统一归一化；否则两条通道各按自己的最大值
			   撑满，合起来就有一路会削顶。因此透镜开着时走"先累向量、再求最大值、
			   最后写 R/G"两趟，关着时保持原来的一趟（省一半内存和时间）。 */
			const lens = GLASS_LENS[o.lens] || GLASS_LENS.none;
			const lensAmp = o.lensAmp || 0;
			const vec = lensAmp > 0 && !lens.off ? new Float32Array(MW * MH * 2) : null;
			let maxv = 1e-6;

			for (let y = 0; y < MH; y++) {
				const py = (y + 0.5) / k;
				for (let x = 0; x < MW; x++) {
					const px = (x + 0.5) / k;
					const depth = -sdf(px, py);
					let m = 0, ee = 0, gx = 0, gy = 0;
					if (depth < B) {
						const dd = Math.max(0, depth);
						m = lerpTab(tab, dd);
						ee = lerpTab(edge, dd);
						gx = (sdfDir(px + e, py) - sdfDir(px - e, py)) / (2 * e);
						gy = (sdfDir(px, py + e) - sdfDir(px, py - e)) / (2 * e);
						const gl = Math.hypot(gx, gy) || 1;
						gx /= gl; gy /= gl;
					}
					/* 位移向量两项都指向玻璃内部（采样更靠里的背景 = 放大，厚玻璃的成像规律）：
					   边缘项沿内法线，透镜项沿径向。 */
					const dx = -gx * m, dy = -gy * m;
					let vx = dx, vy = dy;
					if (vec) {
						const u = (px / W - 0.5) * 2, v = (py / H - 0.5) * 2;
						const r = Math.hypot(u, v);
						const w = lens.vec(u, v, r, lens);
						vx += w[0] * lensAmp; vy += w[1] * lensAmp;
						const vi = (y * MW + x) * 2;
						vec[vi] = vx; vec[vi + 1] = vy;
						const len = Math.hypot(vx, vy);
						if (len > maxv) maxv = len;
					}
					/* 只有受光那半边被光向调制：压暗是几何拿走的，四周一样 */
					let lit = ee;
					if (ee > 0) {
						const f = gx * L[0] + gy * L[1];
						lit = ee * (Math.max(0, f) * 0.78 + Math.max(0, -f) * 0.30);
					}
					const i = (y * MW + x) * 4;
					if (!vec) {
						data[i] = Math.round(128 + vx / maxd * 127);
						data[i + 1] = Math.round(128 + vy / maxd * 127);
					}
					data[i + 2] = Math.round(Math.max(0, Math.min(255, 128 + lit * 127)));
					data[i + 3] = 255;
				}
			}
			if (vec) {
				const sc = 127 / maxv;
				for (let p = 0, n = MW * MH; p < n; p++) {
					const i = p * 4, vi = p * 2;
					data[i] = Math.round(Math.max(0, Math.min(255, 128 + vec[vi] * sc)));
					data[i + 1] = Math.round(Math.max(0, Math.min(255, 128 + vec[vi + 1] * sc)));
				}
			}
			ctx.putImageData(img, 0, 0);
			return { url: canvas.toDataURL("image/png"), maxd: vec ? maxv : maxd, bevel: B };
		}

		/**
		 * 把地图接成滤镜链。
		 * 顺序：地图 → 模糊 → 位移（有 dispersion 时 R/G/B 各一次再相加）→
		 *       用 B 通道相乘压暗 → 用 B 通道相加补光。
		 * 压暗必须用 feBlend multiply 而不是 feComposite arithmetic：arithmetic 会
		 * 连 alpha 一起乘，把背景的 alpha 压下去等于在背景上打了个洞。
		 */
		function buildGlassFilter(id, map, o) {
			const f = svgEl("filter", {
				id,
				filterUnits: "objectBoundingBox",
				primitiveUnits: "userSpaceOnUse",
				x: 0, y: 0, width: 1, height: 1,
				"color-interpolation-filters": "sRGB",
			});
			const image = svgEl("feImage", { preserveAspectRatio: "none", result: "map" });
			image.setAttribute("href", map.url);
			f.append(image);
			/* 位移场整体倍数：0 会被当成 1 —— "完全不动"这条路只能显式调小，不能填 0 蒙混过去 */
			const S = 2 * map.maxd * (o.dispGain || 1);
			f.append(svgEl("feGaussianBlur", { in: "SourceGraphic", stdDeviation: o.blur, result: "soft" }));
			if (o.dispersion > 0) {
				/* 色散是固定的像素数，不是位移的比例：玻璃对不同波长的折射率差是材料常数 */
				const d2 = 2 * o.dispersion;
				const scales = { R: S - d2, G: S, B: S + d2 };
				for (const ch of ["R", "G", "B"]) {
					f.append(svgEl("feDisplacementMap", {
						in: "soft", in2: "map", scale: scales[ch].toFixed(2),
						xChannelSelector: "R", yChannelSelector: "G", result: "d" + ch,
					}));
					f.append(svgEl("feColorMatrix", { in: "d" + ch, type: "matrix", values: CHANNEL_ONLY[ch], result: "c" + ch }));
				}
				f.append(svgEl("feComposite", { in: "cR", in2: "cG", operator: "arithmetic", k1: 0, k2: 1, k3: 1, k4: 0, result: "cRG" }));
				f.append(svgEl("feComposite", { in: "cRG", in2: "cB", operator: "arithmetic", k1: 0, k2: 1, k3: 1, k4: 0, result: "glass" }));
			} else {
				f.append(svgEl("feDisplacementMap", {
					in: "soft", in2: "map", scale: S.toFixed(2),
					xChannelSelector: "R", yChannelSelector: "G", result: "glass",
				}));
			}
			/* 边缘剖面在 B 通道里，以 128 为中值：取出来当作图层用 */
			f.append(svgEl("feColorMatrix", {
				in: "map", type: "matrix",
				values: "0 0 1 0 0  0 0 1 0 0  0 0 1 0 0  0 0 0 0 1", result: "edgeRGB",
			}));
			const shade = svgEl("feComponentTransfer", { in: "edgeRGB", result: "shadeLayer" });
			for (const ch of ["R", "G", "B"]) shade.append(svgEl("feFunc" + ch, { type: "table", tableValues: "0 1 1" }));
			f.append(shade);
			f.append(svgEl("feBlend", { in: "glass", in2: "shadeLayer", mode: "multiply", result: "shaded" }));
			/* 中值以上的那半是玻璃送回的光，所以相加 */
			f.append(svgEl("feColorMatrix", {
				in: "map", type: "matrix",
				values: "0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 1 0 0", result: "litA",
			}));
			const litHalf = svgEl("feComponentTransfer", { in: "litA", result: "litHalf" });
			litHalf.append(svgEl("feFuncA", { type: "table", tableValues: "0 0 1" }));
			f.append(litHalf);
			f.append(svgEl("feComposite", { in: "litHalf", in2: "shaded", operator: "over" }));
			return f;
		}

		/**
		 * 锐利的边缘线和它下面那条暗发丝线走 CSS 内阴影，不走滤镜。
		 * 原因：feImage 对大图会降采样，Chromium 采样弯曲后的画面又是最近邻，
		 * 半像素的线两边都活不下来。内阴影画在元素自身上，天然跟着 border-radius，
		 * 而且在拿不到折射的浏览器上也照常显示。
		 * 内阴影的方向跟着 light 走 —— 这就是"朝向光的那侧更亮"。
		 * 层表见 GLASS_EDGE_SHADOWS：加一层改一行，不再在这里堆魔法数字。
		 */
		function glassEdgeShadow(o) {
			if (!(o.edge > 0)) return "none";
			const rad = o.light * Math.PI / 180;
			const dx = Math.sin(rad).toFixed(2), dy = (-Math.cos(rad)).toFixed(2);
			return GLASS_EDGE_SHADOWS.map((row) => {
				const a = Math.max(0, Math.min(1, row.alpha * o.edge));
				const rgb = row.dark ? "0,0,0" : "255,255,255";
				/* dir 的层把阴影整体朝光源方向挪开一点：挪开之后，只有朝光那侧的内侧
				   还能看见它，背光侧被推出元素外 —— 这就是"单侧高光"，不用两条规则。 */
				const off = row.dir ? dx + "px " + dy + "px " : "0 0 ";
				return "inset " + off + row.blur + "px " + row.spread + "px rgba(" + rgb + "," + a.toFixed(3) + ")";
			}).join(",");
		}

		/**
		 * 材质派生：**唯一一处**「由一个材质算出另一个」的实现。
		 * spec 的形状与 GLASS_CALM / GLASS_SLOT_VARIANTS 一致：
		 *   scale 是乘（系数 —— 基准以后调了，派生出来的自动跟随）
		 *   set   是换（绝对值）
		 */
		function deriveGlassMaterial(base, spec) {
			const out = Object.assign({}, base);
			for (const [key, factor] of Object.entries(spec.scale || {})) out[key] = base[key] * factor;
			return Object.assign(out, spec.set || {});
		}
		/** 把常态参数按系数折成阅读态参数（一处调、两处生效）。 */
		function calmGlassMaterial(base) {
			return deriveGlassMaterial(base, GLASS_CALM);
		}

		/**
		 * 我们自己注入的节点：**一类节点一行**，一行同时管三件事 ——
		 *   1. `attr`  语义标记（CSS / 探针 / 守卫都按它选节点）；
		 *   2. `label` 布局守卫报问题时的中文名；
		 *   3. `pin`   不可协商的定位与尺寸，写成**内联样式**；为 null = 这个节点
		 *              本来就该参与排版（比如工具行里的那颗胶囊），守卫不碰它。
		 * 加一个新注入节点 = 表里加一行，别在调用点再手写一遍选择器或标签名。
		 *
		 * 为什么定位必须内联：`width="0" height="0"` 这类**表现属性**在 CSS 里是最低的
		 * 一档，任何一条样式规则都能盖掉它 —— 包括我们自己上一代热更留在 <head> 里、
		 * 没被 dispose 撤干净的旧样式表。一旦被盖出尺寸，它就变成文档末尾一块
		 * **看不见**的空白：页面能一直往下滚，用户看到的正是
		 * 「壁纸跑到了页面下面，要滚轮往下滑才看得见」。
		 * 已在真 Firefox 里复现：给玻璃 svg 255px 高，文档就多出 255px、页面随即可滚。
		 */
		const NODE_OWNERS = {
			/* 玻璃滤镜定义：整张 svg 里只有 <defs>，本身不需要可见区域。
			   用 fixed 而不是 absolute —— 已实测：fixed 的元素不产生可滚动溢出。 */
			glassSvg: {
				attr: "data-wta-glass-svg",
				label: "玻璃滤镜 svg",
				pin: {
					position: "fixed", top: "0px", left: "0px", width: "0px", height: "0px",
					overflow: "hidden", pointerEvents: "none",
				},
			},
			/* 档位/权限下拉：left/top 由 place() 按需写，这里只保证脱离文档流。 */
			optimizerPop: {
				attr: "data-dsh-warm-optimizer-pop",
				label: "档位/权限下拉",
				pin: { position: "fixed" },
			},
			/* 布局守卫的角标：只在真出问题时出现，它自己当然也不能参与排版。 */
			guardNote: {
				attr: "data-dsh-warm-guard-note",
				label: "布局守卫角标",
				pin: {
					position: "fixed", left: "8px", bottom: "8px",
					pointerEvents: "none", zIndex: "var(--wta-pop-z)",
				},
			},
			/* 工具行里的「优化」胶囊：它**就是**排版的一部分（插在 .dpo-controls 里），
			   所以没有 pin。登记它的理由只有一个：让"页面上的东西是不是我们的"
			   可以被脚本一眼确认。 */
			/* 动效层的根：display:contents 让它自己不产生盒子，但仍是"我们的节点"的
			   唯一入口（清扫、卸载、探针都按这个属性认）。 */
			motionLayer: {
				attr: "data-wta-motion-layer",
				label: "动效层",
				pin: null,
			},
			collapseChip: {
				attr: "data-dsh-warm-collapse",
				label: "工具行「优化」胶囊",
				pin: null,
			},
		};

		/** 归属标记：值 = `包名:节点名`。检查脚本按它确认注入节点都属于本包。 */
		const OWNER_ATTRIBUTE = "data-dsh-warm-owner";
		const ownerValue = (key) => "dsh-warm-ui:" + key;

		/** 贴归属与语义标记（属性名只在上面那张表里写一遍）。 */
		function tagOwner(el, key) {
			const spec = NODE_OWNERS[key];
			if (!el || !spec) return el;
			el.setAttribute(spec.attr, "");
			el.setAttribute(OWNER_ATTRIBUTE, ownerValue(key));
			return el;
		}

		/** 把表里那一行的定位写成内联样式（kebab 名由键名推导，不手抄属性名）。 */
		function pinOverlay(el, key) {
			const spec = NODE_OWNERS[key];
			if (!el || !spec || !spec.pin) return el;
			for (const [prop, value] of Object.entries(spec.pin)) {
				el.style.setProperty(cssPropertyName(prop), value);
			}
			return el;
		}

		/**
		 * 换代清扫：把同类节点**全部**撤掉，再挂新的。
		 *
		 * 为什么需要：热重载会先跑旧实例的清理、再跑新实例，正常情况下不留残迹；
		 * 但只要清理抛过一次、或顺序被打乱，页面上就会同时存在两代节点 ——
		 * 「守卫对着上一代的角标读问题」「两套节点抢同一批规则」都是这么来的。
		 * 所以挂载前一律先清扫，保证同类节点永远只有一个。
		 * @returns {number} 被撤掉的旧节点数
		 */
		function sweepOwned(key) {
			const spec = NODE_OWNERS[key];
			if (!spec || typeof document === "undefined") return 0;
			let removed = 0;
			for (const el of document.querySelectorAll("[" + spec.attr + "]")) {
				el.remove();
				removed += 1;
			}
			return removed;
		}

		/**
		 * 挂到 head/body 上的**唯一入口**：贴标 → 钉死 → 清扫上一代 → append。
		 * 页面外层的节点都必须经这里（`tools/check.mjs` 会静态扫描裸 append 调用）。
		 */
		function mountDetached(parent, el, key) {
			tagOwner(el, key);
			pinOverlay(el, key);
			sweepOwned(key);
			parent.append(el);
			return el;
		}

		/** 切入/切出：内联 display 与 [hidden] 双保险（残留样式表盖得掉 [hidden]，盖不掉内联）。 */
		function setOverlayHidden(el, hidden) {
			el.hidden = hidden;
			el.style.setProperty("display", hidden ? "none" : "");
		}

		/**
		 * 玻璃层出错只报**一次**。
		 *
		 * sync 是指针热路径：一次故障会在每一次 pointermove 上重复触发。逐次上报既会把
		 * console 淹掉，也让人以为页面坏了；而自我卸载之后热路径就断了 —— 所以一条错配
		 * 一条"已卸载"，页面回到"没有玻璃但能用"的状态。契约条目见
		 * contract/ui-contract.json 的 lifecycle.failSafe。
		 */
		function reportGlassFailure(error) {
			console.error("[dsh-warm-ui] 玻璃层出错，已自我卸载（输入框回到无玻璃状态）", error);
		}

		/**
		 * 挂载液态玻璃。
		 *
		 * 位移图按元素**实际尺寸**生成 —— 所以必须监听尺寸变化并在变化时重建；
		 * 但状态切换、DOM 重建都只是"重新套用已有滤镜"，绝不能每次按键重算 canvas。
		 * 缓存按 `宽x高` 分桶，桶里放常态与阅读态两个滤镜 id。
		 *
		 * 悬停判定不用 :hover 而是自己维护 [data-wta-over]：
		 * DSH 的输入卡片在按键时会重建 DOM 节点，节点一换 :hover 当场失效，要等
		 * 下一次鼠标移动才恢复 —— 那正是用户报的「一打字就变透明，鼠标动一下才恢复」。
		 * 这里记住指针坐标，节点重建后按最后一次坐标重新判定，等于有了一个扛得住重建的 :hover。
		 *
		 * 判定用 elementFromPoint 而不是自己比矩形：指针底下那个节点**被 React 删掉**
		 * 时，浏览器会发一个 relatedTarget = null 的 pointerout —— 按矩形判定的话
		 * 只能靠"指针离开窗口"来解释它，于是状态就丢了，直到下次鼠标移动才回来。
		 * 这就是用户报的「有时候一打字透明度就回到鼠标不在上面的样子」（"有时候"取决于
		 * 旧节点被删的那一帧新节点有没有同时就位）。hit test 不看事件、只看现在指针下是什么，
		 * 所以节点换掉也照样判定正确。
		 *
		 * @returns {{ sync: Function, remove: Function }}
		 */
		function mountGlass() {
			/* 上新的一代：从这一刻起，上一代（含热重载换掉模块留下的老实例）一律停手。 */
			const generation = beginGeneration("glass");
			/** 已经卸载（正常卸载或出错自我卸载）—— 幂等卸载靠它。 */
			let dead = false;
			const NS = "http://www.w3.org/2000/svg";
			const svg = document.createElementNS(NS, "svg");
			svg.setAttribute("width", "0");
			svg.setAttribute("height", "0");
			svg.setAttribute("aria-hidden", "true");
			const defs = document.createElementNS(NS, "defs");
			svg.append(defs);
			/* 尺寸与定位走内联（见 NODE_OWNERS.glassSvg）：表现属性会被任何样式规则
			   盖掉，一旦被盖出高度，它就成了文档末尾一块看不见的空白 —— 页面能滚下去，
			   壁纸就"跑到页面下面"了。挂载走 mountDetached：贴标 + 钉死 + 清扫上一代。 */
			mountDetached(document.body, svg, "glassSvg");

			/* 材质按**槽位变体**预先派生：变体名 → { full, calm }。dress 只查表、不再算材质 ——
			   「常态 / 阅读态」与「哪个槽位」两件事各管各的，互不干扰。 */
			const materials = new Map();
			const materialOf = (variant) => {
				const key = variant || "";
				const hit = materials.get(key);
				if (hit) return hit;
				const spec = GLASS_SLOT_VARIANTS[key];
				const full = spec ? deriveGlassMaterial(GLASS_MATERIAL, spec) : GLASS_MATERIAL;
				const made = { full, calm: calmGlassMaterial(full) };
				materials.set(key, made);
				return made;
			};
			/** 尺寸桶 → { full, calm } 两个滤镜 id */
			const buckets = new Map();
			/** 元素 → 上次套用的签名，用于跳过没必要的重写 */
			const applied = new WeakMap();
			let seq = 0;

			const targets = () => {
				const found = [];
				for (const slot of GLASS_TARGETS) {
					for (const el of document.querySelectorAll(slot.sel)) {
						found.push({ el, variant: slot.variant, layer: slot.layer === true });
					}
				}
				return found;
			};

			/** 拿到（或建好）这个尺寸 + 变体对应的两个滤镜 id。 */
			const bucketFor = (w, h, radius, variant) => {
				/* 这个引擎吃不下 url()：一条滤镜都不用建，返回值就是"没有滤镜 id"。
				   buildGlassMap 是这里最贵的一步，省掉它是顺手的好处。 */
				if (!GLASS_ENGINE.svgFilter) return { full: null, calm: null };
				/* 桶键 = 尺寸 + 变体：与 dress 的签名同源（两处各写一遍，某天只改一处
				   就会变成"两个槽位共用一份滤镜"，见 sizeKey 的说明） */
				const key = sizeKey(w, h) + "@" + variant;
				const hit = buckets.get(key);
				if (hit) return hit;
				const m = materialOf(variant);
				const fullId = "wta-glass-" + (seq++) + "-full";
				const calmId = "wta-glass-" + (seq++) + "-calm";
				defs.append(buildGlassFilter(fullId, buildGlassMap(w, h, radius, m.full), m.full));
				defs.append(buildGlassFilter(calmId, buildGlassMap(w, h, radius, m.calm), m.calm));
				const made = { full: fullId, calm: calmId };
				buckets.set(key, made);
				return made;
			};

			/** 表面反射图层必须是玻璃的直接子节点（CSS 用 `>` 选它），且只插一次。 */
			const ensureSurf = (el) => {
				if (el.querySelector(":scope > [" + SURF_ATTR + "]")) return;
				const surf = document.createElement("div");
				surf.setAttribute(SURF_ATTR, "");
				surf.setAttribute("aria-hidden", "true");
				/* 数组 join 成一条 background-image：层数是数据，CSS 不需要知道 */
				surf.style.setProperty("--wta-surf-image", SURFACE_LAYERS.join(", "));
				el.insertBefore(surf, el.firstChild);
			};

			/* 卡片 → 承载模糊的层；层 → 卡片（清扫孤儿层用）；卡片 → 我们**写过模糊**
			   的那个层（用来发现层被换掉）；定位宿主 → 我们改之前它的内联 position。 */
			const layers = new WeakMap();
			const liveLayers = new Map();
			const dressedLayer = new WeakMap();
			const layerHosts = new Map();
			const layerPlaced = new WeakMap();

			/**
			 * 拿到（或建好）卡片的模糊层。层必须**在卡片外面**：它一旦是卡片的
			 * 后代，卡片自己的 backdrop-filter 就又成了 fixed 后代的包含块（见
			 * LAYER_ATTR）。所以插在卡片**前面**：同为定位元素时 DOM 在后者画在
			 * 上层，卡片因此盖住层，层的模糊透过卡片半透明底色显出来。
			 */
			const ensureLayer = (el) => {
				const host = el.parentElement;
				if (!host) return null;
				const kept = layers.get(el);
				if (kept && kept.isConnected && kept.parentElement === host) return kept;
				if (kept) liveLayers.delete(kept);
				/* 绝对定位需要定位祖先。宿主若是 static 就补 relative —— 实测该宿主
				   子树里的 absolute 后代**全在卡片内部**（卡片自己是 relative），
				   所以这一步不改变任何已存在元素的包含块。改动登记下来以便还原。 */
				if (!layerHosts.has(host) && host.isConnected) {
					const before = host.style.getPropertyValue("position");
					layerHosts.set(host, before);
					if (getComputedStyle(host).position === "static") {
						host.style.setProperty("position", "relative");
					}
				}
				const layer = document.createElement("div");
				layer.setAttribute(LAYER_ATTR, "");
				layer.setAttribute("aria-hidden", "true");
				layer.style.setProperty("position", "absolute");
				layer.style.setProperty("pointer-events", "none");
				layer.style.setProperty("z-index", "0");
				host.insertBefore(layer, el);
				layers.set(el, layer);
				liveLayers.set(layer, el);
				return layer;
			};

			/**
			 * 清扫孤儿层：卡片被 React 整个换掉时，卡片和它的层会一起离开 DOM，
			 * 但**层是卡片的兄弟**，所以留下的那个不会自己消失（留在页面上的
			 * 空层会挡住卡片、也会让"每卡片恰好一层"的断言数错）。
			 * 顺带扫掉不属于当前这一代的同类节点（热重载残迹）。
			 */
			const sweepLayers = () => {
				for (const [layer, card] of [...liveLayers]) {
					if (layer.isConnected && card.isConnected) continue;
					layer.remove();
					liveLayers.delete(layer);
				}
				const known = new Set(liveLayers.keys());
				for (const stray of document.querySelectorAll("[" + LAYER_ATTR + "]")) {
					if (!known.has(stray)) stray.remove();
				}
				/* 宿主也一并清理：这张表是强引用，被 React 换掉的宿主不该一直挂着。 */
				for (const host of [...layerHosts.keys()]) {
					if (!host.isConnected) layerHosts.delete(host);
				}
			};


			/**
			 * 把层对齐到卡片。位置**不受材质签名管辖**：卡片可以在尺寸不变的情况下
			 * 移动（切相位、滚动），所以这里自己比一次签名，变了才写。
			 */
			const placeLayer = (el, rect, radius) => {
				const layer = ensureLayer(el);
				if (!layer) return null;
				const hostRect = layer.parentElement.getBoundingClientRect();
				const left = rect.left - hostRect.left;
				const top = rect.top - hostRect.top;
				const sig = [Math.round(left), Math.round(top),
					Math.round(rect.width), Math.round(rect.height), radius].join("|");
				if (layerPlaced.get(layer) !== sig) {
					layerPlaced.set(layer, sig);
					layer.style.setProperty("left", left + "px");
					layer.style.setProperty("top", top + "px");
					layer.style.setProperty("width", rect.width + "px");
					layer.style.setProperty("height", rect.height + "px");
					layer.style.setProperty("border-radius", radius + "px");
				}
				return layer;
			};

			/* 指针位置 + 重入保护。hoverTick 会把"当前指针底下是谁"缓存到 hit 里，
			   一次 sync 里所有待判定元素共用同一次 hit test。 */
			let pointer = { x: -1e5, y: -1e5, inside: false };
			let hit = null;
			const pointerOver = (el) => hit != null && (hit === el || el.contains(hit));

			/** 给一个元素套样式；尺寸、槽位、状态都没变就直接返回。 */
			const dress = (el, variant, layering) => {
				const rect = el.getBoundingClientRect();
				if (rect.width < 8 || rect.height < 8) return;
				/* 圆角跟着 DSH 自己的 border-radius 走，不写死 */
				const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || GLASS_RADIUS_FALLBACK;
				const layer = layering ? placeLayer(el, rect, radius) : null;
				const over = pointerOver(el);
				/* 签名与 bucketFor 的桶键同源（尺寸 + 变体 + 状态） */
				const sig = sizeKey(rect.width, rect.height) + "@" + variant + (over ? ":over" : ":idle");
				/* 层被换过（React 重建、父节点换人）就必须重写：新层身上没有模糊。 */
				const layerSwapped = layer != null && dressedLayer.get(el) !== layer;
				if (applied.get(el) === sig && !layerSwapped) return;
				applied.set(el, sig);
				ensureSurf(el);
				const ids = bucketFor(rect.width, rect.height, radius, variant);
				const m = materialOf(variant);
				const o = over ? m.calm : m.full;
				const id = over ? ids.calm : ids.full;
				/* 配方由 GLASS_ENGINE 决定：
				   - 吃得下 url()（Chromium）：上面的模糊照旧，折射交给 SVG 滤镜，
				     而且**保留带 url() 的兜底语义** —— 滤镜万一没挂上，模糊仍在。
				   - 吃不下（Firefox）：id 是 null，只发函数那半条，同时把材质里
				     那个 0 模糊抬起来，否则这块玻璃什么也不做、纯一块色板。 */
				const plain = "blur(" + (o.blur + GLASS_ENGINE.blurOffset) + "px) saturate("
					+ o.sat + ") brightness(" + o.lift + ")";
				const value = id ? plain + " url(#" + id + ")" : plain;
				/* 模糊写到层上（layer 槽位）而不是卡片上 —— 卡片一旦带上
				   backdrop-filter 就会成为 fixed 后代的包含块，把 Tooltip 气泡挤到
				   视口外并撑出溢出，指针停在按钮边缘时会自激成"画面反复切换"。
				   卡片只留 isolation:isolate：它不是包含块、也不截断 backdrop 采样，
				   但保住了层叠上下文，[data-wta-surf] 的 z-index:-1 +
				   mix-blend-mode:screen 因此仍然成立。 */
				const blurHost = layer || el;
				blurHost.style.setProperty("backdrop-filter", value, "important");
				blurHost.style.setProperty("-webkit-backdrop-filter", value, "important");
				if (layer) {
					dressedLayer.set(el, layer);
					el.style.setProperty("backdrop-filter", "none", "important");
					el.style.setProperty("-webkit-backdrop-filter", "none", "important");
					el.style.setProperty("isolation", "isolate", "important");
				}
				el.style.setProperty("box-shadow", glassEdgeShadow(o), "important");
				/* 状态不只是"模糊/折射"变了，底色和表面反射强度也跟着变。
				   这两个值写成**内联变量**而不是靠选择器覆盖：
				   带 !important 的选择器互压时看的是优先级，而内联变量是最终值，
				   没有第二条规则能再压掉它 —— 「扫上来不变暗」那个 bug 就没了。 */
				el.style.setProperty("--wta-glass-tint-cur", o.tint);
				el.style.setProperty("--wta-surf-opacity", String(o.surf));
				if (over) el.setAttribute(OVER_ATTR, "1");
				else el.removeAttribute(OVER_ATTR);
			};

			/** 把所有玻璃元素重新套一遍（尺寸变了、DOM 重建了、开关切了都走这里）。 */
			const sync = () => {
				/* 被换代了就彻底停手。守卫必须在最前面：老实例的监听/rAF 还在，但它一旦
				   还去写这个输入框，就会出现"两代互相覆盖"的每帧闪烁。 */
				if (generation !== generationOf("glass")) return;
				if (!document.body.hasAttribute(ATTR + "glass")) return;
				/* 出错就自我卸载，而不是带着"半套玻璃"每帧抛一次 —— 用户看到的闪烁就是
				   失败的热路径被反复触发（见 reportGlassFailure）。 */
				try {
					/* 一次 sync 只做一次 hit test，所有待判定元素共用结果 */
					hit = pointer.inside ? document.elementFromPoint(pointer.x, pointer.y) : null;
					for (const slot of targets()) dress(slot.el, slot.variant, slot.layer);
					/* 卡片换代后留下的孤儿层在这里收掉（见 sweepLayers）。 */
					sweepLayers();
				} catch (error) {
					remove(error);
					reportGlassFailure(error);
				}
			};

			/* 指针移动 → 只重算悬停状态，不碰背景让位那套几何（那是滚动/尺寸才需要的） */
			let hoverFrame = 0;
			const hoverTick = () => {
				hoverFrame = 0;
				sync();
			};
			const scheduleHover = () => {
				if (hoverFrame || document.hidden) return;
				hoverFrame = window.requestAnimationFrame(hoverTick);
			};
			const onPointerMove = (event) => {
				pointer = { x: event.clientX, y: event.clientY, inside: true };
				scheduleHover();
			};
			/**
			 * 「指针离开文档」按**事件自带的坐标**判真假，不按事件名。
			 *
			 * 2026-09-25 用户在自己浏览器里抓到的现场：指针停在输入框上一动不动，
			 * 13ms 内来了 20+ 条 documentElement 的 pointerleave，紧随其后 `over` 翻成常态
			 * （底色 .62 → .30、blur 4px → 0），而**同一时刻** focus 仍为 true、按最后的指针
			 * 坐标做命中测试仍在卡片里、玻璃 alive —— 也就是没有任何"指针真的离开了"的证据，
			 * 只有一条事件自称离开了。信事件名，状态就交给最后到达的那一条事件；而打字不会
			 * 重算悬停判定（只有 pointermove 会），于是表现为「一打字就透明，鼠标动一下才恢复」。
			 *
			 * 两种离开实测长得不一样（口径见 contract glass.pointer.measured）：
			 *   真离开（手把鼠标移出窗口）：坐标落在视口**外** —— 跳跃式 y=1200、扫掠式 y=854，
			 *                               而视口内高只有 830；
			 *   假离开（指针没动 / 被另一个进程的窗口盖住，例如输入法候选窗）：坐标仍在视口内。
			 * 所以：坐标还在视口内 ⇒ 指针几何上没离开，坐标留着、按最后的位置重算；
			 * 坐标在视口外 ⇒ 真离开，照旧清坐标回常态（"鼠标移出后与改动前一致"）。
			 */
			const onPointerGone = (event) => {
				const root = document.documentElement;
				const stillInViewport = event.clientX >= 0 && event.clientY >= 0
					&& event.clientX <= root.clientWidth && event.clientY <= root.clientHeight;
				if (stillInViewport) {
					hit = null;
					scheduleHover();
					return;
				}
				pointer = { x: -1e5, y: -1e5, inside: false };
				hit = null;
				scheduleHover();
			};
			window.addEventListener("pointermove", onPointerMove, { passive: true });
			document.documentElement.addEventListener("pointerleave", onPointerGone);
			/**
			 * 窗口失焦**不等于**指针离开文档：鼠标的物理位置在失焦前后一点没动。
			 *
			 * 2026-09-25 用户报「鼠标停在输入框上打字，输入框由模糊态回退成透明态，
			 * 鼠标一动就恢复」。复现到根上就是这里：失焦走 onPointerGone（清坐标、
			 * inside = false），而**打字不会重算悬停判定**（只有 pointermove 会），于是
			 * 状态一直粘在"指针不在卡片上"那一档 —— 鼠标在不在输入框上完全看不出区别，
			 * 要等下一次鼠标移动才回来。失焦只该丢掉 hit 缓存并按最后的坐标重算：
			 * 坐标是几何事实，不随窗口焦点改变（"真离开"由上面的 pointerleave 管）。
			 *
			 * 这里直接 sync() 而不是 scheduleHover()：后者在 document.hidden 时直接返回，
			 * 而失焦这一拍正是必须重算的那一拍（重算幂等，dress 有签名守卫）。
			 */
			const onWindowBlur = () => {
				hit = null;
				sync();
			};
			window.addEventListener("blur", onWindowBlur);

			/**
			 * 可观测出口：探针（tools/probes/glass-zombie.js）与用户 console 都能直接问
			 * "玻璃现在活着吗、是第几代"。没有它，"玻璃悄悄死了"只能靠肉眼看出来。
			 */
			const publish = (error) => {
				const state = { alive: !dead, generation };
				if (error) state.error = String((error && error.message) || error);
				window.__dshWarmExtra = Object.assign(window.__dshWarmExtra || {}, { glass: state });
			};

			/**
			 * 卸载。幂等：正常卸载与"出错自我卸载"都走它，撤两遍不会出事。
			 * 只有仍是最新一代（或确实是出错退场）才去改可观测出口 —— 老世代悄悄退位
			 * 不该把新一代的状态覆盖成"已死"。
			 */
			const remove = (error) => {
				if (dead) return;
				dead = true;
				const wasNewest = generation === generationOf("glass");
				endGeneration("glass", generation);
				window.removeEventListener("pointermove", onPointerMove);
				document.documentElement.removeEventListener("pointerleave", onPointerGone);
				window.removeEventListener("blur", onWindowBlur);
				if (hoverFrame) window.cancelAnimationFrame(hoverFrame);
				for (const el of document.querySelectorAll("[" + SURF_ATTR + "]")) el.remove();
				for (const el of document.querySelectorAll("[" + OVER_ATTR + "]")) el.removeAttribute(OVER_ATTR);
				for (const el of document.querySelectorAll("[" + LAYER_ATTR + "]")) el.remove();
				for (const slot of targets()) {
					const el = slot.el;
					el.style.removeProperty("backdrop-filter");
					el.style.removeProperty("-webkit-backdrop-filter");
					el.style.removeProperty("box-shadow");
					el.style.removeProperty("--wta-glass-tint-cur");
					el.style.removeProperty("--wta-surf-opacity");
					/* 只清我们自己写上去的 isolation（见 dress 的 layer 分支）。 */
					if (slot.layer) el.style.removeProperty("isolation");
				}
				/* 宿主上那个 relative 是我们补的（见 ensureLayer），撤掉才算无痕。
				   宿主可能已随 React 重建消失，所以逐个确认还在。 */
				for (const [host, before] of [...layerHosts]) {
					if (!host.isConnected) continue;
					if (before) host.style.setProperty("position", before);
					else host.style.removeProperty("position");
				}
				layerHosts.clear();
				liveLayers.clear();
				svg.remove();
				buckets.clear();
				if (wasNewest || error) publish(error);
			};

			sync();
			publish();

			return { sync, remove };
		}

		/* 这里原来还有 mountVeils() / paintGuard() 两个函数：建三个铺满视口、
		   z-index 为负的柔光罩，并把「背景让位」那个的模糊区用 mask-image 对齐到
		   正文列。整组已删除，理由见 EXTRA_STYLESHEET 第 3 节的注释（全屏
		   backdrop-filter 压在每帧更新的壁纸画布上，是「背景要滚动才出来」的
		   唯一嫌疑源）。 */

		/**
		 * 自检：两张样式表（基础的 + 增强的）里有没有「用了、却没定义、又没写兜底值」
		 * 的 --wta-* 变量。
		 *
		 * 为什么非要机器来查：`var(--x)` 指向未定义的变量时，**整条声明作废**，
		 * 那个属性不是"这条规则不起作用"，而是**被复位成 initial** ——
		 * background-color 直接变全透明、backdrop-filter 直接变 none、渐变换成 none。
		 * 没有报错、没有警告，表现只是"某块 UI 悄悄变丑了"。
		 *
		 * 已经踩过一次：重写玻璃那一段时连带删掉了 --wta-seat-* 与 --wta-bubble-* 的
		 * 定义，于是输入区那条全宽渐隐带的渐变和模糊一起没了、会话气泡的暖底变成全透明，
		 *（注：--wta-seat-* 那一组已在 2026-09-25 随座位带一起整体删除，不再是活变量）
		 * 用户看到的就是「之前所有 UI 的调整都没了」。人眼很难把"少了一条渐隐"归因到
		 * 一个变量名上，所以这条不变式交给代码守。
		 *
		 * 规则：每个 var(--wta-x) 要么**在本表内**有定义，要么登记在 CSS_VARS_FROM_JS 里
		 * （那一类本来就该由 JS 按状态写内联变量，不该出现在 CSS 定义里）。
		 * 以前只扫增强表、且跨表合并定义，于是基础表里的漏定义一直查不出来。
		 */
		const CSS_VARS_FROM_JS = ["--wta-glass-tint-cur"];
		function checkCssVars() {
			/* **逐表**检查，不跨表合并：任何一张被单独撤掉时，另一张不该因此缺变量。 */
			const sheets = { base: STYLESHEET, extra: EXTRA_STYLESHEET, motion: MOTION_STYLESHEET };
			const missing = [];
			for (const [sheet, css] of Object.entries(sheets)) {
				const defined = new Set();
				for (const m of css.matchAll(/(--wta-[a-z0-9-]+)\s*:/g)) defined.add(m[1]);
				/* 只匹配没有兜底值的那种写法：var(--x) 与 var(--x, 兜底) 的区别就在右括号位置 */
				for (const m of css.matchAll(/var\(\s*(--wta-[a-z0-9-]+)\s*\)/g)) {
					const where = sheet + ":" + m[1];
					if (!defined.has(m[1]) && !CSS_VARS_FROM_JS.includes(m[1]) && !missing.includes(where)) missing.push(where);
				}
			}
			if (missing.length) {
				console.warn("[dsh-warm-ui] 样式表里有未定义又没兜底的变量，相关声明会被整条复位：", missing);
			}
			return missing;
		}

		/**
		 * 布局守卫：文档只要比视口高，页面就能往下滚 —— 用户看到的就是
		 * 「壁纸跑到了页面下面」。
		 *
		 * 做法：把候选节点逐个临时藏起来量一次 scrollHeight，藏了就不溢出的是肇事者。
		 * 藏→量→还原全在**同一个任务**里，浏览器来不及重绘，看不见闪。
		 * 命中**我们自己**的节点（带归属标记的）就现场钉死（pinOverlay）；别人的节点
		 * 一律只点名、绝不动它 —— 上一版就是在这里给壁纸画布写了内联 display:none，
		 * 用户看到「壁纸没了」。守卫的职责是让用户看见问题，不是替别人做决定。
		 * 结论同时写进 window.__dshWarmExtra.layoutGuard 和角标，截图就能带回来。
		 */
		/* 我方那几行直接从 NODE_OWNERS 生成（带 pin 的才需要量），字符串不重写。 */
		const LAYOUT_GUARD_TARGETS = [
			...Object.entries(NODE_OWNERS)
				.filter(([, spec]) => spec.pin)
				.map(([key, spec]) => ({ key, label: spec.label, selector: "[" + spec.attr + "]" })),
			/* 末行是**别的插件**的节点：只报不动，用来把真凶的类名带回来。 */
			{ label: "壁纸层 canvas", selector: "[data-dsh-warm-wallpaper-layer]" },
		];
		/** 守卫的节奏与判据：数值集中在这里，逻辑里只引用。 */
		const LAYOUT_GUARD = {
			/* 首屏要等 DSH 把布局铺完再量，否则量到的是半成品 */
			firstCheckMs: 1500,
			/* DOM 频繁变化时最多一秒量一次（每次量都是一次强制布局） */
			minIntervalMs: 1000,
			/* 视口高度往往带小数（缩放/DPR），少于这个像素差就当没溢出 */
			tolerancePx: 1,
		};

		/**
		 * 它就是溢出的责任人吗：临时藏一下，**藏完必须不再溢出**才算数。
		 *
		 * 量之前先要求"确实还溢着"：否则已经被前一个候选解决掉的溢出，会被算到后面
		 * 每一个人头上 —— 守卫因此在真机上冤枉过壁纸画布，把它 display:none 掉了
		 * （症状是"壁纸没了"）。所以这一条判据必须带上前置检查。
		 * @returns {boolean}
		 */
		function ownsOverflow(el, over) {
			if (over() <= LAYOUT_GUARD.tolerancePx) return false;
			const keep = el.getAttribute("style");
			el.style.setProperty("display", "none", "important");
			const after = over();
			if (keep === null) el.removeAttribute("style");
			else el.setAttribute("style", keep);
			return after <= LAYOUT_GUARD.tolerancePx;
		}

		/** 给节点起个认得出的名字：类名 → id → 插槽名 → data-* 标记 → 标签名。 */
		function describeNode(el) {
			const cls = typeof el.className === "string" ? el.className.trim() : "";
			if (cls) return el.tagName + "." + cls.split(/\s+/)[0];
			if (el.id) return el.tagName + "#" + el.id;
			const slot = el.getAttribute("data-slot");
			if (slot) return el.tagName + "[slot=" + slot + "]";
			const marker = [...el.attributes].map((a) => a.name).find((n) => n.startsWith("data-"));
			return marker ? el.tagName + "[" + marker + "]" : el.tagName;
		}

		/** 角标文案：角标是出问题时唯一的求助渠道（用户会截图）。 */
		function guardNoteText(report) {
			const who = report.pinned[0] || report.blamed[0] || report.outsiders[0] || "未定位";
			return "布局溢出 +" + report.overflow + "px ← " + who;
		}

		/** 角标节点：无问题即撤掉。 */
		function paintGuardNote(text) {
			let note = document.querySelector("[" + NODE_OWNERS.guardNote.attr + "]");
			if (!note) {
				note = document.createElement("div");
				note.className = "wta-guard";
				mountDetached(document.body, note, "guardNote");
			}
			if (note.textContent !== text) note.textContent = text;
		}

		function clearGuardNote() {
			sweepOwned("guardNote");
		}

		/** @returns {?{overflow: number, pinned: string[], blamed: string[], outsiders: string[], left: number}} */
		function guardLayout() {
			const de = document.documentElement;
			const over = () => de.scrollHeight - de.clientHeight;
			const baseline = over();
			if (baseline <= LAYOUT_GUARD.tolerancePx) {
				clearGuardNote();
				return null;
			}
			const pinned = [];
			const blamed = [];
			const outsiders = [];
			for (const spec of LAYOUT_GUARD_TARGETS) {
				for (const el of document.querySelectorAll(spec.selector)) {
					if (!ownsOverflow(el, over)) continue;
					/* 只有**带本包归属标记**的节点才允许现场钉死；别人的节点只点名 ——
					   这一条就是「守卫把壁纸藏了」那次的修复。 */
					if (spec.key && el.getAttribute(OWNER_ATTRIBUTE) === ownerValue(spec.key)) {
						pinOverlay(el, spec.key);
						pinned.push(spec.label);
					} else {
						blamed.push(spec.label);
					}
				}
			}
			/* 还溢出的，就去 body 的直接子节点里点名（只报不动：那是 DSH 自己的节点）。
			   从后往前找、找到第一个就停 —— 真凶总是排在内容后面；反过来藏掉
			   #root 也会让文档不再溢出（因为没内容了），那是误报。 */
			if (over() > LAYOUT_GUARD.tolerancePx) {
				for (const el of [...document.body.children].reverse()) {
					if (el.hasAttribute(OWNER_ATTRIBUTE)) continue;
					if (!ownsOverflow(el, over)) continue;
					outsiders.push(describeNode(el));
					break;
				}
			}
			const report = { overflow: baseline, pinned, blamed, outsiders, left: over() };
			window.__dshWarmExtra = Object.assign(window.__dshWarmExtra || {}, { layoutGuard: report });
			paintGuardNote(guardNoteText(report));
			console.warn("[dsh-warm-ui] 文档比视口高，页面可以滚下去（壁纸会露在页面下面）：", report);
			return report;
		}

		/* ── 样式表注入：实现在共享包 `dsh-warm-shared` 里，只写一遍 ──────────
		 * `data-plugin` / `data-plugin-css` / 语义标记这三件是**平台约定**：
		 * 模块加载器只在工厂返回那一刻认领还没打标的 `<style>`，热重载也只删
		 * `style[data-plugin=<包名>]`；漏了标记 = 旧表删不掉、还会被后加载的插件
		 * 错认成自己的（「壁纸跑到页面下面」就是这么来的）。以前两个包各抄一份，
		 * 于是有抄错的机会 —— 现在实现唯一，这里只把**本包包名**绑上去。
		 * ────────────────────────────────────────────────────────────────── */
		const PACKAGE_ID = "dsh-warm-ui";
		const { createStyleInstaller, cssPropertyName } = require("dsh-warm-shared");
		const installStyleSheet = createStyleInstaller(PACKAGE_ID);

		/* 基础样式表：模块一加载就在（官方写法也是在模块作用域插），
		   卸载时由 apply 的清理函数撤掉，保证"删掉插件即无痕"。 */
		const baseStyleSheet = installStyleSheet("base", STYLESHEET, STYLE_ATTRIBUTE);

		/**
		 * 挂载增强层。返回清理函数：撤样式表、撤玻璃、撤 body 属性、断开 observer、停掉守卫。
		 *
		 * 装到一半抛出去也必须能收拾干净：每一步装上的东西先登记成"可撤"的，出错时按登记的
		 * 逆序撤掉 —— 半成品最麻烦的不是那声报错，而是"样式留一半、监听留一半"，下一次挂载
		 * 就变成两代同时写页面（用户 2026-09-24 报的闪烁）。包级资源（样式表、body 属性、
		 * 布局角标）只在**整层装成功之后**才登记卸载：装失败时撤掉的只有这一代自己造的东西，
		 * 不会连累正在工作的那一代。
		 */
		function mountExtras() {
			const disposers = [];
			let disposed = false;
			const dispose = () => {
				if (disposed) return;
				disposed = true;
				/* 逆序撤：后装的先撤（观察器要早于它依赖的东西停掉）。 */
				for (let i = disposers.length - 1; i >= 0; i -= 1) disposers[i]();
			};
			const track = (fn) => {
				disposers.push(fn);
				return fn;
			};
			try {
				/* 换代清扫：上一代万一没被 dispose 干净，先撤掉再挂新的（见 sweepOwned）。 */
				sweepOwned("glassSvg");
				sweepOwned("guardNote");
				const style = installStyleSheet("extra", EXTRA_STYLESHEET, "data-dsh-warm-extra");
				/* 自检结果留一个查询口：console 里会 warn，脚本里能直接读它。
				   这样"某个 var 没定义"从"肉眼发现 UI 变丑了"变成一条可断言的不变式。 */
				const missingCssVars = checkCssVars();
				window.__dshWarmExtra = Object.assign(window.__dshWarmExtra || {}, { missingCssVars });

				paintExtraFlags();
				const glass = mountGlass();
				track(() => glass.remove());

				const sync = () => {
					if (disposed) return;
					paintExtraFlags();
					/* 玻璃要在这里重套：DSH 按键时会重建输入卡片的 DOM 节点，
					   新节点没有内联滤镜、也没有表面反射图层，靠这次补上。
					   尺寸没变时 dress() 会直接返回，所以每次按键的代价只是几次属性读。 */
					glass.sync();
				};
				sync();

				/* 输入卡片是 DSH 的 React 树里长出来的，出现的时机不由我们决定
				   （挂载那一刻可能还没进会话，卡片根本不存在；之后按键、切会话、
				   窗口变化都会把它重建）。所以这里只做一件事：DOM 一动就补一次
				   dress()。用 rAF 合并，避免在 observer 回调里同步写样式触发回环。 */
				let scheduled = false;
				const schedule = () => {
					if (scheduled || disposed) return;
					scheduled = true;
					requestAnimationFrame(() => {
						scheduled = false;
						if (disposed) return;
						glass.sync();
						guardNow();
					});
				};
				/* 布局守卫：DOM 一变就顺手量一次（自带节流，见 LAYOUT_GUARD.minIntervalMs）。 */
				let lastGuard = 0;
				const guardNow = () => {
					const now = Date.now();
					/* 角标还挂着时不节流：溢出一消失就得让它立刻撤掉，不能等下一拍。 */
					if (now - lastGuard < LAYOUT_GUARD.minIntervalMs && !document.querySelector("[" + NODE_OWNERS.guardNote.attr + "]")) return;
					lastGuard = now;
					guardLayout();
				};
				const onResize = () => schedule();
				window.addEventListener("resize", onResize);
				track(() => window.removeEventListener("resize", onResize));
				const observer = new MutationObserver(schedule);
				observer.observe(document.body, { childList: true, subtree: true });
				track(() => observer.disconnect());
				const onScroll = () => schedule();
				window.addEventListener("scroll", onScroll, true);
				track(() => window.removeEventListener("scroll", onScroll, true));
				/* 首屏那一下：等 DSH 自己把布局铺完再量，否则量到的是半成品。 */
				const guardTimer = window.setTimeout(guardLayout, LAYOUT_GUARD.firstCheckMs);
				track(() => window.clearTimeout(guardTimer));

				/* 整层装成功了，包级资源这时才登记卸载。 */
				track(() => style.remove());
				track(clearGuardNote);
				track(() => {
					for (const key of Object.keys(EXTRA_DEFAULTS)) {
						document.body.removeAttribute(ATTR + key);
					}
				});
				return dispose;
			} catch (error) {
				dispose();
				throw error;
			}
		}

		/* ══ 动效引擎（内联实现，与隔离页调试过的是同一份代码） ══════════════
		 * 这里只做"把一份纯逻辑塞进插件"，逻辑本身不碰任何插件状态：
		 * 输入是图层元素，输出是 { refresh, destroy, diagnostics }。
		 * ══════════════════════════════════════════════════════════════════ */
		/**
		 * warm-ui 动效引擎（可内联进插件的一份实现）。
		 *
		 * 两个能力，共用一套弹簧积分器：
		 *   ① 输入区：自绘光标（弹簧横移、打字常亮、停手 N ms 才闪）+ 框内选区高亮
		 *   ② 正文选区：跨行/跨段高亮块，位置与宽度由弹簧驱动
		 *
		 * 三条硬约束（每条都是踩出来的）：
		 *   1. 不重排宿主 DOM。绝不包一层、也不往里插节点：DSH 的输入框是 Lexical
		 *      contenteditable，插节点会被下一次 reconcile 抹掉；包一层则 React 卸载时
		 *      removeChild 找不到原父节点会抛错。自绘物全部住在 body 下的独立图层，
		 *      按**视口坐标**画。
		 *   2. 高亮垫在文字下面靠 mix-blend-mode（亮色 multiply / 暗色 screen）。
		 *      图层必须是 display:contents —— position:fixed 的包裹层会被单独合成，
		 *      blend 的"背景"变成透明的自己，高亮退化成一块盖住文字的不透明色块（实测）。
		 *   3. 画不了立刻交还原生：任何一步失败 → 摘属性 → 原生光标与选中色立刻回来。
		 */
		function createMotionApi(global) {
		  'use strict';

		'use strict';

		var EDITABLE_SELECTOR = [
		  'textarea',
		  'input[type="text"]', 'input[type="search"]', 'input[type="email"]',
		  'input[type="url"]', 'input[type="tel"]', 'input[type="number"]',
		  'input:not([type])',
		  '[contenteditable="true"]', '[contenteditable=""]'
		].join(',');

		/* 别人的地盘：里面的选区由它们自己画，本层不重复画。 */
		var SKIP_CLOSEST = '.ea-field, .dsh-explain-assistant-overlay, [data-wta-motion-layer]';

		var DEFAULTS = {
		  caretResponse: 0.30,
		  caretDamping: 1,
		  selectionResponse: 0.20,
		  dragResponse: 0.10,
		  fade: 0.12,
		  blinkDelayMs: 500,
		  substep: 1 / 240,
		  maxDt: 0.064,
		  maxFieldBoxes: 24,
		  maxPageBoxes: 200,
		  padX: 2,
		  padY: 2
		};

		function springConfig(response, dampingRatio) {
		  var w = (2 * Math.PI) / response;
		  return { k: w * w, c: 2 * dampingRatio * w };
		}
		function createSpring(value, response, damping) {
		  var cfg = springConfig(response, damping);
		  return { x: value, v: 0, target: value, k: cfg.k, c: cfg.c };
		}
		function retune(spring, response) {
		  var cfg = springConfig(response, 1);
		  spring.k = cfg.k;
		  spring.c = cfg.c;
		}
		function stepSpring(s, dt, substep) {
		  var steps = Math.ceil(dt / substep);
		  var h = steps ? dt / steps : 0;
		  for (var i = 0; i < steps; i++) {
		    s.v += (-s.k * (s.x - s.target) - s.c * s.v) * h;
		    s.x += s.v * h;
		  }
		  if (Math.abs(s.x - s.target) < 0.01 && Math.abs(s.v) < 0.05) {
		    s.x = s.target; s.v = 0; return false;
		  }
		  return true;
		}
		function round(n) { return Math.round(n * 100) / 100; }

		function cssNumber(name, fallback) {
		  try {
		    var n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
		    return isFinite(n) ? n : fallback;
		  } catch (e) { return fallback; }
		}

		function readConfig() {
		  var cfg = {};
		  for (var key in DEFAULTS) cfg[key] = DEFAULTS[key];
		  cfg.caretResponse = cssNumber('--wta-motion-caret-response', cfg.caretResponse);
		  cfg.caretDamping = cssNumber('--wta-motion-caret-damping', cfg.caretDamping);
		  cfg.selectionResponse = cssNumber('--wta-motion-sel-response', cfg.selectionResponse);
		  cfg.dragResponse = cssNumber('--wta-motion-drag-response', cfg.dragResponse);
		  cfg.fade = cssNumber('--wta-motion-fade', cfg.fade);
		  cfg.blinkDelayMs = cssNumber('--wta-motion-blink-delay', cfg.blinkDelayMs);
		  cfg.substep = cssNumber('--wta-motion-substep', cfg.substep);
		  cfg.maxDt = cssNumber('--wta-motion-max-dt', cfg.maxDt);
		  cfg.padX = cssNumber('--wta-motion-sel-pad-x', cfg.padX);
		  cfg.padY = cssNumber('--wta-motion-sel-pad-y', cfg.padY);
		  return cfg;
		}

		function reducedMotion() {
		  try { return global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
		}

		function isEditable(el) {
		  if (!el || el.nodeType !== 1) return false;
		  if (!el.matches || !el.matches(EDITABLE_SELECTOR)) return false;
		  if (el.hasAttribute('disabled')) return false;
		  if (el.tagName !== 'DIV' && el.readOnly) return false;
		  if (el.closest(SKIP_CLOSEST)) return false;
		  return true;
		}

		function toElement(node) {
		  if (!node) return null;
		  return node.nodeType === 1 ? node : node.parentElement;
		}

		/* ── 几何 ─────────────────────────────────────────────────────── */

		function firstTextNode(root) {
		  if (!root) return null;
		  if (root.nodeType === 3) return root;
		  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
		  return walker.nextNode();
		}
		function lastTextNode(root) {
		  if (!root) return null;
		  if (root.nodeType === 3) return root;
		  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
		  var last = null;
		  var node = walker.nextNode();
		  while (node) { last = node; node = walker.nextNode(); }
		  return last;
		}

		/**
		 * 折叠选区的插入点矩形。
		 * Chrome 在**行盒里**的折叠 Range 会给 width=0、height≈字形高 的矩形；
		 * 但有两种退化情况它给全 0：
		 *   a) 选区锚在**元素**上（空段落 <p><br></p>、或刚 focus 还没落进文本节点）；
		 *   b) 段落里一个字都没有。
		 * 这两种都要自己找位置，否则光标会贴在视口左上角。
		 */
		function caretRectOfRange(range) {
		  var r = range.getBoundingClientRect();
		  if (r.height > 0) return { left: r.left, top: r.top, height: r.height };

		  var start = range.startContainer;
		  var anchorText = null;
		  if (start.nodeType === 3) {
		    anchorText = start;
		  } else if (start.nodeType === 1) {
		    var kids = start.childNodes;
		    var at = Math.min(range.startOffset, kids.length);
		    for (var i = at; i < kids.length && !anchorText; i++) anchorText = firstTextNode(kids[i]);
		    for (var j = at - 1; j >= 0 && !anchorText; j--) anchorText = lastTextNode(kids[j]);
		    if (!anchorText) anchorText = lastTextNode(start);
		  }
		  if (anchorText) {
		    var probe = document.createRange();
		    probe.setStart(anchorText, anchorText === start ? Math.min(range.startOffset, anchorText.length) : (start.nodeType === 1 && anchorText === lastTextNode(start) ? anchorText.length : 0));
		    probe.collapse(true);
		    var pr = probe.getBoundingClientRect();
		    if (pr.height > 0) return { left: pr.left, top: pr.top, height: pr.height };
		  }

		  /* 真的一段文字都没有（例如空的 <p><br></p>）：用 <br> 或段落本身的行高兜底。 */
		  var host = toElement(start);
		  var br = host && host.querySelector ? host.querySelector('br') : null;
		  var box = (br || host || document.body).getBoundingClientRect();
		  var lineHeight = 20;
		  try {
		    var cs = getComputedStyle(host && host.nodeType === 1 ? host : document.body);
		    var lh = parseFloat(cs.lineHeight);
		    if (isFinite(lh) && lh > 0) lineHeight = lh;
		  } catch (e) { /* 取不到就用默认 */ }
		  return {
		    left: br ? box.left : box.left + (parseFloat(getComputedStyle(host).paddingLeft) || 0),
		    top: box.top + Math.max((box.height - lineHeight) / 2, 0),
		    height: Math.min(box.height || lineHeight, lineHeight)
		  };
		}

		/** 把矩形裁进 clip；完全在外面就丢掉。高亮块是 position:fixed，坐标即视口坐标。 */
		function clipRect(r, clip) {
		  if (!clip) return r;
		  var left = Math.max(r.left, clip.left);
		  var top = Math.max(r.top, clip.top);
		  var right = Math.min(r.left + r.width, clip.right);
		  var bottom = Math.min(r.top + r.height, clip.bottom);
		  if (right - left <= 0.5 || bottom - top <= 0.5) return null;
		  return { left: left, top: top, width: right - left, height: bottom - top };
		}

		/**
		 * 最近一个「真的会滚」的祖先的客户区，再与视口求交。
		 *
		 * 为什么必须有它：高亮块是 position:fixed，坐标就是视口坐标 —— 不裁剪的话，
		 * 滚出容器的那几行会被画到顶栏 / 侧栏 / 页脚上（用户 2026-11-01 报的
		 * 「选中文字在可见区域外仍显示橙色方框」就是它）。
		 *
		 * 只认「overflow 非 visible 且内容确实超出」的祖先：消息卡片常带
		 * overflow:hidden 做圆角，认它会把跨段选区裁成一条。
		 */
		function clipRectOf(node) {
		  var right = (global.innerWidth || document.documentElement.clientWidth || 0);
		  var bottom = (global.innerHeight || document.documentElement.clientHeight || 0);
		  var left = 0, top = 0;
		  var el = toElement(node);
		  var owner = null;
		  var guard = 0;
		  while (el && el !== document.body && el !== document.documentElement && guard++ < 40) {
		    var cs = null;
		    try { cs = getComputedStyle(el); } catch (e) { cs = null; }
		    if (cs) {
		      var oy = cs.overflowY, ox = cs.overflowX;
		      var clips = (oy && oy !== 'visible') || (ox && ox !== 'visible');
		      if (clips && el.clientHeight > 2 && el.clientWidth > 2
		        && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)) {
		        var r = el.getBoundingClientRect();
		        left = Math.max(left, r.left + el.clientLeft);
		        top = Math.max(top, r.top + el.clientTop);
		        right = Math.min(right, r.left + el.clientLeft + el.clientWidth);
		        bottom = Math.min(bottom, r.top + el.clientTop + el.clientHeight);
		        owner = el;
		        break;
		      }
		    }
		    el = el.parentElement;
		  }
		  if (right - left < 2 || bottom - top < 2) return null;
		  return { left: left, top: top, right: right, bottom: bottom, el: owner };
		}

		function rectsOfRange(range, clip) {
		  var list = range.getClientRects();
		  var out = [];
		  for (var i = 0; i < list.length; i++) {
		    var r = list[i];
		    if (r.width <= 0 || r.height <= 0) continue;
		    var c = clipRect({ left: r.left, top: r.top, width: r.width, height: r.height }, clip);
		    if (c) out.push(c);
		  }
		  return out;
		}

		function dedupeRects(rects) {
		  var out = [];
		  for (var i = 0; i < rects.length; i++) {
		    var r = rects[i];
		    var inside = false;
		    for (var j = 0; j < out.length; j++) {
		      var c = out[j];
		      if (r.left >= c.left - 2 && r.top >= c.top - 2 &&
		          r.left + r.width <= c.left + c.width + 2 &&
		          r.top + r.height <= c.top + c.height + 2) { inside = true; break; }
		    }
		    if (!inside) out.push(r);
		  }
		  return out;
		}

		/**
		 * 把"同一行里的多个行内盒"并成一条。
		 *
		 * Range.getClientRects() 在**一行里混排不同字体**时，给的是每个行内盒一个矩形：
		 * 正文一段、行内代码一段、加粗一段、链接一段……它们的 top/height 并不相同
		 * （行内代码自带 padding、等宽字体行高也不同）。逐个画就成了"两块高亮叠在同一行上、
		 * 还错开一两像素"—— 用户 2026-10-31 报的"不同字体时重叠"就是这个。
		 *
		 * 做法：先按垂直重叠把矩形归到"同一行"；行内再按水平相邻（间隙 ≤ 2px）切成若干段，
		 * 每段用**段内最宽的那个矩形**的 top/height 当基准（最宽的那个通常是正文，它的高度
		 * 才是这一行该有的高度），水平取整段的左右边界。
		 * 于是：一行一条、高度不随字体跳变、相邻段之间不会叠色（34% 叠 34% ≈ 56%，看着更深）。
		 *
		 * 留退路：行内两个矩形之间若真有明显空洞（> 2px）就不并 —— 那说明选区中间本来
		 * 没选中，并起来会把没选中的空白也糊上。
		 */
		function mergeLineRects(rects) {
		  if (!rects || rects.length < 2) return rects;
		  var sorted = rects.slice().sort(function (a, b) { return a.top - b.top || a.left - b.left; });
		  var groups = [];
		  for (var i = 0; i < sorted.length; i++) {
		    var r = sorted[i];
		    var home = null;
		    for (var g = 0; g < groups.length; g++) {
		      var head = groups[g].items[0];
		      /* 按**行心距离**分组，不按重叠比例：同一行里行内代码的矩形比正文矮 5px、还低 4px
		         （实测 h=14/t=367 vs h=19/t=363），重叠比例只有 57%，按比例分组会把同一行拆成
		         两块 —— 那正是"看起来叠了两层"。行心相差不到 0.6 个行高就算同一行；相邻行行距 24，
		         中心差也就是 24，不会被误并。 */
		      var dh = Math.max(head.height, r.height);
		      var dc = Math.abs((head.top + head.height / 2) - (r.top + r.height / 2));
		      if (dc <= Math.max(4, dh * 0.6)) { home = groups[g]; break; }
		    }
		    if (home) home.items.push(r);
		    else groups.push({ items: [r] });
		  }
		  var out = [];
		  for (var gi = 0; gi < groups.length; gi++) {
		    var items = groups[gi].items.slice().sort(function (a, b) { return a.left - b.left; });
		    var run = null;
		    for (var k = 0; k < items.length; k++) {
		      var it = items[k];
		      if (!run) { run = { left: it.left, right: it.left + it.width, anchor: it }; continue; }
		      /* 缝的容忍度按行高推导：行内代码自带左右 padding，正文到代码正文之间实测有 6px
         的空档，固定 2px 会把同一行切成两块（高度还不一样，看着就是"重叠/错位"）。
         真没选中的空洞（跨栏、跨段）远大于这个数，不会被误并。 */
      var gap = Math.max(2, Math.min(16, (run.anchor.height || 20) * 0.8));
      if (it.left <= run.right + gap) {
		        run.right = Math.max(run.right, it.left + it.width);
		        if (it.width > run.anchor.width) run.anchor = it;
		        continue;
		      }
		      out.push({ left: run.left, top: run.anchor.top, width: run.right - run.left, height: run.anchor.height });
		      run = { left: it.left, right: it.left + it.width, anchor: it };
		    }
		    if (run) out.push({ left: run.left, top: run.anchor.top, width: run.right - run.left, height: run.anchor.height });
		  }
		  return out;
		}

		/**
		 * 相交即取并集 —— 送去绘制的矩形集合必须**两两不相交**。
		 *
		 * 为什么必须有这一步：高亮是半透明的（强调色 34%）。两个矩形只要相交，
		 * 交叠处就是 34% 叠 34% ≈ 56%，看起来比别处深一块 —— 用户看到的"重叠/像残留"
		 * 就是它。分组与合并（mergeLineRects）已经把绝大多数情况收掉了，但字体度量、
		 * 行内 padding、跨块紧贴这些情形不可能靠阈值穷尽，所以最后再用并集兜一次底：
		 * 这是**结构性保证**，不是又一个阈值。
		 */
		function unionOverlaps(rects) {
		  var out = rects.slice();
		  var merged = true;
		  while (merged) {
		    merged = false;
		    for (var i = 0; i < out.length && !merged; i++) {
		      for (var j = i + 1; j < out.length; j++) {
		        var a = out[i];
		        var b = out[j];
		        var ox = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
		        var oy = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
		        if (ox <= 0.5 || oy <= 0.5) continue;
		        var left = Math.min(a.left, b.left);
		        var top = Math.min(a.top, b.top);
		        out[i] = {
		          left: left,
		          top: top,
		          width: Math.max(a.left + a.width, b.left + b.width) - left,
		          height: Math.max(a.top + a.height, b.top + b.height) - top
		        };
		        out.splice(j, 1);
		        merged = true;
		        break;
		      }
		    }
		  }
		  return out;
		}

		/**
		 * 「这个矩形能不能用来判断在不在视口里」。
		 *
		 * 关键：**空矩形不等于在视口外**。DSH 的会话流里到处是 display:contents 的包裹层
		 * （CSS Modules 的 _root_ / _content_ / _plainRun_ 都是），它们的 getBoundingClientRect()
		 * 恒为 0×0×0×0 —— 当成"在视口上方"剪掉，整棵树就被剪空了：
		 * 真机实测选区明明在屏上，却一个文本节点都收不到（3082，2026-11-01）。
		 * 所以空矩形一律**放行**（继续往下走），只有真有面积的元素才按矩形剪。
		 */
		function rectUsable(r) { return !!r && (r.width > 0 || r.height > 0); }

		/**
		 * 取"有效矩形"：自己没面积就往下钻第一个有面积的子元素。
		 * display:contents 包裹层本身 0×0，但它和子元素在布局里是同一个盒子 ——
		 * 用子元素的矩形代替它，剪枝才剪得动（否则 3000 个包裹层每个都得往下看一眼）。
		 */
		function probeRect(el) {
		  var r = null;
		  try { r = el.getBoundingClientRect(); } catch (e) { r = null; }
		  if (rectUsable(r)) return r;
		  var node = el, depth = 0;
		  while (depth++ < 6) {
		    var child = node.firstElementChild;
		    if (!child) return r;
		    try { r = child.getBoundingClientRect(); } catch (e) { return r; }
		    if (rectUsable(r)) return r;
		    node = child;
		  }
		  return r;
		}

		function outsideClip(r, clip) {
		  if (!rectUsable(r)) return false;
		  return r.bottom < clip.top - 1 || r.top > clip.bottom + 1
		    || r.right < clip.left - 1 || r.left > clip.right + 1;
		}

		/**
		 * 兄弟节点是**竖着排**的时候，用二分找到第一条落在可见区里的，别从第一个开始数。
		 * 会话有几百条消息时，全选一次要白读几百个矩形。
		 * 三个前提缺一不可：首尾都有面积、首尾是从上到下、中途没撞到空矩形 ——
		 * 任何一条不满足就退回线性扫描（宁可慢一点，也不能漏）。
		 */
		function visibleStartIndex(kids, clip) {
		  var n = kids.length;
		  if (n <= 24) return 0;
		  function probe(i) {
		    var el = kids[i];
		    if (!el || el.nodeType !== 1) return null;
		    return probeRect(el);
		  }
		  var first = probe(0), last = probe(n - 1);
		  if (!rectUsable(first) || !rectUsable(last)) return 0;
		  if (first.top > last.top) return 0;
		  var lo = 0, hi = n - 1, guard = 0;
		  while (lo < hi && guard++ < 40) {
		    var mid = (lo + hi) >> 1;
		    var r = probe(mid);
		    if (!rectUsable(r)) return 0;
		    if (r.bottom < clip.top) lo = mid + 1; else hi = mid;
		  }
		  return Math.max(0, lo - 1);
		}

		/**
		 * 只收集「落在可见区里」的文本节点。
		 *
		 * 旧实现用 TreeWalker 走遍 range.commonAncestorContainer 下的**每一个**文本节点，
		 * 再逐个 range.intersectsNode() —— 跨两条消息时公共祖先就是整个消息流，
		 * 于是量一次等于遍历整场会话（实测 9,600 节点 24ms、38,400 节点 100ms），
		 * 而它会被拖选、滚动、每一次 DOM 变更各触发一次。用户 2026-11-01 报的
		 * 「选中大量文字时卡」就是这一条。
		 *
		 * 现在先按**子树矩形**剪枝：整棵子树都在裁剪区外就一步不进去；
		 * 兄弟节点多的时候再二分找起点、越过下边界就停。
		 * 会话再长，真正走到的也只是屏幕上那几条消息。
		 */
		function collectVisibleText(el, clip, out, budget, range) {
		  if (!el || !el.childNodes) return;
		  var kids = el.childNodes;
		  var start = visibleStartIndex(kids, clip);
		  for (var i = start; i < kids.length; i++) {
		    var node = kids[i];
		    if (node.nodeType === 3) {
		      if (!node.nodeValue || !node.nodeValue.length) continue;
		      /* 光看"可见"不够：同屏但不在选区里的文本节点必须排掉
		         （剪枝之后每个容器只剩几十个节点，这一步很便宜）。 */
		      var hit = true;
		      try { hit = range.intersectsNode(node); } catch (e) { hit = false; }
		      if (!hit) continue;
		      out.push(node);
		      if (out.length > budget) return;
		      continue;
		    }
		    if (node.nodeType !== 1) continue;
		    if (node.hasAttribute && node.hasAttribute('data-wta-motion-layer')) continue;
		    var r = probeRect(node);
		    if (outsideClip(r, clip)) {
		      /* 已经越过下边界：往后看三个兄弟，都没有落回来的话就可以整段跳过。 */
		      if (rectUsable(r) && r.top > clip.bottom + 1 && kids.length > 8) {
		        var back = false;
		        for (var j = i + 1; j < kids.length && j <= i + 3; j++) {
		          if (kids[j].nodeType !== 1) continue;
		          try { var rj = probeRect(kids[j]); if (rectUsable(rj) && rj.top <= clip.bottom + 1) { back = true; break; } } catch (e) { }
		        }
		        if (!back) return;
		      }
		      continue;
		    }
		    /* 这里**不**调 getComputedStyle：它对每个元素要 5~10µs，全选时顶层就有几百个
		       兄弟节点，光这一项就能把量取从 1ms 抬到 8ms（实测）。display:none 的子树
		       矩形恒为 0，上面那道矩形剪枝已经把它挡掉了。 */
		    collectVisibleText(node, clip, out, budget, range);
		    if (out.length > budget) return;
		  }
		}

		/* ── 引擎 ─────────────────────────────────────────────────────── */

		function createEngine(options) {
		  options = options || {};
		  var layer = options.layer;
		  var cfg = readConfig();

		  var boxLayer = document.createElement('div');
		  boxLayer.className = 'wta-m-boxes';
		  layer.appendChild(boxLayer);

		  var caretEl = document.createElement('div');
		  caretEl.className = 'wta-m-caret';
		  caretEl.setAttribute('data-wta-motion-caret', '');
		  var caretBar = document.createElement('i');
		  caretBar.className = 'wta-m-caret-bar';
		  caretEl.appendChild(caretBar);
		  layer.appendChild(caretEl);

		  var mirror = document.createElement('div');
		  mirror.className = 'wta-m-mirror';
		  mirror.setAttribute('aria-hidden', 'true');
		  var mirrorText = document.createTextNode('');
		  mirror.appendChild(mirrorText);
		  layer.appendChild(mirror);

		  var boxes = [];
		  var caretX = createSpring(0, cfg.caretResponse, cfg.caretDamping);
		  var caretFade = createSpring(0, cfg.fade, 1);
		  var caretVisible = false;
		  var caretY = 0;
		  var caretH = 20;
		  var blinkTimer = 0;
		  var blinkOn = false;
		  var activeField = null;
		  var nativeField = false;
		  var nativeSel = false;
		  var dragging = false;
		  var rafId = 0;
		  var lastTime = 0;
		  var dead = false;
		  var enabled = typeof requestAnimationFrame === 'function' && !reducedMotion();
		  var stats = { frames: 0, measures: 0, mode: 'idle', error: null, paintedRects: 0, skipped: 0 };
		  /** 上一次绘制用的裁剪区：诊断口用它算"有多少块画到了容器外"。 */
		  var lastClip = null;
		  /** 上一次绘制时块容器的视口 y 原点（内容模式非 0），诊断算"容器外块"要用。 */
		  var lastOriginY = 0;
		  /** 最近一次"交还原生色"的原因与时间（诊断用）。 */
		  var lastDegrade = { reason: '', at: 0 };
		  /** 闪烁被重置过几次 + 本次闪亮的起点（诊断用）。 */
		  var blinkResets = 0;
		  var blinkT0 = 0;

		  /* 原生选中色开关：只在**真的画出东西**时才关掉它 */
		  function syncNativeSel(on) {
		    /* 以 **DOM 实际状态**为准，不看 JS 标志位。
		       踩过的坑：旧引擎销毁时会 removeAttribute，而新引擎的标志位还记着"开着"，
		       于是它再也不补 —— 松手后原生蓝色又回来了。读一次属性、不一致才写，代价可以忽略。 */
		    nativeSel = on;
		    if (on) preArmT = Date.now() + 500;
		    var has = document.documentElement.hasAttribute('data-wta-motion-sel');
		    if (on && !has) document.documentElement.setAttribute('data-wta-motion-sel', '');
		    else if (!on && has) document.documentElement.removeAttribute('data-wta-motion-sel');
		  }

		  function anyAliveBox() {
		    for (var i = 0; i < boxes.length; i++) if (boxes[i].alive) return true;
		    return false;
		  }

		  /** 唯一的"把原生色还回去"出口：带原因码，供诊断面板读。 */
		  function restoreNative(reason) {
		    if (!nativeSel) return;           /* 本来就是开的，不用重复记 */
		    lastDegrade.reason = String(reason || '');
		    lastDegrade.at = Date.now();
		    syncNativeSel(false);
		  }
		  /** 只记录、不改变状态（用于"这一帧无块可画但选区还在"）。 */
		  function noteDegrade(reason) {
		    lastDegrade.reason = String(reason || '');
		    lastDegrade.at = Date.now();
		  }

		  function setNativeField(on) {
		    if (nativeField === on) return;
		    nativeField = on;
		    if (!activeField) return;
		    if (on) activeField.removeAttribute('data-wta-motion-field');
		    else activeField.setAttribute('data-wta-motion-field', '');
		  }

		  /* ── 光标 ──────────────────────────────────────────── */
		  function paintCaretBox(x, y, h) {
		    caretY = y; caretH = h;
		    caretEl.style.transform = 'translate3d(' + round(x) + 'px,' + round(y) + 'px,0)';
		    caretEl.style.height = round(h) + 'px';
		  }

		  function setBlink(on) {
		    if (blinkOn === on) return;
		    blinkOn = on;
		    if (on) caretBar.setAttribute('data-blink', '1');
		    else caretBar.removeAttribute('data-blink');
		  }

		  /** 光标位置的指纹：位置没变就不该重置闪烁计时（否则任何一次重绘都会把它清零）。 */
		  var caretKey = null;
		  var blinkForce = false;
		  /** 提前关原生色之后的保护窗：这段时间内不把原生色还回去，免得拖选首帧又闪蓝。 */
		  var preArmT = 0;
		  function preArmed() { return Date.now() < preArmT; }

		  function restartBlink() {
		    clearTimeout(blinkTimer);
		    setBlink(false);
		    caretEl.style.opacity = '1';
		    blinkResets++;
		    blinkT0 = Date.now();
		    blinkTimer = setTimeout(function () {
		      if (dead || !caretVisible) return;
		      setBlink(true);
		    }, cfg.blinkDelayMs);
		  }

		  function hideCaretNow() {
		    clearTimeout(blinkTimer);
		    setBlink(false);
		    caretVisible = false;
		    caretKey = null;
		    caretEl.style.opacity = '0';
		  }

		  /* ── 高亮块的挂载点 ──────────────────────────────────
		     · 正文选区（page-sel）：把块容器搬进**滚动容器**，坐标换成内容坐标。
		       浏览器滚内容时块跟着同一次合成滚动一起走 —— 这才能不"跟不上"：
		       position:fixed 的块只能等主线程收到 scroll 事件再重画，永远慢一帧以上。
		     · 输入框选区（field-sel）/ 找不到滚动容器：退回 body + 视口坐标。 */
		  var contentHost = null;
		  var contentHostPatched = null;
		  var contentHostPrevPos = '';

		  function ensureContentHost(el) {
		    if (!el || !el.appendChild) return false;
		    if (contentHost === el) { boxLayer.setAttribute('data-mode', 'content'); return true; }
		    detachContentHost();
		    var cs = null;
		    try { cs = getComputedStyle(el); } catch (e) { cs = null; }
		    if (cs && cs.position === 'static') {
		      contentHostPrevPos = el.style.position;
		      el.style.position = 'relative';
		      contentHostPatched = el;
		    }
		    try { el.appendChild(boxLayer); } catch (e) { return false; }
		    contentHost = el;
		    boxLayer.setAttribute('data-mode', 'content');
		    return true;
		  }

		  function detachContentHost() {
		    if (contentHost === null && boxLayer.getAttribute('data-mode') !== 'content') return;
		    boxLayer.removeAttribute('data-mode');
		    if (boxLayer.parentNode && boxLayer.parentNode !== layer) {
		      try { layer.appendChild(boxLayer); } catch (e) { /* 忽略 */ }
		    }
		    if (contentHostPatched) {
		      try { contentHostPatched.style.position = contentHostPrevPos; } catch (e) { /* 忽略 */ }
		      contentHostPatched = null;
		      contentHostPrevPos = '';
		    }
		    contentHost = null;
		  }

		  /* ── 高亮块 ────────────────────────────────────────── */
		  function ensureBoxes(count) {
		    while (boxes.length < count) {
		      var el = document.createElement('div');
		      el.className = 'wta-m-sel';
		      el.setAttribute('data-wta-motion-sel', '');
		      boxLayer.appendChild(el);
		      boxes.push({
		        el: el,
		        left: createSpring(0, cfg.selectionResponse, 1),
		        width: createSpring(0, cfg.selectionResponse, 1),
		        opacity: createSpring(0, cfg.fade, 1),
		        top: 0, height: 0, alive: false
		      });
		    }
		  }

		  function fadeAllBoxes() {
		    for (var i = 0; i < boxes.length; i++) if (boxes[i].alive) boxes[i].opacity.target = 0;
		    /* 这里**不**恢复原生色：由调用点决定。拖选刚开始时还没有选区，
		       如果这一帧就把属性摘掉，下一次拖动就会先看到一帧原生蓝。 */
		    ensureLoop();
		  }

		  /* ── 测量 ──────────────────────────────────────────── */
		  function selectionInside(el) {
		    var sel = global.getSelection();
		    if (!sel || sel.rangeCount === 0) return null;
		    var range = sel.getRangeAt(0);
		    if (!el.contains(range.commonAncestorContainer)) return null;
		    return range;
		  }

		  function syncMirror(el) {
		    var cs = getComputedStyle(el);
		    var rect = el.getBoundingClientRect();
		    mirror.style.left = rect.left + 'px';
		    mirror.style.top = rect.top + 'px';
		    mirror.style.width = el.clientWidth + 'px';
		    mirror.style.height = el.clientHeight + 'px';
		    mirror.style.padding = cs.padding;
		    mirror.style.font = cs.font;
		    mirror.style.fontSize = cs.fontSize;
		    mirror.style.lineHeight = cs.lineHeight;
		    mirror.style.letterSpacing = cs.letterSpacing;
		    mirror.style.fontWeight = cs.fontWeight;
		    mirror.style.textAlign = cs.textAlign;
		    mirror.style.boxSizing = 'border-box';
		    mirror.style.whiteSpace = el.tagName === 'TEXTAREA' ? 'pre-wrap' : 'pre';
		    mirror.style.wordBreak = 'break-word';
		    var data = el.value || '\u200b';
		    if (mirrorText.data !== data) mirrorText.data = data;
		    mirror.scrollTop = el.scrollTop;
		    mirror.scrollLeft = el.scrollLeft;
		  }

		  function measureField(el) {
		    stats.measures++;
		    var isCE = el.tagName === 'DIV';
		    if (isCE) {
		      /* DSH 在"选中了 chip"时会自己把原生光标藏起来，那时也不该画我们的 */
		      if (el.hasAttribute('data-composer-chip-selected')) return { mode: 'field-off' };
		      var range = selectionInside(el);
		      if (!range) return null;
		      if (range.collapsed) return { mode: 'field-caret', caret: caretRectOfRange(range), boxes: [], el: el };
		      var rects = unionOverlaps(mergeLineRects(dedupeRects(rectsOfRange(range))));
		      if (!rects.length) return { mode: 'field-empty' };
		      return { mode: 'field-sel', caret: null, boxes: rects, el: el };
		    }
		    var start = el.selectionStart;
		    var end = el.selectionEnd;
		    if (start === null || start === undefined) return null;
		    syncMirror(el);
		    if (end === start) {
		      var caretRange = document.createRange();
		      caretRange.setStart(mirrorText, Math.min(start, mirrorText.data.length));
		      caretRange.collapse(true);
		      return { mode: 'field-caret', caret: caretRectOfRange(caretRange), boxes: [], el: el };
		    }
		    var selRange = document.createRange();
		    selRange.setStart(mirrorText, Math.min(start, mirrorText.data.length));
		    selRange.setEnd(mirrorText, Math.min(end, mirrorText.data.length));
		    var boxRects = unionOverlaps(mergeLineRects(dedupeRects(rectsOfRange(selRange))));
		    if (!boxRects.length) return { mode: 'field-empty' };
		    return { mode: 'field-sel', caret: null, boxes: boxRects, el: el };
		  }

		  function measurePage() {
		    stats.measures++;
		    var sel = global.getSelection();
		    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
		    var ranges = [];
		    for (var i = 0; i < sel.rangeCount; i++) {
		      var r = sel.getRangeAt(i);
		      if (r.collapsed) continue;
		      var host = toElement(r.commonAncestorContainer);
		      if (!host || host.closest(SKIP_CLOSEST)) continue;
		      ranges.push(r);
		    }
		    if (!ranges.length) return null;
		    var rects = [];
		    var clip = null;
		    var owner = null;
		    var budget = cfg.maxPageBoxes * 6;
		    for (var k = 0; k < ranges.length; k++) {
		      var range = ranges[k];
		      var one = clipRectOf(range.startContainer);
		      if (!one) continue;
		      clip = clip ? {
		        left: Math.max(clip.left, one.left), top: Math.max(clip.top, one.top),
		        right: Math.min(clip.right, one.right), bottom: Math.min(clip.bottom, one.bottom)
		      } : one;
		      if (!owner && one.el) owner = one.el;
		      /* 上下各放宽一屏：块挂在滚动内容里，滚进来的那几行**已经画好了**，
		         不会在边缘一帧之后才冒出来。 */
		      var padY = (one.bottom - one.top);
		      var win = { left: one.left, top: one.top - padY, right: one.right, bottom: one.bottom + padY };
		      var scopeEl = toElement(range.commonAncestorContainer) || document.body;
		      var nodes = [];
		      collectVisibleText(scopeEl, win, nodes, budget, range);
		      for (var n = 0; n < nodes.length; n++) {
		        var text = nodes[n];
		        var part = document.createRange();
		        part.setStart(text, text === range.startContainer ? range.startOffset : 0);
		        part.setEnd(text, text === range.endContainer ? range.endOffset : text.length);
		        if (part.collapsed) continue;
		        var list = rectsOfRange(part, win);
		        for (var m = 0; m < list.length; m++) rects.push(list[m]);
		        if (rects.length > budget) break;
		      }
		    }
		    if (!rects.length) return { mode: 'page-empty' };
		    rects = unionOverlaps(mergeLineRects(dedupeRects(rects)));
		    if (!rects.length) return { mode: 'page-empty' };
		    /* 上限是**兜底**而不是**截断**：可见区里的行数天然有限，
		       真超了说明这个场景画不了，整段交还原生，绝不"只画前几十行"。 */
		    if (rects.length > cfg.maxPageBoxes) return { mode: 'page-overflow' };
		    return { mode: 'page-sel', caret: null, boxes: rects, el: null, clip: clip, owner: owner };
		  }

		  /* ── 落点 ──────────────────────────────────────────── */
		  /**
		   * @param {boolean} snap 视口刚动过（滚动 / 缩放）。这时块必须**瞬时贴住**文字，
		   *   一个过渡帧都不能有：可见区的矩形集合每滚一步都会整体换一批，
		   *   按索引匹配的块会拿到"另一行"的目标值，弹簧一过渡就成了"橙框自己会动"。
		   */
		  function paint(snap) {
		    if (dead) return;
		    /* 窗口没有焦点时不画：浏览器在这种情况下也不显示光标，我们自己画一根就成了
		       "切到别的窗口还看到光标在闪"。焦点回来时 onFocusIn / 对账会重新接管。 */
		    if (typeof document.hasFocus === 'function' && !document.hasFocus()) {
		      if (caretVisible) hideCaretNow();
		      fadeAllBoxes();
		      /* 窗口没焦点时我们什么都不画 —— 那把原生选中色还回去，
		         否则"切到别的窗口，选中的字看上去消失了"。 */
		      syncNativeSel(false);
		      stats.mode = 'unfocused';
		      return;
		    }
		    var m = null;
		    /* 谁在场由**文档选区**说了算：文档里有一段非折叠选区、且不在当前输入框里，
		       那就是正文选区；输入框只是"还挂着焦点"而已（真机上两者不会同时存在，
		       但无头/焦点仿真下会，判断顺序不对就会把正文选区整个吃掉）。 */
		    var sel = global.getSelection();
		    var docRange = (sel && sel.rangeCount && !sel.isCollapsed) ? sel.getRangeAt(0) : null;
		    var inField = !!(docRange && activeField && activeField.contains(docRange.commonAncestorContainer));
		    if (activeField && document.activeElement === activeField && (!docRange || inField)) {
		      m = measureField(activeField);
		    }
		    if (!m) {
		      if (activeField && docRange && !inField) setNativeField(true);
		      m = measurePage();
		    }

		    if (!m) {
		      stats.mode = 'idle';
		      if (caretVisible) { clearTimeout(blinkTimer); setBlink(false); }
		      fadeAllBoxes();
		      /* 什么都不画了 → 把原生选中色还回去。
		         不还的话，落在"本层跳过"的区域（小助手浮窗、它自己的输入框、任何我们不敢画的
		         地方）里的选区会既没有自绘高亮、也没有系统蓝 —— 等于"选不中"。
		         跨插件事故：warm-ui 的 ::selection{transparent !important} 是全局的，
		         小助手那侧"画不了就交还原生"的设计单方面作废。 */
		      if (docRange || (!dragging && !preArmed())) restoreNative('no-selection');
		      return;
		    }
		    stats.mode = m.mode;

		    if (m.mode === 'field-caret') {
		      var c = m.caret;
		      if (!c) { hideCaretNow(); return; }
		      setNativeField(false);
		      /* 这里**不**恢复原生选中色：光标分支意味着"当前没有选区"，但用户可能正按下
		         鼠标准备拖选 —— 一恢复，下一帧就会露出原生蓝（输入框内实测 1 帧）。 */
		      var first = !caretVisible;
		      caretEl.style.opacity = '1';
		      if (first || snap) { caretX.x = c.left; caretX.v = 0; caretX.target = c.left; }
		      else caretX.target = c.left;
		      caretVisible = true;
		      paintCaretBox(caretX.x, c.top, c.height);
		      /* 只有"插入点真的动了"或"真的在打字"才重置静默期。
		         以前是无条件重置 —— 于是页面上任何一次 DOM 变更 / 任何一次滚动
		         都会把 500ms 计时清零，光标永远停不住（用户 2026-11-01 报的
		         「停止输入后不闪」）。 */
		      var ckey = Math.round(c.left * 2) + '|' + Math.round(c.top * 2) + '|' + Math.round(c.height * 2);
		      if (first || blinkForce || ckey !== caretKey) { caretKey = ckey; blinkForce = false; restartBlink(); }
		      fadeAllBoxes();
		      return;
		    }

		    if (m.mode === 'field-sel' || m.mode === 'page-sel') {
		      hideCaretNow();
		      var useContent = false;
		      if (m.mode === 'page-sel' && m.owner) useContent = ensureContentHost(m.owner);
		      if (!useContent) detachContentHost();
		      /* 内容模式下块的坐标原点是**块容器自己**（它已经在滚动内容里，会跟着滚），
		         视口模式下原点是 (0,0)。 */
		      var ox = 0, oy = 0;
		      if (useContent) {
		        var orct = boxLayer.getBoundingClientRect();
		        ox = orct.left; oy = orct.top;
		      }
		      lastOriginY = oy;
		      if (useContent) {
		        var toneNow = layer.getAttribute('data-tone') || 'light';
		        if (boxLayer.getAttribute('data-tone') !== toneNow) boxLayer.setAttribute('data-tone', toneNow);
		      }
		      var drawClip = m.clip ? { left: m.clip.left - ox, top: m.clip.top - oy, right: m.clip.right - ox, bottom: m.clip.bottom - oy } : null;
		      var cap = m.mode === 'field-sel' ? cfg.maxFieldBoxes : cfg.maxPageBoxes;
		      var list = [];
		      for (var bi = 0; bi < m.boxes.length && bi < cap; bi++) {
		        var rr = m.boxes[bi];
		        var pb = { left: rr.left - ox - cfg.padX, top: rr.top - oy - cfg.padY, width: rr.width + cfg.padX * 2, height: rr.height + cfg.padY * 2 };
		        /* 内容模式下**不再手工裁剪**：块挂在滚动容器里，容器自己会把露到外面的部分裁掉。
		           手工裁剪反而有害 —— 贴边那一行的高度会随着滚动每帧被改一次
		           （实测 20.7 → 1.7 一路缩小再跳回 20.7），屏幕上看就是上边界附近的橙框在抖。
		           视口模式（找不到滚动容器时）才需要手工裁。 */
		        if (drawClip && !useContent) pb = clipRect(pb, drawClip);
		        if (pb) list.push(pb);
		      }
		      /* 外扩之后再并一次：外扩是逐块加的，两条原本只差 3px 的块各扩 2px 就又叠上了
		         （实测还剩 2 处 2px 交叠）。这一步保证"真正画出去"的矩形两两不相交。 */
		      list = unionOverlaps(list);
		      if (m.el) setNativeField(list.length >= cap);
		      ensureBoxes(list.length);
		      var response = dragging ? cfg.dragResponse : cfg.selectionResponse;
		      for (var i = 0; i < boxes.length; i++) {
		        var box = boxes[i];
		        var r = i < list.length ? list[i] : null;
		        if (!r) { box.opacity.target = 0; continue; }
		        retune(box.left, response);
		        retune(box.width, response);
		        if (!box.alive || box.opacity.x < 0.02) {
		          box.alive = true;
		          box.left.x = r.left; box.left.v = 0;
		          box.width.x = r.width; box.width.v = 0;
		          /* 滚动中滚进来的行：直接满不透明。
		             这里如果从 0 淡入，用户会看到"先什么都没有、过 0.12s 才变橙"——
		             和"先蓝后橙"是同一种观感问题。 */
		          if (snap) { box.opacity.x = 1; box.opacity.v = 0; }
		          else { box.opacity.x = 0; box.opacity.v = 0; }
		        } else if (snap) {
		          /* 滚动/缩放触发的重算：直接落位，不做弹簧。 */
		          box.left.x = r.left; box.left.v = 0;
		          box.width.x = r.width; box.width.v = 0;
		        }
		        box.left.target = r.left;
		        box.width.target = r.width;
		        box.opacity.target = 1;
		        box.top = r.top;
		        box.height = r.height;
		        box.el.style.height = round(r.height) + 'px';
		        box.el.style.transform = 'translate3d(' + round(box.left.x) + 'px,' + round(r.top) + 'px,0)';
		      }
		      lastClip = m.clip || null;
		      /* 正文选区：**只要选区还在，就一律保持抑制**，不看这一帧画了几个块。
		         这里以前写的是 syncNativeSel(list.length > 0)：由于收集窗口上下各放宽一屏，
		         选区"差一点进视野"时 m.boxes 非空、但裁剪后 list 为空，于是原生色被还回去；
		         等它真的滚进视野，第一帧是原生蓝、下一帧才变成橙 —— 用户看到的就是
		         "回到视野先被蓝框框住，再迅速变橙"。 */
		      stats.paintedRects = list.length;
		      ensureBoxes(list.length);
		      syncNativeSel(m.el ? (list.length > 0) : true);
		      ensureLoop();
		      return;
		    }

		    /* 收尾分支。**谁能还原生色，按原因分**：
		       · field-off / field-empty —— 这个输入框里我们不画，交还；
		       · page-overflow —— 真的画不了（超过上限），交还；
		       · page-empty —— 选区还在，只是这一帧跟可见区没有交集（滚出屏外了）。
		         这时**必须继续抑制**原生色：一旦还回去，用户滚回来就会看到一段蓝色，
		         而且因为块已被淡出、下一次滚动又被当成空转，就永远停在蓝色上。 */
		    hideCaretNow();
		    fadeAllBoxes();
		    if (m.mode === 'field-empty') setNativeField(true);
		    if (m.mode === 'field-empty' || m.mode === 'field-off') restoreNative(m.mode);
		    if (m.mode === 'page-overflow') restoreNative('page-overflow');
		    if (m.mode === 'page-empty') noteDegrade('page-empty(保留抑制)');
		  }

		  /* ── 帧 ────────────────────────────────────────────── */
		  function frame(now) {
		    if (dead) return;
		    stats.frames++;
		    var dt = Math.min(Math.max((now - lastTime) / 1000, 0), cfg.maxDt);
		    lastTime = now;
		    var moving = false;
		    if (stepSpring(caretX, dt, cfg.substep)) moving = true;
		    if (caretVisible) {
		      caretEl.style.transform = 'translate3d(' + round(caretX.x) + 'px,' + round(caretY) + 'px,0)';
		      caretEl.style.height = round(caretH) + 'px';
		    }
		    /* caretFade 这一支原来每帧都把 opacity 写成 1，hideCaretNow 又直接写 0 ——
		       淡出动画从来没生效过，只是每帧多一次样式写入。整支删掉，行为不变。 */
		    for (var i = 0; i < boxes.length; i++) {
		      var box = boxes[i];
		      if (!box.alive) continue;
		      if (stepSpring(box.left, dt, cfg.substep)) moving = true;
		      if (stepSpring(box.width, dt, cfg.substep)) moving = true;
		      if (stepSpring(box.opacity, dt, cfg.substep)) moving = true;
		      box.el.style.width = round(Math.max(box.width.x, 0)) + 'px';
		      box.el.style.transform = 'translate3d(' + round(box.left.x) + 'px,' + round(box.top) + 'px,0)';
		      box.el.style.opacity = String(round(Math.min(Math.max(box.opacity.x, 0), 1)));
		      if (box.opacity.x <= 0.002 && Math.abs(box.opacity.v) < 0.02 && box.opacity.target <= 0) {
		        box.alive = false;
		        box.el.style.opacity = '0';
		      }
		    }
		    rafId = moving ? requestAnimationFrame(frame) : 0;
		  }

		  function ensureLoop() {
		    if (dead || rafId || !enabled) return;
		    lastTime = (global.performance || Date).now();
		    rafId = requestAnimationFrame(frame);
		  }

		  function refresh(cheap) {
		    if (dead || !enabled) return;
		    /* 空转短路：没画光标、也没有任何活着的块时，DOM 变更 / 滚动都不值得重量一次。 */
		    if (cheap === true) {
		      /* 只有"连选区都没有"时才能整段跳过。
		         之前这里漏了选区这一条：选区整段滚出可见区之后块被淡出，
		         于是下一次滚动被当成空转跳过 —— 再滚回来就永远不重画了，
		         用户看到的就是"滚出去再滚回来，橙框变成原生蓝"。 */
		      var selNow = global.getSelection();
		      var hasSel = !!(selNow && !selNow.isCollapsed && selNow.rangeCount > 0);
		      if (!caretVisible && !anyAliveBox() && !hasSel) { stats.skipped++; return; }
		      /* 有东西在画：再花一次 getBoundingClientRect 确认"几何真的变了"才重量。
		         流式输出每秒钟几十次 DOM 变更，绝大多数时候选区根本没动。 */
		      var sig = quickSig();
		      if (sigSame(sig, lastSig)) { stats.skipped++; return; }
		    }
		    try { paint(cheap === true); } catch (e) {
		      stats.error = String((e && e.message) || e);
		      if (activeField) { activeField.removeAttribute('data-wta-motion-field'); nativeField = true; }
		      syncNativeSel(false);
		    }
		    lastSig = quickSig();
		    ensureLoop();
		  }

		  /* ── 事件 ──────────────────────────────────────────── */
		  var scheduled = false;
		  var scheduledCheap = false;
		  /**
		   * cheap = 这类触发源"如果本来就没在画东西，就完全没事可做"。
		   * DOM 变更（流式输出每秒钟几十次）和滚动都属于这一类；
		   * 用户输入 / 焦点变化 / 选区变化属于非 cheap，一定会重画。
		   */
		  function schedule(cheap) {
		    if (dead) return;
		    if (cheap === true) scheduledCheap = true;
		    if (scheduled) return;
		    scheduled = true;
		    requestAnimationFrame(function () {
		      scheduled = false;
		      var wasCheap = scheduledCheap;
		      scheduledCheap = false;
		      refresh(wasCheap);
		    });
		  }
		  /**
		   * 便宜的"几何没变"指纹：选区身份 + 锚点元素的视口矩形 + 裁剪区。
		   * 一次 getBoundingClientRect，比整趟量取便宜两个数量级。
		   * 用途：DOM 变更这种高频触发源，只有指纹变了才值得真的重量一次。
		   */
		  /*
		   * 注意：指纹里**绝对不能**放 getSelection().toString()。
		   * 那是一次全量文本序列化 —— 15 万字的选区实测要 2~4ms，比量取本身还贵，
		   * 会把"省下来的一次量取"原封不动地还回去。这里只比节点身份与偏移。
		   */
		  var lastSig = null;
		  function quickSig() {
		    var sel = global.getSelection();
		    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
		    var r = sel.getRangeAt(0);
		    var el = toElement(r.startContainer);
		    if (!el) return null;
		    var box = null;
		    try { box = el.getBoundingClientRect(); } catch (e) { box = null; }
		    return {
		      s: r.startContainer, e: r.endContainer, so: r.startOffset, eo: r.endOffset,
		      t: box ? Math.round(box.top) : -1, l: box ? Math.round(box.left) : -1, h: box ? Math.round(box.height) : -1
		    };
		  }
		  function sigSame(a, b) {
		    if (!a || !b) return a === b;
		    return a.s === b.s && a.e === b.e && a.so === b.so && a.eo === b.eo
		      && a.t === b.t && a.l === b.l && a.h === b.h;
		  }

		  /** 真的在打字：重置闪烁静默期（否则打字时光标也该闪）。 */
		  function onTyping() { blinkForce = true; schedule(); }

		  function onFocusIn(event) {
		    var el = event.target;
		    if (!isEditable(el)) return;
		    if (activeField && activeField !== el) activeField.removeAttribute('data-wta-motion-field');
		    activeField = el;
		    nativeField = false;
		    el.setAttribute('data-wta-motion-field', '');
		    hideCaretNow();
		    schedule();
		  }

		  /**
		   * 接管"已经聚焦"的输入框。
		   * 必须有这一条：DSH 进会话就自动把焦点放进输入框，而引擎是插件加载后才挂上的 ——
		   * 那一刻 focusin 已经发生过了，只等焦点事件就永远等不到（3082 真机实测：光标画不出来）。
		   */
		  function adoptActive() {
		    var el = document.activeElement;
		    if (!isEditable(el) || el === activeField) return;
		    if (activeField) activeField.removeAttribute('data-wta-motion-field');
		    activeField = el;
		    nativeField = false;
		    el.setAttribute('data-wta-motion-field', '');
		    hideCaretNow();
		    schedule();
		  }

		  function onFocusOut(event) {
		    if (!activeField || event.target !== activeField) return;
		    var el = activeField;
		    activeField = null;
		    el.removeAttribute('data-wta-motion-field');
		    hideCaretNow();
		    fadeAllBoxes();
		    ensureLoop();
		  }

		  function onSelectionChange() {
		    /* 先把原生选中色关掉再量：否则拖选时原生色会先闪一帧再被替换。 */
		    var sel = global.getSelection();
		    if (sel && !sel.isCollapsed) syncNativeSel(true);
		    if (!activeField) adoptActive();
		    schedule();
		  }
		  function onPointerDown() {
		    dragging = true;
		    /* 按下这一下就要关掉原生选中色 —— 不能等 selectionchange。
		       浏览器可能在派发 selectionchange 之前就把原生蓝色选区画上屏了（拖选首帧），
		       那时我们再设属性已经晚了一帧，用户看到的就是"蓝色一闪而过"。
		       这里提前关，等于让原生色从一开始就不存在；画不出来时 paint() 会把它还回去。 */
		    syncNativeSel(true);
		  }
		  function onPointerUp() { dragging = false; schedule(); }
		  /** 键盘扩选（Shift+方向键 / Ctrl+A）同样要提前关：它不经过 pointerdown。 */
		  function onKeyDown(event) {
		    if (!event) return;
		    if (event.shiftKey || ((event.ctrlKey || event.metaKey) && (event.key === "a" || event.key === "A"))) syncNativeSel(true);
		  }
		  function onScroll() { schedule(true); }
		  function onResize() { schedule(true); }
		  function onWindowBlur() { dragging = false; schedule(); }
		  function onWindowFocus() { adoptActive(); schedule(); }
		  function onAbortDrag() { dragging = false; schedule(); }

		  var listeners = [];
		  function on(target, name, fn, capture) {
		    target.addEventListener(name, fn, !!capture);
		    listeners.push([target, name, fn, !!capture]);
		  }

		  if (enabled) {
		    on(document, 'focusin', onFocusIn, true);
		    on(document, 'focusout', onFocusOut, true);
		    on(document, 'selectionchange', onSelectionChange, false);
		    on(document, 'pointerdown', onPointerDown, true);
		    on(document, 'pointerup', onPointerUp, true);
		    on(document, 'pointercancel', onPointerUp, true);
		    on(document, 'keydown', onKeyDown, true);
		    on(document, 'input', onTyping, true);
		    on(document, 'keyup', onTyping, true);
		    on(document, 'compositionupdate', onTyping, true);
		    on(document, 'compositionend', onTyping, true);
		    on(window, 'scroll', onScroll, true);
		    on(window, 'resize', onResize, false);
		    /* 回焦必须**无条件**重画一次：adoptActive() 在"还是同一个输入框"时会提前返回，
		       那样就没人把光标画回来了（刚从 unfocused 分支出来，屏上什么都没有）。 */
		    on(window, 'focus', onWindowFocus, false);
		    /* 失焦要立刻收笔：以前只有 focus 没有 blur，"切到别的窗口光标还在闪"要等下一次
		       随便什么事件才会消失。 */
		    on(window, 'blur', onWindowBlur, false);
		    /* 右键菜单 / 在窗口外松手都会让 pointerup 收不到，拖选状态会一直卡着。 */
		    on(document, 'contextmenu', onAbortDrag, true);
		  }

		  var motionQuery = null;
		  try { motionQuery = global.matchMedia('(prefers-reduced-motion: reduce)'); } catch (e) { motionQuery = null; }
		  function onMotionChange() {
		    var next = !(motionQuery && motionQuery.matches);
		    if (next === enabled) return;
		    enabled = next;
		    if (!enabled) {
		      if (activeField) activeField.removeAttribute('data-wta-motion-field');
		      nativeField = true;
		      hideCaretNow();
		      fadeAllBoxes();
		      syncNativeSel(false);
		      if (rafId) cancelAnimationFrame(rafId);
		      rafId = 0;
		      layer.setAttribute('data-wta-motion-off', '');
		    } else {
		      layer.removeAttribute('data-wta-motion-off');
		      if (activeField) { activeField.setAttribute('data-wta-motion-field', ''); nativeField = false; }
		      adoptActive();
		      refresh();
		    }
		  }
		  if (motionQuery && motionQuery.addEventListener) motionQuery.addEventListener('change', onMotionChange);

		  /* 动效开着 = 选中色归我们画。属性在挂载时就打开，之后只在"确实画不出来"
		     时才还原 —— 这样不存在"选区已出现、属性还没写"的空窗帧（那正是蓝色一闪的来源）。 */
		  syncNativeSel(true);
		  adoptActive();

		  /* 兜底对账：宿主可能在我们看不见的时机把焦点"还"给输入框（元素没变、
		     不会派发 focusin），也可能刚换完代就再没有事件可等。每秒读三次属性、
		     发现不一致才动，代价可以忽略，换来"光标不会莫名消失"。 */
		  var reconcileTimer = setInterval(function () {
		    if (dead) return;
		    adoptActive();
		    /* 高亮块只增不减会一直挂着 will-change（每块一个合成层）——
		       从**尾巴**回收已经彻底淡掉的块：索引不变，活着的块不会跳位。 */
		    var keep = 8;
		    while (boxes.length > keep) {
		      var lastBox = boxes[boxes.length - 1];
		      if (lastBox.alive || lastBox.opacity.x > 0.01) break;
		      boxLayer.removeChild(lastBox.el);
		      boxes.pop();
		    }
		  }, 1000);

		  /* 选区巡检：只在"屏上还有高亮块"时才跑。静默丢选区的路径不止重渲染一种
		     （程序化 clear、焦点被抢走、iframe 重排……），事件未必到得了我们这里，
		     所以对"已经画出来的东西"必须自己复核一遍：没选区了就淡出。
		     代价 = 每 260ms 一次 getSelection().isCollapsed（不碰布局）。 */

		  var observer = typeof MutationObserver === 'function'
		    ? new MutationObserver(function () {
		        if (!layer.isConnected) { handle.destroy(); return; }
		        /* 宿主重渲染会把输入框节点整个换掉（Lexical / React 都可能）：焦点还在，
		           而我们的引用已经指向一棵脱落的旧树。只"清空"不够 —— 清空之后再也没有
		           focusin 可等，光标就永远不画了（3081 实测：节点换代后 caretOpacity 一直是 0）。
		           所以清空完立刻重新认领当前焦点。 */
		        if (activeField && !activeField.isConnected) {
		          activeField = null;
		          hideCaretNow();
		        }
		        if (!activeField) adoptActive();
		        /* 宿主重渲染会**静默**丢掉选区：被选中的文本节点被换掉，Selection 直接
		           变成 collapsed，而浏览器不一定派发 selectionchange。只靠事件的话，
		           已经画出来的高亮块会永远停在屏上（3081 实测：整行残影）。
		           但这一条是 cheap：本来就没在画东西时，流式输出的每一次变更都不该触发重量。 */
		        schedule(true);
		      })
		    : null;
		  if (observer) observer.observe(document.body, { childList: true, subtree: true });

		  var handle = {
		    config: cfg,
		    refresh: refresh,
		    destroy: function () {
		      if (dead) return;
		      dead = true;
		      clearTimeout(blinkTimer);
		      if (rafId) cancelAnimationFrame(rafId);
		      rafId = 0;
		      for (var i = 0; i < listeners.length; i++) {
		        var l = listeners[i];
		        l[0].removeEventListener(l[1], l[2], l[3]);
		      }
		      listeners.length = 0;
		      clearInterval(reconcileTimer);
		      detachContentHost();
		      if (motionQuery && motionQuery.removeEventListener) motionQuery.removeEventListener('change', onMotionChange);
		      if (observer) observer.disconnect();
		      if (activeField) activeField.removeAttribute('data-wta-motion-field');
		      activeField = null;
		      syncNativeSel(false);
		      layer.remove();
		    },
		    diagnostics: function () {
		      var alive = 0;
		      var sample = null;
		      for (var i = 0; i < boxes.length; i++) {
		        if (boxes[i].alive) {
		          alive++;
		          if (!sample) sample = { x: round(boxes[i].left.x), targetX: round(boxes[i].left.target), w: round(boxes[i].width.x), targetW: round(boxes[i].width.target), top: round(boxes[i].top), h: round(boxes[i].height), o: round(boxes[i].opacity.x) };
		        }
		      }
		      var outside = 0;
		      if (lastClip) {
		        for (var k = 0; k < boxes.length; k++) {
		          var b2 = boxes[k];
		          if (!b2.alive) continue;
		          var vy = b2.top + lastOriginY;
		          if (vy < lastClip.top - 0.5 || vy + b2.height > lastClip.bottom + 0.5) outside++;
		        }
		      }
		      return {
		        enabled: enabled,
		        mode: stats.mode,
		        frames: stats.frames,
		        measures: stats.measures,
		        skipped: stats.skipped,
		        paintedRects: stats.paintedRects,
		        boxes: alive,
		        domBoxes: boxes.length,
		        outside: outside,
		        clip: lastClip ? { l: Math.round(lastClip.left), t: Math.round(lastClip.top), r: Math.round(lastClip.right), b: Math.round(lastClip.bottom) } : null,
		        sample: sample,
		        caret: { visible: caretVisible, x: round(caretX.x), target: round(caretX.target), y: round(caretY), h: round(caretH), blinking: blinkOn },
		        activeField: activeField ? (activeField.tagName + ' ' + (activeField.getAttribute('data-lexical-editor') ? 'lexical' : String(activeField.className || ''))) : null,
		        /* 原生选中色当前是否被抑制（= 自绘高亮在负责）。
		           诊断面板上它必须和"画了几块"同真同假，不同就是降级出了问题。 */
		        /** 'content' = 块挂在滚动容器里（零延迟跟随滚动）；'fixed' = 退回视口层 */
		        boxLayerMode: contentHost ? 'content' : 'fixed',
		        nativeSuppressed: nativeSel,
		        degrade: lastDegrade.reason,
		        degradeAgeMs: lastDegrade.at ? (Date.now() - lastDegrade.at) : -1,
		        blinkResets: blinkResets,
		        blinkPhaseMs: blinkT0 ? (Date.now() - blinkT0) : -1,
		        nativeSel: nativeSel,
		        nativeField: nativeField,
		        dragging: dragging,
		        error: stats.error
		      };
		    }
		  };
		  return handle;
		}

		return { createEngine: createEngine, DEFAULTS: DEFAULTS, readConfig: readConfig,
		    springConfig: springConfig, createSpring: createSpring, stepSpring: stepSpring };

		}


		/** 引擎只创建一次（它没有全局状态，创建一次即可复用）。 */
		const MOTION_API = createMotionApi(window);
		/** 由 mountMotion 填入：开关一变就要重新 sync（关掉要真的销毁引擎）。 */
		let motionSync = null;

		/** 写一项增强层开关（隐私模式下静默失败，只在本次生效）。 */
		function writeExtra(key, value) {
			try { localStorage.setItem(EXTRA_KEY(key), String(value)); } catch (error) { /* 忽略 */ }
		}

		/** 动效开关变化：落盘 → 重写 body 属性 → 重挂/卸载引擎 → 面板重渲染。 */
		function setMotionEnabled(value) {
			writeExtra("motion", value);
			paintExtraFlags();
			if (motionSync) motionSync();
			if (window.__dshWarmAppearance) window.__dshWarmAppearance.notify();
		}

		/**
		 * 挂动效层。
		 *
		 * 生命周期只有两条边：开 → 建图层 + 建引擎；关 → 销毁引擎（图层随之移除）。
		 * 关掉之后页面上的痕迹只有<strong>零个</strong>：图层没了，body 上的两个属性也被
		 * 引擎自己摘掉，原生光标与原生选中色立刻回来。
		 */
		function mountMotion() {
			const disposers = [];
			let disposed = false;
			let engine = null;
			let layer = null;
			const track = (fn) => { disposers.push(fn); return fn; };
			const dispose = () => {
				if (disposed) return;
				disposed = true;
				for (let i = disposers.length - 1; i >= 0; i -= 1) disposers[i]();
			};

			try {
				const style = installStyleSheet("motion", MOTION_STYLESHEET, "data-dsh-warm-motion");
				track(() => style.remove());

				/** 亮/暗只影响 blend：亮色 multiply、暗色 screen。按**实际底色**的亮度判，
				 *  不看属性名 —— DSH 的主题属性可能改名，而底色是眼睛真正看到的那个。 */
				const toneNow = () => {
					try {
						/* 亮度取一个**不透明**的颜色：body 的底色在 DSH 里是 transparent
						   （真正上色的是它下面那层），按 transparent 算会恒为黑 —— 实测把
						   亮色主题误判成暗色，于是 blend 用了 screen，亮底上会糊成一片。 */
						const cs = getComputedStyle(document.body);
						const lumOf = (raw) => {
							const m = /rgba?\(([^)]+)\)/.exec(raw || "");
							if (!m) return null;
							const p = m[1].split(/[,/]/).map(Number);
							if (p.length > 3 && !(p[3] > 0.1)) return null;
							const lum = 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
							return Number.isFinite(lum) ? lum : null;
						};
						const bg = lumOf(cs.backgroundColor);
						if (bg !== null) return bg < 128 ? "dark" : "light";
						/* 底色透明（DSH 的常态）：用文字色反推 —— 浅字是暗色主题，深字是亮色主题。 */
						const fg = lumOf(cs.color);
						if (fg !== null) return fg > 128 ? "dark" : "light";
					} catch (error) { /* 取不到就按属性判 */ }
					return document.body.hasAttribute("data-ds-dark-theme") ? "dark" : "light";
				};

				const sync = () => {
					if (disposed) return;
					const want = String(readExtra("motion")) === "1";
					if (want && !engine) {
						layer = document.createElement("div");
						layer.className = "wta-m-layer";
						layer.setAttribute("data-wta-motion-layer", "");
						layer.setAttribute("aria-hidden", "true");
						layer.setAttribute("data-tone", toneNow());
						mountDetached(document.body, layer, "motionLayer");
						engine = MOTION_API.createEngine({ layer: layer });
					} else if (!want && engine) {
						engine.destroy();
						engine = null;
						layer = null;
					} else if (want && layer) {
						layer.setAttribute("data-tone", toneNow());
					}
				};
				motionSync = sync;
				track(() => {
					motionSync = null;
					if (engine) { engine.destroy(); engine = null; }
					layer = null;
				});

				/* 切换主题只改 body 属性、不动 DOM 结构，所以用属性观察者跟。 */
				const observer = typeof MutationObserver === "function"
					? new MutationObserver(() => { if (engine) sync(); })
					: null;
				if (observer) {
					observer.observe(document.body, { attributes: true, attributeFilter: ["class", "style", "data-ds-dark-theme"] });
					track(() => observer.disconnect());
				}

				sync();

				/* 自检口：与 __dshWarmExtra / __dshWarmAppearance 同一套约定 ——
				   脚本里能直接读到"现在开着没、画了几个块、光标在哪"，不用靠肉眼。 */
				/**
				 * 只读诊断面板（默认关）。
				 *
				 * 开关存在 localStorage 的 dsh.wta.motion.diag：默认关 —— 所以 3081 上即使代码在也
				 * 永远不显示；只有显式打开（或在控制台 __dshWarmMotion.diag(true)）才会挂。
				 * 面板只读，不参与任何逻辑。
				 */
				const DIAG_KEY = "dsh.wta.motion.diag";
				let diagEl = null;
				let diagTimer = 0;
				const diagOn = () => { try { return localStorage.getItem(DIAG_KEY) === "1"; } catch (error) { return false; } };
				const diagStop = () => {
					if (diagTimer) { clearInterval(diagTimer); diagTimer = 0; }
					if (diagEl && diagEl.parentNode) diagEl.parentNode.removeChild(diagEl);
					diagEl = null;
				};
				const diagRender = () => {
					if (!diagEl) return;
					const d = engine ? engine.diagnostics() : null;
					const dom = document.querySelectorAll(".wta-m-sel").length;
					if (!d) { diagEl.textContent = "动效层：未挂载"; return; }
					diagEl.textContent = [
						"mode        " + d.mode + (d.enabled ? "" : "（关闭）"),
						"measures    " + d.measures + "   跳过 " + d.skipped,
						"paintedRects " + d.paintedRects + "   块 " + d.boxes + "/" + d.domBoxes,
						"屏外缓存块   " + d.outside + "（容器负责裁）  层 " + d.boxLayerMode,
						"clip        " + (d.clip ? [d.clip.l, d.clip.t, d.clip.r, d.clip.b].join(",") : "-"),
						"caret       " + (d.caret.visible ? (d.caret.blinking ? "闪" : "实") + "@" + d.caret.x + "," + d.caret.y : "无"),
						"field       " + (d.activeField || "-"),
						"native      sel=" + d.nativeSel + " field=" + d.nativeField,
						"DOM 块节点   " + dom,
						"err         " + (d.error || "-")
					].join("\n");
				};
				const diagSync = () => {
					const want = diagOn();
					if (want && !diagEl) {
						diagEl = document.createElement("div");
						diagEl.setAttribute("data-wta-motion-diag", "");
						diagEl.setAttribute("aria-hidden", "true");
						diagEl.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:2147483000;font:11px/1.45 ui-monospace,Menlo,monospace;background:rgba(20,20,24,.84);color:#e8e8ea;padding:8px 10px;border-radius:8px;pointer-events:none;white-space:pre;box-shadow:0 6px 20px rgba(0,0,0,.35)";
						mountDetached(document.body, diagEl, "motionDiag");
						diagRender();
						diagTimer = setInterval(diagRender, 500);
					} else if (!want && diagEl) {
						diagStop();
					}
				};
				window.__dshWarmMotion = {
					get: () => ({ enabled: String(readExtra("motion")) === "1", layer: !!layer, engine: !!engine, diag: !!diagEl }),
					diagnostics: () => (engine ? engine.diagnostics() : null),
					set: (value) => setMotionEnabled(Number(value)),
					diag: (on) => {
						try { localStorage.setItem(DIAG_KEY, on ? "1" : "0"); } catch (error) { /* 忽略 */ }
						diagSync();
						return !!diagEl;
					},
				};
				diagSync();
				track(() => { diagStop(); delete window.__dshWarmMotion; });

				return dispose;
			} catch (error) {
				dispose();
				throw error;
			}
		}

		/** 外观面板里的「动效」分组：一行开关。 */
		function mountMotionSection() {
			const api = window.__dshWarmAppearance;
			if (!api || typeof api.register !== "function") return () => {};
			return api.register({
				id: "dsh-warm-ui-motion",
				title: "动效",
				rows: [{
					key: "motion",
					label: "光标·选区",
					get: () => Number(readExtra("motion")),
					set: (value) => setMotionEnabled(Number(value)),
					options: [
						{ value: 0, text: "关", title: "关掉自绘光标与选区动画，完全回到浏览器原生" },
						{ value: 1, text: "开", title: "弹簧光标 + 选区高亮（跟随当前主题的强调色）" },
					],
				}],
			});
		}

		/**
		 * 挂载暖色 token 层与整形样式表；返回的清理函数同时撤掉两者。
		 * 暖度档位可以在地址栏改 `#warm=1` 实时切换（改 hash 即换，无需刷新）。
		 * @param {object} ctx - client cordis 上下文（注入 theme）。
		 */
		function apply(ctx) {
			ctx.effect(() => {
				/** 按当前档位重新铺一层 token（切换档位时先撤旧的再铺新的）。 */
				let releaseTokens = null;
				const paint = () => {
					if (releaseTokens) releaseTokens();
					releaseTokens = ctx.theme.overrideTokens("dsh-warm-ui", buildTokens());
					// 加粗档位走 body 属性 + 样式表，不占 token
					document.body.dataset.dshWarmBold = String(currentBold());
					for (const fn of LEVEL_LISTENERS) fn();
				};
				repaint = paint;

				paint();

				/* 外观面板：挂到侧栏底部插槽；拿不到插槽就不挂，主题本身不受影响。 */
				const unmountAppearance = mountAppearanceControl(ctx);
				const unmountCollapse = mountOptimizerCollapse();
				const unmountText = mountTextReplacements();
				/* 增强层：独立的样式表 + 柔光罩，整体可撤（见 mountExtras）。 */
				const unmountExtras = mountExtras();
				/* 动效层：独立样式表 + 独立引擎，跟增强层一样可整层撤掉。 */
				const unmountMotion = mountMotion();
				/* 外观面板里的「动效」分组（没有面板时返回空函数，不影响主题）。 */
				const unmountMotionSection = mountMotionSection();

				return () => {
					unmountMotionSection();
					unmountMotion();
					unmountAppearance();
					unmountCollapse();
					unmountText();
					unmountExtras();
					repaint = null;
					document.body.removeAttribute("data-dsh-warm-bold");
					if (releaseTokens) releaseTokens();
					if (baseStyleSheet) baseStyleSheet.remove();
				};
			}, "dsh-warm-ui: 暖色 token 层 + 输入栏整形样式表 + 档位/权限下拉 + 动效层");
		}

		exports.apply = apply;
		/** slots 用来挂侧栏底部的「外观」面板；拿不到时面板降级为不挂，主题照常。 */
		exports.inject = ["theme", "slots"];
		return module.exports;
	},
});
