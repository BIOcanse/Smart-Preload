function wrapVisitGraphEngine(exports) {
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  return {
    applyEvent(state, event) {
      const stateInput = writeJsonToWasm(exports, textEncoder, state);
      const eventInput = writeJsonToWasm(exports, textEncoder, event);

      try {
        const resultPointer = exports.apply_event_json(
          stateInput.pointer,
          stateInput.length,
          eventInput.pointer,
          eventInput.length
        );
        const result = readJsonFromWasm(exports, textDecoder, resultPointer);

        if (!result?.ok) {
          throw new Error(result?.error || "Wasm engine returned an unknown error.");
        }

        return result.state;
      } finally {
        freeInputBuffer(exports, stateInput);
        freeInputBuffer(exports, eventInput);
      }
    },
    queryState(state, query) {
      const stateInput = writeJsonToWasm(exports, textEncoder, state);
      const queryInput = writeJsonToWasm(exports, textEncoder, query);

      try {
        const resultPointer = exports.query_state_json(
          stateInput.pointer,
          stateInput.length,
          queryInput.pointer,
          queryInput.length
        );
        const result = readJsonFromWasm(exports, textDecoder, resultPointer);

        if (!result?.ok) {
          throw new Error(result?.error || "Wasm query returned an unknown error.");
        }

        return result.result ?? null;
      } finally {
        freeInputBuffer(exports, stateInput);
        freeInputBuffer(exports, queryInput);
      }
    },
    scoreWeights(baseScore, multipliers) {
      if (typeof exports.score_weights_json !== "function") {
        return scoreWeightsFallback(baseScore, multipliers);
      }

      const input = writeJsonToWasm(exports, textEncoder, {
        baseScore,
        multipliers: Array.isArray(multipliers) ? multipliers : [],
      });

      try {
        const resultPointer = exports.score_weights_json(input.pointer, input.length);
        const result = readJsonFromWasm(exports, textDecoder, resultPointer);

        if (!result?.ok) {
          throw new Error(result?.error || "Wasm scoring returned an unknown error.");
        }

        return result.result ?? null;
      } finally {
        freeInputBuffer(exports, input);
      }
    },
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
