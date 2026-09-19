/* P0 探针（热重载）：连续几次热更之后，样式表与注入节点还各只有一份吗？
 *
 * 这是本轮两个 bug 的核心回归项：
 *   - 样式表必须带 data-plugin（HMR 才删得掉），热更 N 次后计数必须恒为 1；
 *   - 注入节点必须带 data-dsh-warm-owner，同类恒为 1。
 *
 * 跑法：先把这个探针挂上去跑，**同时**在另一边改动插件文件触发重建
 * （见 tools/README.md 里的 hmr 回归步骤）。探针自己订阅 /plugins/events，
 * 数出真正发生了几次 rebuilt 帧，避免"其实没热更"被当成通过。
 */
const frames = [];
let es = null;
try {
  es = new EventSource("/plugins/events");
  es.addEventListener("message", (event) => {
    try {
      const frame = JSON.parse(event.data);
      frames.push(String(frame.type) + ":" + String(frame.id || ""));
    } catch (error) {
      frames.push("unparseable");
    }
  });
} catch (error) {
  frames.push("EventSource 打不开");
}

const sample = () => ({
  base: document.querySelectorAll("style[data-dsh-warm-ui]").length,
  extra: document.querySelectorAll("style[data-dsh-warm-extra]").length,
  wallpaper: document.querySelectorAll("style[data-dsh-warm-wallpaper-style]").length,
  unowned: [...document.querySelectorAll("style")].filter((el) => !el.hasAttribute("data-plugin")).length,
  owners: [...document.querySelectorAll("[data-dsh-warm-owner]")].length,
  canvases: document.querySelectorAll("[data-dsh-warm-wallpaper-layer]").length,
  overflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
});

const samples = [sample()];
/* 三拍，每拍 3 秒：改动由外部（跑这条探针的同时）触发，这里只负责按时取数。 */
const SAMPLE_INTERVAL_MS = 3000;
const SAMPLE_COUNT = 3;
for (let i = 0; i < SAMPLE_COUNT; i += 1) {
  await new Promise((r) => setTimeout(r, SAMPLE_INTERVAL_MS));
  samples.push(sample());
}
if (es) es.close();

const owners = {};
for (const el of document.querySelectorAll("[data-dsh-warm-owner]")) {
  const v = el.getAttribute("data-dsh-warm-owner");
  owners[v] = (owners[v] || 0) + 1;
}

return {
  frames,
  rebuilt: frames.filter((f) => f.startsWith("rebuilt")).length,
  samples,
  owners,
  canvasDisplay: (() => {
    const c = document.querySelector("[data-dsh-warm-wallpaper-layer]");
    return c ? getComputedStyle(c).display : null;
  })(),
};
