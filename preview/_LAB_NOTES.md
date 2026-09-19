# 在 3081 上直接做预览的交接说明

> 本轮用户授权：**直接在真实实例 3081 上改**（原本要求先 3082 预览）。
> 唯一的硬约束是「**别改崩**」。所以：每个改动都必须可逆、必须防御式、必须实测。

## -1. 动手之前先跑这两条（2026-09-19 新增）

```bash
node tools/check.mjs              # 静态：语法 / 样式归属 / 注入登记 / 挂载入口 / 变量闭包 / 契约数字 / 共享依赖
node tools/check.mjs --browser    # 追加真机断言（需要 Windows 侧 Firefox，见 tools/README.md）
```

"UI 应该长什么样"写在 `contract/ui-contract.json`（机器可读）+ `contract/ui-contract.md`（人读）。
**改设计先改契约再改代码**：静态检查与真机断言都跟着契约走，不需要再去别处找回期望值。

## -0.5 那两件"卡在重启"的事（2026-09-19 全部做完）

> **前提被推翻了**：patch 文件是**热加载**的（`profiles/web/package.json` 里
> `dsh.profile.patchReload: "live"`，`dsh-app-boot` 的 `watchUserPatches()` 用 cordis HMR
> 盯着它），加/删条目**根本不用重启**，刷新一次页面就生效（实测：图谱里已经出现
> `dsh-warm-shared`、`dsh-warm-dynbg` 已消失，全程没重启过 dsh web）。
> 唯一的例外是改包的 `dsh.client` 清单（比如加 `external`）—— 那要重启，因为宿主把包元数据
> 缓存在内存里（`dsh-client-modules` 的 `pkgMeta`）。

**① 删掉死配置 `dsh-warm-dynbg` —— 已完成（3081 + 3082 两份 patch）**
- 两份 `cordis.patch.yml` 里的 `dsh-warm-dynbg` 段（含标记行）整段删掉，
  `preview/toggle-dynbg.sh` 也删了（它管的就是这个已摘除的插件）。
- `preview/dynbg/` 目录留着当历史（文件头注释写着恢复方法），没有任何补丁加载它。
- 删完两份 patch 都仍是 `dsh-warm-shared` → `dsh-warm-ui` → `dsh-warm-brandgag` →
  `dsh-warm-wallpaper`（用 `python3 -c "import yaml..."` 验过可解析）。

**② 跨包重复代码收成共享客户端模块 `dsh-warm-shared` —— 已完成并实测**
- `preview/shared/`（`package.json` / `lib/index.js` / `lib/client.js` / `README.md`），
  两份 patch 都把它放**最前面**；两个消费方的 `package.json` 也加了
  `dsh.client.external: ["dsh-warm-shared"]`（宿主据此排依赖行）。
- `warm-ui` 与 `wallpaper` 在工厂体里 `require("dsh-warm-shared")`，改成
  `const installStyleSheet = createStyleInstaller(PACKAGE_ID);`，
  **不写"本地降级实现"**（那等于把重复又抄回来）。
- 实测下来的重复情况（比原笔记里写的少）：**只有 `installStyleSheet` 是逐字节重复的**；
  `cssPropertyName` 只有壁纸一份（warm-ui 里是内联的同类转换）、`mixLinear` 只有 warm-ui 一份、
  `withAlpha` 只有壁纸一份、`checkCssVars` 只有 warm-ui 一份 —— 后四个不是重复，
  留在各自包里，边界写在 `contract/ui-contract.md` 第 5 节。
- 一条依赖要在**三处**同时登记：代码 `require` + 本包 `package.json` 的 `dsh.client.external`
  + 契约的 `requires`。`tools/check.mjs` 的「共享依赖」一条核对这三处，
  并拦下"消费方又自己实现一遍注入三件套"。

**踩过的坑（写进不变量了）：客户端半边必须导出 `apply` / `inject`。**
只导出工具函数（我们的第一版共享包就是这样）会被浏览器侧 runner 判成
`invalid plugin … received object`，**整个宿主启动被它拦住**，页面只剩「Failed to load plugins」。
检查项「客户端插件形状」现在守着这一条。

**别忘的不变量**（`tools/check.mjs` 已经在守）：样式表必须自带 `data-plugin`；
注入节点必须带 `data-dsh-warm-owner` 且同类唯一；页面外层节点只能经
`mountDetached` / `mountLayer` / `installStyleSheet` 入文档，定位写内联。

## 0. 最重要的一条：不需要重启（连 patch 也是热的）

DSH 的客户端插件代码是**按请求从磁盘读**的（bundle 是 `/plugins/??<name>/client.js&rev=<hash>`，
文件一变 `rev` 就变）。**改完客户端代码，浏览器刷新一次就生效。**

已实测：往 `preview/dynbg/lib/client.js` 追加 `/* HMRPROBE1 */`，新开页面后 `rev` 由
`a3217e57b0f3` → `2f388a1f2e1e`，标记出现在 bundle 里。

