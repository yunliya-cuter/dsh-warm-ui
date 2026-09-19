/**
 * dsh-warm-ui —— host 半边。
 *
 * 本插件的全部行为都在浏览器侧（lib/client.js）：叠一层暖色 token + 注入一张
 * 输入栏整形样式表。host 侧不需要任何服务，所以这里是一个空插件，只为了让
 * loader 有一条 entry —— dsh-client-modules 是按 loader entry 扫描 `dsh.client`
 * 声明的，没有 host 半边就不会有 client 模块。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - profile 上下文（未使用）。
 */
export function apply(ctx) {
	void ctx;
}
