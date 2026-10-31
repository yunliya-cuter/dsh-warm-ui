#!/usr/bin/env node
/**
 * dsh-warm-ui 检查入口 —— 一条命令跑完所有**不需要浏览器**的不变式。
 *
 *   node tools/check.mjs            # 静态检查（零依赖，任何 node 都能跑）
 *   node tools/check.mjs --browser  # 追加真机断言（需要 Windows 侧 Firefox + Marionette）
 *   node tools/check.mjs --hmr      # 追加热重载回归（会临时改一行插件源码，跑完逐字节还原）
 *
 * 为什么要有这个文件：以前的验证是几十个一次性 _p*.js 脚本 + 肉眼看截图，
 * 每次都得重新想起来"该看哪里"。现在不变式写进 contract/ui-contract.json，
 * 由这里逐条核对：静态的查名字与归属，真机的查数字与可见性。
 *
 * 检查项（每项失败都点名到文件与原因）：
 *   1. 语法      —— 契约里每个包的 client 半边与 host 半边、以及未入契约的包，都能通过 node --check
 *   2. 样式归属  —— 注入三件套（data-plugin / data-plugin-css / 去重 / 语义标记）只有一份实现且写法完整
 *   3. 客户端插件形状 —— 每个客户端入口都导出 apply/inject（runner 会把它当插件 apply）
 *   4. 注入登记  —— 契约里每个 ownerKey 在代码里都有对应表行
 *   5. 标记名    —— 契约里每个标记属性都在代码里出现过（改名必须同步契约）
 *   6. 挂载入口  —— 没有裸的 document.body/head append（页面外层节点必须走 mount* 助手）
 *   7. 变量闭包  —— 每张样式表引用的 CSS 变量都在**本表内**有定义（或登记为 JS 内联）
 *   8. 契约数字  —— 契约里的设计数字与代码里的那一处定义相等
 *   9. 共享依赖  —— 契约里 requires 的包真的 require 了、清单里声明了 external、且没有自己再实现一遍
 *  10. 探针      —— tools/probes/*.js 按 harness 的包装能解析（它们是函数体，不是独立脚本）
 *  11. 玻璃无动效 —— 契约说 glass.motion.state = none 时，代码里不许再出现流动层的配方/原语/开关
 *                     （按"已删标识符表"逐个查，半删状态也算红）
 *  12. 底部曲率 —— 契约 glass.curvature 的设计数字与代码里那一处相等，且系数不许低到
 *                   "把曲率调成看不见"；折射路径与槽位表两行必须在（不许拿曲率换可读性）
 *  13. 悬停判定 —— 契约 glass.pointer 在代码里成立：真离开只认 documentElement 上的
 *                   pointerleave；窗口失焦走独立处理器、只丢命中缓存并按最后的坐标重算
 *                   （**失焦不许当成指针离开**，那正是用户报的"鼠标在输入框上打字却变透明"）
 *  14. 进行中指示 —— 契约 busy 在代码里成立：座位不再画全宽渐隐带、五族行内扫光全关、
 *                   点的颜色只有一处定义且**不许写回 :root**（那一层取不到 --dsw-* 语义
 *                   token，var() 链失效会让整条 background 作废 ⇒ 点画出来是透明的，实测过）
 *  15. 列表底边渐隐 —— 契约 listEdgeFade 在代码里成立：原生 .bhn1Oq_fade 的上色被撤掉、
 *                   改成内容容器的 24px 遮罩；后缀必须用子串匹配（内容容器带附加类，
 *                   [class$=...] 会静静失效）；两条规则都门控在 :root[data-dsh-warm-wallpaper-on]
 *                   下（关档要与原生逐像素相同）；24px 只有一处定义
 *  16. 命令模式玻璃 —— 契约 glass.commandMenu 在代码里成立：/ 菜单靠厚底色而非 blur
 *                   （卡片内部采不到页面背景），不透明度不低于契约地板
 *  17. 卡片包含块 —— 契约 glass.containingBlock 在代码里成立：带 backdrop-filter 的元素会
 *  18. warm 系列打包 —— 主包 files 收齐 shared/wallpaper/brandgag，cordis.patch.yml 每个子包
 *                   都有一条相对路径 entry（单包安装 = 完整暖色系列，不再漏装）
 *                   成为 fixed 后代的包含块，而 DSH 的 Tooltip 气泡正是 fixed 且渲染在卡片
 *                   内部 ⇒ 模糊必须外置到卡片的**兄弟层**、卡片只留 isolation:isolate。
 *                   守「只改登记的槽位」「卡片被显式置 none」「层插在卡片之前」
 *                   （用户 2026-09-27 报的悬停抽搐就是这条被破坏）
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkWarmSeries } from "./check-warm-series.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const contract = JSON.parse(read("contract/ui-contract.json"));

/** 与代码无关的静态清单：**不在契约里**的包（各自 host 半边 + client 半边）。 */
const EXTRA_SOURCES = [
	"preview/brandgag/lib/index.js",
	"preview/brandgag/lib/client.js",
	"preview/dynbg/lib/index.js",
	"preview/dynbg/lib/client.js",
];

const findings = [];
const add = (check, message) => findings.push({ check, message });

/* ── 1. 语法 ─────────────────────────────────────────────────────────── */
/** host 半边与 client 半边同目录：`lib/client.js` ↔ `lib/index.js`。 */
const hostHalfOf = (entry) => entry.replace(/client\.js$/, "index.js");

function checkSyntax() {
	const files = new Set([...EXTRA_SOURCES]);
	for (const spec of Object.values(contract.packages)) {
		files.add(spec.entry);
		files.add(hostHalfOf(spec.entry));
	}
	for (const file of files) {
		try {
			execFileSync(process.execPath, ["--check", path.join(ROOT, file)], { stdio: "pipe" });
		} catch (error) {
			add("语法", file + " 通不过 node --check：" + String(error.stderr || error.message).split("\n")[0]);
		}
	}
}

/* ── 2. 样式归属：注入三件套只有一份实现，写法逐条核对 ───────────────────
 *
 * 这三件是**平台约定**（见 preview/shared/lib/client.js 里的说明）：漏了任何一件，
 * 上一代样式表就删不掉、还会被别的插件错认走。以前每个包各写一遍，于是有抄错的机会；
 * 现在实现唯一，这里就核对那一份，并保证调用方确实在用它（见 checkRequires）。
 */
const STYLE_INJECTION_RULES = [
	{ needle: "tag.dataset.plugin =", why: "样式表没打 data-plugin（热重载删不掉它，还会被后加载的插件错认走）" },
	{ needle: "tag.dataset.pluginCss =", why: "样式表没打 data-plugin-css（跨代去重的键）" },
	{ needle: "style[data-plugin-css=", why: "没有按标签名去重（同名表会插两份）" },
	{ needle: "setAttribute(marker", why: "样式表没贴语义标记（DevTools 与探针认表用）" },
];

/** 契约里 role=shared 的那个包 —— 注入三件套的唯一实现者。 */
const sharedSpec = Object.entries(contract.packages).find(([, spec]) => spec.role === "shared");

