// 配对被拒后的扩展侧退避。
//
// 这条是实机跑出来的（2026-08-09）：第一版退避**从未生效过**，因为它踩了两个坑，
// 每一个都足以让它失效，而且两个都不会报错：
//
//   1. 退避标志被写进 `resetNativeAppRegistration()` 里一起清掉，
//      而那个函数是**心跳恢复与唤醒重试自动调用**的（六处），每个周期都会触发。
//   2. 退避只存在模块级变量里。MV3 的 service worker 空闲约 30 秒被回收，
//      而心跳闹钟正好 30 秒一次 —— 变量撑不过一个周期。
//
// 表现是：用户点了「不连接」，扩展照样每 30 秒发一次注册请求。
// 这些请求只是被 app 侧的冷却窗口挡住了，看起来像修好了，其实扩展这一侧完全没闭嘴。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const registrationSource = readFileSync(
  path.join(repoRoot, "extension/background/shared/native-app/request/registration.js"),
  "utf8"
);

// --- 1. 自动恢复路径不得清掉退避 ---
//
// 静态检查：`resetNativeAppRegistration` 的函数体里不能出现退避变量。
// 它被自动调用，碰了退避就等于没有退避。
{
  const body = registrationSource.match(
    /function resetNativeAppRegistration\(\)\s*\{([\s\S]*?)\n  \}/
  );
  assert.ok(body, "没找到 resetNativeAppRegistration");

  assert.doesNotMatch(
    body[1],
    /pairingBackoffUntil|PAIRING_BACKOFF_STORAGE_KEY|clearNativeAppPairingBackoff/,
    "resetNativeAppRegistration 又碰退避了。它被心跳恢复与唤醒重试自动调用（六处），" +
      "碰一下退避就每个周期归零 —— 用户点了「不连接」照样每 30 秒被问一次"
  );
}

// --- 2. 自动恢复的调用点确实是自动的（证明上一条不是空的） ---
{
  const autoRecoveryFiles = [
    "extension/background/shared/native-app/request/heartbeat/recovery.js",
    "extension/background/shared/native-app/request/heartbeat/wake-retry.js",
  ];

  let autoCallSites = 0;
  for (const relativePath of autoRecoveryFiles) {
    const source = readFileSync(path.join(repoRoot, relativePath), "utf8");
    autoCallSites += [...source.matchAll(/resetNativeAppRegistration\(\)/g)].length;
    assert.doesNotMatch(
      source,
      /clearNativeAppPairingBackoff/,
      `${relativePath} 是自动恢复路径，不该清配对退避`
    );
  }

  assert.ok(
    autoCallSites >= 4,
    `自动恢复路径里的 resetNativeAppRegistration 调用数为 ${autoCallSites} —— ` +
      "如果降到 0，第 1 条断言就变成空的了（没有自动调用方，碰不碰退避都无所谓）"
  );
}

// 在沙箱里把 registration.js 跑起来。每次调用都是一个**全新的模块作用域**，
// 用来模拟 MV3 回收 service worker；传入同一个 sessionStore 表示同一个浏览器会话。
function createModuleContext({ sessionStore, status = 403 }) {
    const fetchCalls = [];
    const modules = {
      NATIVE_APP_BASE_URL: "http://127.0.0.1:45831",
      NATIVE_APP_REQUEST_TIMEOUT_MS: 1500,
      NATIVE_APP_EXTENSION_REGISTER_PATH: "/api/v1/extension/register",
      buildNativeAppHeaders: () => ({}),
      markNativeAppSystemHidingAvailability: () => {},
    };

    const sandbox = {
      console,
      setTimeout,
      clearTimeout,
      AbortController,
      Date,
      Number,
      Error,
      String,
      JSON,
      Object,
      chrome: {
        storage: {
          // session 存储在 SW 重启后仍然存在 —— 这正是它被选中的原因。
          session: {
            get: async (key) => (key in sessionStore ? { [key]: sessionStore[key] } : {}),
            set: async (entries) => Object.assign(sessionStore, entries),
            remove: async (key) => {
              delete sessionStore[key];
            },
          },
        },
      },
      fetch: async (url) => {
        fetchCalls.push(url);
        return {
          ok: false,
          status,
          json: async () => ({}),
        };
      },
    };

    sandbox.globalThis = sandbox;
    sandbox.self = sandbox;
    sandbox.ZeroLatencyNativeAppRequestModules = modules;

    const context = vm.createContext(sandbox);
    vm.runInContext(registrationSource, context, { filename: "registration.js" });

  return { modules: sandbox.ZeroLatencyNativeAppRequestModules, fetchCalls };
}

