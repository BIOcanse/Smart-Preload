const WASM_ENGINE_RETRY_COOLDOWN_MS = 30_000;
let visitGraphEngineLastFailureAt = 0;

async function getVisitGraphEngine() {
  const shouldRetryEngineLoad =
    backgroundState.visitGraphEnginePromise === null &&
    (visitGraphEngineLastFailureAt === 0 ||
      Date.now() - visitGraphEngineLastFailureAt >= WASM_ENGINE_RETRY_COOLDOWN_MS);

  if (shouldRetryEngineLoad) {
    backgroundState.visitGraphEnginePromise = createVisitGraphEngine().catch((error) => {
      console.error("Failed to load visit graph wasm engine.", error);
      visitGraphEngineLastFailureAt = Date.now();
      backgroundState.visitGraphEnginePromise = null;
      return null;
    });
  }

  return backgroundState.visitGraphEnginePromise;
}

async function createVisitGraphEngine() {
  const response = await fetch(chrome.runtime.getURL(WASM_ENGINE_PATH));

  if (!response.ok) {
    throw new Error(`Wasm engine fetch failed with status ${response.status}.`);
  }

  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer());

  if (!instance?.exports?.memory) {
    throw new Error("Wasm engine did not expose linear memory.");
  }

  console.log("Visit graph wasm engine loaded.");
  visitGraphEngineLastFailureAt = 0;
  return wrapVisitGraphEngine(instance.exports);
}
