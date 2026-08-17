(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});
  const {
    constants,
    state,
    isPassivePrerenderContext,
    reportAttentionActivityToBackground,
  } = namespace;

  function buildAttentionActivitySnapshot() {
    const observedAtMs = Date.now();
    const mediaPlayback = collectActiveMediaPlayback();

    return {
      pageUrl: location.href,
      observedAt: new Date(observedAtMs).toISOString(),
      documentVisible: document.visibilityState === "visible" && document.hidden !== true,
      prerendering: isPassivePrerenderContext(),
      lastUserInputAt:
        state.lastUserInputAt > 0 ? new Date(state.lastUserInputAt).toISOString() : null,
      lastLinkInteractionAt:
        state.lastLinkInteractionAt > 0
          ? new Date(state.lastLinkInteractionAt).toISOString()
          : null,
      videoPlaybackActive: mediaPlayback.video,
      audioPlaybackActive: mediaPlayback.audio,
    };
  }

  // 节流判定必须留在同步路径上。
  //
  // mousemove / wheel / touchstart 注册在 document 捕获阶段
  // （dom-observer/input-events.js:15-26），Chrome 把它们合并到每帧一次，事件率与刷新率
  // 同阶（60–144 次/秒）；而上报间隔是 1000ms，于是 98%–99% 的调用只是为了走到下面那个
  // return。此前这个判定在 async 的 reportAttentionActivity 内部——调用一个 async 函数，
  // 无论它多快返回，都要为返回值分配一个 Promise 和一个协程帧，随后立刻被 void 丢弃。
  function recordUserInputForAttention() {
    const now = Date.now();
    state.lastUserInputAt = now;

    if (
      now - state.lastAttentionActivityReportedAt <
      constants.ATTENTION_ACTIVITY_MIN_REPORT_INTERVAL_MS
    ) {
      return;
    }

    void reportAttentionActivity();
  }

  function recordLinkInteractionForAttention() {
    const now = Date.now();
    state.lastUserInputAt = now;
    state.lastLinkInteractionAt = now;
    void reportAttentionActivity();
  }

  // 无参数、语义单一：调用即上报。
  //
  // 此前签名是 reportAttentionActivity(options)，接受 throttle 与 force 两个选项。
  // throttle 已上移到唯一的使用方 recordUserInputForAttention；force **从未被函数体读取
  // 过**，却写在 6 个调用点上，读起来像是在绕过节流——那些调用点不被节流其实只是因为它们
  // 没传 throttle。留着它是在埋雷：若哪天把节流改成默认行为，那 6 处会静默地开始被节流，
  // 而字面上仍写着 force: true。
  async function reportAttentionActivity() {
    if (typeof reportAttentionActivityToBackground !== "function") {
      return;
    }

    state.lastAttentionActivityReportedAt = Date.now();
    await reportAttentionActivityToBackground(buildAttentionActivitySnapshot());
  }

  function startAttentionActivityReporter() {
    if (state.attentionActivityTimerId) {
      return;
    }

    void reportAttentionActivity();
    state.attentionActivityTimerId = window.setInterval(() => {
      // 隐藏标签页跳过周期性上报。
      //
      // 后台的 resolveAttentionActivity（preload/scheduler/attention/activity.js:52-58）
      // 对 documentVisible !== true 的观测一律返回 { kind: "hidden", weight: 0 }，
      // 所以隐藏标签的这一发消息**唯一的效果就是唤醒 service worker 来听一句「权重 0」**。
      //
      // 而 MV3 的 service worker 大约空闲 30 秒被回收：每个标签每 15 秒发一次，
      // 两个以上标签打开时平均间隔就低于 30 秒，SW 永远不会被回收。
      //
      // 不会漏掉状态变化：lifecycle-events.js 的 visibilitychange 监听在切换的那一刻
      // 就会立即上报一次。
      if (document.visibilityState !== "visible") {
        return;
      }

      void reportAttentionActivity();
    }, constants.ATTENTION_ACTIVITY_INTERVAL_MS);
  }

  // 一次查询同时得出 video / audio 两个结论。
  //
  // 此前 hasActiveVideoPlayback 与 hasActiveAudioPlayback 各自跑一遍
  // document.querySelectorAll("video,audio")：同一份全文档查询做两次，遍历两次，
  // 而两者的判定条件只差最后比对的 tagName。两者都只在这里被调用。
  function collectActiveMediaPlayback() {
    const mediaElements = document.querySelectorAll("video,audio");
    const MediaElementCtor = globalThis.HTMLMediaElement;
    const playback = {
      video: false,
      audio: false,
    };

    for (const mediaElement of mediaElements) {
      if (playback.video && playback.audio) {
        break;
      }

      if (
        (typeof MediaElementCtor === "function" &&
          !(mediaElement instanceof MediaElementCtor)) ||
        mediaElement.paused !== false ||
        mediaElement.ended !== false ||
        !(mediaElement.readyState > 1)
      ) {
        continue;
      }

      const tagName = mediaElement.tagName?.toLowerCase();

      if (tagName === "video") {
        playback.video = true;
      } else if (tagName === "audio") {
        playback.audio = true;
      }
    }

    return playback;
  }

  Object.assign(namespace, {
    buildAttentionActivitySnapshot,
    recordUserInputForAttention,
    recordLinkInteractionForAttention,
    reportAttentionActivity,
    startAttentionActivityReporter,
  });
})();
