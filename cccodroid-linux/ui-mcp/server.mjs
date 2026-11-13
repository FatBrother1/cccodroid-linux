#!/usr/bin/env node
// cccodroid 页面操控 MCP（stdio）：把 Qt WebEngine 里的页面当成「屏幕」，
// 读编号元素、点按、输入、滚动、按键、打开网址、截图。编号只在一次读屏内有效（和 DSH Go 的手机操控同一套语义）。
//
// 运行前提：原生窗口在跑（cccodroid open）。窗口启动时会把自己的 CDP 端口写进
// ${XDG_RUNTIME_DIR:-<前缀>/run}/cccodroid-cdp.json；本程序只连 127.0.0.1 的这个端口。
// 协议：MCP stdio（每行一条 JSON-RPC）；诊断信息只写 stderr，绝不写 stdout。
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const VERSION_DIR = path.resolve(path.dirname(SELF), "..");
const PREFIX = path.resolve(VERSION_DIR, "..", "..");
const CDP_FILE = process.env.CCCODROID_CDP_FILE ||
  path.join(process.env.XDG_RUNTIME_DIR || path.join(PREFIX, "run"), "cccodroid-cdp.json");
const VERSION = (() => { try { return fs.readFileSync(path.join(VERSION_DIR, "VERSION"), "utf8").trim(); } catch { return "0"; } })();
const log = (s) => { try { process.stderr.write(`[ccui] ${s}\n`); } catch {} };

function readCdpPort() {
  let j;
  try { j = JSON.parse(fs.readFileSync(CDP_FILE, "utf8")); }
  catch { throw new Error("原生窗口没在运行（找不到 " + CDP_FILE + "）。先运行 cccodroid open，或告诉我你要操作哪个页面。"); }
  const port = Number(j && j.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("窗口的调试端口文件不对：" + CDP_FILE);
  return port;
}

function httpGetJson(url, timeout = 4000) {
  return new Promise((res, rej) => {
    const req = http.get(url, { timeout }, (r) => {
      let b = "";
      r.setEncoding("utf8");
      r.on("data", (c) => (b += c));
      r.on("end", () => { try { res(JSON.parse(b)); } catch (e) { rej(new Error("CDP 返回的不是 JSON")); } });
    });
    req.on("timeout", () => req.destroy(new Error("连不上窗口的调试端口（窗口可能刚关）")));
    req.on("error", rej);
  });
}

const redactUrl = (u) => String(u || "").replace(/([?&]t=)[^&]*/g, "$1…");

async function listTargets() {
  const port = readCdpPort();
  const all = await httpGetJson(`http://127.0.0.1:${port}/json`);
  const pages = (Array.isArray(all) ? all : []).filter((t) => t.type === "page" && !/^devtools/.test(t.url));
  return pages.map((t, i) => ({ n: i + 1, id: t.id, title: t.title || "", url: redactUrl(t.url), ws: t.webSocketDebuggerUrl }));
}

function pickTarget(targets, want) {
  if (!want) return targets[0] || null;
  const s = String(want);
  return targets.find((t) => t.id === s) ||
    targets.find((t) => String(t.n) === s) ||
    targets.find((t) => t.url.includes(s) || t.title.includes(s)) || null;
}

class Cdp {
  constructor(wsUrl) { this.ws = new WebSocket(wsUrl); this.id = 0; this.pending = new Map(); this.ready = new Promise((r, j) => { this.ws.onopen = r; this.ws.onerror = () => j(new Error("连不上页面调试通道")); }); this.ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.rej(new Error(m.error.message || "CDP 错误")) : p.res(m.result); } }; }
  call(method, params = {}) { return new Promise((res, rej) => { const i = ++this.id; this.pending.set(i, { res, rej }); this.ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (this.pending.has(i)) { this.pending.delete(i); rej(new Error("CDP 超时：" + method)); } }, 15000); }); }
  close() { try { this.ws.close(); } catch {} }
}

async function evalIn(cdp, expr) {
  const r = await cdp.call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error("页面脚本出错：" + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text || "").slice(0, 300));
  return r.result ? r.result.value : undefined;
}

