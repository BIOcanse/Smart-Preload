import { escapeHtml } from "./test-utils.mjs";
import { respondHtml, respondText, startHttpTestServer } from "./test-server.mjs";

export function startBrowserIsolationSite(port) {
  return startHttpTestServer(port, (request, response) => {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host}`);
    response.setHeader("Cache-Control", "no-store");

    if (requestUrl.pathname.startsWith("/source/")) {
      respondHtml(response, renderSourcePage(request.headers.host || "", requestUrl.pathname));
      return;
    }

    if (
      requestUrl.pathname.startsWith("/native/") ||
      requestUrl.pathname.startsWith("/hidden/")
    ) {
      respondHtml(response, renderTargetPage(request.headers.host || "", requestUrl.pathname));
      return;
    }

    respondText(response, "not found", 404);
  });
}

function renderSourcePage(hostHeader, pathname) {
  const [host, port] = hostHeader.split(":");
  const browserName = pathname.split("/").filter(Boolean)[1] || "browser";
  const hiddenHost = `${browserName}-hidden.test`;
  const nativeUrls = Array.from(
    { length: 5 },
    (_, index) => `http://${host}:${port}/native/${browserName}/${index + 1}`
  );
  const hiddenUrls = Array.from(
    { length: 5 },
    (_, index) => `http://${hiddenHost}:${port}/hidden/${browserName}/${index + 1}`
  );
  const links = [
    ...nativeUrls.map(
      (url, index) => `<a id="native-link-${index + 1}" href="${url}">Native ${index + 1}</a>`
    ),
    ...hiddenUrls.map(
      (url, index) => `<a id="hidden-link-${index + 1}" href="${url}">Hidden ${index + 1}</a>`
    ),
  ].join("\n");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>ZLW ${browserName} source</title>
    <style>
      body { font-family: sans-serif; margin: 32px; }
      a { display: block; margin: 10px 0; padding: 10px; font-size: 18px; }
    </style>
  </head>
  <body>
    <h1>ZLW ${browserName} source</h1>
    ${links}
  </body>
</html>`;
}

function renderTargetPage(hostHeader, pathname) {
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>${escapeHtml(pathname)}</title></head>
  <body><h1>${escapeHtml(hostHeader)} ${escapeHtml(pathname)}</h1></body>
</html>`;
}
