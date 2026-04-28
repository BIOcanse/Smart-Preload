# 设计偏差盘点 2026-04-19

这份文档只记录“设计文档说应该这样、但实际实现不一致”的偏差，不收录普通 bug、不收录 UX 优化建议。
普通 bug 已在 `docs/issue` 与 `docs/Codex-Review-Findings-2026-04-18.md` 里。

参照来源：

- `docs/Algorithm-Design-Workflow-v0.md` （以下简称 *算法文档*）
- `docs/Implementation-Roadmap-v0.md` （以下简称 *路线图*）
- `docs/Local-App-Lifecycle.md`
- `docs/Zero-Latency-Web-Project-Blueprint-v0.md`

---

## D1 · 便携 runtime 在系统已装 Ollama 时会回落到系统目录【真实偏差，会破坏便携性主张】

**设计原文** — 算法文档 §5.9.1：

> 启动前必须显式设置 `OLLAMA_MODELS=<local-app-dir>/portable/models/ollama`，否则模型仍会写到 `%USERPROFILE%\.ollama\models`
> 端口与生命周期由本地 app 自己管理，不依赖系统服务
> 真正的便携性取决于环境变量、端口、进程生命周期是否都被本地 app 接管
> **如果其中任何一环落回系统默认路径，便携性就不成立**

