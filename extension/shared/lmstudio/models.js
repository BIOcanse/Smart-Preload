(() => {
  function normalizeModelListResponse(parsed) {
    const rawModels = Array.isArray(parsed?.models)
      ? parsed.models
      : Array.isArray(parsed?.data)
        ? parsed.data
        : [];

    return rawModels
      .map(normalizeModel)
      .filter(Boolean)
      .sort(compareModels);
  }

  function normalizeModel(rawModel) {
    if (!rawModel || typeof rawModel !== "object") {
      return null;
    }

    const type =
      typeof rawModel.type === "string" ? rawModel.type.trim().toLowerCase() : "llm";

    if (type && type !== "llm") {
      return null;
    }

    const id = normalizeModelId(rawModel.key || rawModel.id || rawModel.model);

    if (!id) {
      return null;
    }

    const label = normalizeLabel(
      rawModel.display_name || rawModel.displayName || rawModel.name || id
    );
    const instanceIds = normalizeLoadedInstanceIds(rawModel, id);
    const loaded = instanceIds.length > 0 || rawModel.loaded === true;

    return {
      id,
      label,
      type: "llm",
      loaded,
      statusLabel: loaded ? "loaded" : "not loaded",
      instanceIds,
      raw: rawModel,
    };
  }

  function normalizeLoadedInstanceIds(rawModel, modelId) {
    const rawInstances =
      rawModel.loaded_instances ??
      rawModel.loadedInstances ??
      rawModel.instances ??
      rawModel.loadedInstancesInfo ??
      [];

    if (!Array.isArray(rawInstances)) {
      return rawModel.loaded === true ? [modelId] : [];
    }

    return rawInstances
      .map((instance) => {
        if (typeof instance === "string") {
          return instance.trim();
        }

        return normalizeModelId(
          instance?.instance_id ||
            instance?.instanceId ||
            instance?.identifier ||
            instance?.id ||
            modelId
        );
      })
      .filter(Boolean);
  }

  function compareModels(left, right) {
    if (left.loaded !== right.loaded) {
      return left.loaded ? -1 : 1;
    }

    return String(left.label || left.id).localeCompare(String(right.label || right.id));
  }

  function normalizeModelId(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizeLabel(value) {
    return typeof value === "string" && value.trim() ? value.trim() : "Local model";
  }

  globalThis.ZeroLatencyLmStudioModels = {
    normalizeModelListResponse,
    normalizeModel,
    normalizeLoadedInstanceIds,
    compareModels,
    normalizeModelId,
    normalizeLabel,
  };
})();
