/* P0 探针（输入框宽度 · 量取）：卡片宽度到底由谁决定。
 *
 * 返回四个数，对照 DSH 自己的公式即可判断"宽"是不是我们造成的：
 *   card        卡片实际宽度
 *   cardMax     卡片的 max-width 计算值（应等于 --dsh-composer-card-max-width）
 *   contentVar  --dsh-chat-user-width 的实际值（无偏好时为空串）
 *   columnVar   --dsh-conversation-column-width 的实际值
 *   widthPref   localStorage 里的偏好原文
 * 公式：content = min(max(pref, 640), max(640, column - 176))；card ≤ content + 32。
 */
const KEY = "dsh.conversation.contentWidth";
const card = document.querySelector('[data-slot="conversation.composer.bar"] [class*="_card"]');

/* 这两个变量写在会话根节点上（不是 :root），所以从卡片往上找持有者。 */
let host = card;
let contentVar = "";
let columnVar = "";
for (let el = card; el; el = el.parentElement) {
  const style = el.style;
  if (style && style.getPropertyValue("--dsh-chat-user-width")) {
    host = el;
    contentVar = style.getPropertyValue("--dsh-chat-user-width").trim();
    columnVar = style.getPropertyValue("--dsh-conversation-column-width").trim();
    break;
  }
}

let widthPref = null;
try {
  widthPref = window.localStorage.getItem(KEY);
} catch (error) {
  widthPref = "读取失败";
}

/* 公式复算：把"应当是"的宽度和实测放一起，差值一眼可见。 */
const column = parseFloat(columnVar) || 0;
const pref = Number(widthPref);
const MIN = 640;
const EDGE = 176;
const expectContent = Number.isFinite(pref) && pref > 0
  ? Math.min(Math.max(pref, MIN), Math.max(MIN, column - EDGE))
  : Math.max(680, Math.min(column * 0.64, 920));

return {
  card: card ? Math.round(card.getBoundingClientRect().width) : null,
  cardMax: card ? getComputedStyle(card).maxWidth : null,
  contentVar: contentVar || null,
  columnVar: columnVar || null,
  widthPref,
  host: host ? String(host.className).split(" ")[0] : null,
  expectContent: Math.round(expectContent),
  expectCard: Math.round(expectContent) + 32,
  viewport: window.innerWidth,
};
