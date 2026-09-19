# dsh-warm-shared

暖色插件族共用的**浏览器侧**工具。它不做任何界面，只是一份实现被两个包共用。

## 里面有什么

| 导出 | 用途 |
| --- | --- |
| `createStyleInstaller(包名)` | 返回该包自己的 `installStyleSheet(表名, css, 标记)`：按 DSH 官方写法给 `<style>` 打 `data-plugin` / `data-plugin-css`，同名表幂等复用 |
| `cssPropertyName(prop)` | camelCase → kebab-case：写内联样式与生成 CSS 共用同一条命名规则 |

## 为什么单独成包

`data-plugin` 那三件套是**平台约定**，写错会出两类事故（旧样式表删不掉、被别的插件错认走），
而"每个包各抄一份"正是抄错的来源。两个线上 bug（壁纸跑到页面下面、工具行变回原样）都出在这里，
所以实现只留一份，并且由 `tools/check.mjs` 核对写法与调用方。

## 依赖方向与登记（改这个包之前先看）

```
dsh-warm-ui ─┐
             ├─→ dsh-warm-shared
wallpaper  ──┘
```

单向，不允许反向或成环。加一条依赖要**三处同时改**（少一处就是"看起来能跑、换个时机就崩"）：

1. 消费方工厂体里 `require("dsh-warm-shared")`；
2. 消费方 `package.json` 的 `dsh.client.external: ["dsh-warm-shared"]`（宿主据此排依赖行的先后）；
3. `contract/ui-contract.json` 里该包的 `requires`。

三处都由 `node tools/check.mjs` 的「共享依赖」一条核对；它还会拦下消费方"又自己抄一遍注入三件套"。

## 边界

- 这里只放**跨包重复**或**平台约定**的东西。一个包专用的助手留在那个包里 ——
  `NODE_OWNERS` / `pinOverlay` / `sweepOwned` / `checkCssVars` 看着通用，但各包的清扫副作用不同，
  硬抽一层只会多一层间接（见 `contract/ui-contract.md` 第 5 节）。
- 非浏览器环境（没有 `document`）下 `installStyleSheet` 返回 `null`，调用方按"没有表"处理即可。
