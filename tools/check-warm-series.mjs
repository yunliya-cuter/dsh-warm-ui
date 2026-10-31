
import fs from "node:fs";
import path from "node:path";

/**
 * 18. warm 系列打包完整性（单包多插件）
 *
 * 用户 2026-10-31 报「warm-ui 没有集成所有 warm 系列插件，只集成了一部分」。
 * 根因是主包只声明自己的 entry/files，同仓库的 shared / wallpaper / brandgag
 * 仍要靠额外的 git 子目录 spec 单独安装；少装任何一个，运行时就少一个插件。
 *
 * 现在 dsh-warm-ui 是**单包多插件**：三个子包目录进 files，cordis.patch.yml
 * 用相对路径 entry 把它们一起挂进组合树。这一条守三件事：
 *   ① 仓库里所有非 private 的 dsh-warm-* 子包都被列进主包 files；
 *   ② 每个子包在 cordis.patch.yml 里都有且只有一条对应 entry（相对包根路径）；
 *   ③ 主包自身 entry、shared external、以及已停用的 dynbg 不被误挂。
 * 这样「版本发出去但少一个插件」会在静态检查阶段直接报红，而不是等用户装完才看到。
 */
export function checkWarmSeries(ROOT, read, add) {
	const rootPkg = JSON.parse(read("package.json"));
	const previewDir = path.join(ROOT, "preview");
	const active = [];
	for (const dirent of fs.readdirSync(previewDir, { withFileTypes: true })) {
		if (!dirent.isDirectory()) continue;
		const dir = "preview/" + dirent.name;
		const manifest = dir + "/package.json";
		if (!fs.existsSync(path.join(ROOT, manifest))) continue;
		const pkg = JSON.parse(read(manifest));
		if (pkg.private === true || !String(pkg.name || "").startsWith("dsh-warm-")) continue;
		active.push({ dir, name: pkg.name, pkg });
	}
	const expected = ["preview/shared", "preview/wallpaper", "preview/brandgag"];
	const actual = active.map((item) => item.dir).sort();
	if (actual.join(",") !== expected.slice().sort().join(",")) {
		add("warm 系列打包", "非 private 的 dsh-warm-* 子包是 [" + actual.join("、") + "]，与预期的 ["
			+ expected.join("、") + "] 不一致（新增/停用子包时必须同步主包 files 与 cordis.patch.yml）");
	}
	const files = Array.isArray(rootPkg.files) ? rootPkg.files : [];
	const patch = read("cordis.patch.yml");
	for (const item of active) {
		if (!files.includes(item.dir)) {
			add("warm 系列打包", item.name + " 的子包目录 " + item.dir + " 没进主包 package.json 的 files —— npm pack 后子包不会被发布，安装出来就只有一部分 warm 插件");
		}
		if (item.pkg.dsh?.client?.platform !== "web") {
			add("warm 系列打包", item.dir + "/package.json 的 dsh.client.platform 必须是 web");
		}
		if (item.pkg.exports?.["./client"] === undefined) {
			add("warm 系列打包", item.dir + "/package.json 缺少 exports[\"./client\"]");
		}
		const idLine = "- id: " + item.name;
		const nameLine = "      name: './" + item.dir + "/lib/index.js'";
		const idAt = patch.indexOf(idLine);
		if (idAt < 0 || patch.indexOf(nameLine, idAt) < 0) {
			add("warm 系列打包", "cordis.patch.yml 缺少 " + item.name + " 的相对路径 entry（应为 ./" + item.dir + "/lib/index.js）");
		}
	}
	if (!/- id: dsh-warm-ui\n\s+name: 'dsh-warm-ui'/.test(patch)) {
		add("warm 系列打包", "cordis.patch.yml 缺少 dsh-warm-ui 自身 entry");
	}
	if (patch.includes("dsh-warm-dynbg")) add("warm 系列打包", "已停用的 dsh-warm-dynbg 又被写回 cordis.patch.yml");
	const external = rootPkg.dsh?.client?.external;
	if (!Array.isArray(external) || !external.includes("dsh-warm-shared")) {
		add("warm 系列打包", "主包 dsh.client.external 必须声明 dsh-warm-shared（模块图谱靠它把共享包排在本包之前）");
	}
}
