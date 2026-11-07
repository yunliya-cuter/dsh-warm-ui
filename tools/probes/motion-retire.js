/* 高亮块层必须退出滚动内容（2026-11-07 用户报「滚轮往下滑会滑到没有内容的地方」）。
 *
 * 背景：内容模式下（"把高亮层挂进滚动内容"，2026-11-01）块层是滚动容器里的绝对定位元素，
 * 块用内容坐标 —— 浏览器会把这些后代算进容器的 scrollHeight。于是只要块的纵坐标比
 * 「当前内容」更靠下（选中的是很长的消息、之后消息折叠 / 切会话 / 压缩让内容变短），
 * 滚动区末尾就凭空多出一段空白：能一直往下滚，滚到的却是一片空，块本身早已 opacity:0。
 *
 * 判据（三条，都要成立）：
 *   ① 没有选区时，块层不在滚动容器里（退回 body 的 fixed 模式）；
 *   ② 这块层不产生可滚动溢出：把正文藏掉之后，容器的 scrollHeight 塌回容器高度；
 *   ③ 还在画块的时候**不能**退（内容模式必须保留，否则橙框又会慢半拍）。
 *
 * 跑法：harness eval（真 Firefox）或 Chromium 的 cdp.mjs both —— 都是函数体。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scrollBody = document.querySelector(".wSkVaW_scrollBody") || document.querySelector(".wSkVaW_embeddedBody [class*=scrollBody]");
const layer = document.querySelector(".wta-m-boxes");
const out = { ok: false, reason: "", steps: {} };
if (!scrollBody || !layer) {
	out.reason = "页面上没有对话滚动容器或动效块层（这条探针要在有会话的页面上跑）";
	return out;
}
const content = scrollBody.querySelector(".wSkVaW_viewArea") || scrollBody.firstElementChild;
const hiddenScrollHeight = async () => {
	const keep = content.getAttribute("style");
	content.style.setProperty("display", "none", "important");
	await sleep(150);
	const value = scrollBody.scrollHeight;
	if (keep === null) content.removeAttribute("style");
	else content.setAttribute("style", keep);
	await sleep(150);
	return value;
};
/* ① 先清掉选区，等淡出跑完 */
getSelection().removeAllRanges();
await sleep(900);
out.steps.layerInScrollBody = layer.closest(".wSkVaW_scrollBody") !== null;
out.steps.mode = layer.getAttribute("data-mode");
out.steps.staleBoxes = [...layer.children].filter((el) => el.style.transform && el.style.transform !== "translate3d(0px,0px,0px)").length;
/* ② 层不在滚动内容里时，藏掉正文必须让 scrollHeight 塌回容器高度 */
const containerHeight = scrollBody.clientHeight;
out.steps.scrollHeightWithContentHidden = await hiddenScrollHeight();
out.steps.clientHeight = containerHeight;
/* ③ 真选一段正文：高亮必须照样画出来（块活着）。
   注意：内容模式只在**真实拖选**（有 pointer 归属的滚动容器）时才挂，
   代码里用 Range 造出来的选区 owner 为空，会走 fixed 模式 —— 所以这条只查"还画不画"，
   不查 mode；内容模式的跟随由人工真机复核（见 README 的验收段）。 */
const text = [...scrollBody.querySelectorAll("span, p")].filter((el) => !el.children.length && (el.textContent || "").trim().length > 30).pop();
if (text) {
	const range = document.createRange();
	range.selectNodeContents(text);
	const sel = getSelection();
	sel.removeAllRanges();
	sel.addRange(range);
	await sleep(500);
	out.steps.selectedMode = layer.getAttribute("data-mode");
	out.steps.selectedAliveBoxes = [...layer.children].filter((el) => el.style.opacity && el.style.opacity !== "0").length;
	getSelection().removeAllRanges();
}
out.ok = out.steps.layerInScrollBody === false
	&& out.steps.scrollHeightWithContentHidden <= containerHeight + 8
	&& (!text || out.steps.selectedAliveBoxes > 0);
if (!out.ok) out.reason = "块层还留在滚动内容里 / 藏掉正文后 scrollHeight 仍被顶高 / 有选区时高亮没画出来";
return out;