function checkStyleOwnership() {
	if (!sharedSpec) {
		add("样式归属", "契约里没有 role: shared 的包 —— 注入三件套必须只有一份实现");
		return;
	}
	const [pkg, spec] = sharedSpec;
	const code = read(spec.entry);
	for (const rule of STYLE_INJECTION_RULES) {
		if (!code.includes(rule.needle)) add("样式归属", pkg + " " + rule.why);
	}
	for (const name of spec.exports || []) {
		if (!code.includes("exports." + name + " =")) {
			add("样式归属", pkg + " 没有导出契约里声明的 " + name);
		}
	}
}

/* ── 3. 客户端半边必须是「插件形状」（exports.apply + exports.inject） ───
 *
 * 浏览器侧的 runner（dsh-cordis-client-runner）按模块图谱给**每个客户端包**建一条
 * loader 条目，并把它的导出当插件 apply。只导出工具函数的包会被判成
 * "invalid plugin … received object"，而且这个错会拦住**整个宿主启动**
 * （页面只剩「Failed to load plugins」）—— 2026-09-19 在共享包上真踩过一次。
 * 所以每个客户端入口都必须能当面回答"我就是个插件"。
 */
function checkClientPluginShape() {
	for (const [pkg, spec] of Object.entries(contract.packages)) {
		const code = read(spec.entry);
		for (const needle of ["exports.apply =", "exports.inject ="]) {
			if (!code.includes(needle)) {
				add("客户端插件形状", pkg + " " + spec.entry + " 少了 `" + needle + "`（它会作为插件被 apply，缺了会拦住宿主启动）");
			}
		}
	}
}

/* ── 4. 注入登记 / 5. 标记名 ───────────────────────────────────────────── */
function checkPackages() {
	for (const [pkg, spec] of Object.entries(contract.packages)) {
		const code = read(spec.entry);
		for (const sheet of spec.styleSheets) {
			/* 表的注入必须经 installStyleSheet（实现见 shared 包，不在这里重复核对）。 */
			if (!code.includes('installStyleSheet("' + sheet.name + '"')) {
				add("样式归属", pkg + " 少了 installStyleSheet(\"" + sheet.name + "\") 的调用");
			}
			if (!code.includes(sheet.marker)) {
				add("样式归属", pkg + " 的样式表没贴语义标记 " + sheet.marker);
			}
		}
		for (const key of spec.ownerKeys) {
			/* 表行形如 `key: {` —— 与三处调用点解耦，只认登记表本身。 */
			if (!new RegExp("\\b" + key + ":\\s*\\{").test(code)) {
				add("注入登记", pkg + " 的登记表里没有 " + key + " 这一行");
			}
		}
		for (const marker of spec.markers) {
			if (!code.includes(marker)) add("标记名", pkg + " 里找不到标记 " + marker + "（契约与代码不同步）");
		}
	}
}

/* ── 6. 挂载入口：裸 append 只允许出现在助手函数内部 ───────────────────── */
function checkMountSites() {
	const allowed = new Set(
		Object.values(contract.packages).flatMap((spec) => spec.mountHelpers),
	);
	for (const [pkg, spec] of Object.entries(contract.packages)) {
		const code = read(spec.entry);
		const lines = code.split("\n");
		lines.forEach((line, index) => {
			const hit = /document\.(body|head)\.append(Child)?\(/.exec(line);
			if (!hit) return;
			/* 往上找最近的函数定义；找不到就是裸调用。 */
			let owner = null;
			for (let i = index; i >= 0 && i > index - 200; i -= 1) {
				const m = /^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/.exec(lines[i]);
				if (m) {
					owner = m[1];
					break;
				}
			}
			if (!owner || !allowed.has(owner)) {
				add("挂载入口", pkg + " " + spec.entry + ":" + (index + 1) + " 有裸 append（应走 " + [...allowed].join(" / ") + "）");
			}
		});
	}
}

/* ── 7. 变量闭包：逐表检查（不跨表合并） ──────────────────────────────── */
function extractTemplate(code, name) {
	const head = "const " + name + " = `";
	const start = code.indexOf(head);
	if (start < 0) return null;
	const bodyStart = start + head.length;
	const end = code.indexOf("`;", bodyStart);
	return end < 0 ? null : code.slice(bodyStart, end);
}

function checkCssVars() {
	for (const [pkg, spec] of Object.entries(contract.packages)) {
		if (!spec.styleSheets.length) continue;
		const code = read(spec.entry);
		const fromJs = spec.cssVarsFromJs || [];
		/* 代码里那份"由 JS 写内联、所以不该在 CSS 里定义"的名单必须与契约一致。 */
		const literal = /const CSS_VARS_FROM_JS = \[([^\]]*)\]/.exec(code);
		const declared = literal
			? [...literal[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort()
			: [];
		if (JSON.stringify(declared) !== JSON.stringify([...fromJs].sort())) {
			add("变量闭包", pkg + " 代码里的 CSS_VARS_FROM_JS 与契约不一致（代码=" + JSON.stringify(declared) + "，契约=" + JSON.stringify(fromJs) + "）");
		}
		for (const sheet of spec.styleSheets) {
			const css = extractTemplate(code, sheet.cssTemplate);
			if (css === null) {
				add("变量闭包", pkg + " 找不到样式表模板 " + sheet.cssTemplate);
				continue;
			}
			const prefix = sheet.cssVarPrefix;
			const defined = new Set([...css.matchAll(new RegExp("(" + prefix + "[a-z0-9-]+)\\s*:", "g"))].map((m) => m[1]));
			for (const m of css.matchAll(new RegExp("var\\(\\s*(" + prefix + "[a-z0-9-]+)\\s*\\)", "g"))) {
				if (!defined.has(m[1]) && !fromJs.includes(m[1])) {
					add("变量闭包", pkg + " " + sheet.name + " 里 var(" + m[1] + ") 没有兜底值、本表也没定义（整条声明会被复位）");
				}
			}
		}
	}
}

/* ── 8. 契约里的设计数字必须与代码里的那一处相等 ───────────────────── */
function checkContractNumbers() {
	const ref = contract.toolbar.rowHeightVar;
	if (!ref) return;
	const spec = contract.packages[ref.package];
	if (!spec) {
		add("契约数字", "rowHeightVar 指向的包 " + ref.package + " 不在契约里");
		return;
	}
	const code = read(spec.entry);
	const declared = [...code.matchAll(new RegExp("(" + ref.name + ")\\s*:\\s*(\\d+)px", "g"))];
	if (declared.length !== 1) {
		add("契约数字", ref.name + " 在 " + spec.entry + " 里出现 " + declared.length + " 次（应恰好一次：一处定义 = 一个含义）");
		return;
	}
	const value = Number(declared[0][2]);
	if (value !== contract.toolbar.rowHeightPx) {
		add("契约数字", ref.name + " = " + value + "px，但契约的 toolbar.rowHeightPx = " + contract.toolbar.rowHeightPx + "px");
	}
	/* 规则里不该再有裸的同一个数字（那才是"同一含义写两遍"） */
	const bare = [...code.matchAll(/height:\s*(\d+)px/g)].map((m) => Number(m[1]));
	if (bare.includes(value)) {
		add("契约数字", spec.entry + " 里除变量定义外还有裸的 height: " + value + "px（应写 var(" + ref.name + ")）");
	}
}

/* ── 9. 共享依赖：声明了 requires 就必须真的用起来，而且不能又抄一遍 ──────
 *
 * 一条依赖要在三个地方同时成立，少一处都是"看起来能跑，换个时机就崩"：
 *   1. 代码：工厂体里 `require("<依赖>")`（浏览器侧靠它拿到实现）；
 *   2. 清单：本包 package.json 的 `dsh.client.external`（宿主侧靠它把依赖行排在本包之前）；
 *   3. 契约：依赖方自己**不得**再出现 `dataset.plugin =`（那意味着注入三件套又被抄了一遍）。
 */
function checkRequires() {
	for (const [pkg, spec] of Object.entries(contract.packages)) {
		const needs = spec.requires || [];
		if (!needs.length) continue;
		const code = read(spec.entry);
		const manifest = JSON.parse(read(spec.manifest));
		const declared = ((manifest.dsh || {}).client || {}).external || [];
		for (const dep of needs) {
			if (!contract.packages[dep]) {
				add("共享依赖", pkg + " 依赖的 " + dep + " 不在契约的 packages 里");
				continue;
			}
			if (!code.includes('require("' + dep + '")')) {
				add("共享依赖", pkg + " 声明依赖 " + dep + "，但工厂体里没有 require(\"" + dep + "\")");
			}
			if (!declared.includes(dep)) {
				add("共享依赖", pkg + " 的 " + spec.manifest + " 里 dsh.client.external 没写 " + dep + "（宿主就不知道要把它排在本包前面）");
			}
		}
		if (/dataset\.plugin\s*=/.test(code)) {
			add("共享依赖", pkg + " 又自己实现了一遍样式表注入（应调用 " + needs.join(" / ") + " 的 installStyleSheet）");
		}
	}
}

/* ── 10. 探针：tools/probes/*.js 是**函数体**（harness 把它塞进 async 箭头函数里跑） ──
 *
 * 它们不是独立脚本，`node --check` 会一律报 "Illegal return statement"，所以语法错误
 * 要等到真机跑那一刻才炸（还得先起 Firefox）。这里用**同一种包装**提前解析一遍，
 * 把"跑到一半才发现少个括号"提前到几秒内。
 */
function checkProbes() {
	const dir = path.join(ROOT, "tools/probes");
	for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".js")).sort()) {
		const body = fs.readFileSync(path.join(dir, file), "utf8");
		try {
			/* 与 harness.mjs 的包装一致：`return (async () => { <探针> })()`。 */
			new Function("window", "document", "return (async () => {" + body + "})();");
		} catch (error) {
			add("探针", "tools/probes/" + file + " 解析失败（它是函数体，按 harness 的包装解析）：" + error.message);
		}
	}
}

