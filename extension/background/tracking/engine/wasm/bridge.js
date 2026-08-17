function wrapVisitGraphEngine(exports) {
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  // 这里只包装 WASM 实际导出的函数。
  //
  // 曾经还有 applyEvent / queryState / scoreWeights（单个）三个包装，对应
  // apply_event_json / query_state_json / score_weights_json。前两个的调用方
  // （applyTrackingEvent、queryTrackingGraph）一直无条件走 JS 实现，第三个的调用方
  // scorePreloadCandidate 没有任何调用者，因此对应的 Rust 入口连同只服务它们的
  // db/ events/ query/ model/ 模块已一并删除，二进制从 932 KB 降到 265 KB。
  // 决策依据见 docs/internal/wasm-engine-decision.md。
  return {
    scoreWeightsBatch(inputs) {
      if (typeof exports.score_weights_batch_json !== "function") {
        return Array.isArray(inputs)
          ? inputs.map((input) => scoreWeightsFallback(input?.baseScore, input?.multipliers))
          : [];
      }

      const input = writeJsonToWasm(exports, textEncoder, {
        inputs: Array.isArray(inputs) ? inputs : [],
      });

      try {
        const resultPointer = exports.score_weights_batch_json(input.pointer, input.length);
        const result = readJsonFromWasm(exports, textDecoder, resultPointer);

        if (!result?.ok) {
          throw new Error(result?.error || "Wasm scoring batch returned an unknown error.");
        }

        return Array.isArray(result.result) ? result.result : [];
      } finally {
        freeInputBuffer(exports, input);
      }
    },
    filterCandidateMetrics(input) {
      if (typeof exports.filter_candidate_metrics_json !== "function") {
        return null;
      }

      const wasmInput = writeJsonToWasm(exports, textEncoder, input);

      try {
        const resultPointer = exports.filter_candidate_metrics_json(
          wasmInput.pointer,
          wasmInput.length
        );
        const result = readJsonFromWasm(exports, textDecoder, resultPointer);

        if (!result?.ok) {
          throw new Error(result?.error || "Wasm candidate filter returned an unknown error.");
        }

        return result.result ?? null;
      } finally {
        freeInputBuffer(exports, wasmInput);
      }
    },
    selectPreloadCandidateGroup(input) {
      if (typeof exports.select_preload_candidate_group_json !== "function") {
        return null;
      }

      const wasmInput = writeJsonToWasm(exports, textEncoder, input);

      try {
        const resultPointer = exports.select_preload_candidate_group_json(
          wasmInput.pointer,
          wasmInput.length
        );
        const result = readJsonFromWasm(exports, textDecoder, resultPointer);

        if (!result?.ok) {
          throw new Error(result?.error || "Wasm preload site selection returned an unknown error.");
        }

        return result.result ?? null;
      } finally {
        freeInputBuffer(exports, wasmInput);
      }
    },
  };
}

async function applyTrackingEvent(state, event) {
  const nextState = applyTrackingEventFallback(state, event);
  globalThis.ZeroLatencyTrackingMutationJournal?.recordAppliedEvent?.(nextState, event);
  return nextState;
}
