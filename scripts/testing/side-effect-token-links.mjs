// 一次性凭据类链接不得被预加载。
//
// 此前 inspectSideEffectUrl 的 query 检查**只匹配 value 不匹配 key**，路径只做 10 个 token
// 的精确段匹配。于是 magic link（`/login?token=…`）、密码重置、邮箱验证、`?unsubscribe=1`、
// `?action=trash` 全部放行。
//
// 这个场景完全可达：magic link 从邮件来，用户在**网页版邮箱**里打开那封信，该链接就是当前
// 页面上的一个候选链接。预加载会消耗掉令牌 —— 用户真去点时看到「链接已失效」；magic link
// 更糟，会话可能建立在隐藏的预加载窗口里。
//
// 误报方向是安全的（该链接不被预加载而已），漏报方向不是，所以这里刻意偏向拦截。
// 但也记录了刻意**不**拦的那些，防止后来者把它们当遗漏补上去。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const bundleSource = [
  "../../extension/shared/preload-safety-rules/constants.js",
  "../../extension/shared/preload-safety-rules/url.js",
]
  .map((filePath) => readFileSync(new URL(filePath, import.meta.url), "utf8"))
  .join("\n");

const sandbox = { console, URL, Set, String, Object, decodeURIComponent };
sandbox.globalThis = sandbox;
const context = vm.createContext(sandbox);
vm.runInContext(bundleSource, context, { filename: "preload-safety-rules.js" });

const { inspectSideEffectUrl } = context.ZeroLatencyPreloadSafetyRuleUrl;
assert.equal(typeof inspectSideEffectUrl, "function");

const BASE = "https://mail.example/inbox";

// 结果数组建在 vm realm 里，原型不是宿主的 Array.prototype，直接 deepStrictEqual 会
// 因原型不同而误报「不相等」（即使两边都是空数组）。统一搬回宿主 realm。
// 见 docs/internal/invariants.md 第 4 条的 vm 沙箱注意事项。
function reasonsFor(url) {
  return Array.from(inspectSideEffectUrl(url, { baseUrl: BASE }), String);
}

function assertBlocked(url, note) {
  const reasons = reasonsFor(url);
  assert.ok(
    reasons.length > 0,
    `${url} 未被拦截 —— ${note}`
  );
  return reasons;
}

function assertAllowed(url, note) {
  const reasons = reasonsFor(url);
  assert.deepEqual(reasons, [], `${url} 被误拦 —— ${note}（原因：${reasons.join(", ")}）`);
}

// --- 1. 一次性凭据：预加载会把令牌烧掉 ---
{
  const mustBlock = [
    ["https://app.example/login?token=abc123def", "magic link：会话可能建立在隐藏预加载窗口里"],
    ["https://app.example/auth?auth_token=abc", "*_token 后缀规则"],
    ["https://app.example/u/reset?reset_token=xyz", "密码重置令牌"],
    ["https://app.example/confirm?confirmation_token=xyz", "确认令牌"],
    ["https://app.example/verify-email?verification_code=999", "邮箱验证码"],
    ["https://app.example/enter?otp=445566", "一次性口令"],
    ["https://news.example/mail?unsubscribe=1", "unsubscribe 作为**键**出现"],
    ["https://app.example/i?invite_token=zz", "邀请令牌"],
    ["https://app.example/go?magic_link=zz", "magic link 别名"],
    ["https://app.example/x?csrf-token=zz", "-token 后缀规则"],
  ];

  for (const [url, note] of mustBlock) {
    const reasons = assertBlocked(url, note);
    assert.ok(
      reasons.includes("side-effect-query-credential"),
      `${url} 拦是拦住了，但原因不是 side-effect-query-credential：${reasons.join(", ")}`
    );
  }
}

