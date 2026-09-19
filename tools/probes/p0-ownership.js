/* P0 探针：样式归属 / 换代清扫 / 布局不变量。
 *
 * 由 Marionette（tools/harness.mjs，或工作区里的 _ff.mjs）在真 Firefox 里执行，
 * 函数体用 return 交回一个可序列化的结果。跑法见 tools/README.md。
 */
const de = document.documentElement;

/* ---- ① 样式表归属：lib/client.js 注入的每一张都该带 data-plugin ---- */
const styles = [...document.querySelectorAll("style")].map((el) => ({
  plugin: el.getAttribute("data-plugin"),
  cssId: el.getAttribute("data-plugin-css"),
  warm: el.hasAttribute("data-dsh-warm-ui"),
  extra: el.hasAttribute("data-dsh-warm-extra"),
  wallpaper: el.hasAttribute("data-dsh-warm-wallpaper-style"),
  bytes: (el.textContent || "").length,
}));
const byMarker = {
  base: styles.filter((s) => s.warm).length,
  extra: styles.filter((s) => s.extra).length,
  wallpaper: styles.filter((s) => s.wallpaper).length,
};
/* 没打 data-plugin 的样式表 = 热重载删不掉的残留（历史 bug 的根） */
const unowned = styles.filter((s) => !s.plugin).map((s) => s.cssId || (s.bytes + "B"));

/* ---- ② 归属标记：每个注入节点都该有，且同类只有一个 ---- */
const owners = {};
for (const el of document.querySelectorAll("[data-dsh-warm-owner]")) {
  const v = el.getAttribute("data-dsh-warm-owner");
  owners[v] = (owners[v] || 0) + 1;
}

/* ---- ③ 布局不变量：文档不许比视口高 ---- */
const overflow = de.scrollHeight - de.clientHeight;

/* ---- ④ 壁纸层：必须在、且 fixed 铺满、display 不是 none ---- */
const canvas = document.querySelector("[data-dsh-warm-wallpaper-layer]");
const ccs = canvas ? getComputedStyle(canvas) : null;
const wallpaper = canvas
  ? { position: ccs.position, display: ccs.display, zIndex: ccs.zIndex, w: canvas.width, h: canvas.height }
  : null;

/* ---- ⑤ 工具行三态：胶囊/插件滑杆的可见性 ---- */
const row = document.querySelector(".dpo-controls");
const vis = (el) => (el ? getComputedStyle(el).display !== "none" : null);
const chip = document.querySelector("[data-dsh-warm-collapse]");
const sliders = [...document.querySelectorAll(".dpo-controls .dpo-slider")];
const toolbar = {
  state: document.body.getAttribute("data-dsh-warm-dpo"),
  rowHeight: row ? Math.round(row.getBoundingClientRect().height) : null,
  chip: vis(chip),
  sliders: sliders.map(vis),
  tierCollapsed: vis(document.querySelector('[data-dpo="tier-collapsed"]')),
};

/* ---- ⑥ 输入框宽度：卡片 / 正文列 / 拖拽偏好 ---- */
const card = document.querySelector('[data-slot="conversation.composer.bar"] [class*="_card"]');
const contentWidth = getComputedStyle(de).getPropertyValue("--dsh-chat-user-width").trim();
let widthPref = null;
try {
  widthPref = window.localStorage.getItem("dsh.conversation.contentWidth");
} catch (error) {
  widthPref = "读取失败";
}
const composer = {
  card: card ? Math.round(card.getBoundingClientRect().width) : null,
  cardMaxWidth: card ? getComputedStyle(card).maxWidth : null,
  contentWidthVar: contentWidth || null,
  widthPref,
  docWidth: de.clientWidth,
  viewport: window.innerWidth,
};

/* ---- ⑦ JS 侧自检口 ---- */
const extra = window.__dshWarmExtra || {};

return {
  url: location.href.replace(/token=[^&]+/, "token=***"),
  overflow,
  styles: { byMarker, unowned, tagged: styles.filter((s) => s.plugin).map((s) => s.plugin + " | " + s.cssId) },
  owners,
  wallpaper,
  toolbar,
  composer,
  missingCssVars: extra.missingCssVars || null,
  layoutGuard: extra.layoutGuard || null,
  guardNote: document.querySelector("[data-dsh-warm-guard-note]")?.textContent || null,
};
