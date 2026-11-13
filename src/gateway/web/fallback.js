// app.js 自身没加载出来时的兜底：5 秒后把状态行改成可点的重试提示（CSP 不允许内联脚本，见 http.mjs）
  // app.js 自身没加载出来（网关正在重启、静态文件缺失、脚本早退）时，静态壳会一直停在「连接中…」。
  // 5 秒后还没看到 app 挂出的 window.__cc，就把状态行改成可点的重试提示（#182 S-02 网页端半）
  setTimeout(function () {
    if (window.__cc) return;
    var el = document.getElementById("sub-title");
    if (!el) return;
    var msg = "界面脚本没能加载，点这里重试";
    el.textContent = (window.I18N && I18N.t) ? I18N.t(msg) : msg;
    el.className = "err";
    el.style.cursor = "pointer";
    el.onclick = function () { location.reload(); };
  }, 5000);
