function normalizeHistoryDeletionRange(rawRange) {
  const start = parseUtcDateBound(rawRange?.startDate, "startDate");
  const end = parseUtcDateBound(rawRange?.endDate, "endDate");

  if (!start.provided || !end.provided) {
    throw new Error("Select both UTC start date and UTC end date.");
  }

  if (start.ms >= end.ms) {
    throw new Error("UTC start date must be earlier than UTC end date.");
  }

  return {
    startDate: start.date,
    endDate: end.date,
    startAt: new Date(start.ms).toISOString(),
    endAt: new Date(end.ms).toISOString(),
    startMs: start.ms,
    endMs: end.ms,
  };
}

function parseUtcDateBound(value, fieldName) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return {
      provided: false,
      ms: null,
      date: null,
    };
  }

  const dateText = String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);

  if (!match) {
    throw new Error(`Invalid ${fieldName} UTC date.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsedMs = Date.UTC(year, month - 1, day);
  const parsedDate = new Date(parsedMs);

  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day
  ) {
    throw new Error(`Invalid ${fieldName} UTC date.`);
  }

  return {
    provided: true,
    ms: parsedMs,
    date: dateText,
  };
}

function isIsoTimestampInRange(value, range) {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }

  const timestampMs = Date.parse(value);

  return (
    Number.isFinite(timestampMs) &&
    timestampMs >= range.startMs &&
    timestampMs < range.endMs
  );
}