// --- 3. 行为：403 之后必须闭嘴，且状态要跨「SW 重启」存活 ---
{
  // 一个「浏览器会话」共享的 session 存储，SW 重启时不清空。
  const sessionStore = {};

  const first = createModuleContext({ sessionStore });

  await assert.rejects(
    first.modules.ensureNativeAppRegistration(),
    /403/,
    "第一次注册应当因为 403 而失败"
  );
  assert.equal(first.fetchCalls.length, 1, "第一次应当真的发了请求");

  // 同一个 SW 实例内的后续尝试：不得再发请求。
  await assert.rejects(first.modules.ensureNativeAppRegistration(), /declined/);
  assert.equal(
    first.fetchCalls.length,
    1,
    "退避期内又发了注册请求 —— 每一次都会让 app 再弹一个确认框"
  );

  // 自动恢复路径调 reset 之后，退避必须**仍然生效**。
  first.modules.resetNativeAppRegistration();
  await assert.rejects(first.modules.ensureNativeAppRegistration(), /declined/);
  assert.equal(
    first.fetchCalls.length,
    1,
    "resetNativeAppRegistration() 之后退避失效了 —— 那是自动恢复路径，每个周期都会调它"
  );

  // 模拟 MV3 回收 service worker：全新的模块作用域，只有 session 存储留了下来。
  const restarted = createModuleContext({ sessionStore });
  await assert.rejects(
    restarted.modules.ensureNativeAppRegistration(),
    /declined/,
    "service worker 重启后退避丢了 —— 模块级变量撑不过 MV3 的 30 秒回收"
  );
  assert.equal(
    restarted.fetchCalls.length,
    0,
    "SW 重启后立刻又发了注册请求，用户会再被弹一次"
  );

  // 用户主动动作：立刻解除退避。
  await restarted.modules.clearNativeAppPairingBackoff();
  await assert.rejects(restarted.modules.ensureNativeAppRegistration(), /403/);
  assert.equal(
    restarted.fetchCalls.length,
    1,
    "用户主动要求连接后仍被自己十分钟前的拒绝挡着"
  );
}

// --- 4. 409（确认框正开着）不得进退避 ---
//
// app 把弹窗从 HTTP 请求上分离出去之后，「确认框已弹出、正在等人」返回 409。
// 这不是拒绝：用户点完「连接」要靠接下来的重试才真正连上。
// 这里若也退避十分钟，用户会觉得点了没反应。
{
  const sessionStore = {};
  const pending = createModuleContext({ sessionStore, status: 409 });

  await assert.rejects(pending.modules.ensureNativeAppRegistration(), /409/);
  await assert.rejects(pending.modules.ensureNativeAppRegistration(), /409/);

  assert.equal(
    pending.fetchCalls.length,
    2,
    "409 之后停止了重试 —— 那是「确认框正开着」，不是拒绝；" +
      "用户点完「连接」就再也没有请求去把配对取回来了"
  );
  assert.deepEqual(
    Object.keys(sessionStore),
    [],
    "409 不该写入退避状态 —— 那会让用户确认之后还要再等一个退避周期"
  );
}

// --- 5. 健康探测成功必须解除退避（托盘手动配对的回环）---
//
// `/health` 在 app 侧受 origin 网关保护，只有已配对的扩展才拿得到 200。
// 用户从托盘手动把扩展配上之后，app 没有办法主动通知扩展；没有这条清除，
// 扩展会在自己的十分钟退避里干等，用户会以为点了没生效。
{
  const healthSource = readFileSync(
    path.join(repoRoot, "extension/background/shared/native-app/health.js"),
    "utf8"
  );

  assert.match(
    healthSource,
    /clearNativeAppPairingBackoff/,
    "健康探测成功后没有清除配对退避 —— 托盘手动配对之后扩展要空等一整个退避周期"
  );

  // 探测必须能在退避期内运行，否则上面那条清除永远够不着。
  assert.match(
    healthSource,
    /skipRegistration:\s*true/,
    "健康探测走了注册路径 —— 退避期内它自己也会被挡住，回环就断了"
  );
}

// --- 6. 退避时长必须盖得住自动重试的节奏 ---
{
  const commonSource = readFileSync(
    path.join(repoRoot, "extension/background/shared/native-app/request/common.js"),
    "utf8"
  );
  const heartbeatSeconds = Number(
    commonSource.match(/NATIVE_APP_HEARTBEAT_INTERVAL_SECONDS:\s*(\d+)/)?.[1]
  );
  const wakeRetrySeconds = Number(
    commonSource.match(/NATIVE_APP_WAKE_RETRY_INTERVAL_SECONDS:\s*(\d+)/)?.[1]
  );
  const backoffMs = Number(
    registrationSource.match(/PAIRING_REJECTED_BACKOFF_MS\s*=\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/)
      ?.slice(1)
      .reduce((product, value) => product * Number(value), 1)
  );

  assert.ok(Number.isFinite(heartbeatSeconds), "没解析到心跳间隔");
  assert.ok(Number.isFinite(wakeRetrySeconds), "没解析到唤醒重试间隔");
  assert.ok(Number.isFinite(backoffMs) && backoffMs > 0, "没解析到退避时长");

  const fastestRetrySeconds = Math.min(heartbeatSeconds, wakeRetrySeconds);
  assert.ok(
    backoffMs / 1000 >= fastestRetrySeconds * 10,
    `退避 ${backoffMs / 1000} 秒对最快 ${fastestRetrySeconds} 秒一次的自动重试来说太短了`
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "automatic recovery never clears the pairing backoff",
        "the automatic call sites really are automatic (so the check above is not vacuous)",
        "a 403 silences further registration attempts",
        "the backoff survives a service worker restart via session storage",
        "an explicit user action lifts the backoff immediately",
        "a 409 (confirmation still on screen) does not trigger the backoff",
        "a successful health probe lifts the backoff (tray-initiated pairing closes the loop)",
        "the backoff outlasts the automatic retry cadence by 10x",
      ],
    },
    null,
    2
  )
);
