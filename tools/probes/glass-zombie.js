/* 僵尸世代回归：**没被卸载的旧插件实例**不许再碰页面。
 *
 * 用户 2026-09-24 报「输入框经常闪烁」并贴出 console：同一个插件的三份 rev 同时活着，
 * 每份都在 `onPointerMove → scheduleHover → hoverTick → sync → dress` 上抛
 * `GLASS_WARP is not defined` 之类的错 —— 那是"流动层"删除过程中三次**半删状态**存盘
 * 留下的旧实例：它们加载时输入卡片还不存在（`targets()` 空，第一发 sync 什么都没做），
 * 所以装上了；等卡片出现、指针一动才开始抛。热重载换掉了模块，但旧实例的
 * pointermove 监听与 rAF **从来没有被卸载**，于是每一代都还在写同一个输入框
 * （工具行里那颗「优化」胶囊被几代互相删/互相插），这就是闪烁。
 *
 * 光有换代守卫还不够——守卫原来写在**模块作用域**的变量里，热重载会给出新模块实例，
 * 新实例的计数器从 0 开始，谁也不认识谁。所以守卫必须挂在 `window` 上（跨实例）：
 * 只有最新一代允许写页面，其余世代一律停手（见 contract/ui-contract.json 的 lifecycle）。
 *
 * 本探针不改代码、不写配置，只在一个一次性浏览器实例里做四件事：
 *   ① 单实例指针风暴 —— 记录 DOM 变更数，作为"正常态"基线；
 *   ② 用假 loader / 假 ctx 连挂**两代**插件（`effect` 故意不提供卸载，等价于热重载
 *      换模块时旧实例被遗漏），再跑同样的指针风暴 —— 改前这里会看到成百上千次变更、
 *      胶囊数量上下跳；改后应当回到基线量级；
 *   ③ 把 `document.elementFromPoint` 换成必抛 —— 校验"玻璃出错时自我卸载"：
 *      只报一次错、`window.__dshWarmExtra.glass.alive === false`、页面照常可用；
 *   ④ 顺带核对玻璃滤镜没有指向不存在的 id（僵尸世代最爱留下这种残迹）。
 *
 * 跑法：harness `eval`（真 Firefox）；Chromium 用 `_warmtheme_shots/cdp.mjs both`，
 * 记得先把本文件包成 `(async () => { … })()`（见 tools/README.md 第 5 节）。
 *
 * 为什么用"注入同源 script"而不是 eval 源码来造世代：CSP 可能禁掉 `unsafe-eval`，
 * 而外链脚本走的是页面自己的 loader 通道；这里只是把 `load` 临时换成"捕获不注册"，
 * 拿到注册记录后立刻还原 —— 页面自己的模块图谱一点不动。
 
 *
 * 为什么这里的代码是内联的：本文件**不是模块**，而是交给 tools/harness.mjs 的一段
 * **函数体** —— harness 把它包成 `return (async () => { … })()` 用 Marionette 送进
 * 真页面执行，所以它没有 import / require，也没有 node 的 fs / path。取值、常量、
 * 判据只能就地写在这个文件里；凡是"数字与可见性"这类该由一处定义的期望值，一律
 * 走契约（harness 注入为 window.__warmContract），本文件不手抄第二份。
*/
const MOVES = 120;
const SETTLE_MS = 1200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rows = (window.__DSH_BOOT__ && window.__DSH_BOOT__.entries) || [];
const rowOf = (needle) =>
  rows.find((row) => String(row.id || "").indexOf(needle) >= 0) ||
  /* 兜底：boot 清单被压缩掉时按资源记录找（rev 用当前的，热重载后也拿得到） */
  (() => {
    const hit = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => name.indexOf(needle) >= 0)
      .pop();
    return hit ? { id: needle, url: hit.replace(location.origin, "") } : null;
  })();

const uiRow = rowOf("dsh-warm-ui");
const sharedRow = rowOf("dsh-warm-shared");

/** 计数口：整个探针期间累加，各阶段自己记差值。变更按来源分开记 ——
    断言"是胶囊在互相删插"还是"是玻璃在重复写样式"必须看得到证据，不能只看总数。 */