const SNAPSHOT_JS = `(() => {
  const sels = 'a[href],button,input,textarea,select,[role=button],[role=link],[role=checkbox],[role=switch],[role=tab],[role=menuitem],[contenteditable="true"],[tabindex]:not([tabindex="-1"])';
  const vis = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.top < innerHeight * 2; };
  const els = [...document.querySelectorAll(sels)].filter(vis);
  const token = Math.random().toString(16).slice(2, 10);
  const lines = [], rects = [];
  els.forEach((el, i) => {
    const id = i + 1; el.setAttribute('data-ccui-id', token + '-' + id);
    const role = el.getAttribute('role') || el.tagName.toLowerCase();
    const t = el.getAttribute('type');
    const name = (el.getAttribute('aria-label') || el.placeholder || el.getAttribute('title') || el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 50);
    const cur = (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? String(el.value || '') : (el.isContentEditable ? String(el.innerText || '') : '');
    let label = name;
    if (cur) label += (label ? ' ' : '') + '值=' + cur.slice(0, 40);
    if (t) label += ' <' + t + '>';
    lines.push('[' + id + '] ' + role + ' ' + JSON.stringify(label) + (el.disabled ? ' disabled' : ''));
    const r = el.getBoundingClientRect();
    rects.push({ id, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
  });
  window.__ccui = { token, rects };
  return { token, count: els.length, title: document.title, url: location.href,
    text: (document.body ? document.body.innerText : '').slice(0, 6000), lines: lines.slice(0, 400) };
})()`;

const FIND_JS = (token, id) => `(() => {
  const el = document.querySelector('[data-ccui-id="${token}-${id}"]');
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
    tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || '', text: (el.innerText || el.value || '').slice(0, 80),
    disabled: !!el.disabled, editable: el.isContentEditable || ['input','textarea','select'].includes(el.tagName.toLowerCase()) };
})()`;

const SENSITIVE = /(删除|清空|移除|退出登录|注销|支付|付款|购买|充值|解绑|重置)/;

async function mouseClick(cdp, x, y, long = false) {
  const base = { x, y, button: "left", clickCount: 1 };
  await cdp.call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", ...base });
  if (long) await new Promise((r) => setTimeout(r, 650));
  await cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", ...base });
}

const KEYS = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Escape: { code: "Escape", keyCode: 27 },
  Tab: { code: "Tab", keyCode: 9 },
  Backspace: { code: "Backspace", keyCode: 8 },
  Delete: { code: "Delete", keyCode: 46 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 }, ArrowDown: { code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 }, ArrowRight: { code: "ArrowRight", keyCode: 39 },
  PageUp: { code: "PageUp", keyCode: 33 }, PageDown: { code: "PageDown", keyCode: 34 },
  Home: { code: "Home", keyCode: 36 }, End: { code: "End", keyCode: 35 },
};

async function pressKey(cdp, name) {
  const k = KEYS[name];
  if (!k) throw new Error("不支持的按键：" + name + "（可用：" + Object.keys(KEYS).join(" ") + "）");
  await cdp.call("Input.dispatchKeyEvent", { type: "keyDown", key: k.code, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode, ...(k.text ? { text: k.text } : {}) });
  await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", key: k.code, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode });
}

async function openCdp(targetWant) {
  const targets = await listTargets();
  if (!targets.length) throw new Error("窗口里没有可操作的页面");
  const t = pickTarget(targets, targetWant);
  if (!t) throw new Error("找不到这个页面；先调 pages 看有哪些");
  const cdp = new Cdp(t.ws);
  await cdp.ready;
  return { cdp, target: t, targets };
}

