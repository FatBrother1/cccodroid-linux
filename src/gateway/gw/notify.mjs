import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { CFG, LAST_LANG, log, tr, tz } from "./config.mjs";
import { onPublish } from "./bus.mjs";
import { NAMES } from "./sessions.mjs";
import { archivedTitle } from "./archive-store.mjs";
import { loadState, saveState } from "./statefile.mjs";

// ── Linux 桌面通知 ────────────────────────────────────────────────────
// 一轮结束 / 需要用户确认时，窗口不在前台就发一条系统通知（notify-send）。开关沿用安卓版那套接口
// （设置 → 通知：/api/app/notify_status、notify_set）；窗口在不在前台由页面经 notify_focus 汇报。
// 安卓上通知由应用自己发（订阅事件流），这里找不到 notify-send 就整块不启用，设置里也不显示这一项。

const FILE = path.join(CFG.home, "ccapp-notify.json");
const MIN_MS = 10_000;        // 比这更快结束的回复不通知：人多半还在看着
const LEASE_MS = 45_000;      // 页面每 20 秒续一次"在前台"，超过这么久没续就当离开了
const RATE_MAX = 6, RATE_WIN = 60_000;

const state = loadState(FILE, {
  shape: (j) => (j && typeof j === "object" && !Array.isArray(j) ? { done: j.done !== false, ask: j.ask !== false } : undefined),
  fallback: () => ({ done: true, ask: true }),
}).data;

function findBin(name) {
  for (const d of String(process.env.PATH || "").split(":").concat(["/usr/bin", "/usr/local/bin"])) {
    if (!d) continue;
    const f = path.join(d, name);
    try { if (fs.statSync(f).isFile()) { fs.accessSync(f, fs.constants.X_OK); return f; } } catch {}
  }
  return "";
}
const BIN = process.env.CCAPP_NOTIFY_BIN || findBin("notify-send");

let focusUntil = 0;
const away = () => Date.now() > focusUntil;
const RUNS = new Map();       // runId → { sid, text, at }
const ASKED = new Set();
const SENT = [];
let warned = false;
const warnOnce = (m) => { if (!warned) { warned = true; log("桌面通知：" + m); } };

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

function label(sid, text) {
  let n = "";
  try { n = (sid && (NAMES[sid] || archivedTitle(sid))) || ""; } catch {}
  return clip(n || String(text || "").trim().split("\n")[0], 48);
}

const dur = (ms) => { const s = Math.round(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; };

/** kind：done / ask / test。命令和正文不进通知：通知会留在系统的通知历史里，可能夹着密钥 */
function send(kind, title, body) {
  if (!BIN) return false;
  const now = Date.now();
  while (SENT.length && now - SENT[0] > RATE_WIN) SENT.shift();
  if (SENT.length >= RATE_MAX) { warnOnce("通知太密，先丢掉多出来的"); return false; }
  SENT.push(now);
  const args = ["-a", "cccodroid", "-i", "cccodroid", "-c", "cccodroid." + kind, "-h", "string:desktop-entry:cccodroid", "-t", kind === "ask" ? "30000" : "10000", "--", clip(title, 80), esc(String(body).split("\n").slice(0, 3).map((l) => clip(l, 100)).join("\n"))];
  const env = { ...process.env };
  if (!env.DBUS_SESSION_BUS_ADDRESS && env.XDG_RUNTIME_DIR) env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${env.XDG_RUNTIME_DIR}/bus`;
  execFile(BIN, args, { env, timeout: 15_000 }, (e) => { if (e) warnOnce("发不出去：" + (e.code || e.message)); });
  return true;
}

function finished(ev) {
  const r = RUNS.get(ev.runId);
  RUNS.delete(ev.runId);
  if (!state.done || ev.aborted || ev.auto || ev.sched || !away()) return;
  const ms = r ? (ev.at || Date.now()) - r.at : MIN_MS;
  if (!ev.failed && ms < MIN_MS) return;
  const name = label(ev.sessionId || r?.sid, r?.text);
  const took = ms >= 20_000 ? "\n" + tr(LAST_LANG, tz("用时 {d}", { d: dur(ms) })) : "";
  send("done", tr(LAST_LANG, ev.failed ? tz("出错了") : tz("任务完成")), name + took);
}

function asked(ev) {
  if (!state.ask || !away() || !ev.id || ASKED.has(ev.id)) return;
  ASKED.add(ev.id);
  if (ASKED.size > 200) ASKED.delete(ASKED.values().next().value);
  const r = RUNS.get(ev.runId);
  const tool = String(ev.tool || "");
  const title = tool === "ExitPlanMode" ? tz("计划待批准") : tool === "AskUserQuestion" ? tz("Claude 想问你") : tz("需要确认");
  const file = ev.input && typeof ev.input.file_path === "string" ? " " + path.basename(ev.input.file_path) : "";
  send("ask", tr(LAST_LANG, title), [label(ev.sessionId || r?.sid, r?.text), tool && tool !== "ExitPlanMode" && tool !== "AskUserQuestion" ? tool + file : ""].filter(Boolean).join("\n"));
}

function onEvent(ev) {
  try {
    if (ev.type === "run_start") {
      RUNS.set(ev.runId, { sid: ev.sessionId || null, text: ev.text, at: ev.startedAt || Date.now() });
      if (RUNS.size > 200) RUNS.delete(RUNS.keys().next().value);
    } else if (ev.type === "run_end") finished(ev);
    else if (ev.type === "perm_request") asked(ev);
    else if (ev.type === "sched_note" && state.done) send("done", ev.title || tr(LAST_LANG, tz("任务完成")), ev.text || "");
  } catch (e) { warnOnce("处理事件出错：" + e.message); }
}
let started = false;
/** 在 server.mjs 启动时调用：模块互相引用成环，导入时就订阅会撞上 bus.mjs 还没初始化完 */
export function startNotify() {
  if (!BIN || started) return;
  started = true;
  onPublish(onEvent);
}

// ── /api/app/notify_*（devside.mjs 转进来）──
export function notifyStatus() {
  if (!BIN) return { ok: false, message: tz("没有找到 notify-send，桌面通知不可用") };
  return { ok: true, done: state.done, ask: state.ask, system: true, chDone: true, chAsk: true };
}

export function notifySet(b) {
  if (!BIN) return notifyStatus();
  const next = { done: typeof b.done === "boolean" ? b.done : state.done, ask: typeof b.ask === "boolean" ? b.ask : state.ask };
  if (!saveState(FILE, next)) return { ok: false, message: tz("没能保存通知设置") };
  Object.assign(state, next);
  return notifyStatus();
}

export function notifyFocus(b) {
  focusUntil = b.focused === true ? Date.now() + LEASE_MS : 0;
  return { ok: true };
}

export function notifyTest() {
  if (!BIN) return notifyStatus();
  return send("test", "cccodroid", tr(LAST_LANG, tz("这是一条测试通知"))) ? { ok: true } : { ok: false, message: tz("通知没发出去") };
}