/* ── 11. 玻璃不做动效：契约说 none，代码里就不许再出现那一层的零件 ──
 *
 * 2026-09-24 按用户要求把玻璃的「流动层」（噪声位移 + 定时驱动）整层删掉了
 * （用户报的是「输入框边缘波纹动效」，要的是"直接去掉"）。这一条守两件事：
 *   ① 删干净 —— 契约 `glass.motion.state = "none"` 时，代码里不许再出现下面表里
 *      任何一个名字；
 *   ② 想加回来必须先改契约 —— 这条只核对"声明与实现一致"，契约改了它就放行，
 *      所以它拦的是"偷偷把动效加回来"。
 *
 * 为什么表要列到这一点点：这一层删除过程中出现过三次**半删状态**存盘 ——
 * 文件语法没问题（`node --check` 全过），但运行中的插件在 pointermove 里抛
 * `GLASS_WARP is not defined` / `glassWarpOf is not defined`，热重载留下的旧实例
 * 每动一下鼠标就抛一次，用户看到的就是「输入框经常闪烁」（复核见 STATE.md §0.5）。
 * 语法检查拦不住半删状态，只有"已删标识符表"拦得住。
 */
const GLASS_MOTION_LEFTOVERS = [
	["配方表", "GLASS_WARP"],
	["配方读取", "glassWarpOf"],
	["位移场采样", "warpAt"],
	["滤镜节点装配", "warpFilterNodes"],
	["噪声滤镜 id", "warpNoise"],
	["位移图掩码", "warpMask"],
	["位移场缓存", "warpField"],
	["掩码 url", "maskUrl"],
	["定时器句柄", "warpTimer"],
	["起始时间戳", "warpStartedAt"],
	["逐帧驱动", "tickWarp"],
	["帧调度", "scheduleWarp"],
	["开关读取", "glassWarp"],
	["开关标记", "data-wta-glasswarp"],
	["噪声原语", "feTurbulence"],
];
function checkGlassMotion() {
	const spec = contract.packages["dsh-warm-ui"];
	const glass = contract.glass;
	if (!spec || !glass || !glass.motion || !glass.motion.state) {
		add("玻璃无动效", "契约里缺 glass.motion.state（玻璃动不动必须是一条登记过的事实）");
		return;
	}
	if (glass.motion.state !== "none") return;
	const code = read(spec.entry);
	const leftovers = GLASS_MOTION_LEFTOVERS
		.filter(([, name]) => new RegExp("\\b" + name + "\\b").test(code))
		.map(([what, name]) => what + "（" + name + "）");
	if (leftovers.length) {
		add("玻璃无动效", spec.entry + " 里还留着 " + leftovers.join("、")
			+ " —— 契约写的是 glass.motion.state = none（删干净或先改契约）");
	}
}

/* ── 12. 底部曲率：数字与契约一致，而且不许被"调成看不见"换可读性 ──────────
 *
 * 2026-09-25 用户报「输入框玻璃底部曲率过大」。修法是把底边折射带里的位移幅度折下来
 * （slope ×0.6，只作用于输入框卡片槽位），而**不是**把曲率做没：弧的几何（bevel /
 * shape / edgeW / rim / shade / light）与画弧用的 5 层内阴影一字不动。
 *
 * 这一条守的就是那个"不是"：
 *   ① 契约里的每个设计数字在代码里**恰好出现一次**（一处定义 = 一个含义）——
 *      系数写成 `slope: 0.6` 这种严格字面量，不然 `\d+` 会把 0.6 误配成 0；
 *   ② 系数必须落在 [地板, 1)：低于地板 = 把曲率调成看不见，等于 1 / 整行没了 = 修复被无声撤销；
 *   ③ 折射路径还在（不许靠删滤镜换可读性）；
 *   ④ 槽位表两行都在：改动只作用于输入框卡片，任务面板保持基准材质。
 * 折射**实际降了多少**只能在 Chromium 侧量（读渲染真正用的那张位移图，见
 * tools/probes/curvature.js）；真机那一半（画出来的弧、圆角、底色）由
 * tools/probes/contract.js 第 ⑪ 段断言。
 */