**patch 文件同样是热的**：`profiles/web/package.json` 写着 `dsh.profile.patchReload: "live"`，
`dsh-app-boot` 的 `watchUserPatches()` 用 cordis HMR 盯着它，加/删条目**不用重启**，
刷新页面就进/出模块图谱（2026-09-19 实测：加 `dsh-warm-shared`、删 `dsh-warm-dynbg`，
全程没重启）。**唯一例外**：改包的 `dsh.client` 清单（例如加 `external`）要重启才重新读取
（宿主把包元数据缓存在 `dsh-client-modules` 的 `pkgMeta` 里）。

**绝对不要重启 3081。** 3081 的 node 进程是本 agent 会话的父进程，重启 = 掐断会话。

## 1. 插件骨架（照抄 `preview/brandgag/`）

一个插件 = 一个目录，两个半边：

```
preview/<name>/
  package.json      # 声明 dsh.client.platform = "web"
  lib/index.js      # host 半边：export function apply(ctx) { void ctx; }   ← 必须是空的
  lib/client.js     # browser 半边：真正干活的地方
```

`package.json` 里必须有：

```json
{
  "name": "dsh-warm-<name>",
  "exports": { "./client": "./lib/client.js" },
  "dsh": { "client": { "platform": "web" } }
}
```

`lib/client.js` 的最小信封（**必须逐字用这个形状**）：

```js
window.__ModuleLoader__.load({
  id: "dsh-warm-<name>",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    let React = null;
    try { React = require("react"); } catch (e) { React = null; }

    exports.inject = ["slots"];   // 需要挂界面时才要；纯 DOM 操作也要写，空数组即可
    exports.apply = (ctx) => { /* ... */ };
    return module.exports;
  },
});
```

> **`exports.apply` / `exports.inject` 一个都不能少。** 浏览器侧的 runner
> （`dsh-cordis-client-runner`）按模块图谱给**每个客户端包**建 loader 条目，并把它的导出
> 当插件 `apply`；少了 `apply` 会被判成 `invalid plugin … received object`，
> 而且这个错会**拦住整个宿主启动**（页面只剩「Failed to load plugins」）。
> 就算这个包只是给别的包提供工具函数（比如 `preview/shared`），也要写一对空实现。
> `tools/check.mjs` 的「客户端插件形状」一条守着它。

host 半边（`lib/index.js`）**保持空的**——这样启动风险几乎为零，所有行为都在浏览器侧。

## 2. 挂进真实实例（这一步由主 agent 做，子代理不要动）

`~/.dsh/profiles/web/cordis.patch.yml` 和预览实例的 patch 各追加一段。
**注意：这两个文件是共享的插件路径，3081 和 3082 指向同一份 `lib/`。**

## 3. 界面扩展点（`dsh-warm-ui` 提供）

往「外观」面板里加一行开关：

```js
window.__dshWarmAppearance?.register({
  id: "warm-<name>",
  title: "分组标题",
  rows: [
    { key: "spine", label: "回合脊", get: () => on ? 1 : 0, set: (v) => { ... },
      options: ["关", "开"], short: "开" },   // short 是收起时显示在页脚的字
  ],
});
```

- `register` 返回一个 dispose 函数。重复 id 会替换旧的。
- 改完值调 `window.__dshWarmAppearance.notify()` 让面板重画。
- 如果扩展点不存在（warm-ui 没加载），**必须优雅退回**：插件自己别崩，什么都别做即可。

## 4. 实测出来的 DOM 事实（都是稳定锚点，不受 CSS-module 哈希影响）

### 4.1 会话正文列

| 选择器 | 说明 | 实测值（1600×1000 窗口） |
| --- | --- | --- |
| `[data-chat-flow]` | 会话流的容器 | `x=513 w=845`，**空会话时不存在** |
| `[data-chat-flow-kind]` | 每一个流单元（flow item） | 见下表 |
| `[data-chat-turn="<n>"]` | 归属第几个 agent 回合 | 同一回合内共享 |
| `[data-chat-flow-key]` / `[data-chat-anchor-key]` | 稳定唯一键 | |

`data-chat-flow-kind` 的取值与实测高度（会话「我的 opencode go…」，共 98 项）：

| kind | 条数 | 平均高 | 内容示例 |
| --- | --- | --- | --- |
| `user` | 2 | 76 | 用户消息 |
| `steering` | 2 | 76 | 用户插话 |
| `assistant-step` | 42 | 67 | 「思考 ####」「正文段落」 |
| `tool-call` | 47 | **24** | 「Bash …」「读取 …」「编辑 …」 |
| `context` | 1 | 24 | 「上下文注入 …」 |
| `turn-tail` | 2 | 32 | 时间戳 + 操作按钮 |
| `turn-process` | 2 | 0 | 回合容器（高度 0） |

**关键：47 个 tool-call 全是 24px 的一行**，DSH 已经把工具输出折叠了，不要重复折叠。
真正缺的是**分组感和可辨识度**——这 88 行等重、同色、没有归属标记。

### 4.2 会话区骨架（空状态实测）

