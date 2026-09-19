# dsh-warm-ui 界面契约（人读版）

机器可读的那份是 `contract/ui-contract.json`；这里说清"每个状态应该长什么样"，
以及**为什么**是那样。改设计先改这两份，再改代码。

## 1. 注入节点的规矩（三条，全部由 `tools/check.mjs` 守）

1. **样式表必须自己打 `data-plugin`。** 模块加载器只在工厂返回那一刻认领还没打标的
   `<style>`，热重载也只删 `style[data-plugin=<包名>]`。不打标的表既会被后加载的插件
   错认成自己的、又永远删不掉 —— 每加热更一次 `<head>` 里就多一份完整旧表。
   症状：旧表把玻璃滤镜 svg 撑出 255px 高，页面能往下滚，"壁纸跑到页面下面"。
   **实现只有一份**：`preview/shared/lib/client.js` 的 `createStyleInstaller(包名)`
   （见第 5 节）。各包只调用它，不再自己抄一遍。
2. **每个注入节点必须有归属标记。** 属性 `data-dsh-warm-owner`，值 `包名:节点名`；
   语义标记（CSS/探针用）由每个包的登记表 `NODE_OWNERS` 一行给出，字符串只写一遍。
3. **页面外层的节点只能经挂载助手入文档**（`mountDetached` / `mountLayer` /
   `installStyleSheet`）：贴标 → 钉死定位 → 清扫上一代 → append。裸 append 会被静态检查拦下。

### 登记表（一类节点一行）

| 包 | 节点名 | 语义标记 | 定位 | 说明 |
| --- | --- | --- | --- | --- |
| dsh-warm-ui | `glassSvg` | `data-wta-glass-svg` | 内联 `fixed`，0×0 | 玻璃滤镜定义，只有 `<defs>`，不需要可见区域 |
| dsh-warm-ui | `optimizerPop` | `data-dsh-warm-optimizer-pop` | 内联 `fixed` | 档位/权限下拉，left/top 由 `place()` 按需写 |
| dsh-warm-ui | `guardNote` | `data-dsh-warm-guard-note` | 内联 `fixed`（左下角） | **按需**：只在文档真的溢出时出现，出现即代表某条不变量破了 |
| dsh-warm-ui | `collapseChip` | `data-dsh-warm-collapse` | 无（就在工具行里） | 「优化」胶囊，本来就该参与排版 |
| dsh-warm-wallpaper | `layer` | `data-dsh-warm-wallpaper-layer` | 内联 `fixed` 铺满，`z-index:-1` | 壁纸画布 |

**为什么定位要写内联**：`width="0" height="0"` 这类表现属性在 CSS 里是最低一档，
任何样式规则都能盖掉它（包括热更残留的旧表）。一旦被盖出尺寸，覆盖层就变成文档末尾
一块看不见的空白 —— 页面能滚下去、壁纸露在下面。内联永远赢样式表。

## 2. 工具行三态（`body[data-dsh-warm-dpo]`）

断点**只在第三方插件里**，我们不写媒体查询（写两份迟早对不上）。我们读它渲染出来的
DOM，把结果写到 body 属性上：

| 状态 | 条件 | 期望外观 |
| --- | --- | --- |
| `chip` | 插件渲染出滑杆（宽屏） | 我们的「优化」胶囊在（24px 高），插件两根滑杆都藏起来 |
| `native` | 插件渲染出 `[data-dpo="tier-collapsed"]`（窄屏） | 我们的胶囊不在，权限滑杆藏起来，档位用它自己的窄屏形态 |
| `fallback` | 认不出插件 DOM | 一切原样，我们的胶囊不在（绝不留下点不动的空壳） |

行高 24px 只在 `chip` 态断言（那是我们定的形态）。

### 参考截图（refs/）

| 文件 | 状态 | 怎么拍的 |
| --- | --- | --- |
| `refs/toolbar-chip-wide.png` | `chip`（1752×745 CSS） | `tools/harness.mjs shot ... --width 1752 --height 830` |
| `refs/toolbar-native-narrow.png` | `native`（1180×715 CSS） | `tools/harness.mjs shot ... --width 1180 --height 800` |