const TOOLS = [
  { name: "pages", description: "列出窗口里的页面（主界面、浏览器窗格）。target 参数可以用这里的编号或 id。", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "screen", description: "读当前页面：每行一个可点/可输入的元素，[编号] 只在本屏有效。返回 screen（本屏号，后续 tap/type/scroll 要带上）和页面文字。detail:true 附坐标；image:true 附截图。", inputSchema: { type: "object", properties: { target: { type: "string", description: "页面编号或 id，省略=第一个页面" }, detail: { type: "boolean", description: "附元素坐标" }, image: { type: "boolean", description: "附当前页面截图" } }, additionalProperties: false } },
  { name: "tap", description: "点一个元素，返回新屏幕。敏感按钮（删除/支付等）要先问用户，再用 confirm:true 重点。", inputSchema: { type: "object", properties: { screen: { type: "string", description: "上一步 screen 返回的屏号" }, id: { type: "integer", description: "元素编号" }, long: { type: "boolean", description: "长按" }, confirm: { type: "boolean", description: "用户已确认敏感操作" }, target: { type: "string" } }, required: ["screen", "id"], additionalProperties: false } },
  { name: "type", description: "在输入框里输入文字（替换原内容）。submit:true 后按回车提交。密码框不代填，遇到就请用户自己输入。", inputSchema: { type: "object", properties: { screen: { type: "string" }, id: { type: "integer" }, text: { type: "string" }, submit: { type: "boolean" }, target: { type: "string" } }, required: ["screen", "id", "text"], additionalProperties: false } },
  { name: "scroll", description: "滚动页面或某个列表，返回新屏幕。id 省略时滚整页。", inputSchema: { type: "object", properties: { screen: { type: "string" }, id: { type: "integer" }, direction: { type: "string", enum: ["up", "down", "left", "right"] }, target: { type: "string" } }, required: ["screen", "direction"], additionalProperties: false } },
  { name: "key", description: "按键：Enter/Escape/Tab/Backspace/Delete/方向键/PageUp/PageDown/Home/End；browser:\"back\"/\"forward\"/\"reload\" 管页面历史。返回新屏幕。", inputSchema: { type: "object", properties: { screen: { type: "string" }, key: { type: "string" }, browser: { type: "string", enum: ["back", "forward", "reload"] }, target: { type: "string" } }, additionalProperties: false } },
  { name: "open", description: "让当前页面打开一个网址（http/https）。返回新屏幕。", inputSchema: { type: "object", properties: { url: { type: "string" }, target: { type: "string" } }, required: ["url"], additionalProperties: false } },
  { name: "screenshot", description: "给页面截一张图（PNG）。", inputSchema: { type: "object", properties: { target: { type: "string" }, full: { type: "boolean", description: "整页（默认只截可见区域）" } }, additionalProperties: false } },
  { name: "wait", description: "等页面出现某段文字或某个元素（动态加载、提交后跳转时用），超时返回提示。", inputSchema: { type: "object", properties: { text: { type: "string", description: "页面里要出现的文字" }, selector: { type: "string", description: "要出现的 CSS 选择器" }, timeout: { type: "integer", description: "最多等多少毫秒，默认 5000，最大 30000" }, target: { type: "string" } }, additionalProperties: false } },
];

const TOOL_NAME = new Set(TOOLS.map((t) => t.name));

async function snapshotText(cdp, { detail = false, image = false } = {}) {
  const s = await evalIn(cdp, SNAPSHOT_JS);
  const head = `screen: ${s.token}\n页面：${s.title || "(无标题)"} · ${redactUrl(s.url)}\n元素 ${s.count} 个：`;
  const body = s.lines.length ? s.lines.join("\n") : "(没有可点/可输入的元素；下面是页面文字)";
  let out = head + "\n" + body;
  if (detail) out += "\n\n坐标：" + JSON.stringify((s.lines || []).length ? await evalIn(cdp, `(() => (window.__ccui && window.__ccui.rects) || [])()`) : []);
  out += "\n\n页面文字：\n" + (s.text || "(空)");
  const content = [{ type: "text", text: out.slice(0, 20000) }];
  if (image) {
    const shot = await cdp.call("Page.captureScreenshot", { format: "png" });
    content.push({ type: "image", data: shot.data, mimeType: "image/png" });
  }
  return { content, screen: s.token };
}

const needScreen = (args, token) => {
  if (!args.screen) throw new Error("缺少 screen 参数：先调 screen 读屏");
  if (!/^[0-9a-f]{8}$/.test(String(args.screen))) throw new Error("screen 参数不对：用上一步 screen 返回的屏号");
};