function checkGlassCurvature() {
	const spec = contract.packages["dsh-warm-ui"];
	const cur = contract.glass && contract.glass.curvature;
	if (!spec || !cur) {
		add("底部曲率", "契约里缺 glass.curvature（曲率怎么调、调到多少必须是一条登记过的事实）");
		return;
	}
	const code = read(spec.entry);
	for (const row of cur.designNumbers || []) {
		const hits = code.split(row.needle).length - 1;
		if (hits !== 1) {
			add("底部曲率", row.needle + " 在 " + spec.entry + " 里出现 " + hits + " 次（应恰好一次：一处定义 = 一个含义）");
		}
	}
	/* 每个"槽位系数"都要有自己的地板：没有地板 = 没人登记这个旋钮能被调到多小。 */
	const floors = cur.floors || {};
	let floored = 0;
	for (const row of cur.designNumbers || []) {
		const lo = floors[row.name];
		if (lo === undefined) continue;
		floored++;
		if (!(row.value < 1 && row.value >= lo)) {
			add("底部曲率", row.name + " 的系数是 " + row.value + "，契约要求落在 [" + lo + ", 1) —— 低于地板等于把曲率调成看不见，等于 1 等于没改");
		}
	}
	if (floored !== Object.keys(floors).length) {
		add("底部曲率", "契约 floors 有 " + Object.keys(floors).length + " 条，只有 " + floored + " 条对上了 designNumbers —— 地板必须挂在真实存在的设计数字上");
	}
	for (const needle of cur.refractionPath || []) {
		if (!code.includes(needle)) {
			add("底部曲率", spec.entry + " 里找不到 " + needle + "（折射路径不许靠删滤镜换可读性）");
		}
	}
	if (!/variant:\s*"composer"/.test(code) || !/variant:\s*""/.test(code)) {
		add("底部曲率", "GLASS_TARGETS 少了槽位行（composer 变体行 / 任务面板基准行）—— 改动必须只作用于该输入框");
	}
}


/* ── 13. 悬停判定：窗口失焦不许把「指针还在卡片上」弄丢 ─────────────────────
 *
 * 2026-09-25 用户报「鼠标停在输入框上打字，输入框由模糊态回退成透明态，鼠标一动就恢复」。
 * 复现出来是这条：插件把 window blur 当成「指针离开文档」（走 onPointerGone：清坐标 +
 * inside = false），而**打字不会重算悬停判定**（只有 pointermove 会）—— 状态一直粘在
 * 「指针不在卡片上」那一档，鼠标在不在输入框上完全看不出区别，要等下一次鼠标移动才回来。
 *
 * 这一条守三件事：
 *   ① 真离开只有一条判据：documentElement 上的 pointerleave（挂错地方 = 状态会莫名丢掉）；
 *   ② 失焦有独立处理器，且**只丢命中缓存并按最后的坐标重算** —— 不许出现 inside = false；
 *   ③ 那个"缺陷写法"（blur 直接接 onPointerGone）不许再出现：它就是用户看到的现象本身。
 * 手感那一半（底色与模糊真的变没变）只能真机断言，见 tools/probes/contract.js 第 ⑫ 段。
 */
function checkGlassPointer() {
	const spec = contract.packages["dsh-warm-ui"];
	const p = contract.glass && contract.glass.pointer;
	if (!spec || !p) {
		add("悬停判定", "契约里缺 glass.pointer（指针怎么算悬停、失焦算不算离开，必须是一条登记过的事实）");
		return;
	}
	const code = read(spec.entry);
	for (const needle of p.must || []) {
		if (!code.includes(needle)) {
			add("悬停判定", spec.entry + " 里找不到 " + JSON.stringify(needle) + "（契约 glass.pointer.must 登记过）");
		}
	}
	for (const needle of p.forbidden || []) {
		if (code.includes(needle)) {
			add("悬停判定", spec.entry + " 里还有 " + JSON.stringify(needle)
				+ " —— 这就是「鼠标在输入框上打字却变透明」的写法：失焦被当成指针离开，而打字不会重算判定");
		}
	}
	/* 失焦处理器体内只许「丢缓存 + 重算」：不清坐标，也不把 inside 置 false。 */
	const want = p.blurHandler || {};
	if (want.head) {
		const at = code.indexOf(want.head);
		if (at === -1) {
			add("悬停判定", spec.entry + " 里找不到失焦处理器 " + JSON.stringify(want.head) + "（失焦必须有独立处理器）");
		} else {
			const end = code.indexOf("\n\t\t\t};", at);
			const body = end === -1 ? code.slice(at) : code.slice(at, end);
			for (const needle of want.must || []) {
				if (!body.includes(needle)) {
					add("悬停判定", "失焦处理器体内缺 " + JSON.stringify(needle) + "（失焦只该丢命中缓存并按最后的坐标重算）");
				}
			}
			for (const needle of want.mustNot || []) {
				if (body.includes(needle)) {
					add("悬停判定", "失焦处理器体里出现了 " + JSON.stringify(needle) + " —— 失焦不等于指针离开，坐标不许清");
				}
			}
		}
	}
	/* 指针离开事件同理：坐标在视口内（假离开）只许重算，在视口外（真离开）才清坐标。
	   判据写法写在契约 glass.pointer.leaveHandler，这里核对它还在。 */
	const leave = p.leaveHandler || {};
	if (!leave.head) {
		add("悬停判定", "契约 glass.pointer.leaveHandler 缺 head（指针离开必须有登记过的真假判据）");
	} else {
		const at = code.indexOf(leave.head);
		if (at === -1) {
			add("悬停判定", spec.entry + " 里找不到「指针离开」处理器 " + JSON.stringify(leave.head));
		} else {
			const end = code.indexOf("\n\t\t\t};", at);
			const body = end === -1 ? code.slice(at) : code.slice(at, end);
			for (const needle of leave.must || []) {
				if (!body.includes(needle)) {
					add("悬停判定", "「指针离开」处理器体内缺 " + JSON.stringify(needle) + "（事件坐标必须参与判定）");
				}
			}
			for (const needle of leave.mustNot || []) {
				if (body.includes(needle)) {
					add("悬停判定", "「指针离开」处理器体里出现了 " + JSON.stringify(needle) + "（契约 glass.pointer.leaveHandler.mustNot）");
				}
			}
		}
	}
	/* 悬停那一档的底色是"眼睛看得到的状态量"：契约登记一个值，代码里只许有一处定义。 */
	if (p.calmTint) {
		const hits = code.split(p.calmTint).length - 1;
		if (hits !== 1) {
			add("悬停判定", "悬停底色 " + p.calmTint + " 在 " + spec.entry + " 里出现 " + hits + " 次（应恰好一次：一处定义 = 一个含义）");
		}
	}
}

