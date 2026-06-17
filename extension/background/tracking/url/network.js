function isHttpPageUrl(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);
    return parsedUrl.protocol === "http:";
  } catch (_error) {
    return false;
  }
}

function isLocalPageUrl(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);
    const hostname = normalizeLocalHostname(parsedUrl.hostname);

    return (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      isIpv4LoopbackHostname(hostname)
    );
  } catch (_error) {
    return false;
  }
}

function isPrivateNetworkPageUrl(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);
    const hostname = normalizeLocalHostname(parsedUrl.hostname);

    return isIpv4PrivateNetworkHostname(hostname) || isIpv6PrivateNetworkHostname(hostname);
  } catch (_error) {
    return false;
  }
}

function normalizeLocalHostname(hostname) {
  return String(hostname || "")
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "");
}

function isIpv4LoopbackHostname(hostname) {
  const parts = parseIpv4Hostname(hostname);

  if (!parts || parts[0] !== 127) {
    return false;
  }

  return true;
}

function isIpv4PrivateNetworkHostname(hostname) {
  const parts = parseIpv4Hostname(hostname);

  if (!parts) {
    return false;
  }

  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 169 && parts[1] === 254)
  );
}

function parseIpv4Hostname(hostname) {
  const parts = String(hostname || "").split(".");

  if (parts.length !== 4) {
    return null;
  }

  const values = [];

  for (const part of parts) {
    if (!/^\d+$/u.test(part)) {
      return null;
    }

    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      return null;
    }

    values.push(value);
  }

  return values;
}

function isIpv6PrivateNetworkHostname(hostname) {
  const normalizedHostname = normalizeLocalHostname(hostname);

  if (!normalizedHostname.includes(":")) {
    return false;
  }

  const firstHextetText = normalizedHostname.split(":")[0];
  if (!/^[\da-f]{1,4}$/u.test(firstHextetText)) {
    return false;
  }

  const firstHextet = Number.parseInt(firstHextetText, 16);
  return (firstHextet & 0xfe00) === 0xfc00 || (firstHextet & 0xffc0) === 0xfe80;
}
