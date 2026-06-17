import { pageEval } from "./cdp-client.mjs";
import { sleep } from "./test-utils.mjs";

export async function waitForLinkPoint(page, linkId, timeoutMs = 5000) {
  const startedAt = Date.now();
  let lastState = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastState = await pageEval(page, (id) => {
      const link = document.getElementById(id);

      if (!link) {
        return {
          found: false,
          readyState: document.readyState,
          bodyText: document.body?.innerText?.slice(0, 300) || "",
        };
      }

      const rect = link.getBoundingClientRect();
      return {
        found: true,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        href: link.href,
      };
    }, linkId);

    if (lastState?.found === true) {
      return lastState;
    }

    await sleep(100);
  }

  throw new Error(`Timed out waiting for ${linkId}: ${JSON.stringify(lastState)}`);
}

export async function dispatchRightClick(page, point) {
  await dispatchMouseMove(page, point);
  await page.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "right",
    buttons: 2,
    clickCount: 1,
  });
  await page.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "right",
    buttons: 0,
    clickCount: 1,
  });
}

export async function dispatchLeftClick(page, point) {
  await dispatchMouseMove(page, point);
  await page.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  await page.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
}

export async function dispatchMouseMove(page, point) {
  await page.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
    button: "none",
    buttons: 0,
  });
}

export async function closeNativeContextMenu(page) {
  await page.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
  await page.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
}

export async function dispatchSyntheticContextMenu(page, linkId) {
  await pageEval(page, (id) => {
    const link = document.getElementById(id);
    if (!link) {
      throw new Error(`link missing: ${id}`);
    }
    const rect = link.getBoundingClientRect();
    link.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 2,
        buttons: 2,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      })
    );
  }, linkId);
}
