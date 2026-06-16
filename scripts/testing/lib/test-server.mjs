import { createServer } from "node:http";

export async function startHttpTestServer(port, handler) {
  const server = createServer((request, response) => {
    try {
      handler(request, response);
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(error?.stack || error?.message || String(error));
    }
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return server;
}

export function respondHtml(response, html) {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
}

export function respondText(response, text, status = 200) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}