let mutations = 0;
let stats = { childList: 0, attributes: 0, chip: 0, style: 0 };
/** 残量归因：改完守卫之后还剩的变更到底是谁写的（属性名 / 目标节点），别拿总数当结论。 */
let byAttr = {};
let byTarget = {};
const nodeKey = (node) => {
  if (!node || node.nodeType !== 1) return String(node && node.nodeName) || "?";
  const cls = String(node.className || "").split(/\s+/).filter(Boolean).slice(0, 2).join(".");
  return node.tagName + (cls ? "." + cls : "");
};
const bump = (bag, key) => {
  bag[key] = (bag[key] || 0) + 1;
};
const observer = new MutationObserver((records) => {
  mutations += records.length;
  for (const record of records) {
    if (record.type === "childList") {
      stats.childList += 1;
      const touched = [...record.addedNodes, ...record.removedNodes];
      if (touched.some((node) => node.nodeType === 1 && node.classList && node.classList.contains("wti-chip"))) {
        stats.chip += 1;
      }
      bump(byTarget, "childList@" + nodeKey(record.target) + " → " + (touched.map(nodeKey).join("|") || "?"));
    } else if (record.type === "attributes") {
      stats.attributes += 1;
      if (record.attributeName === "style") stats.style += 1;
      bump(byAttr, record.attributeName || "?");
      bump(byTarget, record.attributeName + "@" + nodeKey(record.target));
    }
  }
});
observer.observe(document.body, { childList: true, subtree: true, attributes: true });

const errors = [];
const consoleErrors = [];
window.addEventListener("error", (event) => errors.push(String((event && event.message) || event)));
const realConsoleError = console.error;
console.error = (...args) => {
  consoleErrors.push(args.map(String).join(" "));
  return realConsoleError.apply(console, args);
};

/** 注入一段同源 bundle，临时把 loader 的 load 换成"只捕获不注册"。 */
const captureRegistration = (url) =>
  new Promise((resolve, reject) => {
    const loader = window.__ModuleLoader__;
    const realLoad = loader.load;
    let captured = null;
    loader.load = (registration) => {
      captured = registration;
    };
    const script = document.createElement("script");
    script.src = url;
    script.onload = () => {
      loader.load = realLoad;
      script.remove();
      if (captured) resolve(captured);
      else reject(new Error("bundle 没有调用 __ModuleLoader__.load：" + url));
    };
    script.onerror = () => {
      loader.load = realLoad;
      script.remove();
      reject(new Error("bundle 注入失败：" + url));
    };
    document.head.append(script);
  });

/** 假 ctx：`effect` 只跑不卸（等价于"旧世代漏掉了 dispose"），slots 缺省让外观面板自然降级。 */
const zombieCtx = () => ({
  effect: (fn) => fn(),
  theme: { overrideTokens: () => () => {} },
});

const glassTarget = () =>
  document.querySelector('[data-slot="conversation.composer.bar"] [class*="_card"]') ||
  document.querySelector('[data-slot="conversation.input.dock"] [class*="_root"]');

/** 指针风暴：指针**始终停在输入卡片内部**，所以悬停态只在第一发变化一次 —— 剩下的变更必然来自别处。 */
const storm = (moves, sample) =>
  new Promise((resolve) => {
    const card = glassTarget();
    const rect = card ? card.getBoundingClientRect() : null;
    let i = 0;
    const tick = () => {
      if (i >= moves) return resolve();
      const t = i / moves;
      const x = rect ? rect.left + 12 + (rect.width - 24) * (0.5 + 0.49 * Math.sin(t * 12)) : window.innerWidth / 2;
      const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y, bubbles: true, composed: true }));
      i += 1;
      /* 每帧顺手看一眼胶囊数量。实测这个数字**不敏感**：一次"删掉对方的 + 插回自己的"
         在同一帧内完成，抽样时永远是 1 颗，所以闪烁的证据要看变更记录（byKind.chip），
         不能看数量 —— 这里留着只是为了确认"没有同时并列两颗"这种更粗的坏状态。 */
      if (sample) sample();
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  });

