/**
 * dsh-warm-dynbg —— host 半边（空插件）。
 *
 * 全部行为都在浏览器侧（lib/client.js）。host 侧不需要任何服务，这里只是为了让
 * loader 有一条 entry —— dsh-client-modules 按 loader entry 扫描 `dsh.client`
 * 声明，没有 host 半边就不会有 client 模块。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - profile 上下文（未使用）。
 */
export function apply(ctx) {
	void ctx;
}
