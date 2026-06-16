export class CdpClient {
  static async connect(webSocketUrl) {
    const client = new CdpClient(webSocketUrl);
    await client.open();
    return client;
  }

  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.webSocketUrl);
      this.ws.addEventListener("open", () => resolve());
      this.ws.addEventListener("error", (event) =>
        reject(event.error || new Error("WebSocket error"))
      );
      this.ws.addEventListener("message", (event) => this.handleMessage(event.data));
      this.ws.addEventListener("close", () => {
        for (const { reject: rejectPending } of this.pending.values()) {
          rejectPending(new Error("CDP socket closed"));
        }
        this.pending.clear();
      });
    });
  }

  send(method, params = {}, options = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 15000);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!this.pending.has(id)) {
          return;
        }
        this.pending.delete(id);
        reject(new Error(formatCdpTimeoutMessage(method, params)));
      }, timeoutMs).unref?.();
    });
  }

  handleMessage(rawMessage) {
    const message = JSON.parse(rawMessage);
    if (!message.id || !this.pending.has(message.id)) {
      return;
    }
    const pending = this.pending.get(message.id);
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(`${message.error.message}: ${message.error.data || ""}`));
      return;
    }
    pending.resolve(message.result || {});
  }

  close() {
    try {
      this.ws?.close();
    } catch (_error) {
      // Ignore cleanup errors.
    }
  }
}

function formatCdpTimeoutMessage(method, params) {
  if (method !== "Runtime.evaluate" || typeof params?.expression !== "string") {
    return `CDP command timed out: ${method}`;
  }

  const expression = params.expression.replace(/\s+/g, " ").slice(0, 300);
  return `CDP command timed out: ${method}; expression=${expression}`;
}

export async function swEval(client, fn, arg = {}, options = {}) {
  return runtimeEval(client, `(${fn.toString()})(${JSON.stringify(arg)})`, options);
}

export async function pageEval(client, fn, arg = {}, options = {}) {
  return runtimeEval(client, `(${fn.toString()})(${JSON.stringify(arg)})`, options);
}

export async function runtimeEval(client, expression, options = {}) {
  const response = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, options);
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description ||
        response.exceptionDetails.text ||
        "CDP Runtime.evaluate failed"
    );
  }
  return response.result?.value;
}
