// 注入主框架的 CCApp 垫片：同步方法读缓存，其余经 QWebChannel 转给 QML（main.qml 里 id 为 ccapp 的对象）。
// 只在主框架注入（runsOnSubFrames 为 false）；有副作用的方法第一个参数是口令，由 theme.js 的包装自动补上，QML 端逐个校验。
(function () {
  if (window.top !== window || window.CCApp) return;
  if (typeof qt === "undefined" || !qt.webChannelTransport || typeof QWebChannel === "undefined") return;

  var api = null, test = null, queue = [], paneCanBack = false;
  // QWebChannel 按参数个数找方法：少了 / 多了都调不到，统一补齐（含口令共 N 个）
  var ARITY = { openUrl: 2, paneOpen: 2, paneBounds: 5, paneGoBack: 1, paneClose: 1, openBrowser: 2, saveAs: 4 };
  function call(name, args) {
    args = args.slice(0, ARITY[name]);
    while (args.length < ARITY[name]) args.push("");
    if (api) { try { api[name].apply(api, args); } catch (e) {} }
    else if (queue.length < 64) queue.push([name, args]);
  }

  var A = {
    keyed: function () { return true; },
    hasPane: function () { return true; },
    paneCanBack: function () { return paneCanBack; }
  };
  ["openUrl", "paneOpen", "paneBounds", "paneGoBack", "paneClose", "openBrowser", "saveAs"].forEach(function (n) {
    A[n] = function () { call(n, Array.prototype.slice.call(arguments)); };
  });
  window.CCApp = A;

  try {
    new QWebChannel(qt.webChannelTransport, function (ch) {
      api = ch.objects.ccapp;
      if (!api) return;
      paneCanBack = !!api.paneCanBack;
      api.paneCanBackChanged.connect(function () { paneCanBack = !!api.paneCanBack; });
      if (ch.objects.cctest) {
        test = ch.objects.cctest;
        window.__ccTest = {
          cmd: function (n, a) { test.cmd(String(n), a === undefined ? "" : String(a)); },
          state: function () { return test.state; },
          raw: function (n, a) { api[n].apply(api, a); }
        };
      }
      var q = queue; queue = [];
      q.forEach(function (c) { call(c[0], c[1]); });
    });
  } catch (e) {}
})();
