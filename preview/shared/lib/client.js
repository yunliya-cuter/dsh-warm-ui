/**
 * dsh-warm-shared —— 暖色插件族共用的浏览器侧工具（**重复代码的唯一收拢点**）。
 *
 * 这里只放「一个含义只该写一遍、而且写错了会出事」的东西：
 *   1. `createStyleInstaller` —— 样式表注入三件套（data-plugin / data-plugin-css /
 *      按标签名去重），绑定调用方自己的包名；
 *   2. `cssPropertyName` —— camelCase → kebab-case（写内联样式与生成 CSS 共用
 *      同一条命名规则，属性名不手抄两遍）。
 *
 * 为什么注入三件套必须只写一遍（这是两个线上 bug 的根，别再把实现抄回各包）：
 *   - 模块加载器只在**工厂返回那一刻**认领当时还没打标的 `<style>`
 *     （dsh-client-modules 的 claimStyles）；热重载只删 `style[data-plugin=<包名>]`
 *     （dsh-client-hmr 的 removeOwnedStyles）。漏了标记 = 旧表永远删不掉，还会被
 *     后加载的插件**错认成自己的**，于是每加热更一次 `<head>` 里就多一份旧表 ——
 *     旧表把玻璃滤镜 svg 撑出 255px，用户看到的就是「壁纸跑到页面下面」。
 *   - 每个包抄一份，就有抄错/漏改的机会：这正是「修来修去」的来源。
 *
 * 依赖方向：dsh-warm-ui / dsh-warm-wallpaper → dsh-warm-shared（单向）。
 * 两侧都登记在 contract/ui-contract.json 的 `requires` 里，由 tools/check.mjs 核对：
 * 声明了依赖就必须真出现 `require("dsh-warm-shared")`，且**不得**再自己实现注入三件套。
 */
window.__ModuleLoader__.load({
	id: "dsh-warm-shared",
	factory: () => {
		var module = { exports: {} };
		var exports = module.exports;

		/** 样式表标签名：归属包名 + 源文件 + 表名，跨代唯一且稳定（去重就靠它）。 */
		function styleTagId(packageId, name) {
			return packageId + "/lib/client.js#" + name;
		}

		/**
		 * 插一份样式表并打上官方那三个标记；**同包同表**已存在就直接复用（幂等）。
		 * @param {string} packageId 归属包名 —— 必须是**调用方自己**的包名：
		 *   热重载按它删表（dsh-client-hmr 的 removeOwnedStyles），写错就成了别人的表。
		 * @param {string} name 表名（base / extra …），同包内唯一。
		 * @param {string} css 样式文本。
		 * @param {string} [marker] 额外的语义标记属性（DevTools 与探针认表用）。
		 * @returns {HTMLStyleElement|null} 没有 document（非浏览器环境）时返回 null。
		 */
		function installStyleSheet(packageId, name, css, marker) {
			if (typeof document === "undefined") return null;
			const id = styleTagId(packageId, name);
			const existing = document.querySelector("style[data-plugin-css=" + JSON.stringify(id) + "]");
			if (existing) return existing;
			const tag = document.createElement("style");
			tag.dataset.plugin = packageId;
			tag.dataset.pluginCss = id;
			if (marker) tag.setAttribute(marker, "");
			tag.textContent = css;
			document.head.appendChild(tag);
			return tag;
		}

		/**
		 * 绑定归属包名，返回该包自己的注入函数 —— 调用点因此只需要表名与标记，
		 * 包名在一处出现（`installStyleSheet("base", css, marker)`）。
		 * @param {string} packageId 归属包名。
		 * @returns {(name: string, css: string, marker?: string) => HTMLStyleElement|null}
		 */
		function createStyleInstaller(packageId) {
			return (name, css, marker) => installStyleSheet(packageId, name, css, marker);
		}

		/** camelCase → kebab-case：内联样式与生成的 CSS 共用同一条命名规则。 */
		function cssPropertyName(prop) {
			return prop.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
		}

		exports.createStyleInstaller = createStyleInstaller;
		exports.cssPropertyName = cssPropertyName;
		/**
		 * 客户端半边**也必须是一个插件**：浏览器侧的 runner（dsh-cordis-client-runner）
		 * 会按模块图谱给每个客户端包建一条 loader 条目，并把它的导出当插件 apply ——
		 * 没有 `apply` 就会被判成 "invalid plugin … received object"，
		 * 而且这个错会**拦住整个宿主启动**（页面只剩「Failed to load plugins」）。
		 * 本包只用工具函数，所以这里什么都不做（消费方靠工厂体里的 require 取函数）。
		 */
		exports.apply = () => {};
		/** 不注入任何服务。 */
		exports.inject = [];
		return module.exports;
	},
});
