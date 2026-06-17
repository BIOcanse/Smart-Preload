(function () {
  const SENSITIVE_SITE_LIBRARY_VERSION = 1;

  const HOST_SUFFIXES_BY_CATEGORY = Object.freeze({
    banking: Object.freeze([
      "abchina.com",
      "americanexpress.com",
      "bankcomm.com",
      "bankofamerica.com",
      "barclays.co.uk",
      "boc.cn",
      "capitalone.com",
      "ccb.com",
      "cebbank.com",
      "chase.com",
      "cib.com.cn",
      "citibank.com",
      "cmbchina.com",
      "hsbc.com",
      "icbc.com.cn",
      "lloydsbank.com",
      "pnc.com",
      "psbc.com",
      "santander.com",
      "spdb.com.cn",
      "tdbank.com",
      "usbank.com",
      "wellsfargo.com",
    ]),
    exam: Object.freeze([
      "classmarker.com",
      "examity.com",
      "examsoft.com",
      "ets.org",
      "honorlock.com",
      "ielts.org",
      "meazurelearning.com",
      "pearsonvue.com",
      "prometric.com",
      "proctorio.com",
      "proctoru.com",
      "questionmark.com",
      "respondus.com",
      "safeexambrowser.org",
      "testinvite.com",
      "toefl.org",
    ]),
  });

  const HOST_LABEL_TOKENS_BY_CATEGORY = Object.freeze({
    banking: Object.freeze([
      "banc",
      "banco",
      "bank",
      "banka",
      "banking",
      "banque",
      "creditunion",
      "netbanking",
      "onlinebanking",
    ]),
    exam: Object.freeze([
      "assessment",
      "assessments",
      "exam",
      "exams",
      "examsoft",
      "proctor",
      "proctored",
      "proctoring",
      "proctorio",
      "proctoru",
      "quiz",
      "quizzes",
      "testing",
    ]),
  });

  const HOST_LABEL_SUBSTRINGS_BY_CATEGORY = Object.freeze({
    banking: Object.freeze([
      "bank",
      "creditunion",
      "onlinebanking",
    ]),
    exam: Object.freeze([
      "examsoft",
      "honorlock",
      "lockdownbrowser",
      "pearsonvue",
      "prometric",
      "proctorio",
      "proctoru",
      "respondus",
      "safeexambrowser",
      "testinvite",
    ]),
  });

  const PATH_TOKENS_BY_CATEGORY = Object.freeze({
    banking: Object.freeze([
      "bank",
      "banking",
      "netbanking",
      "online-banking",
      "onlinebanking",
      "secure-banking",
      "securebanking",
    ]),
    exam: Object.freeze([
      "assessment",
      "assessments",
      "exam",
      "exams",
      "proctor",
      "proctored",
      "proctoring",
      "quiz",
      "quizzes",
    ]),
  });

  const TEXT_HINTS_BY_CATEGORY = Object.freeze({
    banking: Object.freeze([
      "internet banking",
      "mobile banking",
      "online banking",
      "secure banking",
      "银行",
      "網上銀行",
      "网上银行",
    ]),
    exam: Object.freeze([
      "online exam",
      "online examination",
      "proctored exam",
      "remote proctoring",
      "考试",
      "考試",
      "线上考试",
      "線上考試",
    ]),
  });

  globalThis.ZeroLatencySensitiveSiteRuleConstants = {
    SENSITIVE_SITE_LIBRARY_VERSION,
    HOST_SUFFIXES_BY_CATEGORY,
    HOST_LABEL_TOKENS_BY_CATEGORY,
    HOST_LABEL_SUBSTRINGS_BY_CATEGORY,
    PATH_TOKENS_BY_CATEGORY,
    TEXT_HINTS_BY_CATEGORY,
  };
})();
