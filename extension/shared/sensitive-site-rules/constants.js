(function () {
  // v2：只按主机名后缀判定，不再做任何「按词猜」。
  //
  // v1 有四套判据：主机名后缀、主机名 label 精确/子串、路径段、以及对
  // anchorText + nearbyText 的文本提示。后三套实测误判率很高，且误判是**静默**的
  // ——用户只会觉得「这些链接怎么不预加载」，看不到原因：
  //
  //   | 场景                              | v1 结果 | 命中的判据            |
  //   |-----------------------------------|---------|-----------------------|
  //   | 讲利率的新闻，链接文字含「银行」  | 拦截    | 文本提示（裸二字词）  |
  //   | 高考经验帖，周围文字含「考试」    | 拦截    | 文本提示（裸二字词）  |
  //   | fairbanksalaska.gov/parks         | 拦截    | 主机名 label 子串 bank|
  //   | burbankca.gov/library             | 拦截    | 主机名 label 子串 bank|
  //   | 英文博客《online banking security》| 拦截    | 文本提示（多词短语）  |
  //
  // 最后一行说明问题不是「中英不对称」——文本提示匹配的是「**在谈论** X 的页面」，
  // 不是「X 本身」，这个方向天然不准。主机名子串也没法用前后缀边界修好：
  // `burbank` 以 `bank` 结尾、`fairbanks` 含 `bank`，两者都躲不掉。
  //
  // 维护者裁定（2026-08-02）：全部删掉，只留主机名后缀白名单，并把名单扩充到位。
  // 代价是名单没覆盖到的站点不再被这套规则拦下——但那本来也只是**预加载**的额外
  // 保险，`skipSensitivePages` 设置项仍可整体关闭，而真正的恶意站点由独立的
  // 本地威胁库（background/security/threat-database.js）负责。
  const SENSITIVE_SITE_LIBRARY_VERSION = 2;

  // 后缀匹配：`isHostSuffixMatch` 要求完全相等或以 `.` + 后缀结尾，
  // 所以 `evil-icbc.com.cn` 不会命中 `icbc.com.cn`。
  const HOST_SUFFIXES_BY_CATEGORY = Object.freeze({
    banking: Object.freeze([
      // —— 中国大陆：国有大行与全国性股份制银行 ——
      "abchina.com",
      "bankcomm.com",
      "bankofbeijing.com.cn",
      "bankofchina.com",
      "boc.cn",
      "bosc.cn",
      "ccb.com",
      "cebbank.com",
      "cgbchina.com.cn",
      "cib.com.cn",
      "citicbank.com",
      "cmbc.com.cn",
      "cmbchina.com",
      "ecitic.com",
      "hxb.com.cn",
      "icbc.com.cn",
      "jsbchina.cn",
      "nbcb.com.cn",
      "pingan.com",
      "psbc.com",
      "spdb.com.cn",
      // —— 港澳台 ——
      "bochk.com",
      "cathaybk.com.tw",
      "ctbcbank.com",
      "esunbank.com.tw",
      "firstbank.com.tw",
      "hangseng.com",
      // —— 美国 ——
      "ally.com",
      "americanexpress.com",
      "bankofamerica.com",
      "capitalone.com",
      "chase.com",
      "citi.com",
      "citibank.com",
      "discover.com",
      "fidelity.com",
      "pnc.com",
      "schwab.com",
      "tdbank.com",
      "truist.com",
      "usbank.com",
      "vanguard.com",
      "wellsfargo.com",
      // —— 加拿大 ——
      "bmo.com",
      "cibc.com",
      "rbcroyalbank.com",
      "scotiabank.com",
      "td.com",
      // —— 英国与欧洲 ——
      "barclays.co.uk",
      "bbva.com",
      "bnpparibas",
      "caixabank.es",
      "commerzbank.de",
      "creditagricole.fr",
      "db.com",
      "deutsche-bank.de",
      "hsbc.co.uk",
      "hsbc.com",
      "ing.com",
      "intesasanpaolo.com",
      "lloydsbank.com",
      "natwest.com",
      "santander.co.uk",
      "santander.com",
      "societegenerale.fr",
      "unicredit.it",
      // —— 澳新 ——
      "anz.com",
      "commbank.com.au",
      "nab.com.au",
      "westpac.com.au",
      // —— 日韩与东南亚 ——
      "dbs.com.sg",
      "hanabank.com",
      "japanpost.jp",
      "kbstar.com",
      "mizuhobank.co.jp",
      "mufg.jp",
      "ocbc.com",
      "shinhan.com",
      "smbc.co.jp",
      "uob.com.sg",
      "wooribank.com",
      // —— 支付与转账 ——
      "alipay.com",
      "paypal.com",
      "revolut.com",
      "stripe.com",
      "tenpay.com",
      "wise.com",
    ]),
    exam: Object.freeze([
      // 在线考试、监考与技术测评平台。刻意**不**收录 Canvas / Blackboard / Moodle
      // 这类 LMS ——它们的绝大多数页面是普通课程内容，整站拦掉损失太大。
      "classmarker.com",
      "codility.com",
      "ets.org",
      "examity.com",
      "examsoft.com",
      "gradescope.com",
      "hackerrank.com",
      "honorlock.com",
      "ielts.org",
      "meazurelearning.com",
      "mettl.com",
      "neea.edu.cn",
      "pearsonvue.com",
      "prometric.com",
      "proctorio.com",
      "proctortrack.com",
      "proctoru.com",
      "questionmark.com",
      "respondus.com",
      "safeexambrowser.org",
      "talview.com",
      "testgorilla.com",
      "testinvite.com",
      "toefl.org",
      "verificient.com",
    ]),
  });

  globalThis.ZeroLatencySensitiveSiteRuleConstants = {
    SENSITIVE_SITE_LIBRARY_VERSION,
    HOST_SUFFIXES_BY_CATEGORY,
  };
})();