```
DIV.wSkVaW_root            (280,0 1320x1000)
  DIV.wSkVaW_body          (280,0 1320x1000)
    DIV.wSkVaW_scrollBody  (280,0 1318x1000)
      DIV [data-slot="conversation.session"]        ← 0x0 锚点，空会话时无子节点
      DIV.wSkVaW_composerSeat (280,381 1310x238)    ← 输入区，空会话时垂直居中
```

空会话时 `[data-chat-flow]` **不存在**，`[data-slot="conversation.session"]` 是 0×0 锚点。
所以「空状态」的判据是：`[data-slot="conversation.session"]` 存在且 `[data-chat-flow]` 不存在。

可用的官方插槽名（实测 `[data-slot]` 全集）：
`root, sidebar, sidebar.brand.mark, sidebar.brand.name, sidebar.workspaces,
sidebar.workspaces.directoryFlow, sidebar.footer.action, sidebar.settings,
settings.trigger, main, main.conversation, conversation.session.header,
conversation.session, conversation.composer, conversation.hero.brand.mark,
conversation.hero.workspace, conversation.hero.workspace.directoryFlow,
conversation.hero.agentPreset, conversation.input.dock, conversation.composer.bar,
conversation.input.overlay, conversation.input.attachments, conversation.input.plan,
conversation.input.left, conversation.input.right, conversation.input.model,
rightbar, rightbar.session, shell.overlay`

### 4.3 失败的工具调用行

失败行的 `data-chat-flow-kind` 同样是 `tool-call`，**没有专门的 error 属性**。
可辨识的钩子是行内有一颗红点：`<span class="_dot_1tljr_3">`，`color: rgb(242, 90, 90)`。

- 想选中它：`[class*="_callRow"] [class*="_dot_"]`（用**类名后缀**，别用 hash 前缀）。
- 这颗红点是**冷红**，在暖色环境里突兀。

### 4.4 实测配色事实

- 全站不透明底色只有 8 种，**R−B 全部 = 0**（纯中性灰）：`43,43,43`(×27) / `39,39,39`(×7,
  会话悬停卡片 `Sixlwa_bubble`) / `26,26,26`(×4, 代码块) / `46,46,46`(×3, 按钮) /
  `20,20,20`(基底) / `60,60,60`(新会话按钮)。
- 唯一带暖的是强调色 `rgb(229,159,82)`。
- 正文 `color: rgb(223,225,230)`；正文列 `max-width: 844.8px`，`font-size:14px`，
  `line-height:24px` → 约 **58–60 汉字/行**（中文舒适区一般 30–45 字）。

## 5. 怎么验证（必须自己看截图，不要只信断言）

宿主是 Windows Edge + CDP，驱动脚本在工作区：

```bash
cd /mnt/d/projects/_warmtheme_shots
# 截图
"/mnt/c/Program Files/nodejs/node.exe" cdp.mjs shot D:/projects/_warmtheme_shots/<out>.png \
  --width 1600 --height 1000 --wait 7000 --click "<侧栏会话行的完整文本>"
# 跑一段 JS 并取回返回值（脚本里 return 一个可序列化的值）
"/mnt/c/Program Files/nodejs/node.exe" cdp.mjs eval D:/projects/.../<probe>.js --width 1600 --height 1000
```

已验证可用的会话行完整文本（用于 `--click`，注意末尾的相对时间会变）：
- `调整自动审查插件规则21小时`（正文+表格多）
- `我的opencode go是不是没有deepseek7小时`（工具调用多，47 个）
- 空状态：**不加 `--click`**，直接开就是空会话

**每次 `cdp.mjs` 都是全新临时浏览器 profile**（无缓存、无 localStorage 持久化），
所以每次都是干净的冷启动，更适合当验证。

截图之后**必须用 `read_image` 亲自看**。另外可用的像素工具：
- `_rgb.mjs <png> "x0,y0,x1,y1|标签" ...` — 区域平均 RGB + 暖差(R−B)
- `_lum.mjs <png> "x0,y0,x1,y1|标签" ...` — 区域亮度 mean/sd/分位数

## 6. 硬约束（违反了就是改崩）

1. **不要重启、不要 kill 任何 `dsh web` 进程。** 不要跑 `pkill`。
2. **不要跑 `dsh --dump-config`** —— 它会重写 `cordis.yml`。
3. **不要读/打印 `/home/dsh/.dsh/.credentials.yaml` 或任何 key。**
4. **不要动 `/home/dsh/.dsh/settings.yaml` 里的 `dsh-auto-review` 段。**
5. **不要改 `preview/shared`、`preview/brandgag`、`preview/wallpaper`、`lib/client.js`** ——
   这些文件由主 agent 负责，多个子代理同时写会互相覆盖。（`preview/dynbg` 已停用，不用管。）
6. 所有界面文案用**中文**。
7. 每个新插件都必须能被「删掉 patch 里那 3 行」完整移除，不留残迹。
8. CSS 一律用**类名后缀**或 `data-*` 选择器（`[class*="_callRow"]`），
   **不要用 hash 前缀**（`EvIC1a_`、`wSkVaW_` 这类），DSH 升级会变。
9. DOM 操作要幂等：用 MutationObserver 时要防止自己触发自己（加标记属性并跳过）。
