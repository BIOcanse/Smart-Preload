function sanitizeTrackingStateForWasm(state) {
  if (!isPlainObject(state) || !isPlainObject(state.graph)) {
    return state;
  }

  const sanitizedGraph = { ...state.graph };
  delete sanitizedGraph.recentTransitions;

  return {
    ...state,
    graph: sanitizedGraph,
  };
}

function writeJsonToWasm(exports, textEncoder, value) {
  const bytes = textEncoder.encode(JSON.stringify(value));
  const pointer = bytes.length ? exports.alloc(bytes.length) : 0;

  if (bytes.length) {
    new Uint8Array(exports.memory.buffer, pointer, bytes.length).set(bytes);
  }

  return {
    pointer,
    length: bytes.length,
  };
}

function readJsonFromWasm(exports, textDecoder, pointer) {
  const length = exports.last_result_len();
  const bytes = length
    ? new Uint8Array(exports.memory.buffer.slice(pointer, pointer + length))
    : new Uint8Array();
  const jsonText = textDecoder.decode(bytes);

  if (length) {
    exports.free_result(pointer, length);
  }

  return JSON.parse(jsonText);
}

function freeInputBuffer(exports, buffer) {
  if (buffer.pointer && buffer.length) {
    exports.dealloc(buffer.pointer, buffer.length);
  }
}
