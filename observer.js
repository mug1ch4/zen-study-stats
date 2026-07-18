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
  // 完了/提出の URL パターン:
  //   動画:   PUT  .../n_school/courses/{c}/chapters/{ch}/movies/{id}/progress/passed（HAR実測）
  //   テスト: POST .../n_school/courses/{c}/chapters/{ch}/evaluation_tests/{id}/answerings（HAR実測）
  //   別系統: POST .../material/courses/{c}/chapters/{ch}/essay_tests/{id}/answerings（本家バンドルに存在）
  //           PUT  .../material/{type}/{id}/progress ・ POST .../material/exercises/{id}/answers（同上）
  //   ※material 系の取りこぼしが「今日の目標の反映が遅い」原因になり得るため全系統を観測する。
  var RE = /\/(?:n_school|material)\/courses\/(\d+)\/chapters\/(\d+)\/([a-z_]+)\/(\d+)\/(?:progress\/passed|answerings)\b/i;
  var RE2 = /\/material\/([a-z_]+)\/(\d+)\/(?:progress|answers)\b/i;
  function report(method, url) {
    try {
      if (!/^(PUT|POST)$/i.test(method || '')) return;
      var u = String(url || '');
      // 完了PUTは教材iframe内から送られるため、トップフレームの content.js へ通知する
      // （iframe と top は同一オリジン www.nnn.ed.nico）。top 不在時は自分へ。
      // resource(movies/evaluation_tests/…)とidは所要時間の実測（教科別の分/問）に使う。
      var target = window.top || window;
      var m = u.match(RE);
      if (m) {
        target.postMessage({ __zss: 'completion', courseId: m[1], chapterId: m[2], resource: m[3], resourceId: m[4] }, '*');
        return;
      }
      var m2 = u.match(RE2);
      if (m2) {
        // course/chapter がURLに無い系統。集計トリガーとしては十分（settle側は passed 増分で確定）。
        target.postMessage({ __zss: 'completion', courseId: '', chapterId: '', resource: m2[1], resourceId: m2[2] }, '*');
      }
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
          if (/^(PUT|POST)$/i.test(method) && (RE.test(url || '') || RE2.test(url || '')) && p && typeof p.then === 'function') {
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
        if (/^(PUT|POST)$/i.test(xhr.__zssM || '') && (RE.test(xhr.__zssU || '') || RE2.test(xhr.__zssU || ''))) {
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