async function runTool(name, args) {
  if (!TOOL_NAME.has(name)) throw new Error("没有这个工具：" + name);
  if (name === "pages") {
    const t = await listTargets();
    return { content: [{ type: "text", text: t.length ? t.map((x) => `[${x.n}] ${x.title || "(无标题)"} · ${x.url}`).join("\n") : "窗口里没有页面" }] };
  }
  if (name === "open") {
    const u = String(args.url || "");
    if (!/^https?:\/\//i.test(u)) throw new Error("只支持 http/https 网址");
    const { cdp } = await openCdp(args.target);
    try { await cdp.call("Page.navigate", { url: u }); await new Promise((r) => setTimeout(r, 1200)); return await snapshotText(cdp); }
    finally { cdp.close(); }
  }
  if (name === "screenshot") {
    const { cdp } = await openCdp(args.target);
    try {
      const params = { format: "png" };
      if (args.full) { const m = await cdp.call("Page.getLayoutMetrics"); const cs = m.cssContentSize || m.contentSize; await cdp.call("Emulation.setDeviceMetricsOverride", { width: Math.ceil(cs.width), height: Math.ceil(cs.height), deviceScaleFactor: 1, mobile: false }); }
      const shot = await cdp.call("Page.captureScreenshot", params);
      if (args.full) await cdp.call("Emulation.clearDeviceMetricsOverride");
      return { content: [{ type: "image", data: shot.data, mimeType: "image/png" }] };
    } finally { cdp.close(); }
  }
  const { cdp } = await openCdp(args.target);
  try {
    if (name === "wait") {
      const text = String(args.text || "");
      const sel = String(args.selector || "");
      if (!text && !sel) throw new Error("text 和 selector 至少给一个");
      const limit = Math.min(30000, Math.max(500, Number(args.timeout) || 5000));
      const started = Date.now();
      const expr = `(() => { const t = ${JSON.stringify(text)}, s = ${JSON.stringify(sel)};
        const okText = !t || (document.body && document.body.innerText.includes(t));
        let okSel = true; try { okSel = !s || !!document.querySelector(s); } catch { okSel = false; }
        return okText && okSel; })()`;
      while (Date.now() - started < limit) {
        if (await evalIn(cdp, expr)) return await snapshotText(cdp);
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error(`等了 ${limit} 毫秒还没出现（${text || sel}），可以先 screen 看看现在是什么`);
    }
    if (name === "screen") return await snapshotText(cdp, { detail: !!args.detail, image: !!args.image });

    needScreen(args);
    if (name === "tap") {
      const id = Number(args.id);
      const el = await evalIn(cdp, FIND_JS(String(args.screen), id));
      if (!el) throw new Error("没有编号 " + id + "（编号只在一次读屏内有效，重新 screen）");
      if (SENSITIVE.test(el.text) && !args.confirm) {
        return { content: [{ type: "text", text: `这是敏感操作（「${el.text}」）。先向用户确认；用户同意后带 confirm:true 再点一次。` }], isError: false };
      }
      await mouseClick(cdp, el.x, el.y, !!args.long);
      await new Promise((r) => setTimeout(r, 500));
      return await snapshotText(cdp);
    }
    if (name === "type") {
      const id = Number(args.id);
      const el = await evalIn(cdp, FIND_JS(String(args.screen), id));
      if (!el) throw new Error("没有编号 " + id + "（重新读屏）");
      if (!el.editable) throw new Error("编号 " + id + " 不是输入框，改用 tap");
      if (el.type === "password") return { content: [{ type: "text", text: "密码框不代填：请用户自己输入密码，然后你再继续。" }] };
      await mouseClick(cdp, el.x, el.y);
      const want = String(args.text);
      // 先全选，insertText 就是替换而不是追加（和工具说明一致）
      await evalIn(cdp, "(() => { const a=document.activeElement; if(!a) return false; if (a.select) a.select(); else { const r=document.createRange(); r.selectNodeContents(a); const s=getSelection(); s.removeAllRanges(); s.addRange(r); } return true; })()");
      await cdp.call("Input.insertText", { text: want });
      // 个别 WebEngine 版本里 insertText 到位了却不触发输入框的 value 更新：回读一次，不对就用原生 setter 补
      const got = await evalIn(cdp, "(() => { const a=document.activeElement; return a ? (a.value !== undefined ? String(a.value) : (a.innerText || '')) : null; })()");
      if (got !== want) {
        await evalIn(cdp, `(() => { const el = document.activeElement; if (!el) return false;
          if (el.isContentEditable) { el.textContent = ${JSON.stringify(want)}; }
          else { const proto = Object.getPrototypeOf(el); const d = Object.getOwnPropertyDescriptor(proto, "value"); if (d && d.set) d.set.call(el, ${JSON.stringify(want)}); else el.value = ${JSON.stringify(want)}; }
          el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
      }
      if (args.submit) { await pressKey(cdp, "Enter"); await new Promise((r) => setTimeout(r, 600)); }
      return await snapshotText(cdp);
    }
    if (name === "scroll") {
      let x = 200, y = 200;
      if (args.id !== undefined) {
        const el = await evalIn(cdp, FIND_JS(String(args.screen), Number(args.id)));
        if (!el) throw new Error("没有编号 " + args.id + "（重新读屏）");
        x = el.x; y = el.y;
      } else {
        const vp = await evalIn(cdp, "({x: Math.round(innerWidth/2), y: Math.round(innerHeight/2)})");
        x = vp.x; y = vp.y;
      }
      const d = { up: [0, -600], down: [0, 600], left: [-600, 0], right: [600, 0] }[String(args.direction)];
      if (!d) throw new Error("direction 只能是 up/down/left/right");
      await cdp.call("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: d[0], deltaY: d[1] });
      await new Promise((r) => setTimeout(r, 400));
      return await snapshotText(cdp);
    }
    if (name === "key") {
      if (args.browser) {
        const v = String(args.browser);
        if (v === "back") await cdp.call("Page.navigateToHistoryEntry", { entryId: (await (async () => { const h = await cdp.call("Page.getNavigationHistory"); return h.currentIndex > 0 ? h.entries[h.currentIndex - 1].id : -1; })()) }).catch(async () => { await evalIn(cdp, "history.back(); 1"); });
        else if (v === "forward") { const h = await cdp.call("Page.getNavigationHistory"); if (h.currentIndex + 1 < h.entries.length) await cdp.call("Page.navigateToHistoryEntry", { entryId: h.entries[h.currentIndex + 1].id }); }
        else if (v === "reload") await cdp.call("Page.reload", {});
        else throw new Error("browser 只能是 back/forward/reload");
        await new Promise((r) => setTimeout(r, 800));
        return await snapshotText(cdp);
      }
      if (!args.key) throw new Error("缺少 key");
      await pressKey(cdp, String(args.key));
      await new Promise((r) => setTimeout(r, 400));
      return await snapshotText(cdp);
    }
    throw new Error("没实现的工具：" + name);
  } finally { cdp.close(); }
}

// ── MCP stdio ─────────────────────────────────────────────────────────
let buf = "";
const send = (msg) => { process.stdout.write(JSON.stringify(msg) + "\n"); };
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    try {
      if (m.method === "initialize") {
        reply(m.id, {
          protocolVersion: (m.params && m.params.protocolVersion) || "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "ccui", version: VERSION },
        });
      } else if (m.method === "notifications/initialized") {
        // 通知，不用回
      } else if (m.method === "ping") {
        reply(m.id, {});
      } else if (m.method === "tools/list") {
        reply(m.id, { tools: TOOLS });
      } else if (m.method === "tools/call") {
        const name = m.params && m.params.name;
        const args = (m.params && m.params.arguments) || {};
        try {
          const r = await runTool(name, args);
          reply(m.id, r);
        } catch (e) {
          reply(m.id, { content: [{ type: "text", text: String(e.message || e) }], isError: true });
        }
      } else if (m.id !== undefined) {
        fail(m.id, -32601, "method not found: " + m.method);
      }
    } catch (e) {
      log("处理 " + m.method + " 出错：" + (e && e.message || e));
      if (m.id !== undefined) fail(m.id, -32603, String(e && e.message || e));
    }
  }
});
log(`ccui ${VERSION} 已启动，CDP 文件 ${CDP_FILE}`);
