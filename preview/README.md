# 隔离预览实例（实验台）

> **目的**：在同一台机器上开一个「和你正在用的 dsh 一样、但互相隔离」的实例，
> 所有 UI 实验（比如 `dsh-warm-ui` 暖色主题）都在这上面做，真实 profile 一个字都不改。

## 一句话结构

| | 真实实例 | 隔离预览实例 |
| --- | --- | --- |
| 程序 | `/usr/local/lib/node_modules/@deepseek-ai/dsh`（只读共用，同一份） | 同一份 |
| home | `~/.dsh` | `/mnt/d/projects/.dsh-warm-preview`（工作区内，可随时 `rm -rf`） |
| profile | `~/.dsh/profiles/web` | `…/.dsh-warm-preview/profiles/web`（**副本**） |
| 端口 | 3081 | **3082** |
| 工作区 | `/mnt/d/projects` | `/mnt/d/projects`（按你的选择共用真实工作区） |
| 额外插件 | 无 | `dsh-warm-ui` 单包（暖色 + 输入栏整形 + 壁纸 + 品牌彩蛋） |

因为 home 不同，两边的**会话、存储、设置写入、插件装配**都互不影响；
只有「工作区目录」是共用的（在预览里跑 agent 会真的改文件，这是你选的）。

## 脚本

```bash
bash preview/setup-preview-home.sh   # 重建预览 home（复制真实 profile/settings/凭据/会话/预设，再插入 dsh-warm-ui 单包）
bash preview/start-preview.sh        # 启动（已运行则先停），打印带 token 的地址
bash preview/stop-preview.sh         # 停止（只杀 3082，不影响 3081）
bash preview/toggle-warm-ui.sh off   # 预览实例切回出厂配色（真实 profile 不受影响）
bash preview/toggle-warm-ui.sh on    # 切回暖色
bash preview/toggle-warm-ui.sh status
```

`toggle-warm-ui` 改的是预览 profile 的 `dsh.profile.bundles`（加入/移除 `dsh-warm-ui` 单包），
改完需要 `preview/start-preview.sh` 重启预览才生效。

> 2026-10-31 起 `dsh-warm-wallpaper` / `dsh-warm-brandgag` 已并入 `dsh-warm-ui` 单包，
> 由主包的 `cordis.patch.yml` 自动挂载；`preview/toggle-wallpaper.sh`、`preview/toggle-brandgag.sh`
> 只保留为迁移提示，不再单独改 patch（单独追加会造成重复 entry）。

## 预览实例里的模型配置

真实 `settings.yaml` 里的两个自定义 provider（`opencode-go`、`sudocode`）在预览里被替换成
**dsh 自带的 `opencode-go` 服务商 + 只留三个 DeepSeek 模型**：

```yaml
llm-pi-ai:
  providers:
    opencode-go:
      displayName: OpenCode Go
      apiKeyEnv: OPENCODE_API_KEY
      headers:
        # Console Go 网关要求带会话标识，缺了会返回 400 MissingSessionID
        x-opencode-session: dsh-<预览实例专用随机 id>
      models:
        - id: deepseek-v4-flash-vision-exp
        - id: deepseek-v4-flash
        - id: deepseek-v4-pro
agent-default-model:
  provider: opencode-go
  model: deepseek-v4-flash-vision-exp
  reasoningEffort: max
```

要点：

- 端点和 `api` 不用自己写：pi-ai 内置目录里每个模型都带
  `baseUrl`（`https://opencode.ai/zen/go/v1`）和 `api: openai-completions`，
  所以「只筛 DeepSeek 模型」不会丢端点。
- 另有一个内置服务商 `opencode`（OpenCode **Zen**，`https://opencode.ai/zen/v1`）。
  它那条路由对免费模型做 **User-Agent 白名单**（要求 UA 以 `opencode` 开头），
  直接用会得到 401/403；`zen/go/v1` 没有这个限制，所以这里用 `opencode-go`。
- 凭据来自复制过来的 `.credentials.yaml`（权限保持 600），
  与真实实例用的是同一个 `OPENCODE_API_KEY`。**预览实例跑模型会消耗同一份额度。**

## 与真实实例的其它差异

- 审批审计写到 `/mnt/d/projects/.dsh-warm-preview/auto-review-audit.jsonl`（不污染真实审计日志）。
- 会话是**复制**的：预览里看到的是复制那一刻的历史；两边之后各自增长，互不同步。
- `.agent-presets` 也是复制的，所以自定义预设可用。
- 预览实例由本工作区的脚本启动；彻底清理：先 `stop-preview.sh`，再
  `rm -rf /mnt/d/projects/.dsh-warm-preview`（真实 `~/.dsh` 不受影响）。
