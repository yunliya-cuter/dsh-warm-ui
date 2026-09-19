/**
 * dsh-warm-dynbg —— 已停用（2026-09-18 删效果，2026-09-19 摘除配置）。
 *
 * 这个包原来只做一件事：「提灯」—— 一团 300px 的暖光带滞后跟随鼠标指针。
 * 用户原话：「我现在想把鼠标周围的光晕去掉，看着不舒服。不要了。」
 * 于是整个效果全部删除：图层、指针跟随、rAF 循环、时段微移，以及外观面板里
 * 那一整组「提灯」控件（灯光 / 强度 / 时段）。
 *
 * 现在**什么都不画、也不挂**：两份 cordis.patch.yml 里的 `dsh-warm-dynbg` 段已经删掉
 * （3081 的 `~/.dsh/profiles/web/`、3082 预览 home），toggle-dynbg.sh 也一并删了。
 * 本目录只是历史存档，没有任何进程会加载它 —— 契约与检查脚本也不需要它。
 *
 * 想恢复：删除前的完整实现存在
 *   .snapshots/20260918-194905-pre-nolamp/dynbg-client.js
 * 覆盖回本文件，再把 patch 段与 toggle 脚本加回去即可（外观面板的分组会跟着一起回来）。
 */
window.__ModuleLoader__.load({
	id: "dsh-warm-dynbg",
	factory: () => {
		var module = { exports: {} };
		var exports = module.exports;

		const STYLE_ATTRIBUTE = "data-dsh-warm-dynbg-style";
		const LAYER_ATTRIBUTE = "data-dsh-warm-dynbg-layer";
		const MODE_ATTRIBUTE = "data-dsh-warm-dynbg-mode";

		/**
		 * 不画任何东西。只做一件兜底：如果这个包是被**热替换**（而不是整页重载）
		 * 顶掉的，旧实例留下的节点、样式和 CSS 变量要顺手清掉，否则那团光会一直
		 * 挂在页面上 —— 那正是用户要它消失的东西。
		 */
		function apply() {
			try {
				for (const el of document.querySelectorAll("[" + LAYER_ATTRIBUTE + "]")) el.remove();
				for (const el of document.querySelectorAll("[" + STYLE_ATTRIBUTE + "]")) el.remove();
				document.documentElement.removeAttribute(MODE_ATTRIBUTE);
				const vars = document.documentElement.style;
				for (const name of ["--dyb-lc", "--dyb-k", "--dyb-todk"]) vars.removeProperty(name);
			} catch (error) {
				/* 清理失败也无所谓：新实现本来就不绘制任何东西 */
			}
			return () => {};
		}

		exports.apply = apply;
		/** 没有控件要挂，所以不注入任何服务。 */
		exports.inject = [];
		return module.exports;
	},
});
