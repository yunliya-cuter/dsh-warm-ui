/**
 * dsh-warm-brandgag —— 品牌文字恶搞彩蛋。**3081 真实实例 + 3082 预览实例都挂。**
 *
 * 它单独成包，由两个 home 的 patch 各自引用（3081 ~/.dsh，3082 见 .dsh-warm-preview）。
 * 想关掉：删掉对应 patch 里的 dsh-warm-brandgag 段即可。共用文件
 * dsh-warm-ui/lib/client.js 一个字节都没动。
 *
 * 目标：侧栏左上角那一片
 *     鲸鱼图标 + "deepseek" 字标 + "HARNESS" 圆角徽章
 * 换成
 *     鲸鱼图标 + "deepsleep" 字标 + "遛狗绳" 文字徽章
 *
 * ── 探查结论（2026-09-13，on 3082，DOM 实测）─────────────────────────────
 *
 * 这一片**没有任何文本节点**，整块是**一个 SVG sprite**：
 *
 *   <svg width="156" height="24" viewBox="26 0 156 24" fill="none" aria-hidden="true">
 *     <path d="M68.416…"/> ×9   ← "deepseek" 的 9 条字形轮廓（fill=currentColor）
 *     <g clip-path="url(#dsh-wordmark-whale-clip)">…</g>   ← 鲸鱼（被 clip 裁掉，永不显示）
 *     <rect x="129.348" y="5.5" width="52" height="14" rx="2" fill="currentColor"/>
 *     <g clip-path="url(#dsh-wordmark-badge-clip)">        ← "HARNESS" 7 条字形
 *       <path fill="var(--dsw-alias-label-primary-inverted)"/> ×7
 *     </g>
 *     <defs>…两个 clipPath…</defs>
 *   </svg>
 *
 * 屏幕位置：svg 在 (48,24)，viewBox 原点 x=26 → screenX = 48 + (userX − 26)。
 *   · 字标字形 user x=27…121.5（= screen 49…143.5），基线 y=18.62，字高 14（含降部）
 *   · 每字步进 12，字宽 10.4，因此原字距 1.6
 *   · 徽章矩形 user x=129.348…181.348 / y=5.5…19.5（= screen 151.3…203.3 / 29.5…43.5）
 *   · 徽章文字 user x=132.848…178.4 / y=8.93…16.14，高 7.2，7 个等宽大写字母
 *
 * 没有 aria-label / title（`aria-hidden="true"`），外层是 <span class="…brandName">
 * 用 flex + gap:6px 排的。
 *
 * ── 做法 ────────────────────────────────────────────────────────────────
 *
 * **不重画路径，只用它自己已有的字形重新排版。** 把原字标那 9 条 path 隐藏，再在
 * 同一个 svg 里插一个 <g> 覆盖层，把原字形**克隆 + translate** 拼成 "deepsleep"：
 *
 *   d e e p s l e e p
 *   ↑ 全都能在 "deepseek" 的原字形里找到：
 *     d = M31.9551…（唯一的上伸部）
 *     e = M49.3786…（4 份完全相同的副本）
 *     p = M68.416…（唯一的降部）
 *     s = M80.242…
 *     l = "k" 的竖笔 M113.5…（宽 2.4，正是这个字体的笔画宽度）
 *
 * 所以字重、字面、圆角、抗锯齿**与原字标逐像素同源** —— 比用系统字体渲染一个
 * "差不多的 sans" 忠实得多。
 *
 * ── 'l' 的字格（踩过的坑，别再踩）────────────────────────────────────────
 *
 * 原字标 8 个字形的**左边距全是 0**、字面宽全是 10.4、步进全是 12 —— 即这个手绘
 * 字标的"字距"就是右边距 `GAP = 12 − 10.4 = 1.6`，且字形一律贴字格左缘。
 *
 * 第一版给 'l' 也吃满一整格 12、并把 2.4 宽的竖笔在格里居中，结果 s→l 和 l→e
 * 的间隙各 5.6px（正常字距的 3.5 倍），8 倍图下读成 "deeps l eep" 三个碎块。
 *
 * 正确做法：'l' 的字格 = 笔画宽 + 一个正常字距 = 2.4 + 1.6 = **4.0**，竖笔**贴字格
 * 左缘**（和其余字形一致）。此时
 *     s 右缘 85.4 →(1.6)→ 竖笔 87.0…89.4 →(1.6)→ e 左缘 91.0 →(1.6)→ e
 * 两侧间隙都等于 GAP，与 e→e 完全一样。
 * ⚠️ 别"居中"：s 的右边距 1.6 已经先垫在字格外了，再居中会把空白平摊成
 * s→l = 1.6+1.8 = 3.4、l→e = 1.8，左右不等。
 *
 * ── sprite 加宽量 GROW ─────────────────────────────────────────────────
 *
 * 9 个字比 8 个字宽，多出来的量 = 新字标墨迹右缘 − 原字标墨迹右缘，**由排布算出来**，
 * 不手写：`GROW = newRight − origRight`（origRight 是原 9 条 path 的 bbox 右缘实测值
 * 121.504）。sprite 加宽 GROW、徽章右移 GROW —— 两者必须相等，字标↔徽章的间隙
 * 才逐像素不变（实测加宽前后都是 7.844px）。
 * 加宽后 `width == viewBox 宽`，缩放仍严格 1:1，字形不会落到半像素上。
 * 右边有富余：品牌按钮 216px，原内容 24+8+156=188px，加宽后仍放得下；
 * 徽章右缘离折叠按钮（246）还有 40px 以上。
 *
 * 徽章保留原 rect（形状/圆角/底色/位置都不动），只把里面那 7 条大写字母隐藏，
 * 换成居中的 SVG `<text>遛狗绳</text>`，沿用原来那 7 条 path 用的
 * `var(--dsw-alias-label-primary-inverted)`，因此明暗两套主题下都自动是"反色"。
 *
 * ⚠️ 只改 DOM，不碰 React；React 若重挂这个 svg，MutationObserver 会重铺一遍。
 */