/** 量一轮：指针风暴 + 静置，记录 DOM 变更数（按来源分开）、胶囊数量的抖动、缺失的滤镜 id。 */
const measure = async (label) => {
  mutations = 0;
  stats = { childList: 0, attributes: 0, chip: 0, style: 0 };
  byAttr = {};
  byTarget = {};
  let chipSamples = 0;
  let chipOff = 0;
  let chipMax = 0;
  let missingFilter = 0;
  const sample = () => {
    const chips = document.querySelectorAll(".wti-chip").length;
    chipSamples += 1;
    chipMax = Math.max(chipMax, chips);
    if (chips !== 1) chipOff += 1;
    for (const el of document.querySelectorAll('[data-slot="conversation.composer.bar"] [class*="_card"]')) {
      const value = getComputedStyle(el).backdropFilter || "";
      for (const m of value.matchAll(/url\(["']?#([^)"']+)/g)) {
        if (!document.getElementById(m[1])) missingFilter += 1;
      }
    }
  };
  await storm(MOVES, sample);
  const afterStorm = mutations;
  for (let i = 0; i < SETTLE_MS / 100; i += 1) {
    await sleep(100);
    sample();
  }
  const afterSettle = mutations;
  /* 再空转一段：闪烁是"每帧都在写"，所以静置段才是判据 —— 挂载那一下的一次性变更
     会落在 storm 段，不该跟"每帧互相打架"混为一个数字。 */
  for (let i = 0; i < SETTLE_MS / 100; i += 1) await sleep(100);
  const afterIdle = mutations;
  return {
    label,
    mutations,
    phases: { storm: afterStorm, settle: afterSettle - afterStorm, idle: afterIdle - afterSettle },
    byKind: { ...stats },
    byAttr: { ...byAttr },
    topTargets: Object.entries(byTarget)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([key, count]) => count + "× " + key),
    chipSamples,
    chipOff,
    chipMax,
    missingFilter,
  };
};

const result = {
  bundle: uiRow ? uiRow.url : null,
  rev: uiRow ? uiRow.rev || null : null,
  hasControls: !!document.querySelector(".dpo-controls"),
  hasCard: !!glassTarget(),
  chipsBefore: document.querySelectorAll(".wti-chip").length,
  glassBefore: (window.__dshWarmExtra && window.__dshWarmExtra.glass) || null,
};

/* ① 正常态基线：单实例、指针一直在卡片里 —— 变更应当趋近于零。 */
result.baseline = await measure("单实例基线");

/* ② 连挂两代僵尸：改前这里会失控。 */
let zombieCount = 0;
if (uiRow && sharedRow) {
  try {
    const sharedReg = await captureRegistration(sharedRow.url);
    const sharedExports = sharedReg.factory((id) => {
      throw new Error("probe: 共享包不该 require " + id);
    });
    const uiReg = await captureRegistration(uiRow.url);
    const requireFn = (id) => {
      if (id === "dsh-warm-shared") return sharedExports;
      throw new Error("probe: 未预期的 require " + id);
    };
    for (let i = 0; i < 2; i += 1) {
      /* factory 调用两次 = 两份**独立的模块作用域**，正是热重载换模块后的样子 */
      uiReg.factory(requireFn).apply(zombieCtx());
      zombieCount += 1;
    }
  } catch (error) {
    result.zombieError = String((error && error.message) || error);
  }
}
result.zombieCount = zombieCount;
result.afterZombies = {
  chips: document.querySelectorAll(".wti-chip").length,
  glass: (window.__dshWarmExtra && window.__dshWarmExtra.glass) || null,
  glassSvgs: document.querySelectorAll("[data-wta-glass-svg]").length,
};

/* ③ 僵尸在位时的指针风暴：改前的闪烁现场。 */
result.zombie = await measure("两代僵尸在位");

/* ④ 玻璃出错：命中测试必抛 —— 只报一次、自我卸载、页面照旧。 */
const realHitTest = document.elementFromPoint;
const errBefore = errors.length;
const cerrBefore = consoleErrors.length;
document.elementFromPoint = () => {
  throw new Error("probe: 命中测试故意失败");
};
window.dispatchEvent(new PointerEvent("pointermove", { clientX: 24, clientY: 24, bubbles: true }));
await sleep(300);
const afterFirstThrow = {
  glass: (window.__dshWarmExtra && window.__dshWarmExtra.glass) || null,
  errors: errors.slice(errBefore),
  consoleErrors: consoleErrors.slice(cerrBefore),
};
for (let i = 0; i < 6; i += 1) {
  window.dispatchEvent(new PointerEvent("pointermove", { clientX: 30 + i, clientY: 30, bubbles: true }));
  await sleep(80);
}
document.elementFromPoint = realHitTest;
result.throwOnce = {
  afterFirstThrow,
  errorCount: errors.length - errBefore,
  consoleErrorCount: consoleErrors.length - cerrBefore,
  chipsAfter: document.querySelectorAll(".wti-chip").length,
  glassAfter: (window.__dshWarmExtra && window.__dshWarmExtra.glass) || null,
  cardUsable: !!glassTarget(),
};

result.total = {
  errors: errors.slice(0, 5),
  errorCount: errors.length,
  consoleErrorCount: consoleErrors.length,
  chips: document.querySelectorAll(".wti-chip").length,
  cardFilter: (() => {
    const card = glassTarget();
    return card ? (getComputedStyle(card).backdropFilter || "").slice(0, 80) : null;
  })(),
};
observer.disconnect();
return result;
