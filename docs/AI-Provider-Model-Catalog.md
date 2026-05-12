# AI Provider / Model Catalog

更新时间：2026-05-02

## 目标

插件不再下载安装到本地模型，只通过外部 API key 或 LM Studio 的本地 OpenAI-compatible API 做 AI 关键词预测。

模型和调用参数统一维护在 `extansion/shared/ai-model-catalog.js`，运行时由 `extansion/background/ai/providers.js` 读取总表生成请求。这样后续新增 provider、替换默认模型或调整参数时，不需要在设置页、service worker 和调用逻辑里重复改多处。

模型目录以 OpenRouter 为主来源。OpenRouter 的 `GET /api/v1/models` 覆盖面最广，适合做设置页模型搜索、热门模型预设和后续自动刷新；直连 DeepSeek / Qwen / Kimi 等 provider 保留为低成本、低中转、低风险 fallback。

## 默认测试配置

当前本机测试 provider 是 DeepSeek 直连，模型 ID 是 `deepseek-v4-flash`。它对应 DeepSeek V4 Flash 的低延迟路径，调用时不会发送 `thinkingBudget`、`reasoning_effort` 或类似 reasoning 参数。

仓库不会写入真实 API key。要在本机加载测试 key，可在扩展的 service worker 调试台执行：

```js
await chrome.storage.local.set({
  aiTestConfigV1: {
    enabled: true,
    providerId: "deepseek",
    modelId: "deepseek-v4-flash",
    endpointUrl: "https://api.deepseek.com/chat/completions",
    apiKey: "你的 DeepSeek API key"
  }
});
```

删除本地测试覆盖：

```js
await chrome.storage.local.remove("aiTestConfigV1");
```

`aiTestConfigV1` 只存在于本机扩展存储，不进入 release zip，也不会提交到仓库。

## Provider 总表

| Provider | 默认模型 | Endpoint | 参数策略 |
| --- | --- | --- | --- |
| OpenRouter | `deepseek/deepseek-v4-flash` | `https://openrouter.ai/api/v1/chat/completions` | 主模型目录来源；OpenAI-compatible；支持通过 `GET /api/v1/models` 获取动态模型表和 `default_parameters` |
| DeepSeek | `deepseek-v4-flash` | `https://api.deepseek.com/chat/completions` | 直连低延迟路径；OpenAI-compatible；`temperature=0.1`；`max_tokens=512`；JSON mode；不发送 thinking/reasoning 参数 |
| OpenAI | `gpt-4.1-mini` | `https://api.openai.com/v1/chat/completions` | OpenAI Chat Completions；JSON mode；仅在模型配置要求时发送 `reasoning_effort` |
| Gemini | `gemini-2.5-flash` | `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` | `generationConfig.temperature=0.1`；JSON MIME；`thinkingBudget=0` |
| Claude | `claude-3-5-haiku-latest` | `https://api.anthropic.com/v1/messages` | Messages API；`max_tokens=512`；`temperature=0.1`；不使用 extended thinking |
| Grok | `grok-3-mini` | `https://api.x.ai/v1/chat/completions` | xAI chat-completions 兼容路径；不默认发送 reasoning 参数 |
| Qwen | `qwen-plus` | `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions` | DashScope OpenAI-compatible；暂不默认发送 `enable_thinking`，避免不支持模型报错 |
| GLM | `glm-4.5-flash` | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | OpenAI-compatible；低延迟 Flash 默认 |
| Kimi | `kimi-k2.5` | `https://api.moonshot.ai/v1/chat/completions` | OpenAI-compatible；endpoint 已从旧 `.cn` 迁移到 `.ai` |
| LM Studio | `local-model` | `http://127.0.0.1:1234/v1/chat/completions` | OpenAI-compatible；API key 可为空 |

## 公开模型表现状

OpenRouter 的动态模型表是当前最实用的统一目录来源，能覆盖绝大多数可调用的主流和开源模型；但它仍然只能证明 OpenRouter 当前可代理的模型和默认参数，不能替代各直连 provider 的官方参数规则。因此实现策略是：

- OpenRouter 作为模型目录和默认新装 provider。
- 直连 provider 保留，用于用户已有直连 key、价格更低或需要绕过中转的场景。
- OpenRouter 热门模型预设只放少量高频低延迟模型，完整列表后续从 `GET /api/v1/models` 动态拉取。

## 设置页模型选择

设置页按 provider/key 驱动模型选择：

- 未填写 key 时，非本地 provider 的模型下拉禁用。
- 填写 key 后，设置页请求当前 provider 的模型列表接口。
- 远端模型列表成功返回时，只显示当前 key/provider 返回的轻量候选。
- 轻量候选过滤规则优先保留 `flash`、`mini`、`lite`、`nano`、`haiku`、`fast` 等低延迟模型，以及 14B 以下的小参数开源模型。
- 明显不适合关键词抽取的 `image`、`audio`、`embedding`、`rerank`、`moderation`、`reasoning`、`thinking`、`opus`、`sonnet`、`pro` 等模型默认过滤掉，除非同时带有低延迟标记。
- 远端模型列表失败时，设置页临时回落到 `ai-model-catalog.js` 中的少量 curated preset，并通过控件 title 记录失败原因。

## 参考来源

- DeepSeek model list: https://api-docs.deepseek.com/api/list-models
- DeepSeek chat completion: https://api-docs.deepseek.com/api/create-chat-completion
- OpenAI Chat Completions: https://platform.openai.com/docs/api-reference/chat/create-chat-completion
- Gemini thinking budget: https://ai.google.dev/gemini-api/docs/thinking
- Anthropic Messages API: https://docs.anthropic.com/en/api/messages
- xAI chat completions: https://docs.x.ai/docs/api-reference
- Kimi chat API: https://platform.kimi.ai/docs/api/chat
- Kimi model list: https://platform.kimi.ai/docs/models
- OpenRouter model list API: https://openrouter.ai/docs/api/api-reference/models/get-models
