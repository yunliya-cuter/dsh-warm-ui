/* P0 探针（输入框宽度 · 设置）：把 DSH 自己的「会话内容宽度」偏好写进 localStorage。
 *
 * 为什么只改这一个键：输入框卡片的宽度上限是 DSH 自己算的 ——
 *   --dsh-composer-card-max-width = --dsh-chat-user-width + 32
 *   --dsh-chat-user-width = resolveContentWidth(列宽, 偏好)
 *                         = min(max(偏好, 640), max(640, 列宽 - 176))
 * 偏好键就是 dsh.conversation.contentWidth（拖过宽度手柄才会写）。
 * 见 dsh-client-ui-conversation/lib/client.js 的 WIDTH_PREF_KEY / resolveContentWidth。
 *
 * 跑法：先跑本探针写值 → 再跑 p0-composer.js 量（每次 eval 都是一次全新页面加载，
 * 所以"写完立刻量"必须拆成两条）。
 * 要还原成"没有偏好"：URL 带 `#contentWidth=0` 再跑一次即可（非正数 = 无偏好）。
 */
const KEY = "dsh.conversation.contentWidth";
const m = String(location.hash).match(/contentWidth=(\d+)/);
const value = m ? Number(m[1]) : 1200;
const action = value > 0 ? "set" : "remove";

try {
  if (action === "set") window.localStorage.setItem(KEY, String(value));
  else window.localStorage.removeItem(KEY);
} catch (error) {
  return { ok: false, error: String(error) };
}
return { ok: true, action, key: KEY, readBack: window.localStorage.getItem(KEY) };