两张都是**空会话**页，能同时看到：工具行形态、卡片宽度、壁纸正常。
`fallback` 态没有参考图 —— 它要求把第三方的 DOM 弄坏才复现，属于"出问题时的样子"，
由真机断言（`chipVisible === false`）守。

改设计之后重拍这两张，并把新图连同契约一起提交。

## 3. 输入框宽度：跟着 DSH 自己的偏好走

卡片宽度**不是我们定的**。DSH 的算法（`dsh-client-ui-conversation/lib/client.js`）：

```
--dsh-chat-user-width   = clamp(偏好, 640, 列宽 - 176)      # 有偏好时
                        = clamp(列宽 * 0.64, 680, 920)      # 没有偏好时
--dsh-composer-card-max-width = --dsh-chat-user-width + 32
```

- 偏好键：`localStorage["dsh.conversation.contentWidth"]`（拖动会话宽度手柄才会写）。
- 没有偏好时上限就是 `920 + 32 = 952px`，与会话正文列同宽（正文列也用它）。
- **实测**（2026-09-19，真 Firefox）：
  - 无偏好、窗口 1752 → 卡片 952px；
  - 偏好 1200、窗口 1752（列宽 1472）→ 卡片 1232px = 1200 + 32；
  - 同一份偏好 1200、窗口 1200（列宽 920）→ 卡片 776px = (920 − 176) + 32。

也就是说：**"进了 plan 模式输入框变宽"= 同一份偏好被更宽的可用列放了出来**，
不是插件干的（插件不写这两个变量、也没有任何一条宽度规则）。
要回到默认宽度：把宽度手柄拖回去，或者在控制台执行

```js
localStorage.removeItem("dsh.conversation.contentWidth"); location.reload();
```

## 4. 全局不变量（真机断言）

| 不变量 | 期望 | 为什么 |
| --- | --- | --- |
| 文档溢出 | 0px | 一旦能滚，壁纸就会露在页面下面 |
| 每张样式表份数 | 1 | 热更残留会互相抢规则 |
| 无主样式表（没 `data-plugin`） | 0 | 那些表热重载删不掉 |
| 每个登记节点份数 | 1（按需节点为 0） | 两代节点同时存在会导致"守卫对着上一代读问题" |
| `missingCssVars` | 空 | 未定义又没兜底的变量会让整条声明被复位 |
| `layoutGuard` | 无 | 它一出现就说明上面某条破了 |

## 5. 共享代码与依赖方向（`dsh-warm-shared`）

被两个以上包用到的**平台约定**放在 `preview/shared`（包名 `dsh-warm-shared`），不在各包抄一遍：

| 共享的东西 | 为什么必须是同一份 |
| --- | --- |
| `createStyleInstaller(包名)` | 第 1 节的三件套；抄错一次就是"样式表删不掉/被错认"，两个线上 bug 都出在这里 |
| `cssPropertyName` | camelCase → kebab 的命名规则：内联样式与生成的 CSS 必须用同一条规则，否则表里和 DOM 里对不上 |

依赖方向**单向**：`dsh-warm-ui` / `dsh-warm-wallpaper` → `dsh-warm-shared`（不允许反向、不允许环）。
声明一条依赖要**三处同时改**，`tools/check.mjs` 的「共享依赖」一条逐条核对：

1. 代码：工厂体里 `require("dsh-warm-shared")`；
2. 本包 `package.json`：`dsh.client.external: ["dsh-warm-shared"]`（宿主据此把依赖行排在本包之前）；
3. 契约：`packages.<包>.requires: ["dsh-warm-shared"]`。

同一条检查还会拦下"依赖方又自己实现一遍注入三件套"（代码里再出现 `dataset.plugin =`）。

**不放进共享包的东西**：`NODE_OWNERS` 登记表、`pinOverlay`/`pinLayer`、`sweepOwned`/`sweepLayers`、
`checkCssVars` —— 它们看着像，但每个包的清扫副作用不同（壁纸要顺带清渲染器缓存），
硬抽一层只会多一层间接。共用的**约定**写在契约里，代码保持各包自洽。

