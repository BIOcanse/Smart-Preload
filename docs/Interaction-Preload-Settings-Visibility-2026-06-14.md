# 交互预加载设置可见性 2026-06-14

## 用户原话

- “我们是有悬停加载功能的，但是设置页好像看不到”

## 当前问题

悬停和右键菜单交互预加载已经在运行链路中存在：

- 内容脚本在链接 `pointerover` 后等待 80ms，目标没有现有预加载时发起 `preload:interaction-start`。
- 内容脚本在链接 `contextmenu` 时发起强制新标签页语义的交互预加载。
- 选中文本时会取消当前来源标签页的交互预加载。
- 后台 `ZeroLatencyPreloadInteraction` 负责 status、start、cancel 和右键菜单接管。

设置页目前只有 `experiments.pointerProximityPrediction`，这是未接入运行行为的实验占位项，不是当前已经生效的悬停/右键交互预加载开关。用户在设置页无法明确看到或关闭真实功能。

## 目标行为

- 在设置页“预加载”区域暴露正式开关：悬停和右键预加载。
- 默认开启，保持当前行为不被静默关闭。
- 关闭后，后台 `preload:interaction-start` 和 `preload:interaction-status` 都应返回已跳过/未预加载，不创建 hidden-tab、prefetch 或 prerender 交互条目。
- 关闭后，取消消息仍允许清理已存在的交互预加载，避免用户关闭开关后旧条目残留。
- 该开关不替代未来的“指针接近预测”实验项；后者仍是独立的未接入预测能力。

## 文件结构规划

- `extansion/shared/settings.js`
  - 新增持久化字段 `preloading.interactionPreloadEnabled`。
  - 升级设置版本并在归一化中默认 `true`。
- `extansion/settings/index.html`
  - 在预加载区域新增一个开关项。
- `extansion/settings/settings.js`
  - 读写新表单字段。
- `extansion/background/preload/runtime/interaction.js`
  - 在交互预加载上下文解析处集中尊重开关。
- `extansion/_locales/*/messages.json`
  - 补齐多语言名称和说明。
- `scripts/testing/interaction-preload-runtime.mjs`
  - 覆盖关闭开关时 status/start 不创建条目的行为。

## 进度

- 已确认缺口：真实功能存在，设置页没有正式开关。
- 已完成：设置模型、设置页、运行时、多语言和回归测试同步落地。