**当前实现** — [app/src/model/runtime/process.rs:3-20](app/src/model/runtime/process.rs#L3-L20)：

```rust
pub(crate) async fn ensure_portable_ollama_api_available() -> Result<()> {
    if super::status::try_get_ollama_version().await.is_some() {
        return Ok(());                   // ← 关键
    }
    start_portable_ollama_serve()?;
    ...
}
```

`start_portable_ollama_serve` 才会把 `OLLAMA_MODELS` 指向 `portable/models/ollama`（[process.rs:57](app/src/model/runtime/process.rs#L57)）。但只要 `127.0.0.1:11434` 上已经有任意 Ollama 守护进程在跑（无论是用户自己装的系统版，还是其他工具），上面这条 early-return 就会让本地 app 直接复用对方的实例：

- `OLLAMA_MODELS` 不会被设置
- 后续 `ollama_pull_model_streaming` 调的 `/api/pull` 走的是系统 Ollama
- 模型文件落到 `%USERPROFILE%\.ollama\models`，不在 `portable/models/ollama` 下
- 卸载路径 `prune_portable_ollama_runtime_if_unused` 删的是 `portable/models/ollama`，对系统目录里残留的模型完全无效

**偏离方向**：

- `OLLAMA_HOST` 端口被对方占用 → 端口生命周期没有被本地 app 接管
- 模型路径回落系统默认 → 三条便携边界全部破防

**修复方向（不在本文档范围内的实施细节，仅供后续讨论）**：

- 启动前先按 `OLLAMA_HOST=127.0.0.1:<可用端口>` 探一个独占端口，再起 portable serve
- 或在 `try_get_ollama_version` 成功时额外校验 `/api/version` 返回所走的可执行文件路径就是 `portable/runtime/ollama/ollama.exe`，否则不要复用

---

## D2 · 算法文档自相矛盾：AI 关键词乘区数值【需要拍板】

**设计原文 A** — 算法文档 §5.12.2.1：

> 关键词乘区初版就应明显强于频数乘区。
> 当前建议口径是：
> - 无命中 `1.0`
> - 弱命中 `2.2`
> - 中命中 `3.6`
> - 强命中 `5.4`

**设计原文 B** — 算法文档 §5.14.1（紧接归一化讨论之后）：

> 对于 AI 关键词信号，乘区不要定得太小。
> ……所以当前 AI 关键词信号更合理的初始区间应是：
> - 无命中 `1.0`
> - 弱命中 `1.2 ~ 1.35`
> - 中等命中 `1.4 ~ 1.7`
> - 强命中 `1.8 ~ 2.2`

同一份文档里两组数值同时存在，方向相反：A 想要"明显强于频数乘区"，B 想要"经过 `1/(0.7n)` 归一化后仍能保留差异"。

**当前实现** — [extansion/background/ai/keywords.js:3-8](extansion/background/ai/keywords.js#L3-L8)：

```js
const KEYWORD_MATCH_MULTIPLIERS = {
  none: 1,
  weak: 2.2,
  medium: 3.6,
  strong: 5.4,
};
```

实现挑了 §5.12.2.1 这组（路线图第 208-212 行也固化了同一组数值）。

**偏离判断**：

- 如果 §5.14.1 是更新意图：实现偏大约 2-3 倍，归一化前会大幅压制频数乘区，归一化后强弱档之间的相对差也会被拉得过开
- 如果 §5.12.2.1 才是冻结口径：§5.14.1 的“1.2/1.4/1.8-2.2”就是历史草稿，应该从文档里删掉，避免下次 review 又被当成 issue 上报

任何一种取舍都需要先把文档统一到一组数值，再对齐实现。当前先标明现状：**实现 == §5.12.2.1，与 §5.14.1 偏离**。

---

## D3 · `prune_portable_ollama_runtime_if_unused` 把模型目录也删了【超出文档定义范围】

**设计原文** — 算法文档 §5.10 删除模型流程：

> 6. 删除后检查是否还有其他受管模型仍然存在
> 7. 如果没有任何受管模型还存在，则删除便携 `ollama-runtime`

文档只授权删除 runtime 目录。

**当前实现** — [app/src/model/infer.rs:201-234](app/src/model/infer.rs#L201-L234)：

```rust
async fn prune_portable_ollama_runtime_if_unused() -> Result<()> {
    ...
    if runtime_dir.exists() {
        fs::remove_dir_all(&runtime_dir)...?;
    }
    if models_dir.exists() {
        fs::remove_dir_all(&models_dir)...?;   // ← 文档没说删
    }
    Ok(())
}
```

**偏离判断**：

- 顺手清掉空 models 目录在工程上没问题，但就规范层面而言是“实现做得比文档多”
- 风险情形：如果 D1 里说的“系统 Ollama 复用”发生过，`portable/models/ollama` 里其实没有用户的模型文件，被删的内容确实是空的。但若以后有人手工把模型放进 portable 目录再回头 prune，会被一起清掉，与“只在 runtime 闲置时收回 runtime”的语义不一致

要么把这一段写进文档（补一行“无受管模型时同时清 portable/models/ollama 目录”），要么把代码里的第二个 `remove_dir_all` 删掉。

---

## D4 · `gemma4:e2b` / `gemma4:e4b` 在 Ollama registry 上不存在【文档与实现一致，但都和现实偏离】

**设计原文** — 算法文档 §5.9 与路线图 §198：

```
qwen3:0.6b
qwen3:1.7b
qwen3:4b
gemma4:e2b
gemma4:e4b
```

**当前实现** — [app/src/model/catalog.rs:26-52](app/src/model/catalog.rs#L26-L52) 完全照抄。

**偏离判断**：

- Ollama 官方 library 当前没有 `gemma4` 这个名字。Gemma 系列的 tag 是 `gemma`、`gemma2`、`gemma3`、`gemma3n`，对应嵌入式小尺寸是 `gemma3n:e2b` / `gemma3n:e4b`
- 用户一旦在设置页对 `Gemma 4 E2B` / `Gemma 4 E4B` 切下载，`/api/pull` 会以 404 失败
- 这不是实现违背文档的偏差，而是文档（和实现）一起偏离了上游真实命名

文档需要明确：`gemma4` 是一个内部别名（要在 catalog 里加一层映射 → `gemma3n:e2b/e4b`），还是当时是笔误（要把模型 ID 改成 `gemma3n-e2b/e4b`，对应 backend `gemma3n:e2b/e4b`）。在做出决定之前，UI 上这两条会全程下载失败。

---

## D5 · 设置页“当前窗口已打开标签页”送进 AI 时几乎只有标题【部分实现】

**设计原文** — 算法文档 §5.12.2 第一阶段关键词匹配落地口径：

> AI 输入先固定为：历史页面信息池 + 当前窗口已有标签页 + 当前活动页面

文档语境里“当前窗口已有标签页”指带文本/语义信息的页面集合，否则与单纯 “title 列表 + URL 列表” 等价，AI 推理质量会被压低。

**当前实现** — [extansion/background/preload/scoring.js:235-329](extansion/background/preload/scoring.js#L235-L329)：

`collectOpenContextPages` 通过 `chrome.tabs.query` 取出窗口内所有 tab，但 `textDigest` 只能从两条途径回填：

- `recentForegroundPages` / `historyPagePool`（最多 5 条）
- 页级 keywordStore 里命中过的条目

对那些“当前还开着但既不在最近 5 条历史池里、也没生成过 keywords”的页面，送给 AI 的就是 `{ pageUrl, title, textDigest: "" }`。

**偏离判断**：

- 这条 Codex 已在 P3 里记录（`Codex-Review-Findings-2026-04-18.md` §[P3]），内容一致
- 在“以现有数据补足”这条务实路线上，实现没问题；但要严格对齐文档“当前窗口已有标签页”的本意，应在打开新页时主动向 content script 拉一份轻量 textDigest，而不是只等 history 池兜底

---

## D6 · 模型 catalog 里的 `id` 与 backend tag 之间的映射边界不在文档里【缺文档】

**设计原文** — 算法文档 §5.9：

```
qwen3:0.6b → Qwen3 0.6B
qwen3:1.7b → Qwen3 1.7B
...
```

文档只列出 backend tag 与显示名两组数据。

**当前实现** — [app/src/model/catalog.rs:26-52](app/src/model/catalog.rs#L26-L52) 与 [extansion/shared/settings.js](extansion/shared/settings.js) 引入了第三层 `id`（如 `qwen3-0.6b`，把冒号换成 `-`，作为 `chrome.storage` 与扩展 ↔ 本地 app 通讯里使用的稳定标识符）。

**偏离判断**：

- 这个 `id` 层是合理的工程引入（设置存储里用 `:` 不利于做 key），但文档没记录它的存在和取值规则
- 后续如果 D4 推动了 `gemma4 → gemma3n` 的修复，`id` 该叫 `gemma4-e2b` 还是 `gemma3n-e2b`，没有文档约束
- 建议在算法文档 §5.9 后面补一小段：`id` 是扩展存储里的稳定键，与 backend tag 一一对应，重命名 backend tag 时必须同步迁移

---

## 不算偏差，但顺手记一下

下面这些做法看起来像偏差，实际上文档与实现都对得上，列出来是为了下一轮 review 不重复纠结：

- **下载用 streaming pull / `/api/v1/ai/progress` 浮窗**：`docs/issue` P2 提出，本轮已实现；文档（§5.10）只规定流程顺序，没限定是否流式，因此不算偏差
- **AI 模型 gate 三条件**：`enabled && effectiveAiPredictionModelDownloaded && aiModelManagementUsable`，与算法文档 §5.11 + §5.8 的“以本地 app 为准 + 同时要求 runtime 可用”一致
- **6 个月页级关键词 TTL**：[learning/foreground-pages.js:102](extansion/background/learning/foreground-pages.js#L102) 的 `180 * 24 * 60 * 60 * 1000` 与算法文档 §5.12 “缓存有效期先定为 6 个月”一致
- **本地 app 单进程模型**：当前已取消 Watcher / Host 双进程补拉链路，扩展只探测本地 HTTP API；`app/src/lifecycle/host.rs` 负责 host 单实例与扩展卸载关闭监控，`app/src/lifecycle/watcher.rs` 只保留旧自启动项清理
- **Side-effect 队列**：路线图说“AI 推理、模型管理、候选注册、页面摘要不再阻塞主 mutation queue”，[core/state/container.js:8-32](extansion/background/core/state/container.js#L8-L32) 与 [core/router/messages.js:18-29](extansion/background/core/router/messages.js#L18-L29) 已落地，与 Codex P1 #2 也对得上

---

## 处置建议

按"先动文档、再动代码"的顺序：

1. **D2** 必须先在文档里二选一：把 §5.14.1 那组数值删掉，或者把 §5.12.2.1 那组改掉。否则下一次 review 会再次把同一处当 issue 报。
2. **D4** 与 **D1** 是用户要做端到端实测时第一会撞的两块石头：
   - D4 影响所有 Gemma 选项的"下载"按钮
   - D1 在用户机器上已装了 Ollama 的常见情形下，会让所有"便携性"的承诺失效
   建议在动 UI 之前先补 catalog 映射 + 端口隔离
3. **D3** / **D5** / **D6** 优先级低，可在下一轮文档同步时一起处理