/* ── 17. 卡片包含块：模糊不许留在会成为 fixed 后代包含块的那个元素上 ─────────
 *
 * 2026-09-27 用户报「右下角箭头/停止按钮亮起时，鼠标悬停其上画面反复切换」。
 * 根因不在悬停逻辑，而在**模糊写错了元素**：带 backdrop-filter ≠ none 的元素会成为
 * **固定定位后代的包含块**（CSS 规范），而 DSH 的 Tooltip 气泡（.bubble）正是
 * position:fixed、却渲染在卡片**内部**。卡片一旦自己带 backdrop-filter，气泡的
 * 视口 left/top 就被按卡片坐标系解释 ⇒ 落到视口外（实测 add 气泡 y=831，视口只有 802）
 * ⇒ 撑出可滚动溢出 ⇒ 某些视口高度下冒出横向滚动条 ⇒ 卡片位移 2px ⇒ 指针被甩出按钮
 * ⇒ mouseleave ⇒ 气泡撤销 ⇒ 回弹 ⇒ 自激（实测翻转 17 次 / 4.8s，周期 ≈267ms）。
 *
 * 这一项守四件事：
 *   ① 契约登记的 layerTargets（要外置模糊的槽位）在 GLASS_TARGETS 里带 layer: true；
 *      其余槽位**不许**带 —— 「只改该输入框」是用户给的约束，顺手全局改是回归；
 *   ② 模糊必须写到层上、卡片必须被显式置 none（不是"没写"，是"写了 none"：
 *      没写的话 DSH 自己的规则或残留内联会把它带回来）；
 *   ③ 卡片必须带 isolation:isolate（它不是包含块、也不截断 backdrop 采样，但保住
 *      层叠上下文，[data-wta-surf] 的 z-index:-1 + mix-blend-mode:screen 靠它成立）；
 *   ④ 层必须是**兄弟**（插在卡片之前）—— 若改成卡片的子节点，包含块问题原样回来。
 *
 * 为什么不能只靠"看起来不抖了"：抽搐是自激，视口高度不同触发条件也不同（实测某些
 * 高度下滚动条没变、照样抖）。这一项查的是**机制**，与视口无关。
 */
