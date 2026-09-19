/**
 * dsh-warm-shared —— host 半边（空插件）。
 *
 * 全部内容是浏览器侧的工具函数（lib/client.js）。这里只是为了让 loader 有一条
 * entry —— dsh-client-modules 按 loader entry 扫描 `dsh.client` 声明，没有 host
 * 半边就不会有 client 模块，别的包也就 require 不到它。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - profile 上下文（未使用）。
 */
export function apply(ctx) {
	void ctx;
}