window.__ModuleLoader__.load({
	id: "dsh-warm-brandgag",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		const SVGNS = "http://www.w3.org/2000/svg";

		/** 原 sprite 指纹（viewBox）；class 是哈希的，不能依赖。加宽后靠 DONE 属性认。 */
		const WORDMARK_SELECTOR = 'svg[viewBox="26 0 156 24"], svg[data-brandgag]';

		const DONE_ATTR = "data-brandgag";
		const GROUP_ATTR = "data-brandgag-mark";
		const TEXT_ATTR = "data-brandgag-badge";

		/* ── 文案 ─────────────────────────────────────────────────────────── */

		const NEW_WORD = "deepsleep";
		const NEW_BADGE = "遛狗绳";

		/** 徽章里的「遛狗绳」字号 / 字距 / 字重 / 字族。中文不像大写等宽那样靠字距排版，
		    所以字距贴到几乎为零（0.5 只是为了抵掉一点次像素发虚），读起来才是一个词。 */
		const BADGE_FONT_SIZE = 12;
		const BADGE_LETTER_SPACING = 0.5;
		const BADGE_FONT_WEIGHT = 600;
		const BADGE_FONT_FAMILY =
			'"Microsoft YaHei","PingFang SC","Noto Sans SC","Hiragino Sans GB","Source Han Sans SC",sans-serif';
		/** 「遛狗绳」的光学居中微调（px，正数 = 右 / 下）。
		    把文字按 `text-anchor=middle` + `dominant-baseline=central` 摆好后，**墨迹**
		    的中心并不正好落在徽章矩形中心：8x 截图逐像素量出来偏左 0.6、偏下 0.75，
		    这里补回来。改 BADGE_FONT_SIZE / BADGE_FONT_FAMILY 后要重新量。 */
		const BADGE_NUDGE_X = 0.6;
		const BADGE_NUDGE_Y = -0.75;

		/* ── 原字标的排布（DOM 实测，别改）────────────────────────────────────
		   8 个字形：左边距 0、字面宽 10.4、步进 12 → 字距 GAP = 1.6。 */

		/** 原字标第一个字形的字格左缘。 */
		const START_X = 27;
		/** 原字标每个字形的步进。 */
		const ADVANCE = 12;
		/** 原字标每个字形的字面宽。 */
		const GLYPH_W = 10.4;
		/** 这个字体唯一的字距 = 右边距。'l' 的字格与 sprite 加宽量都从它派生。 */
		const GAP = ADVANCE - GLYPH_W; // 1.6


		/* ── 原字形索引 ───────────────────────────────────────────────────────
		   key = path 的 d 里 "M" 后面那个数（足够区分这 9 条中的任意一条）。 */

		const GLYPH_HEAD = {
			"31.9551": "d",
			"49.3786": "e",
			"61.4045": "e",
			"68.416": "p",
			"80.242": "s",
			"97.4733": "e",
			"109.499": "e",
			"113.5": "stem", // "k" 的竖笔 → 拿来做 "l"
			"117.589": "karm", // "k" 的两撇 → 用不到
		};

		const round = (n) => Math.round(n * 1000) / 1000;

		/* ── 打补丁 ───────────────────────────────────────────────────────── */

		/** 记住元素被我们改之前的原值，卸载时好一字不差地还回去。 */
		function stash(el, attr, value) {
			const key = `data-brandgag-was-${attr}`;
			if (!el.hasAttribute(key)) el.setAttribute(key, value == null ? "\u0000" : value);
		}

		/** 按 stash 的记录还原一个属性（"\u0000" 表示原本没有这个属性）。 */
		function unstash(el, attr) {
			const key = `data-brandgag-was-${attr}`;
			if (!el.hasAttribute(key)) return;
			const was = el.getAttribute(key);
			if (was === "\u0000") el.removeAttribute(attr);
			else el.setAttribute(attr, was);
			el.removeAttribute(key);
		}

		/** 撤掉一条 sprite 上的全部改动，恢复原样（也用于插件卸载）。 */
		function restore(svg) {
			for (const el of svg.querySelectorAll(`:scope > [${GROUP_ATTR}], :scope > [${TEXT_ATTR}]`)) el.remove();
			for (const node of svg.children) {
				const tag = node.tagName.toLowerCase();
				if (tag === "path") node.style.removeProperty("display");
				if (tag === "g" && node.style.display === "none") node.style.removeProperty("display");
				unstash(node, "transform");
			}
			unstash(svg, "viewBox");
			unstash(svg, "width");
			svg.removeAttribute(DONE_ATTR);
			svg.removeAttribute("data-brandgag-grow");
		}

		/**
		 * 把一条品牌 sprite 换成恶搞版。幂等：重复调用只会重建一次覆盖层。
		 * 调用方负责把 MutationObserver 断开（避免自己的改动再触发自己）。
		 * @returns {boolean} 是否成功（找不到字形就返回 false，原样不动）
		 */
		function decorate(svg) {
			// 自己上一次留下的覆盖层先摘掉，保证幂等
			for (const el of svg.querySelectorAll(`:scope > [${GROUP_ATTR}], :scope > [${TEXT_ATTR}]`)) el.remove();

			/* 1) 收集原字形模板（按 d 的开头分类），顺带量出原字标的墨迹右缘 */
			const templates = new Map();
			let origRight = 0;
			for (const node of svg.children) {
				if (node.tagName.toLowerCase() !== "path") continue;
				const head = /^M([\d.]+)/.exec(node.getAttribute("d") || "");
				if (!head) continue;
				let box = null;
				try {
					box = node.getBBox();
				} catch (error) {
					/* getBBox 在未挂载的节点上会抛 —— 那就当没找到 */
					continue;
				}
				origRight = Math.max(origRight, box.x + box.width);
				const role = GLYPH_HEAD[head[1]];
				if (!role || role === "karm") continue;
				templates.set(role, { path: node, box });
			}
			if (!templates.has("d") || !templates.has("s") || !templates.has("stem") || !templates.has("p")) {
				console.warn("[brandgag] 字标 sprite 结构不认识，跳过（DSH 可能升级了）");
				svg.removeAttribute(DONE_ATTR);
				return false;
			}

			/* 2) 隐藏原字标的 9 条 path（鲸鱼和徽章字母在 <g> 里，不受影响） */
			for (const node of svg.children) {
				if (node.tagName.toLowerCase() !== "path") continue;
				node.style.display = "none";
			}

			/* 3) 排一行 "deepsleep"：笔位累加，'l' 只吃 "笔画宽 + 一个正常字距"。
			      见文件头 —— 别给 'l' 吃满一整格，也别在格里居中。 */
			const stemW = templates.get("stem").box.width;
			const L_ADVANCE = round(stemW + GAP);
			const L_INSET = 0; // 竖笔贴字格左缘，和原字标所有字形一致

			const laid = [];
			let pen = START_X;
			for (const ch of NEW_WORD) {
				const tpl = ch === "l" ? templates.get("stem") : templates.get(ch);
				if (!tpl) continue;
				const inset = ch === "l" ? L_INSET : 0;
				laid.push({ ch, tpl, left: pen, inset });
				pen += ch === "l" ? L_ADVANCE : ADVANCE;
			}
			if (laid.length !== NEW_WORD.length) {
				console.warn("[brandgag] 字形不全，跳过");
				svg.removeAttribute(DONE_ATTR);
				return false;
			}

			const group = document.createElementNS(SVGNS, "g");
			group.setAttribute(GROUP_ATTR, "");
			group.setAttribute("fill", "currentColor");
			for (const item of laid) {
				const clone = item.tpl.path.cloneNode(true);
				clone.removeAttribute("style");
				clone.setAttribute(
					"transform",
					`translate(${round(item.left + item.inset - item.tpl.box.x)} 0)`,
				);
				group.append(clone);
			}
			svg.append(group);

			/* 4) sprite 加宽量 = 新墨迹右缘 − 原墨迹右缘（派生，不手写） */
			const last = laid[laid.length - 1];
			const newRight = last.left + last.inset + last.tpl.box.width;
			const GROW = round(newRight - origRight);

			/* 5) 徽章：保留圆角矩形，只换里面的字；整体右移 GROW，间距逐像素不变 */
			const rect = [...svg.children].find((n) => n.tagName.toLowerCase() === "rect");
			const badgeGlyphs = [...svg.children].find(
				(n) => n.tagName.toLowerCase() === "g" && /badge/.test(n.getAttribute("clip-path") || ""),
			);
			if (rect) {
				if (badgeGlyphs) badgeGlyphs.style.display = "none";
				for (const node of [rect, badgeGlyphs]) {
					if (!node) continue;
					stash(node, "transform", node.getAttribute("transform"));
					node.setAttribute("transform", `translate(${GROW} 0)`);
				}

				const rx = (parseFloat(rect.getAttribute("x")) || 0) + GROW;
				const ry = parseFloat(rect.getAttribute("y")) || 0;
				const rw = parseFloat(rect.getAttribute("width")) || 0;
				const rh = parseFloat(rect.getAttribute("height")) || 0;
				const text = document.createElementNS(SVGNS, "text");
				// text-anchor=middle 按字形推进宽度居中；再叠一层墨迹光学微调
				// （实测 Chromium 不计末尾 letter-spacing，所以这里不用补半个字距）。
				text.setAttribute("x", String(round(rx + rw / 2 + BADGE_NUDGE_X)));
				text.setAttribute("y", String(round(ry + rh / 2 + BADGE_NUDGE_Y)));
				text.setAttribute("text-anchor", "middle");
				text.setAttribute("dominant-baseline", "central");
				text.setAttribute("font-family", BADGE_FONT_FAMILY);
				text.setAttribute("font-size", String(BADGE_FONT_SIZE));
				text.setAttribute("font-weight", String(BADGE_FONT_WEIGHT));
				text.setAttribute("letter-spacing", String(BADGE_LETTER_SPACING));
				text.setAttribute("fill", "var(--dsw-alias-label-primary-inverted)");
				text.setAttribute(TEXT_ATTR, "");
				text.textContent = NEW_BADGE;
				svg.append(text);
			}

			/* 6) sprite 加宽 GROW —— width 与 viewBox 一起改，缩放保持严格 1:1 */
			const baseW = parseFloat(svg.getAttribute("width"));
			const vb = (svg.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
			if (Number.isFinite(baseW) && vb.length === 4 && vb.every(Number.isFinite)) {
				stash(svg, "viewBox", svg.getAttribute("viewBox"));
				stash(svg, "width", svg.getAttribute("width"));
				svg.setAttribute("width", String(round(baseW + GROW)));
				svg.setAttribute("viewBox", `${vb[0]} ${vb[1]} ${round(vb[2] + GROW)} ${vb[3]}`);
			}

			svg.setAttribute(DONE_ATTR, "done");
			svg.setAttribute("data-brandgag-grow", String(GROW));
			return true;
		}

		/* ── 运行时 ───────────────────────────────────────────────────────── */

		function apply(ctx) {
			ctx.effect(() => {
				let observer = null;
				let timer = 0;
				/** 运行时的临时总开关：置上就再也不铺（React 重渲染也不铺）。 */
				let suspended = false;

				/** 断开观察器执行 fn，再挂回去 —— 自己的改动不会把自己再叫醒。 */
				const guarded = (fn) => {
					if (observer) observer.disconnect();
					try {
						return fn();
					} finally {
						if (observer) observer.observe(document.documentElement, { childList: true, subtree: true });
					}
				};

				const scan = () => {
					if (suspended) return 0;
					let done = 0;
					for (const svg of document.querySelectorAll(WORDMARK_SELECTOR)) {
						// 覆盖层还在就不动它（React 重渲染会把我们摘掉，那时这里会漏）
						if (
							svg.getAttribute(DONE_ATTR) === "done" &&
							svg.querySelector(`:scope > [${GROUP_ATTR}]`) &&
							svg.querySelector(`:scope > [${TEXT_ATTR}]`)
						) {
							done += 1;
							continue;
						}
						if (decorate(svg)) done += 1;
					}
					return done;
				};

				const schedule = () => {
					if (timer) return;
					timer = window.setTimeout(() => {
						timer = 0;
						guarded(scan);
					}, 200);
				};

				// 先铺一次（client 模块可能比侧栏先加载，那就等 observer 补）
				guarded(scan);

				observer = new MutationObserver(schedule);
				observer.observe(document.documentElement, { childList: true, subtree: true });

				/* — 样品自检口（只在 3082 用，方便脚本核对） — */
				window.__dshBrandgag = {
					config: {
						startX: START_X,
						advance: ADVANCE,
						glyphW: GLYPH_W,
						gap: GAP,
						word: NEW_WORD,
						badge: NEW_BADGE,
					},
					scan: () => guarded(scan),
					/** 铺完之后的实测值：字距、sprite 宽度、徽章落点、布局体检。 */
					state: () => {
						const svg = document.querySelector(WORDMARK_SELECTOR);
						if (!svg) return { svg: false };
						const box = (el) => {
							if (!el) return null;
							const b = el.getBoundingClientRect();
							return [round(b.x), round(b.y), round(b.width), round(b.height)];
						};
						const mark = svg.querySelector(`:scope > [${GROUP_ATTR}]`);
						const text = svg.querySelector(`:scope > [${TEXT_ATTR}]`);
						const rect = [...svg.children].find((n) => n.tagName.toLowerCase() === "rect");
						const span = svg.parentElement && svg.parentElement.parentElement;
						/* 每个字形在屏幕上的紧致盒 → 相邻间隙就是肉眼看到的字距（缩放 1:1，
						   所以屏幕 px == user unit）。 */
						const glyphBoxes = mark ? [...mark.children].map((c) => c.getBoundingClientRect()) : [];
						const gaps = [];
						for (let i = 1; i < glyphBoxes.length; i++) {
							gaps.push({
								pair: NEW_WORD[i - 1] + NEW_WORD[i],
								gap: round(glyphBoxes[i].left - glyphBoxes[i - 1].right),
							});
						}
						const rb = rect ? rect.getBoundingClientRect() : null;
						return {
							svg: true,
							svgBox: box(svg),
							viewBox: svg.getAttribute("viewBox"),
							width: svg.getAttribute("width"),
							grow: Number(svg.getAttribute("data-brandgag-grow")),
							mark: box(mark),
							glyphs: mark ? mark.children.length : 0,
							gaps,
							wordRight: glyphBoxes.length ? round(glyphBoxes[glyphBoxes.length - 1].right) : null,
							badgeRect: box(rect),
							// 字标↔徽章间距：肉眼看到的那段空白
							wordBadgeGap: rb && glyphBoxes.length
								? round(rb.left - glyphBoxes[glyphBoxes.length - 1].right)
								: null,
							badgeText: text ? text.textContent : null,
							badgeBox: box(text),
							badgeFill: text ? getComputedStyle(text).fill : null,
							origHidden: [...svg.children].filter(
								(n) => n.tagName.toLowerCase() === "path" && n.style.display === "none",
							).length,
							// 布局体检：品牌按钮有没有被撑爆 / 裁掉
							container: span
								? { box: box(span), clientWidth: span.clientWidth, scrollWidth: span.scrollWidth }
								: null,
						};
					},
					/** 立刻还原这一处（页面刷新即彻底恢复）。 */
					off: () => guarded(() => {
						suspended = true;
						for (const svg of document.querySelectorAll(WORDMARK_SELECTOR)) restore(svg);
					}),
					/** 重新铺上（配合 off 做 A/B 对照）。 */
					on: () => guarded(() => {
						suspended = false;
						return scan();
					}),
					suspended: () => suspended,
				};

				return () => {
					if (timer) window.clearTimeout(timer);
					if (observer) observer.disconnect();
					delete window.__dshBrandgag;
					// 摘掉覆盖层、把原字标 / viewBox / 徽章位置全放回去
					for (const svg of document.querySelectorAll(WORDMARK_SELECTOR)) restore(svg);
				};
			});
		}

		exports.apply = apply;
		/** 不需要任何服务端能力。 */
		exports.inject = [];
		return module.exports;
	},
});