function checkGlassContainingBlock() {
	const spec = contract.packages["dsh-warm-ui"];
	const cb = contract.glass && contract.glass.containingBlock;
	if (!spec || !cb) {
		add("卡片包含块", "契约里缺 glass.containingBlock（模糊为什么不能写在卡片上，必须是一条登记过的事实）");
		return;
	}
	if (cb.state !== "enforced") return;
	const code = read(spec.entry);

	/* ① 契约登记要外置模糊的选择器，代码里那一行必须带 layer: true。 */
	const layerSels = cb.layerTargets || [];
	if (!layerSels.length) {
		add("卡片包含块", "契约 glass.containingBlock.layerTargets 是空的 —— 这一项就失去了核对对象");
	}
	for (const sel of layerSels) {
		/* 表行形如 `{ sel: '<选择器>', variant: ..., layer: true }`：只认同一行内出现。 */
		const line = code.split("\n").find((l) => l.includes(sel) && l.includes("sel:"));
		if (!line) {
			add("卡片包含块", spec.entry + " 的 GLASS_TARGETS 里找不到 " + JSON.stringify(sel) + "（契约 layerTargets 登记过）");
		} else if (!/layer:\s*true/.test(line)) {
			add("卡片包含块", spec.entry + " 里 " + JSON.stringify(sel)
				+ " 这一行没有 layer: true —— 模糊又写回卡片上了，Tooltip 气泡会被挤到视口外（见契约 glass.containingBlock）");
		}
	}

	/* ② 契约**没**登记的槽位不许带 layer：防"顺手全局改"。 */
	const flagged = [...code.matchAll(/\{\s*sel:\s*('[^'\n]*'|"[^"\n]*")[^\n}]*layer:\s*true[^\n}]*\}/g)]
		.map((m) => m[1].slice(1, -1));
	for (const sel of flagged) {
		if (!layerSels.includes(sel)) {
			add("卡片包含块", spec.entry + " 里 " + JSON.stringify(sel)
				+ " 带了 layer: true，但契约 layerTargets 没登记它 —— 加一处玻璃要同时改契约（用户约束是「只改该输入框」）");
		}
	}

	/* ③ 契约 must 里登记的写法必须在代码里；forbidden 里的一律不许在。 */
	for (const needle of cb.must || []) {
		if (!code.includes(needle)) {
			add("卡片包含块", spec.entry + " 里找不到 " + JSON.stringify(needle) + "（契约 glass.containingBlock.must 登记过）");
		}
	}
	for (const needle of cb.forbidden || []) {
		if (code.includes(needle)) {
			add("卡片包含块", spec.entry + " 里还有 " + JSON.stringify(needle)
				+ " —— 那是把模糊直接写在卡片上的写法（契约 glass.containingBlock.forbidden）");
		}
	}

	/* ④ 层必须是兄弟：赋值语句里必须是 host.insertBefore(layer, el)。 */
	if (!code.includes("host.insertBefore(layer, el)")) {
		add("卡片包含块", spec.entry + " 里找不到 host.insertBefore(layer, el) —— 层必须插在卡片**之前**（兄弟）；"
			+ "放进卡片内部等于让卡片自己再次成为 fixed 后代的包含块");
	}
	/* ⑤ rejected 至少留两条：那是"别再试这两条死路"的档，删掉就会被人重走。 */
	if ((cb.rejected || []).length < 2) {
		add("卡片包含块", "契约 glass.containingBlock.rejected 少于两条（子层 / ::before 两条死路的实测数字必须留档，否则会被重新试一遍）");
	}
}

/* ── 热重载回归（--hmr）：改一次文件 → 插件重建 → 再量一遍 ─────────────
 *
 * 为什么值得专门做一条命令：这一轮两个 bug（壁纸被推到页面下面、工具行变回原样）
 * 的根都是"热重载留下的上一代东西没被清掉"。它没法靠静态检查发现，只能真跑一遍：
 * 改文件触发重建，再看样式表份数/注入节点份数/文档溢出。
 *
 * 安全性：只在插件源码**末尾**追加一行注释标记，跑完立刻按内存里的原文逐字节还原；
 * 万一被中断，下一次 `node tools/check.mjs` 会先自愈式清掉那个标记（见 stripHmrMarkers）。
 */
const HMR_MARKER = "/* hmr-probe */";
const HMRS = { firstTouchMs: 6000, secondTouchMs: 3000 };

function stripHmrMarkers() {
	for (const spec of Object.values(contract.packages)) {
		const file = path.join(ROOT, spec.entry);
		const before = fs.readFileSync(file, "utf8");
		if (!before.includes(HMR_MARKER)) continue;
		const after = before.replace(/\n?\/\* hmr-probe \*\/\n?/g, "\n");
		fs.writeFileSync(file, after);
		console.log("  （自愈）清掉 " + spec.entry + " 里上次残留的热更标记");
	}
}

async function runHmr(env) {
	stripHmrMarkers();
	const entries = Object.values(contract.packages).map((spec) => path.join(ROOT, spec.entry));
	const backups = new Map(entries.map((file) => [file, fs.readFileSync(file, "utf8")]));
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

	const child = spawn(env.nodeExe, [
		env.windows(path.join(ROOT, "tools/harness.mjs")),
		"eval",
		env.windows(path.join(ROOT, "tools/probes/p0-hmr.js")),
		"--port", env.port,
		...viewportArgs(),
		"--url", env.url,
	], { encoding: "utf8" });
	let out = "";
	child.stdout.on("data", (d) => { out += d; });
	child.stderr.on("data", (d) => { out += d; });
	const done = new Promise((resolve) => child.on("close", resolve));

	let report = null;
	try {
		/* 探针要连 Marionette、导航、等页面 ready —— 前两拍触发的重建可能落在它取数之前，
		   所以往后压一点，保证"取数过程中真的发生过重建"。 */
		let wait = HMRS.firstTouchMs;
		for (const file of entries) {
			await sleep(wait);
			fs.appendFileSync(file, "\n" + HMR_MARKER + "\n");
			wait = HMRS.secondTouchMs;
		}
		await done;
	} finally {
		/* 无论成功、失败、抛异常，都要把源码还原成原文。 */
		for (const [file, content] of backups) fs.writeFileSync(file, content);
		const dirty = [...backups].filter(([file, content]) => fs.readFileSync(file, "utf8") !== content);
		if (dirty.length) add("热重载", "还原失败，请手工检查：" + dirty.map(([file]) => file).join(", "));
	}

	try {
		report = JSON.parse(out.slice(out.indexOf("{")));
	} catch (error) {
		add("热重载", "探针没返回 JSON：" + out.trim().split("\n").slice(-3).join(" / "));
		return;
	}
	const samples = report.samples || [];
	if (!samples.length) {
		add("热重载", "探针没取到样本");
		return;
	}
	if (!report.rebuilt) {
		add("热重载", "整个过程中一次重建都没发生（文件改了却没人重建 = 热更链路断了）");
	}
	for (const [index, s] of samples.entries()) {
		const bad = [];
		if (s.base > 1) bad.push("基础样式表 " + s.base + " 份");
		if (s.extra > 1) bad.push("增强样式表 " + s.extra + " 份");
		if (s.wallpaper > 1) bad.push("壁纸样式表 " + s.wallpaper + " 份");
		if (s.unowned > C_UNOWNED) bad.push("无主样式表 " + s.unowned + " 张");
		if (s.canvases > 1) bad.push("壁纸画布 " + s.canvases + " 块");
		if (s.overflow !== contract.invariants.documentOverflowPx) bad.push("文档溢出 " + s.overflow + "px");
		if (bad.length) add("热重载", "第 " + (index + 1) + " 拍（共 " + samples.length + " 拍）不对：" + bad.join("、"));
	}
	console.log("  热重载实测：rebuilt=" + report.rebuilt + " 帧，样本=" + JSON.stringify(samples[samples.length - 1]));
}

/* ── 真机断言（可选） ────────────────────────────────────────────────── */
function browserEnv() {
	/* Marionette 端口默认值取自契约 `probes.ffPort`（与 tools/harness.mjs 同源）；
	   环境变量仍优先 —— 换端口不需要改文件。契约里缺这一项时才退回字面量兜底。 */
	const ffPort = (contract.probes && contract.probes.ffPort) || 2828;
	const port = process.env.DSH_FF_PORT || String(ffPort);
	const url = process.env.DSH_URL;
	const nodeExe = process.env.DSH_NODE_EXE || process.execPath;
	const windows = (p) => {
		const r = spawnSync("wslpath", ["-w", p], { encoding: "utf8" });
		return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : p;
	};
	return { port, url, nodeExe, windows };
}

const C_UNOWNED = contract.invariants.unownedStyleTags;

/**
 * 真机断言的视口也取自契约（`viewports.wide`）。
 * 以前只有 `shot` 那条命令记得传窗口尺寸，`--browser` 不传 —— 于是同一份断言
 * 会随 Firefox 上次的窗口大小落到 `chip` 或 `native` 态，"行高 24" 那条时灵时不灵。
 * 契约里既然写了参考视口，就该由它决定，而不是由窗口碰巧多大决定。
 */
function viewportArgs() {
	const v = (contract.viewports || {}).wide || {};
	const args = [];
	if (v.width) args.push("--width", String(v.width));
	if (v.height) args.push("--height", String(v.height));
	return args;
}

function runBrowser(env) {
	if (!env.url) return;
	const args = [
		env.windows(path.join(ROOT, "tools/harness.mjs")),
		"eval",
		env.windows(path.join(ROOT, "tools/probes/contract.js")),
		"--port", env.port,
		...viewportArgs(),
		"--url", env.url,
	];
	const r = spawnSync(env.nodeExe, args, { encoding: "utf8" });
	const out = (r.stdout || "") + (r.stderr || "");
	if (r.status !== 0) {
		add("真机", "驱动失败（端口 " + env.port + " 上有 Firefox 吗？见 tools/README.md）：" + out.trim().split("\n").slice(-3).join(" / "));
		return;
	}
	let report = null;
	try {
		report = JSON.parse(out.slice(out.indexOf("{")));
	} catch (error) {
		add("真机", "探针返回的不是 JSON：" + out.trim().split("\n").slice(-3).join(" / "));
		return;
	}
	for (const bad of report.violations || []) add("真机", bad);
	console.log("  真机实测：" + JSON.stringify(report.measured));
}

/* ── 跑 ─────────────────────────────────────────────────────────────── */
const env = browserEnv();
const wantsBrowser = process.argv.includes("--browser");
const wantsHmr = process.argv.includes("--hmr");

if ((wantsBrowser || wantsHmr) && !env.url) {
	add("真机", "要跑真机断言请给 DSH_URL（带 token 的页面地址），否则不知道自己连的是哪个实例");
}

/* 自愈先做：上一次 --hmr 被中断的残留要清掉，否则后面所有检查都建立在脏文件上。 */
stripHmrMarkers();

/* ── 14. 进行中指示（契约 busy）──────────────────────────────────────── */
/**
 * 「进行中」长什么样是登记过的事实：两种暗带都要没、点只有一处定义、节奏数字与契约相等。
 * 这里只查**能静态查的**（选择器/定义次数/数字）；真机行为在 tools/probes/contract.js ⑬。
 */
function checkBusyIndicator() {
	const spec = contract.packages["dsh-warm-ui"];
	const b = contract.busy;
	if (!spec || !b) {
		add("进行中指示", "契约里缺 busy（「进行中」用什么表示、两种暗带怎么去掉，必须是一条登记过的事实）");
		return;
	}
	const code = read(spec.entry);
	for (const needle of b.must || []) {
		if (!code.includes(needle)) {
			add("进行中指示", spec.entry + " 里找不到 " + JSON.stringify(needle) + "（契约 busy.must 登记过）");
		}
	}
	for (const needle of b.forbidden || []) {
		if (code.includes(needle)) {
			add("进行中指示", spec.entry + " 里还有 " + JSON.stringify(needle)
				+ " —— 那是被移除的暗带留下的写法（契约 busy.forbidden：黑带不许回来）");
		}
	}
	/* 一处定义，而且作用域必须是 body —— :root 里引用 --dsw-* 会失效（实测点变透明）。 */
	const dot = b.dot || {};
	if (dot.colorVar) {
		const inRoot = code.split("\n  " + dot.colorVar + ":").length - 1;
		if (inRoot !== 0) {
			add("进行中指示", dot.colorVar + " 又出现在 :root 的 2 空格缩进里（" + inRoot + " 处）—— "
				+ "DSH 的语义 token 只定义在 body 上，这一层 var() 链会失效、整条 background 作废，点会变成透明的");
		}
		const scoped = code.split('body[data-wta-busy="1"] { ' + dot.colorVar + ":").length - 1;
		if (scoped !== 1) {
			add("进行中指示", spec.entry + " 里 " + dot.colorVar + " 的 body 作用域定义出现 " + scoped + " 次（应恰好一次：一处定义 = 一个含义）");
		}
	}
	if (dot.colorToken) {
		const n = code.split(dot.colorToken).length - 1;
		if (n !== 1) {
			add("进行中指示", "点色 token " + dot.colorToken + " 在 " + spec.entry + " 里出现 " + n + " 次（应恰好一次：换色只改这一行）");
		}
	}
	/* 设计数字：契约登记的节奏必须等于代码里那一处定义 */
	const norm = (v) => (v !== undefined && v !== "" && !Number.isNaN(Number(v)) ? String(Number(v)) : v);
	const nums = [
		["--wta-busy-blink-dur", dot.blink && dot.blink.duration],
		["--wta-busy-blink-min", dot.blink && dot.blink.opacityMin],
		[(b.wave || {}).durationVar, (b.wave || {}).duration],
		[(b.wave || {}).amplitudeVar, (b.wave || {}).amplitude],
	];
	for (const [name, want] of nums) {
		if (!name || want === undefined) continue;
		const line = code.split("\n").find((l) => l.trim().startsWith(name + ":"));
		if (!line) {
			add("进行中指示", "代码里找不到 " + name + " 的定义（契约 busy 登记了它）");
			continue;
		}
		const got = line.slice(line.indexOf(":") + 1).trim().replace(/;$/, "");
		if (norm(got) !== norm(want)) {
			add("进行中指示", name + " 代码里是 " + got + "，契约写的是 " + want + "（改设计要改契约，别只改一边）");
		}
	}
}

/* ── 15. 列表底边渐隐（契约 listEdgeFade）────────────────────────────── */
/**
 * 侧栏被壁纸插件改半透明之后，原生那条「上色型」渐隐带（.bhn1Oq_fade，收尾色是不透明的
 * --dsw-specific-sidebar-fill）会在列表底边留下一条横向硬缝。契约把替代方案钉死在代码里：
 * 一条常量 + 两条只在开档时生效的规则。这里查**能静态查的**（选择器形状、后缀匹配方式、
 * 24 只写一遍、门控）；真机行为在 tools/probes/contract.js ⑭。
 */
function checkListEdgeFade() {
	const spec = contract.listEdgeFade;
	if (!spec) {
		add("列表底边渐隐", "契约里缺 listEdgeFade（侧栏半透明后原生渐隐带怎么替代，必须是一条登记过的事实）");
		return;
	}
	const pkg = contract.packages[spec.package];
	if (!pkg) {
		add("列表底边渐隐", "契约 listEdgeFade.package 指向 " + spec.package + "，但 packages 里没有这个包");
		return;
	}
	const code = read(pkg.entry);
	for (const needle of spec.must || []) {
		if (!code.includes(needle)) {
			add("列表底边渐隐", pkg.entry + " 里找不到 " + JSON.stringify(needle) + "（契约 listEdgeFade.must 登记过）");
		}
	}
	for (const needle of spec.forbidden || []) {
		if (code.includes(needle)) {
			add("列表底边渐隐", pkg.entry + " 里还有 " + JSON.stringify(needle)
				+ " —— 内容容器实测带附加类（bhn1Oq_treeBody bhn1Oq_wide），后缀匹配命中不到，遮罩会静静失效（契约 listEdgeFade.suffixMatchWhy）");
		}
	}
	/* 24px 只写一遍：常量一处定义，两条 mask 声明都引用它 */
	const h = spec.height || {};
	if (h.constName && h.px) {
		const def = "const " + h.constName + " = { heightPx: " + h.px + " }";
		const n = code.split(def).length - 1;
		if (n !== 1) add("列表底边渐隐", def + " 出现 " + n + " 次（应恰好一次：渐隐高度只能有一个定义处）");
		const ref = "${" + h.constName + ".heightPx}";
		const refs = code.split(ref).length - 1;
		if (refs !== 2) add("列表底边渐隐", ref + " 被引用 " + refs + " 次（应为 2：-webkit-mask-image 与 mask-image 各一次）");
	}
	/* 门控：两条新规则都必须挂在开档属性下，否则关档（没装壁纸）时 UI 会变 */
	const gate = ':root[${ON_ATTRIBUTE}] [class$="_sidebarCol"] ';
	for (const suffix of [spec.fadeSuffix, spec.containerSuffix]) {
		if (!suffix) continue;
		const sel = '[class*="' + suffix + '"]';
		const n = code.split(gate + sel).length - 1;
		if (n !== 1) {
			add("列表底边渐隐", gate + sel + " 出现 " + n + " 次（应恰好一次，且必须门控在 :root[${ON_ATTRIBUTE}] 下：关档要与原生逐像素相同）");
		}
	}
}

/* ── 16. 探针端口只有一处定义（契约 probes.ffPort）─────────────────────
 *
 * Marionette 端口此前在 tools/harness.mjs 与 tools/check.mjs 里各写了一遍
 * `2828`。两处都"能用"，所以不一致时不会报错，只会表现为"换了端口却连不上/
 * 连到了别的实例"这类难查的现场。现在默认值只在契约里定义一次，两个文件都读它；
 * 环境变量 DSH_FF_PORT 仍然优先（换端口不用改文件）。
 *
 * 这一条守的是"单一约定"：契约里必须有这个数，两个使用方都必须真的读它，
 * 而且不许再出现裸的端口字面量作为默认值。
 */
function checkProbePort() {
	const spec = contract.probes;
	if (!spec || typeof spec.ffPort !== "number") {
		add("探针端口", "契约里缺 probes.ffPort（Marionette 端口的默认值必须登记在一处）");
		return;
	}
	const envName = spec.ffPortEnv || "DSH_FF_PORT";
	for (const rel of spec.ffPortUsedBy || []) {
		let code;
		try {
			code = read(rel);
		} catch (error) {
			add("探针端口", "probes.ffPortUsedBy 列了 " + rel + "，但读不到这个文件");
			continue;
		}
		/* 必须真的引用契约字段，而不是自己再写一遍数字。 */
		if (!/probes\s*&&\s*\w+\.probes|contract\.probes|\.probes\b/.test(code) || !code.includes(".ffPort")) {
			add("探针端口", rel + " 没有从契约 probes.ffPort 取端口默认值（两处各写一遍就又出现第二处定义了）");
		}
		if (!code.includes(envName)) {
			add("探针端口", rel + " 里找不到环境变量名 " + envName + "（契约说它可以覆盖默认端口）");
		}
		/* 裸字面量只能在**代码**里出现一次，且必须是 `|| <port>` 的兜底形状。
		   注释里的示例不算数 —— 用法说明里出现端口是有意义的，所以先把注释剥掉。
		   （注释剥离是粗粒度的：不支持字符串里的 `//`，本仓库工具脚本里没有这种写法。） */
		const codeOnly = code
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");
		const bare = codeOnly.split(new RegExp("\\|\\|\\s*" + spec.ffPort + "\\b")).length - 1;
		const all = codeOnly.split(String(spec.ffPort)).length - 1;
		if (bare > 1) {
			add("探针端口", rel + " 里 " + spec.ffPort + " 作为兜底出现 " + bare + " 次（应至多一次）");
		}
		if (all - bare > 0) {
			add("探针端口", rel + " 的**代码**里还有 " + (all - bare) + " 处裸端口字面量 " + spec.ffPort
				+ "（默认值应读契约 probes.ffPort；兜底只允许一处，写成 `|| " + spec.ffPort + "`）");
		}
	}
}

/* ── 17. 命令模式菜单的厚玻璃（契约 glass.commandMenu）──────────────────
 *
 * 用户 2026-09-27 报「透明背景下命令模式（/）输入栏可读性差」，要求「改成与 goal 界面
 * 一致的厚玻璃」。查证结论：**不能照抄 goal 的 blur** —— 菜单渲染在 composer 卡片内部，
 * 卡片自己有 backdrop-filter、因而是 backdrop root，卡片内没有可采样的页面内容，
 * 菜单自己的 backdrop-filter 贡献恒为 0（四组对照实测，见契约 glass.commandMenu.whyNotBlur）。
 * 所以修法是"把底色做厚"，可读性只由那层不透明度决定。
 *
 * 这一条守三件事（都是"改回去就会重新看不清"或"改错地方会伤别人"）：
 *   ① 三个设计数字在代码里**恰好各出现一次**（一处定义 = 一个含义）；
 *   ② 底色不透明度不许低于契约的地板 —— 低于它，实心浅色背景上会掉回 AA 以下；
 *   ③ 选择器必须锚在 [data-trigger-menu] 上。它是命令模式菜单的专属标记：
 *      MenuSurface 还被 commands / model-selection / permission 等复用，
 *      锚错（例如写 [data-menu-material]）就会把别的浮层一起改掉。
 *      material 那一层的选择性停用也一并核对。
 */
function checkCommandMenuGlass() {
	const cm = contract.glass && contract.glass.commandMenu;
	if (!cm) {
		add("命令模式玻璃", "契约里缺 glass.commandMenu（命令菜单怎么变可读、为什么不能靠 blur，必须是一条登记过的事实）");
		return;
	}
	const spec = contract.packages["dsh-warm-ui"];
	if (!spec) {
		add("命令模式玻璃", "契约 packages 里没有 dsh-warm-ui");
		return;
	}
	const code = read(spec.entry);

	/* ① 设计数字恰好各出现一次 */
	for (const row of cm.designNumbers || []) {
		const hits = code.split(row.needle).length - 1;
		if (hits !== 1) {
			add("命令模式玻璃", row.needle + " 在 " + spec.entry + " 里出现 " + hits + " 次（应恰好一次：一处定义 = 一个含义）");
		}
	}

	/* ② 不透明度地板 —— **从代码里取实际值**，不是读契约自己写的那个数。
	   读契约等于"用契约检查契约"，代码真被改薄了它照样绿（这个坑踩过一次：
	   变异测试把契约和代码一起改成 .45，这条检查没报）。 */
	if (typeof cm.legibilityFloor === "number") {
		const decl = code.match(/--wta-slash-fill:\s*rgba\([^)]*?,\s*([0-9.]+)\s*\)/);
		if (!decl) {
			add("命令模式玻璃", spec.entry + " 里找不到 --wta-slash-fill 的 rgba 声明（取不到实际不透明度，无法核对地板）");
		} else {
			const alpha = Number(decl[1]);
			if (alpha < cm.legibilityFloor) {
				add("命令模式玻璃", "--wta-slash-fill 在代码里的不透明度是 " + alpha + "，低于契约地板 " + cm.legibilityFloor
					+ " —— " + (cm.legibilityFloorWhy || "再薄就会在实心浅色背景上掉回 AA 以下"));
			}
		}
	}

	/* ③ 选择器必须锚在命令菜单的专属标记上 */
	if (cm.sel && !code.includes('body[data-wta-glass="1"] ' + cm.sel)) {
		add("命令模式玻璃", spec.entry + " 里找不到门控规则 " + 'body[data-wta-glass="1"] ' + cm.sel
			+ "（必须门控在开档属性下，且只作用于命令菜单）");
	}
	if (cm.sel && code.includes('body[data-wta-glass="1"] [data-menu-material]')) {
		add("命令模式玻璃", spec.entry + " 里用了 [data-menu-material] —— 那是 MenuSurface 的通用标记，"
			+ "commands / model-selection 等浮层也在用，会把它们一起改掉；命令菜单的专属标记是 " + cm.sel);
	}
	/* material 层必须被停用：留着它会和 .94 的底色叠成两层 */
	if (!/\[data-trigger-menu\] > \[aria-hidden="true"\]:first-child/.test(code)) {
		add("命令模式玻璃", spec.entry + " 里没有停用 MenuSurface 的 material 层（留着它会让底色叠两层，"
			+ "实测 material 的 backdrop-filter 在该位置贡献恒为 0，没有保留价值）");
	}
}

const checks = [
	["语法", checkSyntax],
	["样式归属", checkStyleOwnership],
	["客户端插件形状", checkClientPluginShape],
	["注入登记 / 标记名", checkPackages],
	["挂载入口", checkMountSites],
	["CSS 变量闭包", checkCssVars],
	["契约数字", checkContractNumbers],
	["共享依赖", checkRequires],
	["探针", checkProbes],
	["玻璃无动效", checkGlassMotion],
	["底部曲率", checkGlassCurvature],
	["悬停判定", checkGlassPointer],
	["进行中指示", checkBusyIndicator],
	["列表底边渐隐", checkListEdgeFade],
	["探针端口", checkProbePort],
	["命令模式玻璃", checkCommandMenuGlass],
	["卡片包含块", checkGlassContainingBlock],
	["warm 系列打包", () => checkWarmSeries(ROOT, read, add)],
];
for (const [label, run] of checks) {
	const before = findings.length;
	run();
	console.log((findings.length === before ? "  ✓ " : "  ✗ ") + label);
}

if (wantsBrowser && env.url) {
	const before = findings.length;
	runBrowser(env);
	console.log((findings.length === before ? "  ✓ " : "  ✗ ") + "真机断言");
}

if (wantsHmr && env.url) {
	const before = findings.length;
	await runHmr(env);
	console.log((findings.length === before ? "  ✓ " : "  ✗ ") + "热重载回归");
}

if (findings.length) {
	console.log("\n发现 " + findings.length + " 个问题：");
	for (const f of findings) console.log("  [" + f.check + "] " + f.message);
	process.exit(1);
}
console.log("\n全部通过。");
