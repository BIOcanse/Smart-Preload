(function () {
  const DOWNLOAD_EXTENSION_SET = new Set([
    "7z",
    "apk",
    "appx",
    "bat",
    "bin",
    "bz2",
    "cmd",
    "crx",
    "deb",
    "dmg",
    "exe",
    "gz",
    "img",
    "iso",
    "jar",
    "msi",
    "msix",
    "pkg",
    "ps1",
    "rar",
    "reg",
    "rpm",
    "sh",
    "tar",
    "tgz",
    "torrent",
    "xpi",
    "xz",
    "zip",
  ]);
  const DOWNLOAD_MIME_HINTS = [
    "application/octet-stream",
    "application/x-msdownload",
    "application/x-msi",
    "application/zip",
    "application/x-7z-compressed",
    "application/x-rar-compressed",
    "application/x-tar",
    "application/gzip",
    "application/vnd.android.package-archive",
    "application/x-apple-diskimage",
  ];
  const DOWNLOAD_PATH_TOKENS = new Set([
    "attachment",
    "attachments",
    "download",
    "downloads",
    "downloadfile",
    "download-file",
    "export",
    "exports",
  ]);
  const SIDE_EFFECT_PATH_TOKENS = new Set([
    "cancel",
    "confirm",
    "delete",
    "destroy",
    "logout",
    "log-out",
    "remove",
    "signout",
    "sign-out",
    "unsubscribe",
    // 以下为 2026-08-02 补充。判据是「GET 这个地址会改变服务端状态」，且作为可浏览页面
    // 路径出现的可能性低。刻意**未**加入的高误报词：archive（大量博客的归档列表页）、
    // subscribe（常见的营销落地页）、login / signin（登录页本身是无害的 GET，真正危险的是
    // 带一次性令牌的那种，由下面的 query key 规则覆盖）、auth / oauth（大量无害路径前缀）。
    "deactivate",
    "revoke",
    "refund",
    "unpublish",
    "reset-password",
    "verify-email",
  ]);
  // 一次性凭据类 query key。此前**只匹配 value 不匹配 key**，于是
  // `/login?token=…`（magic link）、`/verify-email?code=…`、`?unsubscribe=1` 全部放行。
  //
  // 这类链接被预加载会**消耗掉令牌**：用户真去点的时候看到「链接已失效」；magic link
  // 更糟——会话可能建立在隐藏的预加载窗口里。而这个场景完全可达：magic link 从邮件来，
  // 用户在网页版邮箱里打开那封信，该链接就是当前页面上的一个候选链接。
  //
  // 只收高信号名。刻意**未**收录 `code` 和 `key`：`?code=US`、`?key=name` 这类无害用法
  // 太常见，而 OAuth 的 `code` 通常出现在回调地址上，那本就不是页面里的可点链接。
  const SIDE_EFFECT_QUERY_KEYS = new Set([
    "activation",
    "activation_code",
    "activation_token",
    "confirmation",
    "confirmation_code",
    "confirmation_token",
    "invitation_token",
    "invite_token",
    "magic",
    "magic_link",
    "magiclink",
    "one_time_token",
    "onetimetoken",
    "otp",
    "reset_token",
    "token",
    "unsubscribe",
    "verification",
    "verification_code",
    "verification_token",
  ]);
  // 任何以这些后缀结尾的 query key 都按一次性凭据处理（`auth_token`、`csrf-token`、
  // `invite-token` 等各家命名，逐个枚举列不完）。
  const SIDE_EFFECT_QUERY_KEY_SUFFIXES = ["_token", "-token", "_otp", "-otp"];
  // 动作型 query key：这些键的**值**才是动词。此前 url.js 里的 `action` / `method` 两个
  // 子句是前一个「值命中即拦截」子句的**严格子集**，恒不可达；现在改为对这批键单独用
  // 更宽的动词表，`?action=trash` 之类才拦得住。
  const SIDE_EFFECT_ACTION_QUERY_KEYS = new Set(["action", "cmd", "do", "method", "op"]);
  const SIDE_EFFECT_ACTION_VALUES = new Set([
    "activate",
    "approve",
    "archive",
    "cancel",
    "confirm",
    "deactivate",
    "decline",
    "delete",
    "destroy",
    "disable",
    "enable",
    "logout",
    "publish",
    "reject",
    "remove",
    "reset",
    "restore",
    "revoke",
    "signout",
    "trash",
    "unpublish",
    "unsubscribe",
    "verify",
  ]);
  const DOWNLOAD_QUERY_KEYS = new Set([
    "attachment",
    "content-disposition",
    "dl",
    "download",
    "export",
    "file",
    "filename",
    "response-content-disposition",
  ]);
  const SIDE_EFFECT_QUERY_VALUES = new Set([
    "cancel",
    "confirm",
    "delete",
    "destroy",
    "download",
    "export",
    "logout",
    "remove",
    "signout",
    "unsubscribe",
  ]);

  globalThis.ZeroLatencyPreloadSafetyRuleConstants = {
    DOWNLOAD_EXTENSION_SET,
    DOWNLOAD_MIME_HINTS,
    DOWNLOAD_PATH_TOKENS,
    SIDE_EFFECT_PATH_TOKENS,
    DOWNLOAD_QUERY_KEYS,
    SIDE_EFFECT_QUERY_VALUES,
    SIDE_EFFECT_QUERY_KEYS,
    SIDE_EFFECT_QUERY_KEY_SUFFIXES,
    SIDE_EFFECT_ACTION_QUERY_KEYS,
    SIDE_EFFECT_ACTION_VALUES,
  };
})();
