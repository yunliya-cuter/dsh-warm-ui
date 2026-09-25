/**
 * dsh-warm-wallpaper —— 动态壁纸（关 / 纸 / 摩尔纹 / 焦散）。
 * **3081 真实实例 + 3082 预览实例都挂。**
 *
 * 它单独成包，由两个 home 的 patch 各自引用：
 *   3081  ~/.dsh/profiles/web/cordis.patch.yml
 *   3082  /mnt/d/projects/.dsh-warm-preview/profiles/web/cordis.patch.yml
 * 界面入口在外观面板的「壁纸」分组，扩展点由 dsh-warm-ui 提供。
 *
 * ── 它做什么 ──────────────────────────────────────────────────────────────
 * 一块铺满视口、`z-index:-1` 的 <canvas>，作为 body 的直接子节点。它**不混合**
 * （没有 mix-blend-mode、没有 filter、没有 mask）—— 就是老老实实待在所有 UI 的
 * 后面，靠把几个「铺满视口的大面」改成透明来透出来。
 *
 * ── 为什么必须「把大面变透明」────────────────────────────────────────────
 * DSH 的暗色主题里，`pI_x6G_frame`（应用外框，1600×1000）和 `wSkVaW_root`
 * （对话列）用的是 `var(--dsw-alias-bg-base)` = #141414 **不透明**；侧栏
 * `pI_x6G_sidebarCol` / `hHd-Xa_root` 用 `var(--dsw-specific-sidebar-fill)` = #1a1a1a
 * **不透明**。四个面就把视口盖满了 —— 什么都不做的话，画布一个像素也透不出来。
 * 所以本插件把**恰好这四个**面改成透明/半透明：
 *   [class$="_frame"]        应用外框
 *   [class$="_root"]         对话列（实测 DOM 里只有 wSkVaW_root 命中）
 *   [class*="quietBars"]     侧栏内容
 *   [class$="_sidebarCol"]   侧栏列（留一点点自己的底色，保住「侧栏比正文区暗一档」的层次）
 * 选择器用**类名后缀**而不是 hash 前缀，所以 DSH 升级换了 CSS-module hash 也不会瞎套；
 * 命中不到就只是背景看不见，不会把 UI 弄坏。
 * 卡片 / 菜单 / 输入框 / 浮层**一律不碰**（它们用 bg-layer-* 和 specific-menu），
 * 文字落在自己的不透明底上，永远清晰。
 *
 * 关档时这些覆盖连同画布一起撤掉，UI 与「没装这个插件」逐字节相同。
 *
 * ── 为什么没有全屏 blur ───────────────────────────────────────────────────
 * 实测全屏 `filter: blur(2.5px)` = 66.6ms/帧（15fps）—— 合成面积就是全部成本。
 * 这里走的是「低分辨率 canvas 逐像素画 + CSS 放大」：内部分辨率 320×200 ~ 480×300，
 * 交给合成器做双线性放大，免费、而且正好就是要的那种柔化。实测 16.7ms、0 掉帧。
 *
 * ── 「当背景」怎么重新调参的 ─────────────────────────────────────────────
 * 草稿是给人凑近看的：亮带峰值 ~200/255。当背景时正文 #dfe1e6 必须始终清晰，
 * 所以每个模式有一组 TUNE（见下）：先绕支点收对比，再整体压向界面底色 #141414。
 * 目标是**最亮处的正文对比度仍然 ≥ 7:1**（AA 要求 4.5:1）。这是算出来再照着
 * 截图定的，具体数字和取舍写在 README.md 里。
 *
 * ── 动态纪律 ─────────────────────────────────────────────────────────────
 * 两个模式都只用极小的时间常数（纸：光楔 48s / 次光楔 73s；摩尔纹：圆心 113~167s、
 * 节距 97/127s）。**没有**全局明暗脉动，**没有**快速扫过的高对比元素。
 * 草稿里的「逐帧随机颗粒」（每 ~55ms 换一次偏移）当背景就是全屏闪烁，已删掉，
 * 改成烘焙进底色的静态颗粒。`prefers-reduced-motion: reduce` 只画一帧；
 * 标签页不可见时不排帧。
 */
