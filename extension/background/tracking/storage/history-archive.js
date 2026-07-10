(function () {
  const HISTORY_ARCHIVE_VERSION = 1;
  const HISTORY_CHUNK_SIZE = 256;
  const HISTORY_CHUNK_PREFIX = "trackingHistoryV1";

  function createEmptyHistoryManifest() {
    return {
      version: HISTORY_ARCHIVE_VERSION,
      chunkSize: HISTORY_CHUNK_SIZE,
      maxSequence: 0,
      chunks: [],
    };
  }

  function normalizeHistoryManifest(rawManifest) {
    if (!isPlainObject(rawManifest)) {
      return createEmptyHistoryManifest();
    }

    const chunks = Array.isArray(rawManifest.chunks)
      ? rawManifest.chunks
          .filter((chunk) => isPlainObject(chunk) && typeof chunk.key === "string")
          .map((chunk) => ({
            key: chunk.key,
            dayKey: typeof chunk.dayKey === "string" ? chunk.dayKey : "unknown",
            index: clampNonNegativeInt(chunk.index, 0),
            count: clampNonNegativeInt(chunk.count, 0),
            firstSequence: clampNonNegativeInt(chunk.firstSequence, 0),
            lastSequence: clampNonNegativeInt(chunk.lastSequence, 0),
          }))
          .sort(compareChunks)
      : [];

    return {
      version: HISTORY_ARCHIVE_VERSION,
      chunkSize: HISTORY_CHUNK_SIZE,
      maxSequence: Math.max(
        clampNonNegativeInt(rawManifest.maxSequence, 0),
        ...chunks.map((chunk) => chunk.lastSequence)
      ),
      chunks,
    };
  }

  async function appendTransitionMessages({ chromeStorage, manifestKey, manifest, messages }) {
    const normalizedManifest = normalizeHistoryManifest(manifest);
    const nextMessages = normalizeTransitionMessages(Array.isArray(messages) ? messages : [])
      .filter((message) => message.sequenceNumber > normalizedManifest.maxSequence);

    if (nextMessages.length === 0) {
      return normalizedManifest;
    }

    const chunkValues = new Map();

    for (const message of nextMessages) {
      const dayKey = buildUtcDayKey(message.occurredAt);
      let descriptor = getWritableChunk(normalizedManifest, dayKey);

      if (!descriptor) {
        descriptor = createChunkDescriptor(normalizedManifest, dayKey, message.sequenceNumber);
        normalizedManifest.chunks.push(descriptor);
      }

      let chunk = chunkValues.get(descriptor.key);

      if (!chunk) {
        const stored = await chromeStorage.get({ [descriptor.key]: [] });
        chunk = Array.isArray(stored[descriptor.key]) ? stored[descriptor.key] : [];
        chunkValues.set(descriptor.key, chunk);
      }

      if (chunk.length >= HISTORY_CHUNK_SIZE) {
        descriptor = createChunkDescriptor(normalizedManifest, dayKey, message.sequenceNumber);
        normalizedManifest.chunks.push(descriptor);
        chunk = [];
        chunkValues.set(descriptor.key, chunk);
      }

      chunk.push(message);
      descriptor.count = chunk.length;
      descriptor.firstSequence ||= message.sequenceNumber;
      descriptor.lastSequence = message.sequenceNumber;
      normalizedManifest.maxSequence = Math.max(
        normalizedManifest.maxSequence,
        message.sequenceNumber
      );
    }

    normalizedManifest.chunks.sort(compareChunks);
    await writeChunkValues(chromeStorage, chunkValues);
    await chromeStorage.set({ [manifestKey]: normalizedManifest });
    return normalizedManifest;
  }

  async function loadAllTransitionMessages({ chromeStorage, manifest }) {
    const normalizedManifest = normalizeHistoryManifest(manifest);
    const keys = normalizedManifest.chunks.map((chunk) => chunk.key);

    if (keys.length === 0) {
      return [];
    }

    const stored = {};

    for (let index = 0; index < keys.length; index += 64) {
      Object.assign(stored, await chromeStorage.get(keys.slice(index, index + 64)));
    }

    return normalizeTransitionMessages(
      normalizedManifest.chunks.flatMap((chunk) =>
        Array.isArray(stored[chunk.key]) ? stored[chunk.key] : []
      )
    );
  }

  async function replaceTransitionMessages({ chromeStorage, manifestKey, manifest, messages }) {
    const previousManifest = normalizeHistoryManifest(manifest);
    const previousKeys = previousManifest.chunks.map((chunk) => chunk.key);

    for (let index = 0; index < previousKeys.length; index += 64) {
      await chromeStorage.remove(previousKeys.slice(index, index + 64));
    }

    const nextManifest = await appendTransitionMessages({
      chromeStorage,
      manifestKey,
      manifest: createEmptyHistoryManifest(),
      messages,
    });

    if (nextManifest.chunks.length === 0) {
      await chromeStorage.set({ [manifestKey]: nextManifest });
    }

    return nextManifest;
  }

  function mergeArchivedAndHotMessages(archivedMessages, hotMessages) {
    const messagesBySequence = new Map();

    for (const message of [...archivedMessages, ...hotMessages]) {
      const sequenceNumber = clampNonNegativeInt(message?.sequenceNumber, 0);

      if (sequenceNumber > 0) {
        messagesBySequence.set(sequenceNumber, message);
      }
    }

    return normalizeTransitionMessages([...messagesBySequence.values()]);
  }

  function getWritableChunk(manifest, dayKey) {
    for (let index = manifest.chunks.length - 1; index >= 0; index -= 1) {
      const chunk = manifest.chunks[index];

      if (chunk.dayKey === dayKey && chunk.count < HISTORY_CHUNK_SIZE) {
        return chunk;
      }
    }

    return null;
  }

  function createChunkDescriptor(manifest, dayKey, firstSequence) {
    const nextIndex = manifest.chunks.reduce(
      (maxIndex, chunk) => (chunk.dayKey === dayKey ? Math.max(maxIndex, chunk.index + 1) : maxIndex),
      0
    );

    return {
      key: `${HISTORY_CHUNK_PREFIX}:${dayKey}:${String(nextIndex).padStart(6, "0")}`,
      dayKey,
      index: nextIndex,
      count: 0,
      firstSequence,
      lastSequence: 0,
    };
  }

  function compareChunks(left, right) {
    return left.dayKey.localeCompare(right.dayKey) || left.index - right.index;
  }

  async function writeChunkValues(chromeStorage, chunkValues) {
    const entries = [...chunkValues.entries()];

    for (let index = 0; index < entries.length; index += 32) {
      await chromeStorage.set(Object.fromEntries(entries.slice(index, index + 32)));
    }
  }

  globalThis.ZeroLatencyTrackingHistoryArchive = {
    HISTORY_CHUNK_SIZE,
    createEmptyHistoryManifest,
    normalizeHistoryManifest,
    appendTransitionMessages,
    loadAllTransitionMessages,
    replaceTransitionMessages,
    mergeArchivedAndHotMessages,
  };
})();
