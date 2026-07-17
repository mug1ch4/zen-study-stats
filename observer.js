// ZEN Study 学習統計 — 完了検知オブザーバ（MAIN world / manifest から world:"MAIN" で注入）。
// 【第一原則】観測のみ。本家が送る完了記録リクエストを"見る"だけで、我々は一切送信しない。
// 動画完了時に本家は PUT .../movies/{id}/progress/passed を送る（HAR実測）。これを検知し、
// window.postMessage で ISOLATED 側（content.js）へ通知する。fetch/XHR は必ず原関数を通す。
(function () {
  try {
    if (window.__zssObs) return;
    window.__zssObs = 1;
  } catch (e) {
    return;
  }
  // 完了/提出の URL パターン（HAR実測）:
  //   動画: PUT  .../n_school/courses/{c}/chapters/{ch}/movies/{id}/progress/passed
  //   テスト: POST .../n_school/courses/{c}/chapters/{ch}/evaluation_tests/{id}/answerings
  //   （レポート等の answerings 系も同形と想定）
  var RE = /\/n_school\/courses\/(\d+)\/chapters\/(\d+)\/[a-z_]+\/(\d+)\/(?:progress\/passed|answerings)\b/i;
  function report(method, url) {
    try {
      if (!/^(PUT|POST)$/i.test(method || '')) return;
      var m = String(url || '').match(RE);
      if (!m) return;
      // 完了PUTは教材iframe内から送られるため、トップフレームの content.js へ通知する
      // （iframe と top は同一オリジン www.nnn.ed.nico）。top 不在時は自分へ。
      var target = window.top || window;
      target.postMessage({ __zss: 'completion', courseId: m[1], chapterId: m[2] }, '*');
    } catch (e) {
      /* noop */
    }
  }
  // fetch を包む（成功時のみ通知）。失敗しても必ず原 fetch を返す。
  try {
    var of = window.fetch;
    if (typeof of === 'function') {
      window.fetch = function (input, init) {
        var p = of.apply(this, arguments);
        try {
          var url = typeof input === 'string' ? input : input && input.url;
          var method = (init && init.method) || (input && typeof input !== 'string' && input.method) || 'GET';
          if (/^(PUT|POST)$/i.test(method) && RE.test(url || '') && p && typeof p.then === 'function') {
            p.then(function (r) { if (r && r.ok) report(method, url); }).catch(function () {});
          }
        } catch (e) {
          /* noop */
        }
        return p;
      };
    }
  } catch (e) {
    /* noop */
  }
  // 起動確認ハンドシェイク: content.js からの ping に応答する（observer が生きている証明）。
  try {
    window.addEventListener('message', function (e) {
      try {
        if (e && e.data && e.data.__zss === 'ping') {
          (window.top || window).postMessage({ __zss: 'observer-ready' }, '*');
        }
      } catch (err) { /* noop */ }
    });
  } catch (e) { /* noop */ }

  // XMLHttpRequest を包む（loadend で 2xx のみ通知）。
  try {
    var oOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      try { this.__zssM = method; this.__zssU = url; } catch (e) { /* noop */ }
      return oOpen.apply(this, arguments);
    };
    var oSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function () {
      try {
        var xhr = this;
        if (/^(PUT|POST)$/i.test(xhr.__zssM || '') && RE.test(xhr.__zssU || '')) {
          xhr.addEventListener('loadend', function () {
            if (xhr.status >= 200 && xhr.status < 300) report(xhr.__zssM, xhr.__zssU);
          });
        }
      } catch (e) {
        /* noop */
      }
      return oSend.apply(this, arguments);
    };
  } catch (e) {
    /* noop */
  }
})();