window.__ModuleLoader__.load({
	id: "dsh-warm-wallpaper",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		let React = null;
		try {
			React = require("react");
		} catch (error) {
			React = null;
		}
		const h = React ? React.createElement : null;

		/** 样式表节点标记，便于在 DevTools 与检查脚本里一眼认出本插件注入的规则。 */
		const STYLE_ATTRIBUTE = "data-dsh-warm-wallpaper-style";
		const LAYER_ATTRIBUTE = "data-dsh-warm-wallpaper-layer";
		const MODE_ATTRIBUTE = "data-dsh-warm-wallpaper";
		const ON_ATTRIBUTE = "data-dsh-warm-wallpaper-on";
		const HOST_ATTRIBUTE = "data-dsh-warm-wallpaper-host";

		/* ── 档位 ───────────────────────────────────────────────────────── */

		/** 包名既是 HMR 的样式归属，也是注入节点归属标记的前缀（见 NODE_OWNERS）。 */
		const PACKAGE_ID = "dsh-warm-wallpaper";
		const OWNER_ATTRIBUTE = "data-dsh-warm-owner";

		/* 共享工具只在 preview/shared 里写一遍：样式表注入三件套绑定本包名
		   （热重载按它删表，见 shared 包里的说明），属性名转换内联与生成 CSS 共用。 */
		const { createStyleInstaller, cssPropertyName } = require("dsh-warm-shared");
		const installStyleSheet = createStyleInstaller(PACKAGE_ID);

		/** 0 关 / 1 纸·纤维 / 2 摩尔纹。默认纸（用户的诉求就是「纸/纤维加个模糊」）。 */
		const MODES = {
			0: { name: "关", kind: null },
			1: { name: "纸", kind: "paper" },
			2: { name: "摩尔纹", kind: "moire" },
			3: { name: "焦散", kind: "caustics" },
		};
		const DEFAULT_MODE = 1;
		const KEY = "dsh-wallpaper-mode";

		/**
		 * 侧栏底色。JS 现算出来写进 --wlp-side，CSS 里那份兜底值也从这里生成 ——
		 * 一个数只写一遍。
		 *   alpha  只给 0.34：侧栏要保住「比正文区暗一档」的层次，但不能把壁纸挡死。
		 *   base   主题 token 取不到时用的兜底色（DSH 暗色的侧栏灰）。
		 */
		const SIDE = { alpha: 0.34, base: "#1a1a1a" };

		/**
		 * 会话列表底部那条**原生渐隐带**的几何。DSH 的实现是
		 *   .bhn1Oq_fade{height:24px; position:absolute; bottom:0;
		 *                background:linear-gradient(to bottom, transparent, var(--dsw-specific-sidebar-fill))}
		 * —— 收尾色是**不透明**的侧栏填充色。本插件把 sidebarCol 改成半透明之后，
		 * 这条带子最后一行的颜色就不再等于它周围的真实底色，底边会留下一条横向硬缝
		 * （壁纸越亮越明显：用户标注图里那两处「分割感」就是它的上色段与底边）。
		 * 做法不是"盖住"，而是**撤掉上色、改成内容自己渐隐**：同样 24px 的遮罩，
		 * 透出来的就是与下方逐像素相同的底色，不再依赖任何颜色 token。
		 */
		const LIST_EDGE_FADE = { heightPx: 24 }; // 与 DSH 原生 bhn1Oq_fade 的 height 一致

		/**
		 * 画布挂在 body 上，必须是「铺满视口、且完全不参与排版」的一块。
		 *
		 * 它的定位平时由样式表给；这里再补一份**内联**的不变量，因为样式表是会被盖掉的
		 * （包括自己上一代热更没撤干净的旧表）：一旦它变成了普通块，那张 1600×900 的
		 * 画布就会把文档撑得又高又能滚，用户看到的是「壁纸跑到了页面下面，得往下滑」。
		 * 内联永远赢样式表，代价只有一行。display 不在这里 —— 关模式要靠样式表把它藏掉。
		 */
		const LAYER_PINS = {
			position: "fixed", left: "0px", top: "0px", width: "100%", height: "100%",
			zIndex: "-1", pointerEvents: "none",
		};

		/**
		 * 注入节点登记表：**一类节点一行**（与 warm-ui 的同名表同构）。
		 * `attr` 是语义标记 —— CSS、探针、清扫都按它选节点，字符串只写一遍。
		 */
		const NODE_OWNERS = {
			/* 铺满视口的壁纸画布：定位/尺寸见 LAYER_PINS。 */
			layer: { attr: LAYER_ATTRIBUTE, label: "壁纸层 canvas" },
		};

		/** 归属标记：值 = `包名:节点名`。检查脚本按它确认注入节点都属于本包。 */
		const ownerValue = (key) => PACKAGE_ID + ":" + key;

		/** 把这一行不变量写成内联样式（kebab 名由键名推导，不手抄属性名）。 */
		function pinLayer(el) {
			for (const [prop, value] of Object.entries(LAYER_PINS)) {
				el.style.setProperty(cssPropertyName(prop), value);
			}
			/* 显示/隐藏归样式表管（关模式那条规则要用它），内联的 display 只可能是
			   别人塞进来的 —— 旧版布局守卫就干过这件事，把画布 display:none 之后
			   壁纸就"没了"，而且内联样式压过样式表，不手动清就永远回不来。 */
			el.style.removeProperty("display");
			return el;
		}

		/** 挂到 body 上的**唯一入口**：贴语义/归属标记 → 钉死定位 → append。 */
		function mountLayer(el) {
			const spec = NODE_OWNERS.layer;
			el.setAttribute(spec.attr, "");
			el.setAttribute(OWNER_ATTRIBUTE, ownerValue("layer"));
			pinLayer(el);
			document.body.append(el);
			return el;
		}

		/** 样式表里的画布规则也从 LAYER_PINS 生成 —— 同一含义只写一次。 */
		function layerCss() {
			return Object.entries(LAYER_PINS)
				.map(([prop, value]) => "  " + cssPropertyName(prop) + ": " + value + ";")
				.join("\n");
		}

		/**
		 * 「铺满视口的大面」名单：命中这些的元素底色会被强制透明，壁纸才透得出来。
		 *
		 * 全部用**类名后缀**匹配，不依赖 CSS-module 的 hash；命中不到只是背景看不见，
		 * 不会弄坏 UI。卡片 / 菜单 / 输入框 / 浮层一律不在名单里 —— 文字要有自己的底。
		 *
		 * 加一个目标 = 加一行：op 是属性选择器的运算符（$= 结尾 / *= 包含）。
		 */
		const CLEAR_SURFACES = [
			{ op: "$=", value: "_frame" },
			{ op: "$=", value: "_root" },
			{ op: "*=", value: "quietBars" },
		];

		/** 把名单拼成选择器列表 —— 加一行目标，样式表自动多一条。 */
		function clearSurfaceSelector() {
			return CLEAR_SURFACES
				.map((row) => ":root[" + ON_ATTRIBUTE + "] [class" + row.op + '"' + row.value + '"]')
				.join(",\n");
		}

		/* ── 「当背景」的调参（全部集中在这里）─────────────────────────────
		 *
		 *   pivot     收对比的支点（草稿里「中间调」大概在这）
		 *   contrast  绕支点收对比的系数（1 = 不动，越小对比越低）
		 *   vis       压向界面底色后还剩多少（1 = 原稿，0 = 全底色）
		 *
		 * 先 contrast 再 vis：contrast 让亮带不要那么刺、暗场抬一点点不至于死黑；
		 * vis 负责把整幅压到「亮处也不影响读字」。
		 *
		 * 数值是这么定的：正文 #dfe1e6 的线性亮度 L=0.7375。背景灰度 g 时对比度
		 * = (0.7375+0.05)/(L(g)+0.05)。g=97 → 4.5:1（AA 线）；g=80 → 5.6:1；
		 * g=70 → 6.4:1。两个模式的**最亮处都被压到 80 上下**，且最亮处只占很小面积
		 * （草图本来就大面积近黑），实测整页最亮背景 ~78，正文对比度 ~5.6:1。
		 */
		const UI_BASE = 20; // #141414 的灰度
		const TUNE = {
			// 纸：光带核心在草稿里到 ~200，压完到 ~78；暗场几乎不动（≈UI_BASE）
			paper: { pivot: 40, contrast: 0.80, vis: 0.34 },
			// 摩尔纹：细线本来就低对比，再收一档会「糊成一片」，所以 vis 更低、pivot 更低
			moire: { pivot: 30, contrast: 0.85, vis: 0.28 },
			// 焦散：**方向和另外两档相反**。它天生是「大面积极暗 + 少数地方亮着细丝」，
			// 本来就已经安静了 —— 再收对比就等于把丝压没（上一轮就是这么失败的）。
			// 所以 contrast 拉到 0.95（几乎不动丝的峰值），pivot 压到 16（= 草稿暗场的灰度，
			// 让丝以外的地方正好落在界面底色 20 上、不被抬起来），亮度只由 vis 一家控制。
			caustics: { pivot: 16, contrast: 0.95, vis: 0.30 },
		};

		/** 映射表：草稿的 0..255 → 当背景用的 0..255。 */
		function buildLut(t) {
			const lut = new Uint8Array(256);
			for (let i = 0; i < 256; i++) {
				const k = t.pivot + (i - t.pivot) * t.contrast;
				const o = UI_BASE + (k - UI_BASE) * t.vis;
				lut[i] = o < 2 ? 2 : o > 250 ? 250 : o;
			}
			return lut;
		}

		/* ── 内部分辨率与帧率 ─────────────────────────────────────────────
		 * 预算按像素数给，再按视口长宽比摊成 iw×ih。CSS 负责放大到铺满。
		 * 两个数字都是**实测出来的**（软件渲染、1600×1000、见 README 的性能表）：
		 * 预算再大就守不住 16.7ms，再小纤维就糊成一片色斑。
		 *
		 * FRAME_SKIP=2 → 画布 30fps，rAF 仍然是 60fps（页面帧率不掉，只是壁纸每两帧
		 * 更新一次）。两个模式的运动时间常数是 48s / 113~167s，30fps 下每次更新
		 * 画面只挪 0.6~1.8px —— 看不出来，但主线程负担直接减半。这是「不砍画质也能
		 * 守住 0 掉帧」的那一步。 */
		const BUDGET = { paper: 78000, moire: 80000, caustics: 118000 };
		/* 每档「每几帧画一次」。焦散的逐像素成本是另外两档的 4 倍（5 支波的
		   切比雪夫递推 + 三通道 1/(|J|+ε)），所以它单独降帧率而不是砍分辨率 ——
		   丝一旦被低分辨率糊掉就没有焦散可言了。它的相位推进速率是 2.6~7.6 px/s
		   （内部像素），15fps 下每帧挪不到 0.4px，看不出差别。 */
		const FRAME_SKIP = { paper: 2, moire: 2, caustics: 6 };

		/* 纸的烘焙/着色参数（都是「当背景」重调出来的，可以对着截图改）：
		 *   blur/passes  烘焙期对高度场做几遍盒模糊 —— 用户要的「纸/纤维加个模糊处理」
		 *                就在这儿做掉，运行时零成本。模糊的是**高度场**不是画面，
		 *                所以纤维的走向和长度还在，只是绒毛不再是一粒粒噪点。
		 *   relief       浮雕增益。草稿 13.5；高度场被低通后梯度变小，这里补回来。
		 *   fine         0.85px 那一层绒毛的权重（草稿 0.95）。它在 354px 的内部分辨率下
		 *                已经低于 1 CSS px，纯属亚像素噪点，压一压能少一半「沙子感」。
		 *                2026-09-19 由 0.72 再降到 0.58：warm-ui 那边删掉了「背景让位」
		 *                柔光罩（那层全屏 backdrop-filter 压在画布上不可靠），它原来的
		 *                工作——削掉正文列后面的高频颗粒——改在这里做。降的是**高频**
		 *                这一项，纤维走向和那道掠光带都还在，所以背景不会因此消失。 */
		const PAPER = { blur: 1, passes: 1, relief: 19, fine: 0.58 };

		function fitBudget(aspect, budget) {
			let iw = Math.round(Math.sqrt(budget * aspect));
			iw = iw < 320 ? 320 : iw > 720 ? 720 : iw;
			let ih = Math.round(iw / aspect);
			ih = ih < 180 ? 180 : ih > 480 ? 480 : ih;
			iw = Math.round(ih * aspect);
			iw = iw < 320 ? 320 : iw > 720 ? 720 : iw;
			return [iw, ih];
		}

		/* ═══════════════════════════════════════════════════════════════════
		 *  模式 A：纸 / 纤维
		 *  取自 _warmtheme_shots/drafts/paper.html（语言 A · 特种纸）。
		 *  烘焙一张各向异性噪声「纸浆」高度场 + 梯度；每帧只算一道极慢掠过、
		 *  形状解析的斜光带，纤维靠高度场沿光方向的浮雕着色被「照出来」。
		 *  没被照到的地方几乎不可见 —— 这正是当背景要的「大面积安静」。
		 * ═══════════════════════════════════════════════════════════════════ */
		function createPaper(iw, ih, tune) {
			const N = iw * ih;
			const cv = document.createElement("canvas");
			cv.width = iw;
			cv.height = ih;
			const ctx = cv.getContext("2d", { alpha: false });
			const img = ctx.createImageData(iw, ih);
			const data = img.data;
			const TAU = Math.PI * 2;
			const lut = buildLut(tune);

			// 整数哈希 + 预计算表：热循环里避开 sin/exp
			const RND = new Uint8Array(65536);
			{
				let s = 991;
				for (let i = 0; i < 65536; i++) {
					s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
					RND[i] = (s >>> 15) & 255;
				}
			}
			const ihash = (x, y, s) =>
				RND[(Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1274126177)) & 65535] *
				0.0039215686;
			const vn = (x, y, s) => {
				const xi = Math.floor(x);
				const yi = Math.floor(y);
				const xf = x - xi;
				const yf = y - yi;
				const u = xf * xf * (3 - 2 * xf);
				const v = yf * yf * (3 - 2 * yf);
				const a = ihash(xi, yi, s);
				const b = ihash(xi + 1, yi, s);
				const c = ihash(xi, yi + 1, s);
				const d = ihash(xi + 1, yi + 1, s);
				const ab = a + (b - a) * u;
				const cd = c + (d - c) * u;
				return ab + (cd - ab) * v;
			};
			const GK = 1200;
			const GMAX = 4.4;
			const GSC = GK / GMAX;
			const GT = new Float32Array(GK + 1);
			for (let i = 0; i <= GK; i++) {
				const z = i / GSC;
				GT[i] = Math.exp(-0.5 * z * z);
			}
			const gs = (z) => {
				const a = z < 0 ? -z : z;
				const i = (a * GSC) | 0;
				return i >= GK ? 0 : GT[i];
			};
			const SK = 2048;
			const SM = SK - 1;
			const SSC = SK / TAU;
			const ST = new Float32Array(SK);
			for (let i = 0; i < SK; i++) ST[i] = Math.sin((i / SK) * TAU);
			const sn = (p) => ST[(p * SSC) & SM];
			const KT = new Float32Array(512);
			for (let k = 0; k < 512; k++) KT[k] = 140 + 108 * (1 - Math.exp(-k / 108));

			// 纤维高度场 + 梯度 + 底色（一次性烘焙）
			const HF = new Float32Array(N);
			const HX = new Float32Array(N);
			const HY = new Float32Array(N);
			const BASE = new Float32Array(N * 3);

			const dirFiber = (x, y, ang, wf, len, sA, sB, patch) => {
				const ca = Math.cos(ang);
				const sa = Math.sin(ang);
				const ux = x * ca + y * sa;
				const uy = -x * sa + y * ca;
				const env = vn(ux / patch + 5.1, 3.3, sA);
				const e = env * env * (3 - 2 * env);
				return e * (vn(uy / wf + 1.7, ux / len, sB) - 0.5);
			};
			const fiberHeight = (x, y) => {
				let h = 0;
				h += 0.11 * dirFiber(x, y, 0.16, 1.15, 34, 7.3, 11.1, 62);
				h += 0.1 * dirFiber(x, y, 1.02, 1.05, 30, 9.7, 13.3, 74);
				h += 0.1 * dirFiber(x, y, 2.55, 1.0, 28, 25.3, 15.9, 68);
				h += 0.15 * dirFiber(x, y, 2.14, 0.85, 18, 15.1, 17.7, 46);
				h += 0.14 * dirFiber(x, y, 0.62, 0.85, 18, 21.3, 19.9, 50);
				h += 0.14 * dirFiber(x, y, 2.72, 0.85, 18, 27.9, 23.1, 54);
				h += PAPER.fine * (vn(x / 0.85, y / 0.85, 67.3) - 0.5);
				h += 0.5 * (vn(x / 1.7, y / 1.7, 71.7) - 0.5);
				h += 0.22 * (vn(x / 3.4, y / 3.4, 74.3) - 0.5);
				h += 0.18 * (vn(x / 6.5, y / 6.5, 77.1) - 0.5);
				return h;
			};

			for (let y = 0, i = 0; y < ih; y++) {
				for (let x = 0; x < iw; x++, i++) {
					HF[i] = fiberHeight(x, y);
					const board = vn(x / 210 + 8.3, y / 210 - 4.7, 61.1) - 0.5;
					const s1 = ihash(x >> 1, y >> 1, 71.9);
					const g0 = (ihash(x, y, 91.3) - 0.5) * 2.0;
					const bo = board * 5.0;
					const q = i * 3;
					BASE[q] = 16 + bo + g0;
					BASE[q + 1] = 17 + bo + g0;
					BASE[q + 2] = 21 + bo * 1.2 + g0;
					// 草稿的 SPECK 只在亮带里出现，简单起见并入底色颗粒
					if (s1 > 0.9975) {
						const sp = (ihash(x, y, 73.1) - 0.5) * 2;
						BASE[q] += sp * 6;
						BASE[q + 1] += sp * 6;
						BASE[q + 2] += sp * 6;
					}
				}
			}
			/* 烘焙期模糊：把高度场低通一下。
			   「纸/纤维 + 个模糊处理」这个诉求在**烘焙时**做掉是免费的 —— 运行时不碰它，
			   同一份模糊过的高度场每帧照样参与浮雕着色，每帧成本一分没涨。
			   PAPER.blur/passes 就是模糊量。半径开大、遍数开多 → 绒面变柔和，
			   但超过 ~2 遍半径 2 就只剩迷彩斑块，纤维结构会被抹掉（试过，不行）。 */
			const blurH = (src, dst, w, h, r) => {
				const inv = 1 / (2 * r + 1);
				for (let y = 0; y < h; y++) {
					const row = y * w;
					let sum = 0;
					for (let k = -r; k <= r; k++) sum += src[row + (k < 0 ? 0 : k >= w ? w - 1 : k)];
					for (let x = 0; x < w; x++) {
						dst[row + x] = sum * inv;
						const out = x - r;
						const inn = x + r + 1;
						sum += src[row + (inn >= w ? w - 1 : inn)] - src[row + (out < 0 ? 0 : out)];
					}
				}
			};
			const blurV = (src, dst, w, h, r) => {
				const inv = 1 / (2 * r + 1);
				for (let x = 0; x < w; x++) {
					let sum = 0;
					for (let k = -r; k <= r; k++) sum += src[(k < 0 ? 0 : k >= h ? h - 1 : k) * w + x];
					for (let y = 0; y < h; y++) {
						dst[y * w + x] = sum * inv;
						const out = y - r;
						const inn = y + r + 1;
						sum += src[(inn >= h ? h - 1 : inn) * w + x] - src[(out < 0 ? 0 : out) * w + x];
					}
				}
			};
			const tmpF = new Float32Array(N);
			const HFB = new Float32Array(N);
			HFB.set(HF);
			for (let pass = 0; pass < PAPER.passes; pass++) {
				blurH(HFB, tmpF, iw, ih, PAPER.blur);
				blurV(tmpF, HFB, iw, ih, PAPER.blur);
			}

			for (let y = 0, i = 0; y < ih; y++) {
				for (let x = 0; x < iw; x++, i++) {
					const xm = x > 0 ? i - 1 : i;
					const xp = x < iw - 1 ? i + 1 : i;
					const ym = y > 0 ? i - iw : i;
					const yp = y < ih - 1 ? i + iw : i;
					HX[i] = (HFB[xp] - HFB[xm]) * 0.5;
					HY[i] = (HFB[yp] - HFB[ym]) * 0.5;
				}
			}

			// 四边渐隐：每帧只随尺寸变，预先算好
			const FXV = new Float32Array(iw);
			const FYV = new Float32Array(ih);
			for (let x = 0; x < iw; x++) {
				const v = (x < iw - x ? x : iw - x) / 88;
				const a = v > 1 ? 1 : v;
				FXV[x] = 0.6 + 0.4 * (a * a * (3 - 2 * a));
			}
			for (let y = 0; y < ih; y++) {
				const v = (y < ih - y ? y : ih - y) / 88;
				const a = v > 1 ? 1 : v;
				FYV[y] = 0.6 + 0.4 * (a * a * (3 - 2 * a));
			}

			const RELIEF = PAPER.relief;

			// 光带系数
			const iA = 1 / 0.042;
			const iAb = 1 / 0.068;
			const iAc = 1 / 0.105;
			const iB = 1 / 0.062;
			const iP1 = 1 / 0.3;
			const iP2 = 1 / 0.34;

			const work = [];
			function render(t) {
				const th = -0.62 + 0.34 * Math.sin(t * 0.0083 + 0.6);
				const ca = Math.cos(th);
				const sa = Math.sin(th);
				const pos = -0.3 + 0.26 * Math.sin(t * 0.132) + 0.06 * Math.sin(t * 0.055 + 1.2);
				const nx = -sa;
				const ny = ca;
				const th2 = 0.95 + 0.26 * Math.sin(t * 0.0061 - 1.4);
				const ca2 = Math.cos(th2);
				const sa2 = Math.sin(th2);
				const pos2 = 0.36 + 0.24 * Math.sin(t * 0.086 + 2.6);
				const mm1 = t * 0.09;
				const mm2 = t * 0.06;
				const mm3 = t * 0.05;

				const t0 = performance.now();
				for (let y = 0, i = 0; y < ih; y++) {
					const py = y / ih - 0.5;
					const q1y = py * ca;
					const q2y = py * sa;
					const q3y = 0.05 * ca2 + py * ca2;
					const q4y = 0.05 * sa2 + py * sa2;
					const fy = FYV[y];
					for (let x = 0; x < iw; x++, i++) {
						const px = x / iw - 0.5;
						const q1 = -(px - 0.02) * sa + q1y;
						const q2 = (px - 0.02) * ca + q2y;
						const d1 = q1 - pos;
						let lit = gs(d1 * iA) + 0.3 * gs((d1 + 0.135) * iAb) + 0.16 * gs((d1 - 0.2) * iAc);
						lit *= gs(q2 * iP1) * (0.72 + 0.28 * (0.5 + 0.5 * sn(q2 * 7.1 + mm1) * sn(q2 * 2.7 - mm2)));

						const q3 = -(px + 0.04) * sa2 + q3y;
						const q4 = (px + 0.04) * ca2 + q4y;
						const d2 = q3 - pos2;
						let lit2 = 0.42 * gs(d2 * iB);
						lit2 *= gs(q4 * iP2) * (0.74 + 0.26 * sn(q4 * 4.4 - mm3));

						if (lit > 1.25) lit = 1.25;
						if (lit2 > 1.0) lit2 = 1.0;

						const lr = lit * 244 + lit2 * 86;
						const lg = lit * 196 + lit2 * 168;
						const lb = lit * 142 + lit2 * 196;

						const q = i * 3;
						let r = BASE[q];
						let g = BASE[q + 1];
						let b = BASE[q + 2];

						const d1s = lit > 1 ? 1 : lit;
						const s1 = d1s * d1s * (3 - 2 * d1s);
						const d2s = lit2 > 1 ? 1 : lit2;
						const s2 = d2s * d2s * (3 - 2 * d2s);
						r += s1 * 116 + s2 * 44;
						g += s1 * 91 + s2 * 66;
						b += s1 * 65 + s2 * 76;
						const L = lit + lit2 * 0.85;
						const dif = L > 1 ? 1 : L;

						let e = (HX[i] * nx + HY[i] * ny) * RELIEF;
						if (e > 1) e = 1;
						else if (e < -1) e = -1;
						const gsrc = dif * dif * (3 - 2 * dif);
						const gain = 0.026 + 0.974 * gsrc;
						r += e * lr * gain;
						g += e * lg * gain;
						b += e * lb * gain;

						const al = HFB[i] * 0.5 * (0.1 + 0.9 * gsrc);
						const k = al * 0.055;
						r += k * lr;
						g += k * lg;
						b += k * lb;

						const ss = dif * dif * 0.038;
						r += ss * 54;
						g += ss * 43;
						b += ss * 32;

						const f = FXV[x] * fy;
						r *= f;
						g *= f;
						b *= f;

						// —— 到这儿为止与草稿一致；下面这步是「当背景」的压缩 ——
						const p = i << 2;
						data[p] = lut[r < 0 ? 0 : r > 255 ? 255 : r | 0];
						data[p + 1] = lut[g < 0 ? 0 : g > 255 ? 255 : g | 0];
						data[p + 2] = lut[b < 0 ? 0 : b > 255 ? 255 : b | 0];
						data[p + 3] = 255;
					}
				}
				ctx.putImageData(img, 0, 0);
				const dt = performance.now() - t0;
				work.push(dt);
				if (work.length > 600) work.shift();
				return dt;
			}

			return { canvas: cv, render, work, size: [iw, ih] };
		}
		/* ═══════════════════════════════════════════════════════════════════
		 *  模式 B：摩尔纹
		 *  取自 _warmtheme_shots/drafts/moire.html（语言 B · 参数化几何），
		 *  按 2026-09-13 12:30 那一版重接（圆心推出画面外、恢复「柔和明暗场」）。
		 *  两组同心环的相位差有两个尺度：细拍频（真摩尔纹）+ 1/48 谐波（几百 px 的
		 *  柔和明暗场）；细环线只在大尺度明暗场亮的地方长出来 —— 靠尺度拉开大结构
		 *  和细线，不是靠对比。
		 *  动态：圆心李萨如漂移 113~167s、节距呼吸 97/127s、冷暖分界 0.0002rad/s。
		 *
		 *  与原稿的差异（都是为了当背景）：
		 *   1. 内部分辨率压到 ~1/20 面积，CSS 放大 —— 细环线被放大成柔和的线，
		 *      不会跟正文笔画打架（也就是要求的「低分辨率 canvas + CSS 放大」路径）。
		 *   2. 原稿逐帧换偏移的随机颗粒删掉（每 55ms 换一次 = 全屏闪烁），
		 *      改成烘焙进底色的静态颗粒。
		 *   3. 底色 + 干涉光场在同一个逐像素循环里合成并过 LUT（不是 lighter 叠上去），
		 *      所以「当背景」的压缩只做一次，不会算重；细环线再用 lighter 叠在最上面。
		 * ═══════════════════════════════════════════════════════════════════ */
		function createMoire(iw, ih, tune) {
			const W = iw;
			const H = ih;
			const cv = document.createElement("canvas");
			cv.width = W;
			cv.height = H;
			const ctx = cv.getContext("2d", { alpha: false });
			const img = ctx.createImageData(W, H);
			const data = img.data;
			const TAU = Math.PI * 2;
			const lut = buildLut(tune);

			const LUTN = 2048;
			const LUTM = LUTN - 1;
			const COS = new Float32Array(LUTN);
			for (let i = 0; i < LUTN; i++) COS[i] = Math.cos((i / LUTN) * TAU);

			const CFG = {
				pA0: 19.0,
				pB0: 21.5,
				ell: 0.038,
				coarseH: 48.0, // 柔和明暗场 = 同一相位差的 1/48 谐波 → 全画 3~4 个大起伏
				glowBase: 0.18, // 暗处是暖灰而不是死黑
				glowAmp: 0.52,
				alphaRingA: 0.28,
				alphaRingB: 0.24,
				quietX: 0.985,
				quietY: 0.015,
			};

			const K = Math.sqrt((W * H) / (1400 * 900));
			const REF = Math.hypot(W, H) * 0.5;
			const qx = W * CFG.quietX;
			const qy = H * CFG.quietY;
			const qa2 = Math.pow(0.13 * REF, 2);
			const qb2 = Math.pow(0.56 * REF, 2);
			const invCH = 1 / CFG.coarseH;
			const GBc = CFG.glowBase;

			/* 背景 · 一次性烘焙（大尺度色染 + 暗角 + 静态颗粒），存成 Uint8 三通道 */
			const bgR = new Uint8Array(W * H);
			const bgG = new Uint8Array(W * H);
			const bgB = new Uint8Array(W * H);
			{
				const bg = document.createElement("canvas");
				bg.width = W;
				bg.height = H;
				const bgx = bg.getContext("2d", { willReadFrequently: true });
				bgx.fillStyle = "#0e0f12";
				bgx.fillRect(0, 0, W, H);
				// 大尺度色染：暖在左下、冷在右上；只做底色，不做中心亮斑
				let g = bgx.createLinearGradient(0, H, W, 0);
				g.addColorStop(0.0, "rgba(98,58,18,0.20)");
				g.addColorStop(0.48, "rgba(30,26,26,0.04)");
				g.addColorStop(1.0, "rgba(26,54,90,0.22)");
				bgx.fillStyle = g;
				bgx.fillRect(0, 0, W, H);
				// 暗角：只压四边
				g = bgx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.3, W * 0.5, H * 0.5, Math.max(W, H) * 0.86);
				g.addColorStop(0, "rgba(0,0,0,0)");
				g.addColorStop(1, "rgba(0,0,0,0.58)");
				bgx.fillStyle = g;
				bgx.fillRect(0, 0, W, H);
				const id = bgx.getImageData(0, 0, W, H);
				const d = id.data;
				for (let i = 0, p = 0; i < d.length; i += 4, p++) {
					const n = (Math.random() - 0.5) * 4.6;
					bgR[p] = d[i] + n;
					bgG[p] = d[i + 1] + n;
					bgB[p] = d[i + 2] + n;
				}
			}

			/* 细线透明度分级：按级批量描边，几百段只用二十几次 stroke */
			const LV = 26;
			const ASC = 74;
			const mkStyles = (rgb) => {
				const a = [];
				for (let i = 0; i < LV; i++) a.push("rgba(" + rgb + "," + ((i + 0.5) / ASC).toFixed(3) + ")");
				return a;
			};
			const ST_A = mkStyles("128,174,208");
			const ST_B = mkStyles("240,178,102");
			const SYS_A = { x: 0, y: 0, p: 17, rMax: 0, ell: 1.038, rot: 0, ld: 0.01, la: 0.3, st: ST_A };
			const SYS_B = { x: 0, y: 0, p: 19, rMax: 0, ell: 1.0, rot: 0, ld: 0.009, la: 0.26, st: ST_B };

			let Ax = 0;
			let Ay = 0;
			let Bx = 0;
			let By = 0;
			let pA = 19;
			let pB = 21.5;
			let cax = 1;
			let cay = 0;
			let cwPh = 0;

			/* 两组系统的参数（全部极慢）。圆心推到画面外，只留弧不见心 ——
			   这样中段不再是「两眼之间的空地」。 */
			function setup(t) {
				Ax = -0.1 * W + Math.cos(t * (TAU / 137)) * 0.02 * REF;
				Ay = -0.16 * H + Math.sin(t * (TAU / 113) + 0.7) * 0.018 * REF;
				Bx = 1.1 * W + Math.cos(t * (TAU / 167) + 2.1) * 0.022 * REF;
				By = 1.16 * H + Math.sin(t * (TAU / 149) + 1.3) * 0.02 * REF;
				pA = CFG.pA0 * K * (1 + 0.0135 * Math.sin(t * (TAU / 127)));
				pB = CFG.pB0 * K * (1 + 0.0115 * Math.sin(t * (TAU / 97) + 1.15));
				const cwA = -0.62 + t * 0.0002;
				cax = Math.cos(cwA);
				cay = Math.sin(cwA);
				cwPh = 0.17 * Math.sin(t * (TAU / 211));
				SYS_A.x = Ax;
				SYS_A.y = Ay;
				SYS_A.p = pA;
				SYS_A.rot = -0.22 + t * 0.00026;
				SYS_B.x = Bx;
				SYS_B.y = By;
				SYS_B.p = pB;
				SYS_B.rot = 0.34 + t * 0.00019;
				// 每组只需画到「够覆盖画面最远角」的半径
				SYS_A.rMax = Math.hypot(Math.max(-Ax, W - Ax), Math.max(-Ay, H - Ay)) + 3 * pA;
				SYS_B.rMax = Math.hypot(Math.max(-Bx, W - Bx), Math.max(-By, H - By)) + 3 * pB;
			}

			/* 两组环的相位差（圈数）—— 细拍频与大尺度明暗场都从它来 */
			const phAt = (px, py) => {
				const dax = px - Ax;
				const day = py - Ay;
				const dbx = px - Bx;
				const dby = py - By;
				return Math.sqrt(dax * dax + day * day) / pA - Math.sqrt(dbx * dbx + dby * dby) / pB;
			};
			/* 必须用「未取模」的相位差 —— 先取模再乘 1/CH 等于什么都没做（草稿里踩过） */
			const beatAt = (px, py) => 0.5 + 0.5 * COS[(phAt(px, py) * LUTN) & LUTM];
			const softAt = (px, py) => 0.5 + 0.5 * COS[(phAt(px, py) * invCH * LUTN) & LUTM];
			const envAt = (px, py) => {
				const dx = px - qx;
				const dy = py - qy;
				const d2 = dx * dx + dy * dy;
				let u = (d2 - qa2) / (qb2 - qa2);
				u = u < 0 ? 0 : u > 1 ? 1 : u;
				return u * u * (3 - 2 * u);
			};
			/* 细线的「存在度」：由大尺度明暗场决定 —— 柔和亮区里长出一整片细线，
			   暗区里几乎不长线。 */
			const presAt = (px, py) => {
				const e = softAt(px, py) * envAt(px, py);
				let u = (e - 0.66) / (0.97 - 0.66);
				u = u < 0 ? 0 : u > 1 ? 1 : u;
				return u * u * (3 - 2 * u);
			};

			/* 干涉光场 + 底色：一次过 LUT 写进主画布 */
			function drawField() {
				const iA = 1 / pA;
				const iB = 1 / pB;
				const vis0 = 40 * K;
				const vis1 = 150 * K; // 拍频太密的地方干涉本来就看不见（对比度衰减）
				const qa = qa2;
				const qb = qb2;
				const qxx = qx;
				const qyy = qy;
				const halfW = W * 0.5;
				const halfH = H * 0.5;
				const ramp = 0.55 / REF;
				const cwp = 0.5 + cwPh;
				const amp = CFG.glowAmp;
				let i = 0;
				for (let y = 0; y < H; y++) {
					const py = y + 0.5;
					const dyA = py - Ay;
					const dyB = py - By;
					const dyQ = py - qyy;
					const cwY = (py - halfH) * cay;
					for (let x = 0; x < W; x++, i++) {
						const px = x + 0.5;
						const dxA = px - Ax;
						const dxB = px - Bx;
						const rA = Math.sqrt(dxA * dxA + dyA * dyA);
						const rB = Math.sqrt(dxB * dxB + dyB * dyB);
						const irA = 1 / (rA + 1e-6);
						const irB = 1 / (rB + 1e-6);
						// 局部拍频间距 = 1/|∇(φA-φB)|
						const gx = dxA * irA * iA - dxB * irB * iB;
						const gy = dyA * irA * iA - dyB * irB * iB;
						const sp = 1 / Math.sqrt(gx * gx + gy * gy);
						let v = (sp - vis0) / (vis1 - vis0);
						v = v < 0 ? 0 : v > 1 ? 1 : v;
						const vis = v * v * (3 - 2 * v);
						// 安静角（只压一部分，不留死黑）
						const dqx = px - qxx;
						let u = (dqx * dqx + dyQ * dyQ - qa) / (qb - qa);
						u = u < 0 ? 0 : u > 1 ? 1 : u;
						const env = 0.46 + 0.54 * (u * u * (3 - 2 * u));
						// 同一个相位差，两个尺度
						const phu = rA * iA - rB * iB;
						const Ef = 0.5 + 0.5 * COS[(phu * LUTN) & LUTM]; // 细拍频 = 真摩尔纹
						const Ec = 0.5 + 0.5 * COS[(phu * invCH * LUTN) & LUTM]; // 几百 px 的柔和明暗
						const soft = GBc + (1 - GBc) * Ec;
						const tex = COS[(((rA * iA) % 1) * LUTN) & LUTM] * 0.5 + 0.5;
						const gi = (soft * env + vis * Ef * 0.07) * amp + tex * 0.016 * env;
						// 暖为主、冷为辅的冷暖分界（缓慢旋转的斜线）
						let cw = cwp + ((px - halfW) * cax + cwY) * ramp;
						cw = cw < 0 ? 0 : cw > 1 ? 1 : cw;
						const w = 0.38 + 0.62 * cw;
						const p = i << 2;
						const r = bgR[i] + (84 + 154 * w) * gi;
						const g = bgG[i] + (116 + 58 * w) * gi;
						const b = bgB[i] + (152 - 58 * w) * gi;
						data[p] = lut[r < 0 ? 0 : r > 255 ? 255 : r | 0];
						data[p + 1] = lut[g < 0 ? 0 : g > 255 ? 255 : g | 0];
						data[p + 2] = lut[b < 0 ? 0 : b > 255 ? 255 : b | 0];
						data[p + 3] = 255;
					}
				}
			}

			/* 画面矩形相对某个圆心张开的角度范围（圆心在画面外时 < 180°）——
			   只采这一段圆弧，不必为每条环采样整圈 */
			function angWindow(cx, cy) {
				const base = Math.atan2(H * 0.5 - cy, W * 0.5 - cx);
				let lo = 1e9;
				let hi = -1e9;
				for (let k = 0; k < 4; k++) {
					const px = k & 1 ? W : 0;
					const py = k & 2 ? H : 0;
					let d = Math.atan2(py - cy, px - cx) - base;
					while (d > Math.PI) d -= TAU;
					while (d < -Math.PI) d += TAU;
					if (d < lo) lo = d;
					if (d > hi) hi = d;
				}
				return [base + lo - 0.12, base + hi + 0.12];
			}

			/* 一组同心环：只在柔和明暗场的亮处长出来（暗处留白 → 安静区） */
			function drawRings(S) {
				const ellx = S.ell;
				const rot = S.rot;
				const cr = Math.cos(rot);
				const sr = Math.sin(rot);
				const nRing = Math.floor(S.rMax / (S.p * ellx));
				const lim = S.rMax - 5 * S.p;
				const ld = S.ld;
				const la = S.la;
				const st = S.st;
				const buckets = new Array(LV);
				for (let i = 0; i < LV; i++) buckets[i] = null;
				const WIN = angWindow(S.x, S.y);
				const w0 = WIN[0];
				const wSpan = WIN[1] - WIN[0];
				for (let i = 1; i <= nRing; i++) {
					const r = i * S.p;
					let f = (r - lim) / (5 * S.p);
					f = f < 0 ? 0 : f > 1 ? 1 : f;
					const fade = 1 - f * f * (3 - 2 * f);
					if (fade < 0.05) continue;
					const M = Math.max(8, Math.min(100, Math.round((r * wSpan) / 40)));
					let cur = -1;
					let a0 = 0;
					for (let j = 0; j <= M; j++) {
						// th 必须在外层作用域：下面换级时要拿它当这一段的结束角
						const th = w0 + (wSpan * j) / M;
						let lv;
						if (j === M) lv = -2;
						else {
							const ct = Math.cos(th);
							const sth = Math.sin(th);
							const ex = r * ellx * ct;
							const ey = r * sth;
							const px = S.x + ex * cr - ey * sr;
							const py = S.y + ex * sr + ey * cr;
							const a = (ld + la * presAt(px, py) * (0.45 + 0.55 * beatAt(px, py))) * fade;
							lv = a < 0.02 ? -1 : Math.min(LV - 1, (a * ASC) | 0);
						}
						if (lv !== cur) {
							if (cur >= 0) {
								let b = buckets[cur];
								if (!b) b = buckets[cur] = [];
								b.push(i, a0, th);
							}
							cur = lv;
							a0 = th;
						}
					}
				}
				for (let lv = 0; lv < LV; lv++) {
					const b = buckets[lv];
					if (!b || !b.length) continue;
					ctx.strokeStyle = st[lv];
					ctx.lineWidth = 1;
					ctx.beginPath();
					for (let k = 0; k < b.length; k += 3) {
						const i = b[k];
						const s0 = b[k + 1];
						const s1 = b[k + 2];
						const r = i * S.p;
						const rx = r * ellx;
						const cs = Math.cos(s0);
						const ss = Math.sin(s0);
						ctx.moveTo(S.x + rx * cs * cr - r * ss * sr, S.y + rx * cs * sr + r * ss * cr);
						ctx.ellipse(S.x, S.y, rx, r, rot, s0, s1);
					}
					ctx.stroke();
				}
			}

			const work = [];
			function render(t) {
				const t0 = performance.now();
				setup(t);
				drawField();
				ctx.putImageData(img, 0, 0);
				ctx.globalCompositeOperation = "lighter";
				drawRings(SYS_A);
				drawRings(SYS_B);
				ctx.globalCompositeOperation = "source-over";
				const dt = performance.now() - t0;
				work.push(dt);
				if (work.length > 600) work.shift();
				return dt;
			}

			return { canvas: cv, render, work, size: [W, H] };
		}

		/* ═══════════════════════════════════════════════════════════════════
		 *  模式 C：焦散
		 *  取自 _warmtheme_shots/drafts/caustics.html
		 *  （**基准版本 mtime 2026-09-13 13:15:14**，即 v3「平顶平台」那一版）。
		 *  不画线，算光线汇聚：波场 h 的折射映射 X = x − c·∇h，其雅可比
		 *  J = 1 − env·HS + env²·HP 在 J→0 处取零 —— 那就是焦散线；亮度取
		 *  1/(|J|+ε) − thr。θ 的 sin/cos 用切比雪夫递推逐像素推进。
		 *  色差是白送的：三个通道同一组 HS/HP、只换 (1+δ) 因子。
		 *
		 *  这一档和另外两档的**调参方向相反**，别压：
		 *    纸/摩尔纹是「整幅都有东西」，所以要压暗、收对比；
		 *    焦散天生就是「大面积极暗 + 少数地方亮着细丝」，它已经安静了。
		 *    压过头丝就没了（那正是它上一轮失败的样子）。
		 *    所以焦散的映射用**低支点 + 高对比保持**（pivot 16 / contrast 0.95）：
		 *    丝以外的地方落到界面底色上（不会把黑场抬起来），丝的峰值原样留着，
		 *    整体亮度只由 vis 一家控制。详见 TUNE.caustics 的注释。
		 *
		 *  与原稿的差异：
		 *   1. 内部分辨率按 BUDGET 走（原稿固定 700×450），CSS 放大铺满 ——
		 *      低分辨率 + 放大，不是 blur。
		 *   2. 波长按 W/700 缩放，ω 仍用 700 基准算 → 画面上丝的密度不变、
		 *      相位推进速率（= 丝的移动速度）也基本不变。
		 *   3. 末尾过一遍「当背景」的 LUT（和另外两档同一套两步映射）。
		 *   4. 原稿的 soft bloom（1/4 分辨率、取上一帧）保留 —— 那是柔光池，不是模糊。
		 * ═══════════════════════════════════════════════════════════════════ */
		function createCaustics(iw, ih, tune) {
			const W = iw;
			const H = ih;
			const N = W * H;
			const cv = document.createElement("canvas");
			cv.width = W;
			cv.height = H;
			const ctx = cv.getContext("2d", { alpha: false });
			const img = ctx.createImageData(W, H);
			const data = img.data;
			const TAU = Math.PI * 2;
			const lut = buildLut(tune);

			/* ── 0. 波场（lam 单位是 700×450 基准下的 px） ── */
			const RAW = [
				[262, 0.3, 1.34, 7.6],
				[166, 1.35, 1.2, 6.0],
				[112, 2.5, 1.02, 4.6],
				[78, -0.6, 0.82, 3.4],
				[54, -1.4, 0.62, 2.6],
			];
			const NW = RAW.length;
			const KS = W / 700; // 空间尺度：保持「画面里有多少条丝」不变
			const kx = new Float64Array(NW);
			const ky = new Float64Array(NW);
			const om = new Float64Array(NW);
			const ca2 = new Float64Array(NW);
			const sa2 = new Float64Array(NW);
			const casa = new Float64Array(NW);
			const tt_ = new Float64Array(NW);
			const sk = new Float64Array(NW);
			const ck = new Float64Array(NW);
			const ph0 = new Float64Array(NW);
			for (let i = 0; i < NW; i++) {
				const lamRef = RAW[i][0];
				const ang = RAW[i][1];
				const k = TAU / (lamRef * KS); // 内部像素的空间频率
				const kRef = TAU / lamRef; // 700 基准 → 算 ω，让相位推进速率不随分辨率变
				const ca = Math.cos(ang);
				const sa = Math.sin(ang);
				kx[i] = k * ca;
				ky[i] = k * sa;
				om[i] = kRef * RAW[i][3];
				ca2[i] = ca * ca;
				sa2[i] = sa * sa;
				casa[i] = ca * sa;
				tt_[i] = RAW[i][2];
				sk[i] = Math.sin(kx[i]);
				ck[i] = Math.cos(kx[i]);
				ph0[i] = i * 1.7;
			}

			/* 预乘：H1/H2/H3 里 tᵢ·(cos²/sin²/cos·sin)ᵢ 与时间无关，
			   创建时算一次就地写进 CX/CY/CZ，内循环每像素少 15 次乘法。 */
			const CX = new Float64Array(NW);
			const CY = new Float64Array(NW);
			const CZ = new Float64Array(NW);
			for (let i = 0; i < NW; i++) {
				CX[i] = RAW[i][2] * ca2[i];
				CY[i] = RAW[i][2] * sa2[i];
				CZ[i] = RAW[i][2] * casa[i];
			}

			/* J 对折射强度是二次的：J(δ) = 1 − (1+δ)·HS + (1+δ)²·HP */
			const D_R = -0.02;
			const D_B = 0.026;
			const F_R = 1 + D_R;
			const F_B = 1 + D_B;
			const F2_R = F_R * F_R;
			const F2_B = F_B * F_B;

			const P = {
				eps: 0.042, // 1/(|J|+ε) 的正则化 → 决定亮线宽度（越小越细锐）
				thr: 6.0, // 减掉阈值 → 线之间真正黑、线本身更窄
				gain: 11.0,
				bloom: 0.72,
				glow: 40, // 光池的软光（大尺度、低对比）
				ambR: 2.8,
				ambG: 3.6,
				ambB: 6.4,
			};

			/* ── 1. 大尺度包络：一条斜带上的三个「光池」 ── */
			const BAND = -0.52;
			const BNX = Math.cos(BAND);
			const BNY = Math.sin(BAND);
			const ASPAN = W * Math.abs(BNX) + H * Math.abs(BNY);
			const BSPAN = W * Math.abs(BNY) + H * Math.abs(BNX);
			const BL = 1024;
			const BLUT = new Float32Array(BL);
			const VLUT = new Float32Array(BL);
			/* sqrt(env) = sqrt(BLUT·VLUT) = SLUT·SVLUT —— 省掉每像素一次 Math.sqrt */
			const SLUT = new Float32Array(BL);
			const SVLUT = new Float32Array(BL);
			const BOFF = -0.55;
			const BSCL = 2.1;
			const VOFF = -0.35;
			const VSCL = 1.7;

			const plateau = (d, wi, wo) => {
				const a = d < 0 ? -d : d;
				if (a <= wi) return 1;
				if (a >= wo) return 0;
				const u = (a - wi) / (wo - wi);
				return 1 - u * u * (3 - 2 * u);
			};

			function buildEnv(t) {
				const tt = TAU * t;
				/* ★ v3 的关键：用**平顶平台**代替高斯凸包 —— 高斯让 kf 在池内一直在变，
				   于是 J=0 的等值线还没长出去就绕回来了（「闭合小圈」的根因）。
				   平顶让池芯的折返强度近似常数，等值线才能一路长出去、穿过池子连成网。 */
				const c1 = 0.095 + 0.022 * Math.sin(tt / 67 + 0.7);
				const c2 = 0.38 + 0.026 * Math.sin(tt / 89 + 2.6);
				const c3 = 0.685 + 0.02 * Math.sin(tt / 79 + 1.4);
				const w1 = 0.076 + 0.012 * Math.sin(tt / 131 + 2.1);
				const w2 = 0.107 + 0.016 * Math.sin(tt / 113 + 0.3);
				const w3 = 0.07 + 0.011 * Math.sin(tt / 149 + 2.9);
				const g1 = 0.7 + 0.08 * Math.sin(tt / 97 + 1.9);
				const g2 = 0.84 + 0.07 * Math.sin(tt / 151 + 0.4);
				const g3 = 1.0 + 0.05 * Math.sin(tt / 109 + 2.2);
				const floor = 0.018;
				for (let i = 0; i < BL; i++) {
					const s = BOFF + (BSCL * i) / (BL - 1);
					let v = floor + g1 * plateau(s - c1, w1, w1 * 2.9) + g2 * plateau(s - c2, w2, w2 * 2.7) + g3 * plateau(s - c3, w3, w3 * 2.6);
					BLUT[i] = v > 1.06 ? 1.06 : v;
					SLUT[i] = Math.sqrt(BLUT[i]);
				}
				/* 沿带方向：周期长、幅度浅（池内近乎平坦）→ 丝才有地方长出去 */
				for (let i = 0; i < BL; i++) {
					const s = VOFF + (VSCL * i) / (BL - 1);
					const u = 0.5 + 0.5 * Math.sin(s * 3.1 + tt / 61 + 1.4);
					const v = 0.5 + 0.5 * Math.sin(s * 5.2 - tt / 83 + 0.6);
					VLUT[i] = 0.72 + 0.28 * (0.45 + 0.55 * u) * (0.6 + 0.4 * v);
					SVLUT[i] = Math.sqrt(VLUT[i]);
				}
			}

			/* ── 柔光缓冲（1/4 分辨率，取上一帧） ── */
			const BW = W >> 2;
			const BH = H >> 2;
			const bloomA = new Float32Array(BW * BH * 3);
			const bloomS = new Float32Array(BW * BH * 3);
			const bloomT = new Float32Array(BW * BH * 3);
			const BTH = 22;
			function blurBloom() {
				for (let y = 0; y < BH; y++) {
					const r0 = y * BW;
					for (let x = 0; x < BW; x++) {
						const i = (r0 + x) * 3;
						const a = (r0 + (x > 0 ? x - 1 : 0)) * 3;
						const b = (r0 + (x < BW - 1 ? x + 1 : BW - 1)) * 3;
						bloomT[i] = bloomS[a] + 2 * bloomS[i] + bloomS[b];
						bloomT[i + 1] = bloomS[a + 1] + 2 * bloomS[i + 1] + bloomS[b + 1];
						bloomT[i + 2] = bloomS[a + 2] + 2 * bloomS[i + 2] + bloomS[b + 2];
					}
				}
				for (let y = 0; y < BH; y++) {
					const y0 = y > 0 ? y - 1 : 0;
					const y1 = y < BH - 1 ? y + 1 : BH - 1;
					for (let x = 0; x < BW; x++) {
						const i = (y * BW + x) * 3;
						const a = (y0 * BW + x) * 3;
						const b = (y1 * BW + x) * 3;
						bloomA[i] = (bloomT[a] + 2 * bloomT[i] + bloomT[b]) * 0.0625;
						bloomA[i + 1] = (bloomT[a + 1] + 2 * bloomT[i + 1] + bloomT[b + 1]) * 0.0625;
						bloomA[i + 2] = (bloomT[a + 2] + 2 * bloomT[i + 2] + bloomT[b + 2]) * 0.0625;
					}
				}
			}

			/* ── 暗角 / 颗粒（高频 → 低对比） ── */
			const VIG = new Float32Array(N);
			const GN = new Float32Array(N);
			{
				let s = 90210117;
				const rnd = () => {
					s = (s * 1664525 + 1013904223) >>> 0;
					return s / 4294967296;
				};
				const cx = W * 0.44;
				const cy = H * 0.52;
				const mR = Math.sqrt(cx * cx + cy * cy);
				for (let y = 0, o = 0; y < H; y++) {
					for (let x = 0; x < W; x++, o++) {
						const dx = (x - cx) / mR;
						const dy = (y - cy) / mR;
						const r2 = dx * dx + dy * dy;
						VIG[o] = 1 - 0.3 * r2 * (0.55 + 0.45 * r2);
						GN[o] = (rnd() + rnd() + rnd() - 1.5) * 1.35;
					}
				}
			}

			/* ── 主循环 ── */
			const S0 = new Float64Array(NW);
			const C0 = new Float64Array(NW);
			const work = [];

			function draw(t) {
				const tt = TAU * t;
				buildEnv(t);
				for (let i = 0; i < NW; i++) ph0[i] = i * 1.7 + om[i] * t;

				const eps = P.eps;
				const thr = P.thr;
				const gain = P.gain;
				const bloomK = P.bloom;
				const aR = P.ambR;
				const aG = P.ambG;
				const aB = P.ambB;
				const kf0 = 2.5;
				const bAscl = (BL - 1) / BSCL;
				const bAoff = -BOFF * bAscl;
				const bBscl = (BL - 1) / VSCL;
				const bBoff = -VOFF * bBscl;
				const aStep = (bAscl * BNX) / ASPAN;
				const aInit = bAoff;
				const bStep = (bBscl * -BNY) / BSPAN;
				const bInit = bBoff;

				let o = 0;
				for (let y = 0; y < H; y++) {
					for (let i = 0; i < NW; i++) {
						const th = ky[i] * y + ph0[i];
						S0[i] = Math.sin(th);
						C0[i] = Math.cos(th);
					}
					let s1 = S0[0];
					let c1 = C0[0];
					let s2 = S0[1];
					let c2 = C0[1];
					let s3 = S0[2];
					let c3 = C0[2];
					let s4 = S0[3];
					let c4 = C0[3];
					let s5 = S0[4];
					let c5 = C0[4];
					const k1 = sk[0];
					const m1 = ck[0];
					const k2 = sk[1];
					const m2 = ck[1];
					const k3 = sk[2];
					const m3 = ck[2];
					const k4 = sk[3];
					const m4 = ck[3];
					const k5 = sk[4];
					const m5 = ck[4];
					const X1 = CX[0];
					const X2 = CX[1];
					const X3 = CX[2];
					const X4 = CX[3];
					const X5 = CX[4];
					const Y1 = CY[0];
					const Y2 = CY[1];
					const Y3 = CY[2];
					const Y4 = CY[3];
					const Y5 = CY[4];
					const Z1 = CZ[0];
					const Z2 = CZ[1];
					const Z3 = CZ[2];
					const Z4 = CZ[3];
					const Z5 = CZ[4];

					let iAf = aInit + y * BNY * aStep;
					let iBf = bInit + y * BNX * bStep;

					for (let x = 0; x < W; x++, o++) {
						const H1 = -(X1 * s1 + X2 * s2 + X3 * s3 + X4 * s4 + X5 * s5);
						const H2 = -(Y1 * s1 + Y2 * s2 + Y3 * s3 + Y4 * s4 + Y5 * s5);
						const H3 = -(Z1 * s1 + Z2 * s2 + Z3 * s3 + Z4 * s4 + Z5 * s5);

						let ns = s1 * m1 + c1 * k1;
						c1 = c1 * m1 - s1 * k1;
						s1 = ns;
						ns = s2 * m2 + c2 * k2;
						c2 = c2 * m2 - s2 * k2;
						s2 = ns;
						ns = s3 * m3 + c3 * k3;
						c3 = c3 * m3 - s3 * k3;
						s3 = ns;
						ns = s4 * m4 + c4 * k4;
						c4 = c4 * m4 - s4 * k4;
						s4 = ns;
						ns = s5 * m5 + c5 * k5;
						c5 = c5 * m5 - s5 * k5;
						s5 = ns;

						let jA = iAf | 0;
						if (jA < 0) jA = 0;
						else if (jA > BL - 1) jA = BL - 1;
						let jB = iBf | 0;
						if (jB < 0) jB = 0;
						else if (jB > BL - 1) jB = BL - 1;
						iAf += aStep;
						iBf += bStep;
						const env = BLUT[jA] * VLUT[jB];

						const kf = kf0 * env;
						const HS = (H1 + H2) * kf;
						const HP = (H1 * H2 - H3 * H3) * kf * kf;

						let j = 1 - F_R * HS + F2_R * HP;
						if (j < 0) j = -j;
						const iR = 1 / (j + eps) - thr;
						j = 1 - HS + HP;
						if (j < 0) j = -j;
						const iG = 1 / (j + eps) - thr;
						j = 1 - F_B * HS + F2_B * HP;
						if (j < 0) j = -j;
						const iB = 1 / (j + eps) - thr;

						const bR = iR > 0 ? iR : 0;
						const bG = iG > 0 ? iG : 0;
						const bB = iB > 0 ? iB : 0;

						/* 线芯琥珀暖、线边冷青 */
						let w = bG * 0.058;
						w = w > 1 ? 1 : w;
						const lr = 0.34 + 0.66 * w;
						const lg = 0.58 + 0.26 * w;
						const lb = 0.98 - 0.43 * w;

						/* 大尺度软光池（低对比、慢、面积大） */
						const gl = P.glow * (0.35 * (SLUT[jA] * SVLUT[jB]) + 0.65 * env);
						const vg = VIG[o];
						const gn = GN[o];
						const bi = ((y >> 2) * BW + (x >> 2)) * 3;
						const ambE = 0.25 + 0.75 * env;
						const r0v = aR * ambE + gl * 1.0 + gain * bR * lr;
						const g0v = aG * ambE + gl * 0.62 + gain * bG * lg;
						const b0v = aB * ambE + gl * 0.3 + gain * bB * lb;
						const r = r0v * vg + gn + bloomA[bi] * bloomK;
						const g2v = g0v * vg + gn + bloomA[bi + 1] * bloomK;
						const b2v = b0v * vg + gn + bloomA[bi + 2] * bloomK;
						const p = o << 2;
						// —— 到这儿为止与草稿一致；下面这步是「当背景」的两步映射 ——
						data[p] = lut[r < 0 ? 0 : r > 255 ? 255 : r | 0];
						data[p + 1] = lut[g2v < 0 ? 0 : g2v > 255 ? 255 : g2v | 0];
						data[p + 2] = lut[b2v < 0 ? 0 : b2v > 255 ? 255 : b2v | 0];
						data[p + 3] = 255;

						const er = r0v - BTH;
						const eg = g0v - BTH;
						const eb = b0v - BTH;
						if (er > bloomS[bi]) bloomS[bi] = er;
						if (eg > bloomS[bi + 1]) bloomS[bi + 1] = eg;
						if (eb > bloomS[bi + 2]) bloomS[bi + 2] = eb;
					}
				}
				blurBloom();
				bloomS.fill(0);
				ctx.putImageData(img, 0, 0);
			}

			function render(t) {
				const t0 = performance.now();
				draw(t);
				const dt = performance.now() - t0;
				work.push(dt);
				if (work.length > 600) work.shift();
				return dt;
			}

			return { canvas: cv, render, work, size: [W, H] };
		}

		/* ═══════════════════════════════════════════════════════════════════
		 *  WebGL 渲染器（默认路径）
		 *  ──────────────────────────────────────────────────────────────────
		 *  一个全屏 quad（两个三角形）+ 每档一个 fragment shader。canvas 的
		 *  **实际像素尺寸 = CSS 尺寸 × devicePixelRatio**（DPR 上限 2），
		 *  没有 CSS 放大 —— 所以丝/纤维就是设备像素级的锐度，不再是「低分辨率
		 *  画布 4.5× 双线性放大」揉出来的软泥 + 放大伪色。
		 *
		 *  三档在 shader 里都工作在「草稿坐标」下（CSS 像素 ÷ 参考宽度），
		 *  这样画面里有多少条丝 / 纤维多宽与视口大小无关，也和草稿一致：
		 *    纸     → 640 宽        （drafts/paper.html 的 IW）
		 *    摩尔纹 → 1400×900      （drafts/moire.html 的 K 基准）
		 *    焦散   → 700×450       （drafts/caustics.html 的 W,H）
		 *
		 *  「当背景」的两步映射（pivot / contrast / vis）搬进 shader，和 CPU 版
		 *  同一套公式、同一组数值，所以正文对比度不变。
		 *
		 *  创建失败（没有 WebGL 上下文 / shader 编译不过 / FBO 不完整）→ 自动退回
		 *  CPU 渲染器，并在 window.__dshWallpaper.state().path 里说明走的哪条路。
		 *  ?cpu=1 或 window.__dshWallpaper.setRenderer("cpu") 可以强制 CPU 做 A/B。
		 * ═══════════════════════════════════════════════════════════════════ */

		const GL_TAU = Math.PI * 2;
		const GL_ATTRS = {
			alpha: false,
			antialias: false,
			depth: false,
			stencil: false,
			premultipliedAlpha: false,
			preserveDrawingBuffer: false,
			powerPreference: "high-performance",
		};

		/* 路径开关。URL 参数只在**模块加载这一刻**读 —— DSH 载入之后会把
		   `?token=...` 那次跳转的 query 抹掉，之后再读 location.search 是空的。 */
		let glForce = null;
		try {
			const _q = new URLSearchParams((window.location && window.location.search) || "");
			if (_q.get("cpu") === "1" || _q.get("render") === "cpu" || _q.get("wallpaper") === "cpu") glForce = "cpu";
			else if (_q.get("cpu") === "0" || _q.get("render") === "webgl") glForce = "webgl";
		} catch (error) {
			glForce = null;
		}

		const GL_INFO = { tried: false, ok: false, reason: "", renderer: "", vendor: "", version: "", software: false, failed: {} };

		function glProbe() {
			if (GL_INFO.tried) return GL_INFO;
			GL_INFO.tried = true;
			if (glForce === "cpu") {
				GL_INFO.reason = "forced-cpu";
				return GL_INFO;
			}
			let gl = null;
			try {
				const cv = document.createElement("canvas");
				cv.width = 2;
				cv.height = 2;
				gl =
					cv.getContext("webgl2", GL_ATTRS) ||
					cv.getContext("webgl", GL_ATTRS) ||
					cv.getContext("experimental-webgl", GL_ATTRS);
			} catch (error) {
				gl = null;
			}
			if (!gl) {
				GL_INFO.reason = "no-context";
				return GL_INFO;
			}
			try {
				const dbg = gl.getExtension("WEBGL_debug_renderer_info");
				GL_INFO.renderer = String((dbg && gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || "");
				GL_INFO.vendor = String((dbg && gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) || gl.getParameter(gl.VENDOR) || "");
				GL_INFO.version = String(gl.getParameter(gl.VERSION) || "");
				/* 软件光栅器（SwiftShader / WARP "Basic Render Driver" / llvmpipe）：
				   仍然走 WebGL，但把这件事记下来，自检口里如实报。 */
				GL_INFO.software = /swiftshader|basic render|llvmpipe|lavapipe|softwarerasterizer|software/i.test(GL_INFO.renderer);
				GL_INFO.ok = true;
			} catch (error) {
				GL_INFO.ok = false;
				GL_INFO.reason = "probe-fail";
			}
			try {
				const lose = gl.getExtension("WEBGL_lose_context");
				if (lose) lose.loseContext();
			} catch (error) {
				/* 无所谓 */
			}
			return GL_INFO;
		}

		/* ── WebGL 专用调参（几何 / 锐度；「当背景」的 TUNE 三档共用） ── */
		const GLP = {
			paper: {
				refW: 640, // 草稿基准宽度
				fine: 0.6, // 最细那层绒毛的权重（草稿 0.95，CPU 版 0.72）
				relief: 13.0, // 光楔里的浮雕增益（草稿 13.5）
				amb: 0.1, // ★ 整幅低对比纤维的浮雕增益（不被照亮也读得出来，但别把光楔的「带感」冲掉）
				ambColor: [50, 60, 82], // 环境浮雕的颜色（冷）
				ambScale: 300, // 纤维「呼吸」的大尺度
				ambDrift: 0.004, // 呼吸的漂移速度（极慢）
				wedgeBias: -0.3, // 光楔偏到一侧（0 = 居中扫全屏）
				wedgeAmp: 0.22, // 光楔摆幅
				edge: 0.34, // 四边渐隐强度（0 = 不压）
			},
			moire: {
				lineHalf: 0.6, // 细环线半宽（CSS px）→ 全宽 ~1.2 设备像素
				/* ★ 线的「墨量」。CPU 版是 1 内部 px 的线被 CSS 放大 4.5× —— 视觉上等价于
				   「4.5px 宽、峰值 α≈0.07 的很淡的线」。这里线是原生的 1.2 设备像素，
				   所以峰值 α 必须**大幅压低**（0.31 × 0.30 ≈ 0.09），而不是补偿性抬高；
				   抬高的那版会编成「菱形纱窗网」，就是用户说的不好看。 */
				gain: 0.3,
			},
			caustics: {
				refW: 700, // 草稿基准宽度
				waves: [
					[262, 0.3, 1.34, 7.6],
					[166, 1.35, 1.2, 6.0],
					[112, 2.5, 1.02, 4.6],
					[78, -0.6, 0.82, 3.4],
				],
				band: -0.52,
				/* ★「走廊宽度」：光池平顶半宽的总缩放。草稿/CPU 版是 0.62，
				   收窄到 0.34 → 光池更小、更孤立 → 折返线（丝）更少更长更连贯，
				   池与池之间留出大片真正黑掉的暗区。 */
				pws: 0.34,
				pools: [
					[0.095, 0.076, 0.7],
					[0.38, 0.107, 0.84],
					[0.685, 0.07, 1.0],
				],
				floor: 0.02,
				kf0: 2.5,
				eps: 0.042,
				thr: 6.0,
				gain: 11.0,
				glow: 34,
				amb: [2.8, 3.6, 6.4],
				warm: 0.12,
				/* 色散。**默认 0**：低分辨率场放大出来的彩虹边/紫边不是色散，
				   用户明确不要。想要一点点真实色差可以 configure({gl:{caustics:{disp:[..]}}})。 */
				disp: [0.0, 0.0],
			},
		};

		/* ── 着色器 ─────────────────────────────────────────────────────── */

		const VS_SRC = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

		const GLSL_HELPERS = `
float ihash(vec2 ip, float s) {
  vec3 p3 = fract(vec3(ip.xyx) * 0.1031 + s * 0.0973);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p, float s) {
  vec2 ip = floor(p);
  vec2 fp = p - ip;
  vec2 u = fp * fp * (3.0 - 2.0 * fp);
  float a = ihash(ip, s);
  float b = ihash(ip + vec2(1.0, 0.0), s);
  float c = ihash(ip + vec2(0.0, 1.0), s);
  float d = ihash(ip + vec2(1.0, 1.0), s);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
vec2 pack16(float v, float lo, float hi) {
  float t = clamp((v - lo) / (hi - lo), 0.0, 1.0);
  float n = floor(t * 65535.0 + 0.5);
  float hb = floor(n / 256.0);
  return vec2(hb, n - hb * 256.0) / 255.0;
}
float unpack16(vec2 c, float lo, float hi) {
  float n = floor(c.x * 255.0 + 0.5) * 256.0 + floor(c.y * 255.0 + 0.5);
  return lo + (n / 65535.0) * (hi - lo);
}
/* 与 CPU 版同一套「当背景」两步映射：绕 pivot 收对比 → 压向界面底色。 */
vec3 toneMap(vec3 c, vec4 tone) {
  vec3 k = tone.x + (c - tone.x) * tone.y;
  vec3 o = tone.w + (k - tone.w) * tone.z;
  return clamp(o, 2.0, 250.0) / 255.0;
}
`;

		const HS = 1.7; // 高度场打包范围 ±1.7
		const GS = 0.5; // 梯度打包范围 ±0.5
		/** JS 数字 → GLSL float 字面量（'1' 在 GLSL 里是 int，1.0 才是 float）。 */
		const glf = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

		/* 纸 · 烘焙 1/3：高度场（各向异性纤维 + 绒毛噪声） */
		const FRAG_PAPER_H =
			`
uniform vec2 u_size;
uniform vec2 u_css;
uniform float u_dpr;
uniform float u_refw;
uniform float u_fine;
` +
			GLSL_HELPERS +
			`
float dirFiber(vec2 q, float ang, float wf, float len, float sA, float sB, float patch) {
  float ca = cos(ang);
  float sa = sin(ang);
  float ux = q.x * ca + q.y * sa;
  float uy = -q.x * sa + q.y * ca;
  float e = vnoise(vec2(ux / patch + 5.1, 3.3), sA);
  e = e * e * (3.0 - 2.0 * e);
  return e * (vnoise(vec2(uy / wf + 1.7, ux / len), sB) - 0.5);
}
float fiberHeight(vec2 q) {
  float h = 0.0;
  h += 0.11 * dirFiber(q, 0.16, 1.15, 34.0, 7.3, 11.1, 62.0);
  h += 0.10 * dirFiber(q, 1.02, 1.05, 30.0, 9.7, 13.3, 74.0);
  h += 0.10 * dirFiber(q, 2.55, 1.00, 28.0, 25.3, 15.9, 68.0);
  h += 0.15 * dirFiber(q, 2.14, 0.85, 18.0, 15.1, 17.7, 46.0);
  h += 0.14 * dirFiber(q, 0.62, 0.85, 18.0, 21.3, 19.9, 50.0);
  h += 0.14 * dirFiber(q, 2.72, 0.85, 18.0, 27.9, 23.1, 54.0);
  h += u_fine * (vnoise(q / 0.85, 67.3) - 0.5);
  h += 0.50 * (vnoise(q / 1.70, 71.7) - 0.5);
  h += 0.22 * (vnoise(q / 3.40, 74.3) - 0.5);
  h += 0.18 * (vnoise(q / 6.50, 77.1) - 0.5);
  return h;
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, u_size.y - gl_FragCoord.y) / u_dpr;
  vec2 q = p * (u_refw / max(u_css.x, 1.0));
  gl_FragColor = vec4(pack16(fiberHeight(q), -` +
			HS +
			`, ` +
			HS +
			`), 0.0, 1.0);
}
`;

		/* 纸 · 烘焙 2/3：高度场横向 3 抽头盒模糊（= CPU 版 blurH，半径 1） */
		const FRAG_PAPER_BX =
			`
uniform sampler2D u_tex;
uniform vec2 u_size;
` +
			GLSL_HELPERS +
			`
void main() {
  vec2 uv = gl_FragCoord.xy / u_size;
  float d = 1.0 / u_size.x;
  float a = unpack16(texture2D(u_tex, uv - vec2(d, 0.0)).rg, -` +
			HS +
			`, ` +
			HS +
			`);
  float b = unpack16(texture2D(u_tex, uv).rg, -` +
			HS +
			`, ` +
			HS +
			`);
  float c = unpack16(texture2D(u_tex, uv + vec2(d, 0.0)).rg, -` +
			HS +
			`, ` +
			HS +
			`);
  gl_FragColor = vec4(pack16((a + b + c) / 3.0, -` +
			HS +
			`, ` +
			HS +
			`), 0.0, 1.0);
}
`;

		/* 纸 · 烘焙 3/3：纵向盒模糊 + 梯度（运行时只需 1 次采样） */
		const FRAG_PAPER_BY =
			`
uniform sampler2D u_tex;
uniform vec2 u_size;
` +
			GLSL_HELPERS +
			`
float HH(vec2 uv) { return unpack16(texture2D(u_tex, uv).rg, -` +
			HS +
			`, ` +
			HS +
			`); }
void main() {
  vec2 uv = gl_FragCoord.xy / u_size;
  vec2 dx = vec2(1.0 / u_size.x, 0.0);
  vec2 dy = vec2(0.0, 1.0 / u_size.y);
  float h = (HH(uv - dy) + HH(uv) + HH(uv + dy)) / 3.0;
  float hx = (HH(uv + dx - dy) - HH(uv - dx - dy)
            + HH(uv + dx)      - HH(uv - dx)
            + HH(uv + dx + dy) - HH(uv - dx + dy)) / 6.0;
  float hy = (HH(uv + dy + dy) + HH(uv + dy) - HH(uv - dy) - HH(uv - dy - dy)) / 6.0;
  gl_FragColor = vec4(pack16(h, -` +
			HS +
			`, ` +
			HS +
			`),
                      clamp(hx / ` +
			glf(GS * 2) +
			` + 0.5, 0.0, 1.0),
                      clamp(hy / ` +
			glf(GS * 2) +
			` + 0.5, 0.0, 1.0));
}
`;

		/* 纸 · 每帧：一道偏在一侧的斜光楔 + 整幅的极低对比纤维 */
		const FRAG_PAPER_MAIN =
			`
uniform vec2 u_size;
uniform vec2 u_css;
uniform float u_dpr;
uniform float u_time;
uniform float u_refw;
uniform vec4 u_tone;
uniform vec4 u_p0;   // relief, amb, ambScale, edge
uniform vec4 u_p1;   // wedgeBias, wedgeAmp, ambR, ambG
uniform vec4 u_p2;   // ambB, drift, 0, 0
uniform vec2 u_ptrOff; // 指针位移（CSS px，已反向）
uniform vec4 u_depth;  // far, near, 0, 0
uniform sampler2D u_tex;
` +
			GLSL_HELPERS +
			`
float gauss(float z) { return exp(-0.5 * z * z); }
void main() {
  vec2 fp = gl_FragCoord.xy;
  vec2 p = vec2(fp.x, u_size.y - fp.y) / u_dpr;
  /* 分层视差：远层动得多、近层动得少 —— 深度靠层间差 */
  vec2 pFar = p + u_ptrOff * u_depth.x;
  vec2 pNear = p + u_ptrOff * u_depth.y;
  vec4 smp = texture2D(u_tex, (pNear * u_dpr) / u_size);
  float H = unpack16(smp.rg, -` +
			HS +
			`, ` +
			HS +
			`);
  /* 梯度纹理的 y 轴是纹理方向（向上），屏幕方向（向下）要翻号 */
  float hx = (smp.b - 0.5) * ` +
			glf(GS * 2) +
			`;
  float hy = -(smp.a - 0.5) * ` +
			glf(GS * 2) +
			`;
  vec2 q = pNear * (u_refw / max(u_css.x, 1.0)); // 纤维 / 颗粒（近层）
  vec2 qFar = pFar * (u_refw / max(u_css.x, 1.0)); // 纸板起伏（远层）
  float px = pFar.x / u_css.x - 0.5;
  float py = pFar.y / u_css.y - 0.5;
  float t = u_time;

  /* ── 光楔（几何与草稿逐字一致，只是位置偏到一侧、不再扫过正中）── */
  float th = -0.62 + 0.34 * sin(t * 0.0083 + 0.6);
  float ca = cos(th);
  float sa = sin(th);
  float pos = u_p1.x + u_p1.y * sin(t * 0.132) + 0.060 * sin(t * 0.055 + 1.2);
  float nx = -sa;
  float ny = ca;
  float th2 = 0.95 + 0.26 * sin(t * 0.0061 - 1.4);
  float ca2 = cos(th2);
  float sa2 = sin(th2);
  float pos2 = 0.36 + 0.24 * sin(t * 0.086 + 2.6);
  float mm1 = t * 0.09;
  float mm2 = t * 0.06;
  float mm3 = t * 0.05;

  float q1 = -(px - 0.02) * sa + py * ca;
  float q2 = (px - 0.02) * ca + py * sa;
  float d1 = q1 - pos;
  float lit = gauss(d1 / 0.042) + 0.30 * gauss((d1 + 0.135) / 0.068) + 0.16 * gauss((d1 - 0.20) / 0.105);
  lit *= gauss(q2 / 0.30) * (0.72 + 0.28 * (0.5 + 0.5 * sin(q2 * 7.1 + mm1) * sin(q2 * 2.7 - mm2)));
  float q3 = -(px + 0.04) * sa2 + py * ca2;
  float q4 = (px + 0.04) * ca2 + py * sa2;
  float d2 = q3 - pos2;
  float lit2 = 0.42 * gauss(d2 / 0.062);
  lit2 *= gauss(q4 / 0.34) * (0.74 + 0.26 * sin(q4 * 4.4 - mm3));
  lit = min(lit, 1.25);
  lit2 = min(lit2, 1.0);

  float l1 = clamp(lit, 0.0, 1.0);
  float s1 = l1 * l1 * (3.0 - 2.0 * l1);
  float l2 = clamp(lit2, 0.0, 1.0);
  float s2 = l2 * l2 * (3.0 - 2.0 * l2);
  float dif = min(lit + lit2 * 0.85, 1.0);
  float gsrc = dif * dif * (3.0 - 2.0 * dif);
  vec3 lr = vec3(lit * 244.0 + lit2 * 86.0, lit * 196.0 + lit2 * 168.0, lit * 142.0 + lit2 * 196.0);

  /* ── 底色（草稿的 BASE，逐帧算；两次噪声而已）── */
  float board = vnoise(vec2(qFar.x / 210.0 + 8.3, qFar.y / 210.0 - 4.7), 61.1) - 0.5;
  float g0 = (ihash(floor(q), 91.3) - 0.5) * 2.0;
  float bo = board * 5.0;
  vec3 c = vec3(16.0 + bo + g0, 17.0 + bo + g0, 21.0 + bo * 1.2 + g0);
  c += vec3(s1 * 116.0 + s2 * 44.0, s1 * 91.0 + s2 * 66.0, s1 * 65.0 + s2 * 76.0);

  /* ── 光楔里的纤维浮雕 ── */
  float e = clamp((hx * nx + hy * ny) * u_p0.x, -1.0, 1.0);
  float gain = 0.026 + 0.974 * gsrc;
  c += e * lr * gain;

  /* ── ★ 整幅的极低对比纤维 ──
     光楔照不到的地方不是死黑，而是「一块有质感的冷暗材料」：浮雕增益压到
     最低、颜色用冷灰；浮雕是零均值的 → 中位灰度仍然贴着界面底色。
     外面再套一层 300px 尺度的极慢「呼吸」，让整幅不至于像一块平贴图。 */
  float ambMod = 0.55 + 0.85 * vnoise(vec2(qFar.x / u_p0.z + t * u_p2.y, qFar.y / u_p0.z - t * u_p2.y * 0.65), 55.0);
  vec3 amb = vec3(u_p1.z, u_p1.w, u_p2.x) * (u_p0.y * ambMod);
  c += e * amb;

  /* 纤维本色（凸起亮、凹陷暗）—— 光楔里强、全幅弱 */
  float al = H * 0.5 * (0.10 + 0.90 * gsrc);
  c += al * 0.055 * lr;
  c += al * amb * 0.85;

  float ss = dif * dif * 0.038;
  c += vec3(ss * 54.0, ss * 43.0, ss * 32.0);

  float sp = 0.0;
  if (ihash(floor(q * 0.5), 71.9) > 0.9975) sp = (ihash(floor(q), 73.1) - 0.5) * 2.0;
  c += sp * gsrc * 20.0;

  float ex = clamp(min(p.x, u_css.x - p.x) / 88.0, 0.0, 1.0);
  float ey = clamp(min(p.y, u_css.y - p.y) / 88.0, 0.0, 1.0);
  float ef = (1.0 - u_p0.w + u_p0.w * ex * ex * (3.0 - 2.0 * ex)) *
             (1.0 - u_p0.w + u_p0.w * ey * ey * (3.0 - 2.0 * ey));
  c *= ef;

  gl_FragColor = vec4(toneMap(c, u_tone), 1.0);
}
`;

		/* ── 摩尔纹 · 每帧（干涉场 + 解析细环线，一次绘制） ── */
		const FRAG_MOIRE =
			`
uniform vec2 u_size;
uniform vec2 u_css;
uniform float u_dpr;
uniform float u_time;
uniform vec4 u_tone;
uniform vec4 u_m0;     // lineHalf, gain, 0, 0
uniform vec2 u_ptrOff; // 指针位移（CSS px，已反向）
uniform vec4 u_depth;  // far, near, 0, 0
` +
			GLSL_HELPERS +
			`
vec3 ringLayer(vec2 p, vec2 C, float pp, float ell, float rot, float ld, float la,
               vec3 col, float phu, float envRaw, float Ef) {
  vec2 d = p - C;
  float cr = cos(rot);
  float sr = sin(rot);
  vec2 u = vec2(d.x * cr + d.y * sr, -d.x * sr + d.y * cr);
  float r = sqrt((u.x * u.x) / (ell * ell) + u.y * u.y);
  float idx = floor(r / pp + 0.5);
  float dl = abs(r - idx * pp);
  float hw = u_m0.x * u_dpr;
  if (dl >= hw) return vec3(0.0);
  float prof = 1.0 - smoothstep(0.0, hw, dl);
  float e = (0.5 + 0.5 * cos(phu * TAU / 48.0)) * envRaw;
  float pr = clamp((e - 0.66) / (0.97 - 0.66), 0.0, 1.0);
  float pres = pr * pr * (3.0 - 2.0 * pr);
  float a = (ld + la * pres * (0.45 + 0.55 * Ef)) * u_m0.y;
  return col * (a * prof);
}
void main() {
  vec2 fp = gl_FragCoord.xy;
  vec2 p = vec2(fp.x, u_size.y - fp.y) / u_dpr;
  float t = u_time;
  float W = u_css.x;
  float Hh = u_css.y;
  float K = sqrt((W * Hh) / (1400.0 * 900.0));
  float REF = length(u_css) * 0.5;
  float pA = 19.0 * K * (1.0 + 0.0135 * sin(t * (TAU / 127.0)));
  float pB = 21.5 * K * (1.0 + 0.0115 * sin(t * (TAU / 97.0) + 1.15));
  float Ax = -0.10 * W + cos(t * (TAU / 137.0)) * 0.020 * REF;
  float Ay = -0.16 * Hh + sin(t * (TAU / 113.0) + 0.7) * 0.018 * REF;
  float Bx = 1.10 * W + cos(t * (TAU / 167.0) + 2.1) * 0.022 * REF;
  float By = 1.16 * Hh + sin(t * (TAU / 149.0) + 1.3) * 0.020 * REF;

  /* 分层视差：大尺度明暗场（远）动得多，环线 + 细拍频（近）动得少。
     位移作用在**采样坐标**上 → 整个场刚性平移，绝不重组。
     两组环共用同一个 pNear（同层同 offset）。 */
  vec2 pFar = p + u_ptrOff * u_depth.x;
  vec2 pNear = p + u_ptrOff * u_depth.y;
  float iA = 1.0 / pA;
  float iB = 1.0 / pB;

  /* ── 远层：相位差 → 拍频间距 → 存在度 / 明暗场 ── */
  float dax = pFar.x - Ax;
  float day = pFar.y - Ay;
  float dbx = pFar.x - Bx;
  float dby = pFar.y - By;
  float rAF = sqrt(dax * dax + day * day);
  float rBF = sqrt(dbx * dbx + dby * dby);
  float phuF = rAF * iA - rBF * iB;
  float irA = 1.0 / max(rAF, 0.0001);
  float irB = 1.0 / max(rBF, 0.0001);
  float gx = dax * irA * iA - dbx * irB * iB;
  float gy = day * irA * iA - dby * irB * iB;
  float sp = 1.0 / max(sqrt(gx * gx + gy * gy), 1e-9);
  float vv = clamp((sp - 40.0 * K) / max(150.0 * K - 40.0 * K, 1e-6), 0.0, 1.0);
  float vis = vv * vv * (3.0 - 2.0 * vv);

  float qa2 = 0.13 * REF * 0.13 * REF;
  float qb2 = 0.56 * REF * 0.56 * REF;
  float dqx = pFar.x - W * 0.985;
  float dqy = pFar.y - Hh * 0.015;
  float qu = clamp((dqx * dqx + dqy * dqy - qa2) / max(qb2 - qa2, 1e-6), 0.0, 1.0);
  float envRaw = qu * qu * (3.0 - 2.0 * qu);
  float env = 0.46 + 0.54 * envRaw;

  float EfF = 0.5 + 0.5 * cos(phuF * TAU);
  float Ec = 0.5 + 0.5 * cos(phuF * TAU / 48.0);
  float soft = 0.18 + 0.82 * Ec;

  /* ── 近层：环线本身 ── */
  float daxN = pNear.x - Ax;
  float dayN = pNear.y - Ay;
  float dbxN = pNear.x - Bx;
  float dbyN = pNear.y - By;
  float rAN = sqrt(daxN * daxN + dayN * dayN);
  float rBN = sqrt(dbxN * dbxN + dbyN * dbyN);
  float phuN = rAN * iA - rBN * iB;
  float EfN = 0.5 + 0.5 * cos(phuN * TAU);
  float tex = 0.5 + 0.5 * cos(fract(rAN * iA) * TAU);
  float gi = (soft * env + vis * EfF * 0.07) * 0.52 + tex * 0.016 * env;

  float cax = cos(-0.62 + t * 0.0002);
  float cay = sin(-0.62 + t * 0.0002);
  float cwPh = 0.17 * sin(t * (TAU / 211.0));
  float cw = clamp(0.5 + cwPh + ((p.x - W * 0.5) * cax + (p.y - Hh * 0.5) * cay) * (0.55 / max(REF, 1.0)), 0.0, 1.0);
  float wmix = 0.38 + 0.62 * cw;

  /* 背景：大尺度色染（左下暖 / 右上冷）+ 暗角 + 静态颗粒 */
  vec3 bg = vec3(14.0, 15.0, 18.0);
  float gden = max(W * W + Hh * Hh, 1.0);
  float gt = clamp((pFar.x * W + (Hh - pFar.y) * Hh) / gden, 0.0, 1.0);
  vec3 t0 = vec3(98.0, 58.0, 18.0) * 0.20;
  vec3 t1 = vec3(30.0, 26.0, 26.0) * 0.04;
  vec3 t2 = vec3(26.0, 54.0, 90.0) * 0.22;
  vec3 tint = gt < 0.48 ? mix(t0, t1, gt / 0.48) : mix(t1, t2, (gt - 0.48) / 0.52);
  bg += tint;
  float vr = length(p - vec2(W * 0.5, Hh * 0.5));
  float vk = clamp((vr - min(W, Hh) * 0.3) / max(max(W, Hh) * 0.86 - min(W, Hh) * 0.3, 1.0), 0.0, 1.0);
  bg *= (1.0 - 0.58 * vk);
  bg += (ihash(floor(p), 91.7) - 0.5) * 4.6;

  vec3 c = bg + vec3(84.0 + 154.0 * wmix, 116.0 + 58.0 * wmix, 152.0 - 58.0 * wmix) * gi;
  c += ringLayer(pNear, vec2(Ax, Ay), pA, 1.038, -0.22 + t * 0.00026, 0.010, 0.30, vec3(128.0, 174.0, 208.0), phuN, envRaw, EfN);
  c += ringLayer(pNear, vec2(Bx, By), pB, 1.000, 0.34 + t * 0.00019, 0.009, 0.26, vec3(240.0, 178.0, 102.0), phuN, envRaw, EfN);

  gl_FragColor = vec4(toneMap(c, u_tone), 1.0);
}
`;

		/* ── 焦散 · 每帧（波场折射的雅可比 J→0 处就是丝） ── */
		const FRAG_CAUSTICS =
			`
uniform vec2 u_size;
uniform vec2 u_css;
uniform float u_dpr;
uniform float u_time;
uniform vec4 u_tone;
uniform vec4 u_wave[NW];
uniform vec4 u_w2[NW];
uniform vec4 u_c0;    // kf0, eps, thr, gain
uniform vec4 u_c1;    // bandAngle, floor, glow, warm
uniform vec4 u_c2;    // ambR, ambG, ambB, ptr
uniform vec4 u_c3;    // dR, dB, 0, 0
uniform vec4 u_poolA; // c1, c2, c3, pws
uniform vec4 u_poolB; // w1, w2, w3, 0
uniform vec4 u_poolG; // g1, g2, g3, 0
uniform vec2 u_ptrOff; // 指针位移（CSS px，已反向）
uniform vec4 u_depth;  // far, near, 0, 0
` +
			GLSL_HELPERS +
			`
float plateau(float d, float wi, float wo) {
  float a = abs(d);
  float u = clamp((a - wi) / max(wo - wi, 1e-5), 0.0, 1.0);
  return 1.0 - u * u * (3.0 - 2.0 * u);
}
void main() {
  vec2 fp = gl_FragCoord.xy;
  vec2 p = vec2(fp.x, u_size.y - fp.y) / u_dpr;
  /* mod 一下：跑上几小时相位也不会掉精度 */
  float t = mod(u_time, 5400.0);

  float sc = max(u_css.x, 1.0) / 700.0;
  float Wd = u_css.x / sc;
  float Hd = u_css.y / sc;
  /* 分层视差：光池包络（远）动得多，波场与丝（近）动得少 */
  vec2 qdFar = (p + u_ptrOff * u_depth.x) / sc;
  vec2 qdNear = (p + u_ptrOff * u_depth.y) / sc;

  float sv[NW];
  for (int i = 0; i < NW; i++) {
    float ph = mod(u_wave[i].x * qdNear.x + u_wave[i].y * qdNear.y + u_w2[i].w * t + u_wave[i].z, TAU);
    sv[i] = sin(ph);
  }
  float H1 = 0.0;
  float H2 = 0.0;
  float H3 = 0.0;
  for (int i = 0; i < NW; i++) {
    H1 -= u_w2[i].x * sv[i];
    H2 -= u_w2[i].y * sv[i];
    H3 -= u_w2[i].z * sv[i];
  }

  /* ── 大尺度包络：一条斜带上的三个「光池」，池外几乎为零 ──
     u_poolB 是平顶半宽（走廊宽度），u_poolA.w 是它的总缩放。 */
  float BNX = cos(u_c1.x);
  float BNY = sin(u_c1.x);
  float ASPAN = max(Wd * abs(BNX) + Hd * abs(BNY), 1.0);
  float BSPAN = max(Wd * abs(BNY) + Hd * abs(BNX), 1.0);
  float sA = -0.55 + 2.1 * ((qdFar.x * BNX + qdFar.y * BNY) / ASPAN);
  float sB = -0.35 + 1.70 * ((-qdFar.x * BNY + qdFar.y * BNX) / BSPAN);
  float pw = u_poolA.w;
  float w1 = u_poolB.x * pw;
  float w2 = u_poolB.y * pw;
  float w3 = u_poolB.z * pw;
  float envA = u_c1.y
    + u_poolG.x * plateau(sA - u_poolA.x, w1, w1 * 2.9)
    + u_poolG.y * plateau(sA - u_poolA.y, w2, w2 * 2.7)
    + u_poolG.z * plateau(sA - u_poolA.z, w3, w3 * 2.6);
  envA = min(envA, 1.06);
  float vu = 0.5 + 0.5 * sin(sB * 3.1 + TAU * t / 61.0 + 1.4);
  float vv2 = 0.5 + 0.5 * sin(sB * 5.2 - TAU * t / 83.0 + 0.6);
  float envB = 0.72 + 0.28 * (0.45 + 0.55 * vu) * (0.6 + 0.4 * vv2);
  float env = envA * envB;

  float kf = u_c0.x * env;
  float HSv = (H1 + H2) * kf;
  float HPv = (H1 * H2 - H3 * H3) * kf * kf;
  float fr = 1.0 + u_c3.x;
  float fb = 1.0 + u_c3.y;
  float jr = abs(1.0 - fr * HSv + fr * fr * HPv);
  float jg = abs(1.0 - HSv + HPv);
  float jb = abs(1.0 - fb * HSv + fb * fb * HPv);
  float bR = max(1.0 / (jr + u_c0.y) - u_c0.z, 0.0);
  float bG = max(1.0 / (jg + u_c0.y) - u_c0.z, 0.0);
  float bB = max(1.0 / (jb + u_c0.y) - u_c0.z, 0.0);

  /* 丝的颜色：单一暖琥珀（几乎不随强度变色）—— 低分辨率放大出的「冷色描边」
     不是色散，这里不做。 */
  float wgt = clamp(bG * u_c1.w, 0.0, 1.0);
  vec3 lc = vec3(0.46 + 0.54 * wgt, 0.66 + 0.20 * wgt, 0.94 - 0.30 * wgt);

  float gl = u_c1.z * (0.35 * sqrt(env) + 0.65 * env);
  float mR = max(length(vec2(u_css.x * 0.44, u_css.y * 0.52)), 1.0);
  float dr = (p.x - u_css.x * 0.44) / mR;
  float dg = (p.y - u_css.y * 0.52) / mR;
  float r2 = dr * dr + dg * dg;
  float vg = 1.0 - 0.30 * r2 * (0.55 + 0.45 * r2);
  float gn = (ihash(floor(p), 17.1) + ihash(floor(p) + 31.3, 17.1) + ihash(floor(p) + 71.7, 17.1) - 1.5) * 1.35;
  float ambE = 0.25 + 0.75 * env;

  vec3 c;
  c.r = (u_c2.x * ambE + gl * 1.00) * vg + gn + u_c0.w * bR * lc.r;
  c.g = (u_c2.y * ambE + gl * 0.62) * vg + gn + u_c0.w * bG * lc.g;
  c.b = (u_c2.z * ambE + gl * 0.30) * vg + gn + u_c0.w * bB * lc.b;

  gl_FragColor = vec4(toneMap(c, u_tone), 1.0);
}
`;

		/* ── GL 小工具 ──────────────────────────────────────────────────── */

		function glShader(gl, type, src) {
			const sh = gl.createShader(type);
			gl.shaderSource(sh, src);
			gl.compileShader(sh);
			if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
				const log = String(gl.getShaderInfoLog(sh) || "");
				gl.deleteShader(sh);
				throw new Error("shader: " + log.slice(0, 240));
			}
			return sh;
		}

		function glProgram(gl, fragSrc, defines) {
			const fs = glShader(gl, gl.FRAGMENT_SHADER, "precision highp float;\n" + (defines || "") + "\n" + fragSrc);
			const vs = glShader(gl, gl.VERTEX_SHADER, VS_SRC);
			const prog = gl.createProgram();
			gl.attachShader(prog, vs);
			gl.attachShader(prog, fs);
			gl.linkProgram(prog);
			gl.deleteShader(vs);
			gl.deleteShader(fs);
			if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
				const log = String(gl.getProgramInfoLog(prog) || "");
				gl.deleteProgram(prog);
				throw new Error("link: " + log.slice(0, 240));
			}
			return prog;
		}

		function glQuadBuffer(gl) {
			const buf = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, buf);
			gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
			return buf;
		}

		function glLocs(gl, prog) {
			const m = new Map();
			return (name) => {
				if (!m.has(name)) {
					let loc = gl.getUniformLocation(prog, name);
					if (loc == null && name.indexOf("[") < 0) loc = gl.getUniformLocation(prog, name + "[0]");
					m.set(name, loc || null);
				}
				return m.get(name);
			};
		}

		function glTarget(gl, w, h) {
			const tex = gl.createTexture();
			gl.bindTexture(gl.TEXTURE_2D, tex);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
			/* 最近邻：烘焙的盒模糊必须精确取到相邻纹素，不能被插值污染 */
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			const fb = gl.createFramebuffer();
			gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
			const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			if (!ok) throw new Error("fbo-incomplete");
			return { tex, fb, w, h };
		}

		function glDraw(gl, quad, prog, locs, target, values, textures) {
			gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
			if (target) gl.viewport(0, 0, target.w, target.h);
			else gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
			gl.useProgram(prog);
			gl.bindBuffer(gl.ARRAY_BUFFER, quad);
			const a = gl.getAttribLocation(prog, "a_pos");
			gl.enableVertexAttribArray(a);
			gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
			if (textures) {
				let unit = 0;
				for (const name of Object.keys(textures)) {
					gl.activeTexture(gl.TEXTURE0 + unit);
					gl.bindTexture(gl.TEXTURE_2D, textures[name]);
					const loc = locs(name);
					if (loc) gl.uniform1i(loc, unit);
					unit += 1;
				}
			}
			if (values) {
				for (const name of Object.keys(values)) {
					const loc = locs(name);
					if (!loc) continue;
					const v = values[name];
					if (typeof v === "number") gl.uniform1f(loc, v);
					else if (v instanceof Float32Array) gl.uniform4fv(loc, v);
					else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
					else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]);
					else gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
				}
			}
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		}

		/* ── 每档一个 GL 渲染器（接口与 CPU 版一致：canvas / render / size / work） ── */

		function createPaperGL(gl, quad, W, H, cssW, cssH, dpr) {
			const P = GLP.paper;
			const pH = glProgram(gl, FRAG_PAPER_H, "");
			const pBX = glProgram(gl, FRAG_PAPER_BX, "");
			const pBY = glProgram(gl, FRAG_PAPER_BY, "");
			const pMain = glProgram(gl, FRAG_PAPER_MAIN, "");
			const lH = glLocs(gl, pH);
			const lBX = glLocs(gl, pBX);
			const lBY = glLocs(gl, pBY);
			const lMain = glLocs(gl, pMain);
			const t1 = glTarget(gl, W, H);
			const t2 = glTarget(gl, W, H);
			const t3 = glTarget(gl, W, H);
			const base = { u_size: [W, H], u_css: [cssW, cssH], u_dpr: dpr, u_refw: P.refW };
			const t0 = performance.now();
			glDraw(gl, quad, pH, lH, t1, Object.assign({}, base, { u_fine: P.fine }), null);
			glDraw(gl, quad, pBX, lBX, t2, base, { u_tex: t1.tex });
			glDraw(gl, quad, pBY, lBY, t3, base, { u_tex: t2.tex });
			const bakeMs = performance.now() - t0;
			const mainVals = {
				u_size: [W, H],
				u_css: [cssW, cssH],
				u_dpr: dpr,
				u_refw: P.refW,
				u_tone: [TUNE.paper.pivot, TUNE.paper.contrast, TUNE.paper.vis, UI_BASE],
				u_p0: [P.relief, P.amb, P.ambScale, P.edge],
				u_p1: [P.wedgeBias, P.wedgeAmp, P.ambColor[0], P.ambColor[1]],
				u_p2: [P.ambColor[2], P.ambDrift, 0, 0],
				u_depth: [DEPTH.paper[0], DEPTH.paper[1], 0, 0],
			};
			const work = [];
			function render(t) {
				const s0 = performance.now();
				glDraw(
					gl,
					quad,
					pMain,
					lMain,
					null,
					Object.assign({}, mainVals, { u_time: t, u_ptrOff: pointerOffset() }),
					{ u_tex: t3.tex },
				);
				const dt = performance.now() - s0;
				work.push(dt);
				if (work.length > 600) work.shift();
				return dt;
			}
			return { render, work, size: [W, H], bakeMs, path: "webgl" };
		}

		function createMoireGL(gl, quad, W, H, cssW, cssH, dpr) {
			const P = GLP.moire;
			const prog = glProgram(gl, FRAG_MOIRE, "#define TAU " + GL_TAU + "\n");
			const locs = glLocs(gl, prog);
			const vals = {
				u_size: [W, H],
				u_css: [cssW, cssH],
				u_dpr: dpr,
				u_tone: [TUNE.moire.pivot, TUNE.moire.contrast, TUNE.moire.vis, UI_BASE],
				u_m0: [P.lineHalf, P.gain, 0, 0],
				u_depth: [DEPTH.moire[0], DEPTH.moire[1], 0, 0],
			};
			const work = [];
			function render(t) {
				const s0 = performance.now();
				glDraw(gl, quad, prog, locs, null, Object.assign({}, vals, { u_time: t, u_ptrOff: pointerOffset() }), null);
				const dt = performance.now() - s0;
				work.push(dt);
				if (work.length > 600) work.shift();
				return dt;
			}
			return { render, work, size: [W, H], bakeMs: 0, path: "webgl" };
		}

		function createCausticsGL(gl, quad, W, H, cssW, cssH, dpr) {
			const P = GLP.caustics;
			const nw = P.waves.length;
			const wave = new Float32Array(nw * 4);
			const w2 = new Float32Array(nw * 4);
			const sc = cssW / P.refW; // CSS px → 草稿 px 的换算（乘 sc）
			for (let i = 0; i < nw; i++) {
				const lam = P.waves[i][0];
				const ang = P.waves[i][1];
				const tt = P.waves[i][2];
				const spd = P.waves[i][3];
				const k = GL_TAU / (lam * sc);
				const ca = Math.cos(ang);
				const sa = Math.sin(ang);
				wave[i * 4] = k * ca;
				wave[i * 4 + 1] = k * sa;
				wave[i * 4 + 2] = i * 1.7;
				wave[i * 4 + 3] = 0;
				w2[i * 4] = tt * ca * ca;
				w2[i * 4 + 1] = tt * sa * sa;
				w2[i * 4 + 2] = tt * ca * sa;
				w2[i * 4 + 3] = (GL_TAU / lam) * spd;
			}
			const prog = glProgram(gl, FRAG_CAUSTICS, "#define NW " + nw + "\n#define TAU " + GL_TAU + "\n");
			const locs = glLocs(gl, prog);
			const vals = {
				u_size: [W, H],
				u_css: [cssW, cssH],
				u_dpr: dpr,
				u_tone: [TUNE.caustics.pivot, TUNE.caustics.contrast, TUNE.caustics.vis, UI_BASE],
				u_wave: wave,
				u_w2: w2,
				u_c0: [P.kf0, P.eps, P.thr, P.gain],
				u_c1: [P.band, P.floor, P.glow, P.warm],
				u_c2: [P.amb[0], P.amb[1], P.amb[2], 0],
				u_depth: [DEPTH.caustics[0], DEPTH.caustics[1], 0, 0],
				u_c3: [P.disp[0], P.disp[1], 0, 0],
				u_poolA: [P.pools[0][0], P.pools[1][0], P.pools[2][0], P.pws],
				u_poolB: [P.pools[0][1], P.pools[1][1], P.pools[2][1], 0],
				u_poolG: [P.pools[0][2], P.pools[1][2], P.pools[2][2], 0],
			};
			const work = [];
			function render(t) {
				const s0 = performance.now();
				glDraw(gl, quad, prog, locs, null, Object.assign({}, vals, { u_time: t, u_ptrOff: pointerOffset() }), null);
				const dt = performance.now() - s0;
				work.push(dt);
				if (work.length > 600) work.shift();
				return dt;
			}
			return { render, work, size: [W, H], bakeMs: 0, path: "webgl" };
		}

		/* ── 指针视差 ─────────────────────────────────────────────────────
		 *  用户要的是「鼠标移动 → 背景会动」这件事本身。做法是**整个场坐标的刚性平移**
		 *  （p_world = p + offset），不是去动圆心 / 光池的生成参数 —— 后者会让图案
		 *  **重新组织**（不好看），前者才是**平移**（好看）。
		 *
		 *  · 事件里只写 target（零节流）；位移在 rAF 里过临界阻尼慢慢跟。
		 *  · 背景**反向**于光标（光标向右 → 背景向左）：经典景深线索。
		 *  · 每档分 2 层（远 / 近），乘不同系数 —— 深度靠**层间差**，不靠总位移大。
		 *  · 摩尔纹两组环必须同一层、同一 offset，否则干涉重组。 */
		const POINTER = {
			on: true,
			amp: 16, // 光标从画面中心移到边缘 → 该层最多位移 ±amp CSS px
			tau: 0.55, // 临界阻尼时间常数（秒）
			tx: null, // 目标（事件直接写）
			ty: null,
			x: null, // 平滑后
			y: null,
			init: false,
			reduce: false,
		};
		/* 每档的深度层系数 [远, 近]。远层动得多（它「更远」），近层动得少。
		 * 全 0 = 该档完全不跟鼠标（着色器乘的是这个系数，乘 0 后采样坐标恒定）。
		 * 纸：[0,0] —— 纤维/浮雕是高频细料，采样坐标一动就出现爬行感（看着像抖动），
		 *       实测不好看，所以纸不响应指针；摩尔纹、焦散照旧。 */
		const DEPTH = {
			paper: [0, 0], // 不跟鼠标（原 [1.0, 0.5]）
			moire: [1.0, 0.45], // ① 大尺度明暗场 + 色染 ② 环线 + 细拍频（两组同一层）
			caustics: [1.0, 0.55], // ① 光池包络 ② 波场与丝
		};
		let pointerCss = [1, 1];
		function pointerSeed(w, h) {
			pointerCss = [w, h];
			if (!POINTER.init) {
				POINTER.init = true;
				POINTER.tx = w / 2;
				POINTER.ty = h / 2;
				POINTER.x = POINTER.tx;
				POINTER.y = POINTER.ty;
			}
		}
		function pointerAmp() {
			return POINTER.amp * (POINTER.reduce ? 0.5 : 1);
		}
		function pointerOffset() {
			if (!POINTER.on || !POINTER.init) return [0, 0];
			const w = Math.max(pointerCss[0], 1);
			const h = Math.max(pointerCss[1], 1);
			const nx = (POINTER.x - w / 2) / (w / 2);
			const ny = (POINTER.y - h / 2) / (h / 2);
			const a = pointerAmp();
			return [-nx * a, -ny * a];
		}
		/** 临界阻尼：cur += (target - cur) * (1 - exp(-dt/τ)) */
		function pointerStep(dt) {
			if (!POINTER.on || !POINTER.init || POINTER.tx == null) return;
			const tau = Math.max(0.02, POINTER.tau * (POINTER.reduce ? 2.2 : 1));
			const k = 1 - Math.exp(-Math.min(Math.max(dt, 0), 0.1) / tau);
			POINTER.x += (POINTER.tx - POINTER.x) * k;
			POINTER.y += (POINTER.ty - POINTER.y) * k;
		}
		function pointerSnap() {
			if (!POINTER.init) return;
			POINTER.x = POINTER.tx;
			POINTER.y = POINTER.ty;
		}
		function pointerInfo() {
			const off = pointerOffset();
			const info = {
				on: POINTER.on,
				amp: POINTER.amp,
				tau: POINTER.tau,
				target: POINTER.tx == null ? null : [+POINTER.tx.toFixed(1), +POINTER.ty.toFixed(1)],
				cur: POINTER.x == null ? null : [+POINTER.x.toFixed(1), +POINTER.y.toFixed(1)],
				offset: [+off[0].toFixed(2), +off[1].toFixed(2)],
				layers: {},
			};
			for (const k of Object.keys(DEPTH)) {
				info.layers[k] = [
					+(off[0] * DEPTH[k][0]).toFixed(2),
					+(off[1] * DEPTH[k][0]).toFixed(2),
					+(off[0] * DEPTH[k][1]).toFixed(2),
					+(off[1] * DEPTH[k][1]).toFixed(2),
				];
			}
			return info;
		}

		/**
		 * 建一个 WebGL 渲染器。失败返回 null（由调用方退回 CPU）。
		 * canvas 的实际像素 = CSS 尺寸 × min(DPR, 2) —— 原生 1:1，没有 CSS 放大。
		 */
		function createGLRenderer(kind, cssW, cssH, dpr) {
			const probe = glProbe();
			if (!probe.ok) return null;
			const canvas = document.createElement("canvas");
			const W = Math.max(2, Math.min(8192, Math.round(cssW * dpr)));
			const H = Math.max(2, Math.min(8192, Math.round(cssH * dpr)));
			canvas.width = W;
			canvas.height = H;
			const gl = canvas.getContext("webgl2", GL_ATTRS) || canvas.getContext("webgl", GL_ATTRS);
			if (!gl) {
				GL_INFO.ok = false;
				GL_INFO.reason = "no-context-for-layer";
				return null;
			}
			gl.disable(gl.DEPTH_TEST);
			gl.disable(gl.BLEND);
			gl.disable(gl.CULL_FACE);
			const quad = glQuadBuffer(gl);
			let core;
			if (kind === "paper") core = createPaperGL(gl, quad, W, H, cssW, cssH, dpr);
			else if (kind === "moire") core = createMoireGL(gl, quad, W, H, cssW, cssH, dpr);
			else core = createCausticsGL(gl, quad, W, H, cssW, cssH, dpr);
			/* 先画一帧确认真的能出图，再把它当成可用路径 */
			core.render(0);
			const err = gl.getError();
			if (err !== gl.NO_ERROR) throw new Error("gl-error-" + err);
			canvas.addEventListener("webglcontextlost", (event) => {
				event.preventDefault();
				GL_INFO.ok = false;
				GL_INFO.reason = "context-lost";
				renderers[kind] = null;
				repaint();
			});
			core.canvas = canvas;
			core.gl = gl;
			return core;
		}

		/* ── 每个模式的渲染器（按需创建，创建后缓存：切换不用重新烘焙） ── */

		const renderers = { paper: null, moire: null, caustics: null };
		const stats = { fps: [], work: [] };
		const resetStats = () => {
			stats.fps.length = 0;
			stats.work.length = 0;
		};

		/* DPR 上限 2：再高只是白烧显存，肉眼已经分不出来。 */
		const glDpr = () => Math.min(2, Math.max(1, window.devicePixelRatio || 1));

		function ensure(kind) {
			if (renderers[kind]) return renderers[kind];
			const cssW = Math.max(1, window.innerWidth);
			const cssH = Math.max(1, window.innerHeight);
			pointerSeed(cssW, cssH);
			let r = null;
			/* ① 默认走 WebGL（原生 1:1） */
			if (glProbe().ok) {
				try {
					r = createGLRenderer(kind, cssW, cssH, glDpr());
				} catch (error) {
					r = null;
					/* 单档建不出来只让**这一档**退回 CPU —— 别把整条 WebGL 路一起判死。 */
					GL_INFO.failed[kind] = String((error && error.message) || error).slice(0, 400);
				}
			}
			/* ② 建不出来 / 建出来不能用 → 退回 CPU 渲染器（低分辨率 + CSS 放大） */
			if (!r) {
				const aspect = Math.max(0.4, cssW / cssH);
				const [iw, ih] = fitBudget(aspect, BUDGET[kind]);
				r =
					kind === "paper"
						? createPaper(iw, ih, TUNE.paper)
						: kind === "moire"
							? createMoire(iw, ih, TUNE.moire)
							: createCaustics(iw, ih, TUNE.caustics);
				r.path = "cpu";
			}
			/* 语义标记（[data-dsh-warm-wallpaper-layer]）由 mountLayer 在入文档那一刻贴，
			   这里只留"这张画布是谁、走的哪条路"两个自报信息。 */
			r.canvas.setAttribute("aria-hidden", "true");
			r.canvas.setAttribute("data-dsh-warm-wallpaper-kind", kind);
			r.canvas.setAttribute("data-dsh-warm-wallpaper-path", r.path);
			renderers[kind] = r;
			return r;
		}

		function dropAll() {
			for (const kind of Object.keys(renderers)) {
				const r = renderers[kind];
				if (!r) continue;
				r.canvas.remove();
				renderers[kind] = null;
			}
		}

		/**
		 * 换代清扫：把页面上残留的画布与缓存里的渲染器一起清掉。
		 *
		 * 为什么需要：热重载会先跑旧实例的清理、再跑新实例，正常情况下不留残迹；
		 * 但只要清理抛过一次（WebGL 丢失、烘焙异常都可能），页面上就会同时挂两代
		 * 画布 —— 两张铺满视口的 fixed 层叠在一起，用户看到的就是「壁纸发暗/花掉」。
		 * 所以挂载前先清扫，保证同类节点永远只有一个（warm-ui 里 sweepOwned 同理）。
		 * @returns {number} 被撤掉的旧画布数
		 */
		function sweepLayers() {
			let removed = 0;
			for (const el of document.querySelectorAll("[" + LAYER_ATTRIBUTE + "]")) {
				el.remove();
				removed += 1;
			}
			for (const kind of Object.keys(renderers)) {
				if (renderers[kind]) renderers[kind] = null;
			}
			return removed;
		}

		/* ── 侧栏控件 ───────────────────────────────────────────────────── */

		const LISTENERS = new Set();
		let repaint = () => {};

		const readMode = () => {
			try {
				const raw = window.localStorage.getItem(KEY);
				if (raw == null) return DEFAULT_MODE;
				const value = Number(raw);
				return MODES[value] ? value : DEFAULT_MODE;
			} catch (error) {
				return DEFAULT_MODE;
			}
		};
		const writeMode = (value) => {
			try {
				window.localStorage.setItem(KEY, String(value));
			} catch (error) {
				/* 隐私模式写不进去也不影响本次会话 */
			}
		};
		const pick = (value) => {
			writeMode(value);
			repaint();
			for (const fn of LISTENERS) fn();
			/* 档位长在「外观」面板里时，也让那个面板重渲染（高亮才会跟着动） */
			window.__dshWarmAppearance?.notify?.();
		};

		/* ── 并进「外观」面板的分组 ────────────────────────────────────────
		 *  壁纸不再自己占侧栏底部一行，而是把四档注册进 dsh-warm-ui 的外观面板。
		 *  这里只描述数据，渲染交给那个面板。拿不到那个扩展点（比如单独装在没装
		 *  warm-ui 的实例上）时，下面的 WallpaperControl 仍然会自己占一行。 */
		const SECTION_ID = "dsh-warm-wallpaper";
		function appearanceSection() {
			return {
				id: SECTION_ID,
				title: "壁纸",
				rows: [
					{
						key: "mode",
						label: "模式",
						get: readMode,
						set: (v) => pick(v),
						options: Object.keys(MODES).map((m) => ({
							value: Number(m),
							text: MODES[m].name,
							title: MODES[m].kind ? `${MODES[m].name}（动态）` : "关掉动态壁纸",
						})),
					},
				],
			};
		}

		function WallpaperControl() {
			const [open, setOpen] = React.useState(false);
			const [, force] = React.useState(0);
			const rowRef = React.useRef(null);
			const popRef = React.useRef(null);

			React.useEffect(() => {
				const fn = () => force((x) => x + 1);
				LISTENERS.add(fn);
				return () => {
					LISTENERS.delete(fn);
				};
			}, []);

			/* 侧栏底部那一簇是横向 flex，三个入口并排会各自只剩 1/3 宽，摘要换行。
			   找到真正的 flex 容器让它允许换行，自己占一整行。 */
			React.useLayoutEffect(() => {
				let host = rowRef.current;
				while (host && getComputedStyle(host).display === "contents") host = host.parentElement;
				if (!host || host === document.body) return undefined;
				host.setAttribute(HOST_ATTRIBUTE, "");
				return () => host.removeAttribute(HOST_ATTRIBUTE);
			}, []);

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

			const mode = readMode();
			const row = (value, name, hint) =>
				h(
					"button",
					{
						key: value,
						type: "button",
						title: hint,
						"data-on": String(mode === value),
						onClick: () => {
							pick(value);
							setOpen(false);
						},
					},
					name,
				);

			return h(
				React.Fragment,
				null,
				h(
					"button",
					{
						ref: rowRef,
						type: "button",
						className: "wlp-row",
						"aria-haspopup": "menu",
						"aria-expanded": String(open),
						title: `动态壁纸：${MODES[mode]?.name || "关"}`,
						onClick: () => setOpen((v) => !v),
					},
					h(
						"span",
						{ className: "wlp-icon", "aria-hidden": "true" },
						h(
							"svg",
							{ width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg" },
							h("rect", {
								x: 2.2,
								y: 3.2,
								width: 11.6,
								height: 9.6,
								rx: 1.8,
								stroke: "currentColor",
								strokeWidth: 1.3,
							}),
							h("path", {
								d: "M2.6 10.2l3.1-2.6 2.3 2 2.2-2.4 3.1 3.1",
								stroke: "currentColor",
								strokeWidth: 1.3,
								strokeLinecap: "round",
								strokeLinejoin: "round",
								opacity: 0.85,
							}),
						),
					),
					h("span", { className: "wlp-label" }, "壁纸"),
					h("span", { className: "wlp-value" }, MODES[mode]?.name || "关"),
				),
				open
					? h(
							"div",
							{ ref: popRef, className: "wlp-pop", role: "menu" },
							h(
								"div",
								{ className: "wlp-line" },
								h("span", { className: "wlp-key" }, "壁纸"),
								row(0, "关", "撤掉画布，UI 回到完全不透明"),
								row(1, "纸", "特种纸 / 纤维：一道极慢掠光把纤维照出来"),
								row(2, "摩尔纹", "两组同心环的干涉带：细线、有暗区、有焦点"),
								row(3, "焦散", "光线汇聚的细丝光网：大面积极暗，少数地方亮着"),
							),
							h("div", { className: "wlp-tip" }, "点一下即切换。挂在整个 UI 后面，只从大面透出来"),
						)
					: null,
			);
		}

		/* ── 样式表 ─────────────────────────────────────────────────────── */

		const STYLESHEET = `
/* ── 变量层 ────────────────────────────────────────────────────────────
   面板（侧栏底部那几个入口 + 点开的档位面板）的观感常数全部收在这里：以后改
   一处观感只动一个数，不用到下面几条规则里翻。值是 var(...) 的项保留了对主题
   token 的引用（token 在就听主题的，不在才用兜底），不是把主题色写死。 */
:root {
  --wlp-row-height: 42px;
  --wlp-row-gap: 8px;
  --wlp-row-pad-x: 10px;
  --wlp-row-radius: 8px;
  --wlp-row-font: 13px;
  --wlp-value-font: 12px;
  --wlp-value-opacity: .72;

  --wlp-pop-z: 2147483600;
  --wlp-pop-width: 296px;
  --wlp-pop-pad: 6px;
  --wlp-pop-radius: 10px;
  --wlp-pop-bg: var(--dsw-alias-bg-elevated, #26201a);
  --wlp-pop-shadow: 0 12px 32px rgba(0, 0, 0, .45),
    0 0 0 1px var(--dsw-alias-border-l2, rgba(255, 255, 255, .08));
  --wlp-line-gap: 6px;
  --wlp-line-pad: 3px 4px;
  --wlp-key-width: 34px;
  --wlp-key-font: 12px;
  --wlp-key-opacity: .7;
  --wlp-btn-min-width: 30px;
  --wlp-btn-height: 24px;
  --wlp-btn-pad-x: 9px;
  --wlp-btn-radius: 6px;
  --wlp-btn-font: 12px;
  --wlp-tip-pad: 6px 8px 2px;
  --wlp-tip-font: 11px;
  --wlp-tip-leading: 1.5;
  --wlp-tip-opacity: .55;

  --wlp-hover-bg: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, .06));
  --wlp-active-bg: var(--dsw-alias-interactive-bg-active, rgba(255, 255, 255, .12));
}

/* 画布是 body 的直接子节点，z-index:-1 —— 它排在根背景之上、所有内容之下。
   不用 mix-blend-mode（会穿不过 stacking context，而且用户不喜欢那种突兀），
   也不用 filter（全屏 blur 是性能红线）。
   定位/尺寸那几行由 LAYER_PINS 生成（JS 那份内联用的就是它），
   改一处两边一起变；只有 display 归样式表管 —— 关模式要靠它把画布藏掉。 */
[${LAYER_ATTRIBUTE}] {
${layerCss()}
  display: block;
}
:root[${MODE_ATTRIBUTE}="0"] [${LAYER_ATTRIBUTE}] { display: none; }

/* 让「铺满视口的大面」变透明，背景才透得出来。名单见 CLEAR_SURFACES（加一行
   就多一条选择器），全部用类名后缀匹配、不依赖 CSS-module 的 hash；命中不到
   只是背景看不见，不会弄坏 UI。卡片 / 菜单 / 输入框 / 浮层一律不碰 ——
   文字落在自己的不透明底上。

   第一行（html / body）的来历要说清楚，别让后来的人以为它是"修好的那个 bug"：
   当时在 Edge 里量到「负 z-index 的画布会画在父元素背景之前」，于是推测 Firefox
   会把 body 那层底色盖在壁纸上，先补了这条。**后来用 Marionette 驱动真 Firefox
   复测，这个推测没有被证实**：真 Firefox（GPU/WebGL 正常）里壁纸在会话顶部、
   底部、空状态都画得好好的，画布满屏、层次也对；当初读到的"整页纯 #141414、
   高频 0.000"来自一个连 WebGL 都画不出来的无头 Firefox（同环境下一张纯 WebGL
   测试页也是空的），那是取样环境的问题，不是页面被盖住。

   那为什么还留着：① 无害 —— 关掉壁纸时 ON 属性不存在，这条整个不生效，底色
   原样回来；② 画布的暗场本来就是照 UI 底色调的，底色撤掉后由画布顶着；
   ③ 万一哪台引擎真的按"负 z-index 在父背景之前"画，这条就是那道保险。 */
:root[${ON_ATTRIBUTE}],
:root[${ON_ATTRIBUTE}] body {
  background-color: transparent !important;
}
${clearSurfaceSelector()} {
  background-color: transparent !important;
}
/* 侧栏保住一点自己的底色（比正文区暗一档的层次），只留很淡一层。
   --wlp-side 由 JS 从 --dsw-specific-sidebar-fill 现算，主题换色也跟着换；
   这里的兜底值由 SIDE 表生成，不手写第二份。 */
:root[${ON_ATTRIBUTE}] [class$="_sidebarCol"] {
  background-color: var(--wlp-side, ${withAlpha(SIDE.base, SIDE.alpha)}) !important;
}
/* 会话列表底部那条原生渐隐带（.bhn1Oq_fade）是"上色型"的：收尾色写死为不透明的
   --dsw-specific-sidebar-fill。侧栏被本插件改成半透明后，它就不再等于周围的真实底色，
   底边会留下一条横向硬缝（见 LIST_EDGE_FADE 的注释）。这里换成"内容自己渐隐"：
   撤掉原生那层上色，改用同样 24px 的遮罩打在内容容器上 —— 透出来的是与下方
   逐像素相同的底色，壁纸多亮都不会再有接缝。
   注意 [class*="_treeBody"] 必须用 *=：该元素实测带附加类（bhn1Oq_treeBody bhn1Oq_wide），
   后缀匹配 [class$=...] 命中不到（页内试验已经复现过这个假阴性）。 */
:root[${ON_ATTRIBUTE}] [class$="_sidebarCol"] [class*="_fade"] {
  background-image: none !important;
}
:root[${ON_ATTRIBUTE}] [class$="_sidebarCol"] [class*="_treeBody"] {
  -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - ${LIST_EDGE_FADE.heightPx}px), transparent);
  mask-image: linear-gradient(to bottom, #000 calc(100% - ${LIST_EDGE_FADE.heightPx}px), transparent);
}

/* 侧栏底部三个入口各占一整行 */
[${HOST_ATTRIBUTE}] { flex-wrap: wrap; }
[${HOST_ATTRIBUTE}] .wta-row,
[${HOST_ATTRIBUTE}] .dyb-row,
[${HOST_ATTRIBUTE}] .wlp-row { flex: 1 1 100%; }

.wlp-row {
  display: flex;
  align-items: center;
  gap: var(--wlp-row-gap);
  width: 100%;
  height: var(--wlp-row-height);
  padding: 0 var(--wlp-row-pad-x);
  border: 0;
  border-radius: var(--wlp-row-radius);
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  font: inherit;
  font-size: var(--wlp-row-font);
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}
.wlp-row:hover { background: var(--wlp-hover-bg); }
.wlp-icon { display: inline-flex; flex: 0 0 auto; }
.wlp-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.wlp-value { flex: 0 0 auto; opacity: var(--wlp-value-opacity); font-size: var(--wlp-value-font); }

.wlp-pop {
  position: fixed;
  z-index: var(--wlp-pop-z);
  width: var(--wlp-pop-width);
  padding: var(--wlp-pop-pad);
  border-radius: var(--wlp-pop-radius);
  background: var(--wlp-pop-bg);
  box-shadow: var(--wlp-pop-shadow);
}
.wlp-line { display: flex; align-items: center; gap: var(--wlp-line-gap); padding: var(--wlp-line-pad); }
.wlp-key { flex: 0 0 var(--wlp-key-width); font-size: var(--wlp-key-font); opacity: var(--wlp-key-opacity); }
.wlp-line button {
  min-width: var(--wlp-btn-min-width);
  height: var(--wlp-btn-height);
  padding: 0 var(--wlp-btn-pad-x);
  border: 0;
  border-radius: var(--wlp-btn-radius);
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  font: inherit;
  font-size: var(--wlp-btn-font);
  cursor: pointer;
}
.wlp-line button:hover { background: var(--wlp-hover-bg); }
.wlp-line button[data-on="true"] {
  background: var(--wlp-active-bg);
  color: var(--dsw-alias-label-primary, inherit);
}
.wlp-tip {
  padding: var(--wlp-tip-pad);
  font-size: var(--wlp-tip-font);
  line-height: var(--wlp-tip-leading);
  opacity: var(--wlp-tip-opacity);
}
`;

		/* ── 运行时 ─────────────────────────────────────────────────────── */

		/** 把 #rrggbb / rgb() 变成带 alpha 的 rgba()。 */
		function withAlpha(color, alpha) {
			const m = String(color).trim().match(/^#([0-9a-f]{6})$/i);
			if (m) {
				const n = parseInt(m[1], 16);
				return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
			}
			const r = String(color).match(/rgba?\(([^)]+)\)/);
			if (r) {
				const parts = r[1].split(",").map((s) => parseFloat(s));
				return `rgba(${Math.round(parts[0])}, ${Math.round(parts[1])}, ${Math.round(parts[2])}, ${alpha})`;
			}
			return `rgba(26, 26, 26, ${alpha})`;
		}

		/* 基础样式表：模块作用域就插好（官方写法也是在模块作用域插），
		   卸载时由 apply 的清理函数撤掉。注入三件套的实现与"为什么必须自己打标"
		   都收在共享包里（见文件上方 `require("dsh-warm-shared")` 那一处）。 */
		const baseStyleSheet = installStyleSheet("base", STYLESHEET, STYLE_ATTRIBUTE);

		function apply(ctx) {
			ctx.effect(() => {
				/* 换代清扫：上一代万一没被 dispose 干净，先撤掉再挂新的（见 sweepLayers）。 */
				sweepLayers();

				const root = document.documentElement;
				const rootStyle = root.style;
				const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
				POINTER.reduce = reduce.matches;

				/* 侧栏底色：从当前主题 token 现算，主题换色时重算。
				   α 和兜底色都取自 SIDE 表 —— 样式表里那份兜底值由同一张表生成。 */
				const paintSide = () => {
					let raw = "";
					try {
						raw = getComputedStyle(document.body).getPropertyValue("--dsw-specific-sidebar-fill");
					} catch (error) {
						raw = "";
					}
					if (!raw || !raw.trim()) raw = SIDE.base;
					rootStyle.setProperty("--wlp-side", withAlpha(raw, SIDE.alpha));
				};

				let raf = 0;
				let currentKind = null;
				let lastTick = performance.now();
				let cooldown = 0;
				const t0 = performance.now();

				const step = (now) => {
					raf = 0;
					const mode = readMode();
					const kind = MODES[mode] ? MODES[mode].kind : null;
					if (kind !== currentKind) {
						// 档位被外部（localStorage / 自检口）改过：走一遍完整的重铺
						repaint();
						return;
					}
					const tickDt = now - lastTick;
					lastTick = now;
					stats.fps.push(tickDt);
					if (stats.fps.length > 600) stats.fps.shift();
					/* 指针视差的临界阻尼推进（和画不画壁纸无关，先推） */
					pointerStep(tickDt / 1000);
					if (!kind) return;

					/* 让路：上一帧间隔已经超了 22ms（主线程吃紧，比如正在滚动），
					   或者自己这一笔画得太贵，就多歇两帧再画。背景是 48s/113s 时间
					   尺度的东西，少画两帧看不出来，但页面帧率能守住。 */
					if (cooldown > 0) {
						cooldown -= 1;
						raf = window.requestAnimationFrame(step);
						return;
					}

					const r = ensure(kind);
					const cost = r.render((now - t0) / 1000);
					stats.work.push(cost);
					if (stats.work.length > 600) stats.work.shift();
					if (r.path === "webgl") {
						/* WebGL 路径每帧都在推进指针视差 —— 丢帧就是「一顿一顿」。
						   真正的活在 GPU 上（CPU 侧量到的 cost ≈ 0.1ms），别主动 frame skip。 */
						cooldown = 0;
					} else {
						const skip = FRAME_SKIP[currentKind] || 2;
						// 每档的「这一笔算贵了」阈值不同：焦散单帧本来就重
						const heavy = skip >= 4 ? 14 : 9;
						cooldown = tickDt > 22 || cost > heavy ? skip + 1 : skip - 1;
					}
					raf = window.requestAnimationFrame(step);
				};

				const kick = () => {
					lastTick = performance.now();
					cooldown = 0;
					if (!raf && !document.hidden && !reduce.matches) raf = window.requestAnimationFrame(step);
				};

				/* 模式一变：挂上/摘掉画布、写根属性、点亮或撤掉「大面透明」覆盖 */
				repaint = () => {
					paintSide();
					resetStats();
					const raw = readMode();
					const mode = MODES[raw] ? raw : DEFAULT_MODE;
					const kind = MODES[mode].kind;
					currentKind = kind; // 让 rAF 循环知道该画哪个，别再走一遍 repaint
					root.setAttribute(MODE_ATTRIBUTE, String(mode));
					if (kind) {
						const r = ensure(kind);
						if (r.canvas.parentNode !== document.body) mountLayer(r.canvas);
						else pinLayer(r.canvas);
						// 其它模式的画布留着（烘焙结果缓存着），但不显示
						for (const other of Object.keys(renderers)) {
							const o = renderers[other];
							if (o && o !== r && o.canvas.parentNode === document.body) o.canvas.remove();
						}
						root.setAttribute(ON_ATTRIBUTE, "");
						// 切模式时立刻画一帧，别等下一帧出现空白
						r.render((performance.now() - t0) / 1000);
						kick();
					} else {
						root.removeAttribute(ON_ATTRIBUTE);
						for (const other of Object.keys(renderers)) {
							const o = renderers[other];
							if (o && o.canvas.parentNode === document.body) o.canvas.remove();
						}
						if (raf) {
							window.cancelAnimationFrame(raf);
							raf = 0;
						}
					}
				};

				/* 尺寸变化：重建（重新烘焙）。防抖，别在拖窗口时疯狂烘焙。 */
				let resizeTimer = 0;
				const onResize = () => {
					window.clearTimeout(resizeTimer);
					resizeTimer = window.setTimeout(() => {
						const wasKind = currentKind;
						dropAll();
						currentKind = null;
						if (wasKind) {
							ensure(wasKind);
							repaint();
						}
					}, 220);
				};

				/* 主题换色（暖度/面亮/字色…）会重写 body 的 token，重算侧栏那一层 */
				const themeObserver = new MutationObserver(() => paintSide());

				const onVisibility = () => {
					if (document.hidden) {
						if (raf) {
							window.cancelAnimationFrame(raf);
							raf = 0;
						}
					} else {
						kick();
					}
				};
				const onMotion = () => {
					POINTER.reduce = reduce.matches;
					if (reduce.matches) {
						if (raf) {
							window.cancelAnimationFrame(raf);
							raf = 0;
						}
						if (currentKind) ensure(currentKind).render((performance.now() - t0) / 1000);
					} else {
						kick();
					}
				};

				/* 指针：事件里只记 target（零节流），位移在 rAF 里过临界阻尼跟。
				   CSS px、左上原点。 */
				const onPointer = (event) => {
					POINTER.tx = event.clientX;
					POINTER.ty = event.clientY;
					if (!POINTER.init) pointerSeed(window.innerWidth, window.innerHeight);
					if (reduce.matches) {
						/* 没有逐帧循环：直接跟手 + 只画一帧（位置跟随保留，不做缓动动画） */
						pointerSnap();
						if (currentKind) ensure(currentKind).render((performance.now() - t0) / 1000);
					}
				};

				window.addEventListener("resize", onResize);
				window.addEventListener("pointermove", onPointer, { passive: true });
				document.addEventListener("visibilitychange", onVisibility);
				if (reduce.addEventListener) reduce.addEventListener("change", onMotion);
				themeObserver.observe(document.body, { attributes: true, attributeFilter: ["style", "class", "data-ds-dark-theme"] });

				repaint();

				/* — 控件：优先并进侧栏底部的「外观」面板（省掉一整行）；
				      拿不到那个扩展点就退回自己占一行。

				      这一段**故意放在最前面**，而且会反复自检。原因：分组是注册者自己
				      挂上去的，而插件热重载（或 warm-ui 自己热重载 —— 它的分组数组是
				      模块级的，重载即清空并换掉 window.__dshWarmAppearance）会先跑旧实例
				      的清理、再跑新实例；只要新实例在走到注册那一步之前出错、或两者顺序
				      被打乱，分组就永久消失。而壁纸画面照旧在画（那段没被撤），于是表现成
				      「背景好好的，但外观面板里调不了它了」。注册放最前 + 定时自检补注册，
				      就再也不需要用户刷新页面。 — */
				let disposeControl = () => {};
				let controlKind = ""; /* "" 没挂 | "panel" 并进了外观面板 | "slot" 自己占一行 */
				const ensureControl = () => {
					const panel = window.__dshWarmAppearance;
					if (panel && typeof panel.register === "function") {
						/* 已经在面板上就什么都不做：重复注册会白触发一次面板重渲染。
						   老版本 warm-ui 没有 has()，那时只能信自己记的状态。 */
						if (typeof panel.has === "function") {
							if (panel.has(SECTION_ID)) {
								controlKind = "panel";
								return;
							}
						} else if (controlKind === "panel") return;
						try {
							const dispose = panel.register(appearanceSection());
							if (typeof dispose === "function") disposeControl = dispose;
							controlKind = "panel";
						} catch (error) {
							/* 挂不上面板不影响壁纸本身 */
						}
						return;
					}
					if (controlKind === "slot") return;
					if (React && ctx.slots && typeof ctx.slots.inject === "function") {
						try {
							const dispose = ctx.slots.inject("sidebar.footer.action", () =>
								ctx.slots.register(
									{ name: "sidebar.footer.action", id: "dsh-warm-wallpaper-control", order: 30 },
									WallpaperControl,
								),
							);
							if (typeof dispose === "function") disposeControl = dispose;
							controlKind = "slot";
						} catch (error) {
							controlKind = "";
						}
					}
				};
				ensureControl();
				/* 自检节奏：每 5s 一次。代价只是一次数组查找（分组没丢就直接返回），
				   换来的是"分组丢了会自己长回来"。不挂 visibilitychange 是因为标签页
				   隐藏时定时器仍在跑（只是被节流），回来看之前就已经补好了。 */
				const CONTROL_SYNC_MS = 5000;
				const controlTimer = window.setInterval(ensureControl, CONTROL_SYNC_MS);

				/* — 自检口（只在 3082 用，方便脚本核对数值与切档） — */
				window.__dshWallpaper = {
					setMode: (value) => pick(value),
					/** 强制走哪条路：'webgl' | 'cpu' | 'auto'。立即重建，用来做 A/B。 */
					setRenderer: (path) => {
						glForce = path === "cpu" ? "cpu" : path === "webgl" ? "webgl" : null;
						GL_INFO.tried = false;
						GL_INFO.ok = false;
						GL_INFO.reason = "";
						dropAll();
						currentKind = null;
						repaint();
						return { path: currentKind ? ensure(currentKind).path : null, gl: { ...GL_INFO } };
					},
					/** 调参口（只在 3082 用）：改像素预算/帧率/GL 参数再重建，方便扫参数。 */
					configure: (opts) => {
						if (opts) {
							if (opts.paper) BUDGET.paper = opts.paper;
							if (opts.moire) BUDGET.moire = opts.moire;
							if (opts.frameSkip) {
								if (typeof opts.frameSkip === "number") {
									for (const k of Object.keys(FRAME_SKIP)) FRAME_SKIP[k] = opts.frameSkip;
								} else {
									Object.assign(FRAME_SKIP, opts.frameSkip);
								}
							}
							if (opts.caustics) BUDGET.caustics = opts.caustics;
							if (opts.paperOpts) Object.assign(PAPER, opts.paperOpts);
							if (opts.tune) Object.assign(TUNE.paper, opts.tune.paper || {}, opts.tune.moire ? {} : {});
							if (opts.tuneMoire) Object.assign(TUNE.moire, opts.tuneMoire);
							if (opts.tuneCaustics) Object.assign(TUNE.caustics, opts.tuneCaustics);
							if (opts.pointer) {
								const q = opts.pointer;
								if (q.on != null) POINTER.on = !!q.on;
								if (q.amp != null) POINTER.amp = Number(q.amp) || 0;
								if (q.tau != null) POINTER.tau = Math.max(0.02, Number(q.tau) || 0.55);
								if (q.x != null) POINTER.tx = Number(q.x);
								if (q.y != null) POINTER.ty = Number(q.y);
								if (q.snap) pointerSnap();
								if (q.depth) Object.assign(DEPTH, q.depth);
							}
							/* GL 侧调参：纸 / 摩尔纹 / 焦散各自浅合并 */
							if (opts.gl) {
								for (const k of ["paper", "moire", "caustics"]) {
									if (!opts.gl[k]) continue;
									const src = opts.gl[k];
									for (const key of Object.keys(src)) {
										if (key === "pools") GLP.caustics.pools = src.pools.map((r) => r.slice());
										else if (key === "waves") GLP.caustics.waves = src.waves.map((r) => r.slice());
										else GLP[k][key] = src[key];
									}
								}
							}
							dropAll();
							currentKind = null;
							repaint();
						}
						return {
							budget: { ...BUDGET },
							frameSkip: { ...FRAME_SKIP },
							paper: { ...PAPER },
							tune: JSON.parse(JSON.stringify(TUNE)),
							gl: JSON.parse(JSON.stringify(GLP)),
							pointer: pointerInfo(),
							depth: JSON.parse(JSON.stringify(DEPTH)),
						};
					},
					/** 画布像素的亮度分布（两条路都支持）—— 量「最亮处正文对比度」用。 */
					sample: () => {
						const kind = MODES[readMode()].kind;
						if (!kind) return null;
						const r = ensure(kind);
						r.render((performance.now() - t0) / 1000);
						const w = r.size[0];
						const h2 = r.size[1];
						let data = null;
						if (r.path === "webgl") {
							const buf = new Uint8Array(w * h2 * 4);
							r.gl.readPixels(0, 0, w, h2, r.gl.RGBA, r.gl.UNSIGNED_BYTE, buf);
							data = buf;
						} else {
							const cx = r.canvas.getContext("2d");
							if (!cx) return null;
							data = cx.getImageData(0, 0, w, h2).data;
						}
						const lin = (v) => {
							const c = v / 255;
							return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
						};
						const L = new Float64Array(w * h2);
						let max = 0;
						let over40 = 0;
						let over60 = 0;
						let over90 = 0;
						for (let i = 0, p = 0; i < data.length; i += 4, p++) {
							const v = 0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]);
							L[p] = v;
							const g = (data[i] + data[i + 1] + data[i + 2]) / 3;
							if (g > 40) over40 += 1;
							if (g > 60) over60 += 1;
							if (g > 90) over90 += 1;
							if (v > max) max = v;
						}
						const sorted = Float64Array.from(L).sort();
						const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
						const TEXT_L = 0.2126 * lin(223) + 0.7152 * lin(225) + 0.0722 * lin(230);
						const ratio = (v) => +((TEXT_L + 0.05) / (v + 0.05)).toFixed(2);
						const n = w * h2;
						return {
							path: r.path,
							size: [w, h2],
							p50: +q(0.5).toFixed(4),
							p90: +q(0.9).toFixed(4),
							p95: +q(0.95).toFixed(4),
							p99: +q(0.99).toFixed(4),
							p999: +q(0.999).toFixed(4),
							max: +max.toFixed(4),
							contrast: { p50: ratio(q(0.5)), p95: ratio(q(0.95)), p999: ratio(q(0.999)), max: ratio(max) },
							area: { over40: +(over40 / n).toFixed(4), over60: +(over60 / n).toFixed(4), over90: +(over90 / n).toFixed(4) },
						};
					},
					state: () => {
						const mode = readMode();
						const kind = MODES[mode].kind;
						const r = kind ? renderers[kind] : null;
						const cvs = [...document.querySelectorAll(`[${LAYER_ATTRIBUTE}]`)];
						const cs = cvs.length ? getComputedStyle(cvs[0]) : null;
						const rect = cvs.length ? cvs[0].getBoundingClientRect() : null;
						const srt = (a) => a.slice().sort((x, y) => x - y);
						const q = (a, p) => (a.length ? +a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(2) : 0);
						const f = srt(stats.fps.slice(-240));
						const w = srt(stats.work.slice(-240));
						return {
							mode,
							kind,
							/* ★ 当前走的哪条路：'webgl' = 原生 1:1 全屏着色器；'cpu' = 低分辨率 + CSS 放大 */
							path: r ? r.path : null,
							pointer: pointerInfo(),
							dpr: glDpr(),
							gl: Object.assign({}, GL_INFO, { failed: { ...GL_INFO.failed } }),
							bakeMs: r && r.bakeMs ? +r.bakeMs.toFixed(2) : 0,
							canvasCount: cvs.length,
							internal: r ? r.size : null,
							css: rect ? [Math.round(rect.width), Math.round(rect.height)] : null,
							z: cs ? cs.zIndex : null,
							position: cs ? cs.position : null,
							blend: cs ? cs.mixBlendMode : null,
							filter: cs ? cs.filter : null,
							display: cs ? cs.display : null,
							punch: root.hasAttribute(ON_ATTRIBUTE),
							side: rootStyle.getPropertyValue("--wlp-side"),
							lut: TUNE[kind || "paper"],
							frameSkip: kind && r && r.path === "webgl" ? 1 : kind ? FRAME_SKIP[kind] : null,
							budget: kind && r && r.path === "cpu" ? BUDGET[kind] : null,
							fpsMedian: q(f, 0.5),
							fpsP95: q(f, 0.95),
							over33: f.filter((x) => x > 33).length,
							frames: f.length,
							workMedian: q(w, 0.5),
							workP95: q(w, 0.95),
						};
					},
				};

				return () => {
					window.clearTimeout(resizeTimer);
					window.clearInterval(controlTimer);
					if (raf) window.cancelAnimationFrame(raf);
					window.removeEventListener("resize", onResize);
					document.removeEventListener("visibilitychange", onVisibility);
					if (reduce.removeEventListener) reduce.removeEventListener("change", onMotion);
					window.removeEventListener("pointermove", onPointer);
					themeObserver.disconnect();
					disposeControl();
					repaint = () => {};
					delete window.__dshWallpaper;
					root.removeAttribute(MODE_ATTRIBUTE);
					root.removeAttribute(ON_ATTRIBUTE);
					rootStyle.removeProperty("--wlp-side");
					dropAll();
					if (baseStyleSheet) baseStyleSheet.remove();
				};
			}, "dsh-warm-wallpaper: 动态壁纸样品（纸 / 摩尔纹）");
		}

		exports.apply = apply;
		/** 只需要 slots 挂控件；拿不到时壁纸照常，只是没有开关。 */
		exports.inject = ["slots"];
		return module.exports;
	},
});
