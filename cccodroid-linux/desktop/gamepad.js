// 游戏模式（--kiosk）下把手柄映射成滚动和按键：摇杆 / 十字键滚动，A=Enter，B=Escape，LB/RB=翻页，Y=聚焦输入框。
// 没接手柄时不跑任何定时器：Chromium 在第一次按键后才触发 gamepadconnected。
(function () {
  if (!window.__ccKiosk || window.__ccGamepad) return;
  window.__ccGamepad = true;

  var DEAD = 0.25, SPEED = 1400, timer = 0, last = 0, held = {};
  var CLICKABLE = "a[href],button,summary,select,label,[role=button],[role=tab],[role=menuitem],input[type=checkbox],input[type=radio],input[type=button],input[type=submit]";

  function pads() {
    try { return Array.prototype.filter.call(navigator.getGamepads() || [], Boolean); } catch (e) { return []; }
  }
  function scrollableY(el) {
    var s = getComputedStyle(el);
    return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1;
  }
  function scrollableX(el) {
    var s = getComputedStyle(el);
    return /(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1;
  }
  function target(horizontal) {
    var ok = horizontal ? scrollableX : scrollableY;
    var el = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    if (!el) el = document.elementFromPoint(Math.round(innerWidth / 2), Math.round(innerHeight / 2));
    while (el && el !== document.documentElement) {
      if (el.nodeType === 1 && ok(el)) return el;
      el = el.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }
  function scrollBy(dx, dy) {
    if (dy) target(false).scrollTop += dy;
    if (dx) target(true).scrollLeft += dx;
  }
  function key(type, k, code, num) {
    var el = document.activeElement || document.body;
    el.dispatchEvent(new KeyboardEvent(type, { key: k, code: code, keyCode: num, which: num, bubbles: true, cancelable: true }));
  }
  function press(k, code, num) { key("keydown", k, code, num); key("keyup", k, code, num); }

  function confirm() {
    var el = document.activeElement;
    if (el && el !== document.body && el.matches && el.matches(CLICKABLE)) { el.click(); return; }
    press("Enter", "Enter", 13);
  }
  function focusInput() {
    var el = document.getElementById("input") || document.querySelector("textarea,input[type=text]");
    if (el) el.focus();
  }
  function page(dir) {
    var t = target(false);
    t.scrollTop += dir * Math.max(120, Math.round((t === document.scrollingElement ? innerHeight : t.clientHeight) * 0.85));
  }

  function edge(id, down, fn) {
    if (down && !held[id]) fn();
    held[id] = down;
  }

  function tick() {
    var ps = pads();
    if (!ps.length) { clearInterval(timer); timer = 0; return; }
    var now = performance.now(), dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // 只认标准映射（Steam 输入给游戏的虚拟 Xbox 手柄就是）；别的手柄按键序号不可靠，不去猜
    var p = ps.filter(function (g) { return g.mapping === "standard"; })[0];
    if (!p) return;
    var b = p.buttons || [], ax = p.axes || [];
    var pressed = function (i) { return !!(b[i] && b[i].pressed); };
    var dx = (pressed(15) ? 1 : 0) - (pressed(14) ? 1 : 0);
    var dy = (pressed(13) ? 1 : 0) - (pressed(12) ? 1 : 0);
    var lx = ax[0] || 0, ly = ax[1] || 0;
    if (Math.abs(lx) > DEAD) dx = Math.sign(lx) * (Math.abs(lx) - DEAD) / (1 - DEAD);
    if (Math.abs(ly) > DEAD) dy = Math.sign(ly) * (Math.abs(ly) - DEAD) / (1 - DEAD);
    if (dx || dy) scrollBy(dx * SPEED * dt * 0.6, dy * SPEED * dt);
    edge("a", pressed(0), confirm);
    edge("b", pressed(1), function () { press("Escape", "Escape", 27); });
    edge("y", pressed(3), focusInput);
    edge("lb", pressed(4), function () { page(-1); });
    edge("rb", pressed(5), function () { page(1); });
  }

  function start() {
    if (timer) return;
    last = performance.now();
    timer = setInterval(tick, 16);
  }
  addEventListener("gamepadconnected", start);
  if (pads().length) start();
})();