// --- 2. 动作型 query key ---
{
  for (const [url, note] of [
    ["https://app.example/items/9?action=trash", "action=trash 此前恒不可达"],
    ["https://app.example/items/9?action=archive", "action=archive"],
    ["https://app.example/p?do=revoke", "do=revoke"],
    ["https://app.example/p?op=disable", "op=disable"],
    ["https://app.example/p?cmd=restore", "cmd=restore"],
  ]) {
    const reasons = assertBlocked(url, note);
    assert.ok(
      reasons.includes("side-effect-action-query"),
      `${url} 的拦截原因应当是 side-effect-action-query：${reasons.join(", ")}`
    );
  }

  // 同名键但值是无害的，不该拦。
  assertAllowed("https://app.example/list?action=view", "action=view 是只读动作");
  assertAllowed("https://shop.example/p?op=compare", "op=compare 是只读动作");
}

// --- 3. 新增的状态变更路径段 ---
{
  for (const [url, note] of [
    ["https://app.example/orders/9/refund", "退款"],
    ["https://app.example/tokens/1/revoke", "吊销令牌"],
    ["https://app.example/account/deactivate", "停用账号"],
    ["https://blog.example/posts/3/unpublish", "取消发布"],
    ["https://app.example/reset-password/abc", "密码重置"],
    ["https://app.example/verify-email/abc", "邮箱验证"],
  ]) {
    const reasons = assertBlocked(url, note);
    assert.ok(reasons.includes("side-effect-url-path"), `${url}：${reasons.join(", ")}`);
  }
}

// --- 4. 原有规则不得回退 ---
{
  assertBlocked("https://app.example/session/logout", "原有 logout 路径段");
  assertBlocked("https://app.example/x?method=delete", "原有值匹配");
  assertBlocked("https://cdn.example/setup.exe", "下载扩展名");
  assertBlocked("https://cdn.example/downloads/guide", "下载路径段");
  assertBlocked("https://cdn.example/f?download=1", "下载 query key");
}

// --- 5. 刻意不拦的：把取舍钉住，防止后来者当遗漏补上去 ---
//
// 这些都是**普通可浏览页面**，拦掉等于静默削弱产品核心功能。
{
  const mustAllow = [
    ["https://app.example/login", "登录页本身是无害 GET —— 危险的是带一次性令牌那种"],
    ["https://app.example/signin", "同上"],
    ["https://app.example/oauth/authorize", "auth / oauth 作为路径前缀过于常见"],
    ["https://blog.example/archive/2026", "archive 作为归档列表页极常见"],
    ["https://news.example/subscribe", "subscribe 常见于营销落地页"],
    ["https://shop.example/products?code=US", "裸 code 键太常见（国家码、促销码）"],
    ["https://shop.example/search?key=laptop", "裸 key 键太常见"],
    ["https://docs.example/guide/getting-started", "普通文档页"],
    ["https://app.example/invite/accept/abc", "见下方说明：未收录，属已知缺口"],
  ];

  for (const [url, note] of mustAllow) {
    assertAllowed(url, note);
  }
}

// --- 6. 无效 URL ---
//
// 注意：**给了 baseUrl 时几乎不会走到这条**。`new URL("not a url at all", base)` 会按相对
// 地址解析成 `https://mail.example/not%20a%20url%20at%20all` 并成功，所以 invalid-url 只在
// 没有 base、且字符串本身不是绝对地址时才出现。内容脚本一律传 location.href 作为 base。
{
  assert.deepEqual(
    Array.from(inspectSideEffectUrl("not a url at all"), String),
    ["invalid-url"],
    "无 base 的非法地址应当报 invalid-url"
  );
  assert.deepEqual(Array.from(inspectSideEffectUrl(""), String), ["invalid-url"]);

  assert.deepEqual(
    reasonsFor("not a url at all"),
    [],
    "给了 baseUrl 时会被解析成相对地址，不该报 invalid-url —— 这不是缺陷，是 URL 语义"
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "one-time credential query keys are blocked (token / otp / *_token / unsubscribe)",
        "action-style query keys match a wider verb list",
        "state-changing path segments are blocked",
        "pre-existing download and side-effect rules still fire",
        "browsable pages that must stay preloadable are documented and allowed",
        "invalid URLs report invalid-url",
      ],
      knownGaps: [
        "/invite/accept/<token> —— 令牌在路径段里，没有可靠的通用形状可识别",
        "/vote/up/42 —— vote 作为可浏览页面路径也常见，未收录",
      ],
    },
    null,
    2
  )
);
