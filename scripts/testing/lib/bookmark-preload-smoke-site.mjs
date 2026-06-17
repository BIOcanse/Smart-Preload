import { createServer } from "node:http";
import { escapeHtml } from "./test-utils.mjs";

export function buildBookmarkSmokeUrls(port) {
  return {
    startupGoogle: `http://www.google.test:${port}/search?q=startup-smoke`,
    newGoogle: `http://www.google.test:${port}/search?q=newtab-smoke`,
    nonGoogle: `http://nongoogle.test:${port}/plain`,
    bookmarkHigh: `http://bookmark-high.test:${port}/bookmark/high`,
    bookmarkMid: `http://bookmark-mid.test:${port}/bookmark/mid`,
    bookmarkLow: `http://bookmark-low.test:${port}/bookmark/low`,
    resultA: `http://page-result.test:${port}/result/a`,
    resultB: `http://page-result.test:${port}/result/b`,
  };
}

export async function startBookmarkSmokeServer(port) {
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host}`);
    const host = (request.headers.host || "").split(":")[0];
    response.setHeader("Cache-Control", "no-store");

    if (host === "www.google.test" && requestUrl.pathname === "/search") {
      respondHtml(response, renderGoogleSearchPage(requestUrl));
      return;
    }

    if (host === "nongoogle.test" && requestUrl.pathname === "/plain") {
      respondHtml(response, renderNonGooglePage(port));
      return;
    }

    respondHtml(response, renderTargetPage(host, requestUrl.pathname));
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return server;
}

function renderGoogleSearchPage(requestUrl) {
  const query = requestUrl.searchParams.get("q") || "";
  return `<!doctype html>
<html>
  <head><title>Google smoke ${escapeHtml(query)}</title></head>
  <body>
    <main>
      <h1>Google smoke ${escapeHtml(query)}</h1>
      <a href="/search?udm=50&q=${encodeURIComponent(query)}">AI mode should not be preferred</a>
      <a href="http://page-result.test:${requestUrl.port}/result/a">Result A</a>
      <a href="http://page-result.test:${requestUrl.port}/result/b" target="_blank">Result B blank</a>
      <a href="http://bookmark-low.test:${requestUrl.port}/bookmark/low">Visible low bookmark page</a>
    </main>
  </body>
</html>`;
}

function renderNonGooglePage(port) {
  return `<!doctype html>
<html>
  <head><title>Non Google smoke</title></head>
  <body>
    <h1>Non Google smoke</h1>
    <a href="http://bookmark-high.test:${port}/bookmark/high">Bookmark-looking link outside Google</a>
    <a href="http://page-result.test:${port}/result/a">Normal result</a>
  </body>
</html>`;
}

function renderTargetPage(host, pathname) {
  return `<!doctype html>
<html>
  <head><title>${escapeHtml(host)} ${escapeHtml(pathname)}</title></head>
  <body>
    <h1>${escapeHtml(host)}</h1>
    <p>Target page ${escapeHtml(pathname)}</p>
  </body>
</html>`;
}

function respondHtml(response, html) {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
}
