#!/usr/bin/env python3
"""把「预览实例专用」的模型配置写进预览 home 的 settings.yaml。

真实 settings.yaml 里有两个自定义 provider（opencode-go / sudocode）。预览实例里替换成
**dsh 自带的 opencode-go 服务商 + 只留三个 DeepSeek 模型**：

  * 端点/api 不需要手写：pi-ai 内置目录里每个模型自带 baseUrl
    （https://opencode.ai/zen/go/v1）与 api: openai-completions；
  * Console Go 网关要求请求带 x-opencode-session，缺了会 400 MissingSessionID；
  * 审计日志路径改到预览 home 内，避免写进真实 ~/.dsh。

用法：python3 apply-preview-settings.py <settings.yaml> [--keep-session-header ID]
幂等：重复执行只会把这几项写成同样的值（已存在的 x-opencode-session 会被保留）。
"""
import secrets
import sys

import yaml

DEEPSEEK_MODELS = ["deepseek-v4-flash-vision-exp", "deepseek-v4-flash", "deepseek-v4-pro"]
PREVIEW_HOME = "/mnt/d/projects/.dsh-warm-preview"


def main() -> int:
    path = sys.argv[1]
    doc = yaml.safe_load(open(path, encoding="utf-8")) or {}

    providers = (doc.get("llm-pi-ai") or {}).get("providers") or {}
    previous = providers.get("opencode-go") or {}
    session_header = (previous.get("headers") or {}).get("x-opencode-session") or f"dsh-{secrets.token_hex(16)}"

    doc["llm-pi-ai"] = {
        "providers": {
            "opencode-go": {
                "displayName": "OpenCode Go",
                "apiKeyEnv": "OPENCODE_API_KEY",
                "headers": {"x-opencode-session": session_header},
                "models": [{"id": model} for model in DEEPSEEK_MODELS],
            }
        }
    }
    doc["agent-default-model"] = {
        "provider": "opencode-go",
        "model": DEEPSEEK_MODELS[0],
        "reasoningEffort": "max",
    }
    doc.setdefault("ui-theme", {})["preference"] = "dark"

    guard = doc.get("dsh-auto-review")
    if isinstance(guard, dict) and isinstance(guard.get("audit"), dict):
        guard["audit"]["path"] = f"{PREVIEW_HOME}/auto-review-audit.jsonl"

    with open(path, "w", encoding="utf-8") as handle:
        yaml.safe_dump(doc, handle, allow_unicode=True, sort_keys=False, width=1000)
    print(f"    预览模型配置：opencode-go（内置）+ {len(DEEPSEEK_MODELS)} 个 DeepSeek 模型；默认 {DEEPSEEK_MODELS[0]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
