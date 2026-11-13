import fs from "node:fs";
import path from "node:path";
import { CFG, PATHS, log, tz } from "./config.mjs";
import { readLedger } from "./claude.mjs";
import { NEXT, readBody, sendJson } from "./http.mjs";
import { isInjected } from "./integrity.mjs";
import { isObj, loadState, saveState, writeAtomic } from "./statefile.mjs";
import { onShutdown } from "./crashguard.mjs";

// ── 使用统计：每条发给 Claude 的消息、每轮回复、工具调用、token，按 UTC 小时分桶记下来 ──
// 键是「1970 年起第几个小时」，前端按本地时区自己汇总成日 / 周 / 月（换时区也不乱）。
// since：开始实时记录的时刻；它之前的小时可以从历史会话补算（imported 记补算时间，null = 还没补过）。
// 桶：m 消息数、t 回复轮数、tl 工具调用、i 输入 token（含缓存）、o 输出 token、s 当时用过的会话、md 各模型的轮数；x = 补算来的
//     （0.3.13 起）c 读缓存的输入 token（i 的一部分，算缓存命中）、mt 各模型的 token（i+o）、st 各会话的 token（i+o，用量页「最费的对话」）
const USAGE_FILE = path.join(CFG.home, "ccapp-usage.json");
const usageDefault = () => ({ v: 1, since: Date.now(), imported: null, off: false, hours: {} });
const USAGE = usageDefault();
let USAGE_UNREADABLE = false, USAGE_WARNED = false;
// hours 必须是普通对象：是数组/字符串时 usageAdd 会往它身上写属性，在 stdout data 回调里把网关带走（P1-14）。
// 语法坏、形状不对一律留底成 .bad-* 再按默认值起（195-Z.2；以前解析失败不加保护，下一次 5 秒防抖就把原文件盖了）
const usageShape = (j) => {
  if (!isObj(j)) return undefined;
  if (j.hours !== undefined && !isObj(j.hours)) return undefined;
  const u = { ...j, hours: j.hours || {} };
  for (const [k, b] of Object.entries(u.hours)) if (!/^\d+$/.test(k) || !isObj(b)) delete u.hours[k];
  u.since = Number.isFinite(+u.since) ? +u.since : Date.now();
  u.imported = Number.isFinite(+u.imported) ? +u.imported : null;
  u.off = !!u.off;
  u.v = +u.v || 1;
  return u;
};
{
  let st = null; try { st = fs.lstatSync(USAGE_FILE); } catch {}
  // 文件在但读不了（不是普通文件 / 太大）：别用默认值把它覆盖掉
  if (st && (!st.isFile() || st.size > (8 << 20))) USAGE_UNREADABLE = true;
  else Object.assign(USAGE, loadState(USAGE_FILE, { shape: usageShape, fallback: usageDefault, max: 8 << 20 }).data);
}
let usageTimer = null;
function usageWrite() {
  if (USAGE_UNREADABLE) { if (!USAGE_WARNED) { USAGE_WARNED = true; log("使用统计文件读不了，暂停写盘，避免覆盖原文件"); } return false; }
  return saveState(USAGE_FILE, USAGE, { pretty: false });
}
/** now=true 立即写（返回是否写成）；否则 5 秒防抖（返回 true 只表示已排上） */
function usageSave(now) {
  clearTimeout(usageTimer); usageTimer = null;
  if (now) return usageWrite();
  usageTimer = setTimeout(() => { usageTimer = null; usageWrite(); }, 5000);
  return true;
}
/** SIGTERM 收尾：把防抖里还没落盘的那一段写下去（server.mjs 的退出流程要调，195-W.2） */
export function flushUsage() { clearTimeout(usageTimer); usageTimer = null; return usageWrite(); }
onShutdown("用量", flushUsage);   // 退出流程 runShutdown() 会调；不再靠 server.mjs 记得（196-状态写.2）
if (!fs.existsSync(USAGE_FILE)) { USAGE.v = 2; usageSave(true); }
// 0.3.13 前的数据没有 c / mt / st：启动一会儿后从会话记录补上（不动别的数）
else if ((USAGE.v || 1) < 2 && USAGE.imported) setTimeout(() => usageImport(true).catch((e) => log("使用统计补算失败：" + e.message)), 20000);
function usageBucket(hours, h) {
  return hours[h] || (hours[h] = { m: 0, t: 0, tl: 0, i: 0, o: 0, c: 0, s: [], md: {}, mt: {}, st: {} });
}
function usageMerge(dst, src, sign) {
  for (const k of ["m", "t", "tl", "i", "o", "c"]) dst[k] = Math.max(0, (dst[k] || 0) + sign * (src[k] || 0));
  for (const k of ["md", "mt", "st"]) for (const [n, v] of Object.entries(src[k] || {})) {
    const x = ((dst[k] ||= {})[n] || 0) + sign * v;
    if (x > 0) dst[k][n] = x; else delete dst[k][n];
  }
  if (sign > 0) for (const id of src.s || []) if (!(dst.s ||= []).includes(id) && dst.s.length < 200) dst.s.push(id);
}
export function usageAdd(d, sid, model, ts) {
  if (USAGE.off) return;
  const b = usageBucket(USAGE.hours, Math.floor((ts || Date.now()) / 3600e3));
  for (const k of ["m", "t", "tl", "i", "o", "c"]) if (d[k]) b[k] = (b[k] || 0) + d[k];
  if (sid && !b.s.includes(sid) && b.s.length < 200) b.s.push(sid);
  if (model && d.t) b.md[model] = (b.md[model] || 0) + d.t;
  const tok = (d.i || 0) + (d.o || 0);
  if (tok && model) (b.mt || (b.mt = {}))[model] = (b.mt[model] || 0) + tok;
  if (tok && sid) (b.st || (b.st = {}))[sid] = (b.st[sid] || 0) + tok;
  usageSave();
}
// 一个 claude 进程的 token 计量：边跑边记进当前小时。以前等 result 才整轮一次性记，三处漏算（10-30 实测）：
//   跑几个小时的一轮要到结束才显示、全记在结束那个小时；中断 / 被杀的那一轮没有 result，整轮丢掉；
//   result.usage 只算主会话，子代理花的 token 一个都没记（modelUsage 里有，但 --resume 起的进程会把以前几轮也算进去，没法当本轮的用）。
// 主会话：流式事件按 message.id 记见过的最大值，涨多少记多少（message_start 给输入、message_delta 给累计输出，兼容桥常在 delta 才补输入）；
//   result 时和这一轮的 usage 对一次账，流里没看到的（压缩这类不出流事件的请求）补上差额。
// 子代理：流里不带用量，读它自己的记录（<会话>/subagents/agent-*.jsonl，每条 assistant 带 usage），运行中每 30 秒、每轮 result、进程退出时各扫一次。
export function usageMeter(ctx) {
  const add = ctx.add || usageAdd;   // 测试换成收集器
  const seen = new Map(), cur = {}, tot = { i: 0, o: 0, c: 0 };   // tot：主会话上次对账以来流里记了多少
  const subPos = new Map();          // 子代理记录读到哪个字节了
  const t0 = ctx.start || Date.now();
  const num = (x) => Number.isFinite(x) && x > 0 ? x : 0;
  const bump = (key, u, model, main) => {
    if (!key || !u) return;
    const v = { i: num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens), o: num(u.output_tokens), c: num(u.cache_read_input_tokens) };
    const p = seen.get(key) || { i: 0, o: 0, c: 0, m: model }, d = {};   // 型号跟着请求记：delta 不带型号
    for (const k of ["i", "o", "c"]) if (v[k] > p[k]) { d[k] = v[k] - p[k]; p[k] = v[k]; if (main) tot[k] += d[k]; }
    seen.delete(key); seen.set(key, p);
    if (seen.size > 5000) seen.delete(seen.keys().next().value);
    if (d.i || d.o || d.c) add(d, ctx.sid(), p.m || ctx.model());
  };
  function scanSubs() {
    const dir = ctx.subDir && ctx.subDir();
    if (!dir) return;
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl")); } catch { return; }
    for (const n of names) {
      const file = path.join(dir, n);
      let st; try { st = fs.statSync(file); } catch { continue; }
      if (st.mtimeMs < t0 - 5000) continue;        // 以前几轮的子代理
      const from = subPos.get(n) || 0;
      if (st.size <= from) continue;
      let text = "";
      let fd = null;
      try { fd = fs.openSync(file, "r"); const b = Buffer.alloc(st.size - from); fs.readSync(fd, b, 0, b.length, from); text = b.toString("utf8"); }
      catch { continue; }
      finally { if (fd != null) try { fs.closeSync(fd); } catch {} }   // 读一半抛错也要关 fd（200-6-02）
      const end = text.lastIndexOf("\n");
      if (end < 0) continue;                         // 半行：等写完
      subPos.set(n, from + Buffer.byteLength(text.slice(0, end + 1)));
      for (const line of text.slice(0, end).split("\n")) {
        if (!line.includes('"usage"') || !line.includes('"assistant"')) continue;
        let e; try { e = JSON.parse(line); } catch { continue; }
        // 消息按时间归轮：本轮开始之后写的才算（以前放宽 5 秒，上一轮收尾慢的子代理会被下一轮再算一遍）
        if (e.type !== "assistant" || !e.message?.id || !(Date.parse(e.timestamp) >= t0)) continue;
        bump(e.message.id, e.message.usage, e.message.model, false);
      }
    }
  }
  const timer = setInterval(scanSubs, 30000);
  timer.unref?.();
  return {
    feed(ev) {
      const lane = ev.parent_tool_use_id || "";
      if (ev.type === "stream_event") {
        const e = ev.event;
        if (e?.type === "message_start") { cur[lane] = e.message?.id || lane + ":" + Date.now(); bump(cur[lane], e.message?.usage, lane && e.message?.model, !lane); }
        else if (e?.type === "message_delta" && e.usage) bump(cur[lane], e.usage, undefined, !lane);
      } else if (ev.type === "assistant" && ev.message?.id) bump(ev.message.id, ev.message.usage, lane && ev.message.model, !lane);   // 主会话记在 init 报的型号名下（兼容桥回的名字可能不一样）
    },
    result(r, turn) {
      scanSubs();
      const u = r.usage || {};
      const all = { i: num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens), o: num(u.output_tokens), c: num(u.cache_read_input_tokens) };
      const d = turn ? { t: 1 } : {};
      for (const k of ["i", "o", "c"]) { if (all[k] > tot[k]) d[k] = all[k] - tot[k]; tot[k] = 0; }   // 后台任务回报会在同一进程再出一轮 result，各对各的
      if (Object.keys(d).length) add(d, ctx.sid(), ctx.model());
    },
    close() { clearInterval(timer); scanSubs(); },
  };
}
// 用户自己打的字才算一次对话：斜杠命令、命令回显、系统注入的不算
export const usageIsPrompt = (text) => {
  const s = String(text || "").trimStart();
  return !!s && !s.startsWith("/") && !isInjected(s) && !s.startsWith("Caveat: ");
};
const usageText = (content) => typeof content === "string" ? content
  : Array.isArray(content) && !content.some((c) => c && c.type === "tool_result") ? content.filter((c) => c && c.type === "text").map((c) => c.text).join("\n") : "";

/** 从 ~/.claude/projects 下的会话记录补算 since 之前的部分。分叉出来的会话会重复带上原会话的消息，按 uuid / message.id 去重 */
let usageImporting = null;
let usageGen = 0;   // 清空统计时 +1：还在跑的补算按旧世代号丢弃结果，别把清掉的数据写回来（#119-5）
function usageImport(extraOnly) {
  return usageImporting || (usageImporting = (async () => {
    const gen = usageGen, since0 = USAGE.since;
    // extraOnly：老数据（v1）补上 c / mt / st 三项，别的照旧（实时记下的、后来删掉的会话也还在）
    const until = Math.floor((extraOnly ? Date.now() : since0) / 3600e3);
    // 实时统计从 since 那一刻起记：since 所在的那个小时，since 之前的部分也要补（以前按整点切，整小时丢了，#102 04-011）
    const before = extraOnly ? (ts) => Math.floor(ts / 3600e3) < until : (ts) => ts < since0;
    const hours = {}, seenU = new Set(), seenTool = new Set(), msgs = new Map();
    let files = 0, prompts = 0;
    let dirs = [];
    try { dirs = fs.readdirSync(PATHS.projects); } catch {}
    for (const d of dirs) {
      let list = [];
      try { list = fs.readdirSync(path.join(PATHS.projects, d)).filter((f) => f.endsWith(".jsonl")); } catch { continue; }
      for (const f of list) {
        files++;
        let pending = null;            // 刚收到一条提问、还没见到回复：第一条回复的模型算这一轮的
        const rl = (await import("node:readline")).createInterface({ input: fs.createReadStream(path.join(PATHS.projects, d, f)), crlfDelay: Infinity });
        for await (const line of rl) {
          if (line.length < 20 || !/"type":"(user|assistant)"/.test(line)) continue;
          let e; try { e = JSON.parse(line); } catch { continue; }
          if (e.isSidechain || !e.timestamp) continue;
          const ts = Date.parse(e.timestamp), h = Math.floor(ts / 3600e3);
          if (!before(ts)) continue;
          const m = e.message || {};
          if (e.type === "user" && m.role === "user") {
            if (e.isMeta || e.isCompactSummary || (e.uuid && seenU.has(e.uuid))) continue;
            if (!usageIsPrompt(usageText(m.content))) continue;
            if (e.uuid) seenU.add(e.uuid);
            const b = usageBucket(hours, h);
            b.m++; prompts++;
            if (e.sessionId && !b.s.includes(e.sessionId) && b.s.length < 200) b.s.push(e.sessionId);
            pending = b;
          } else if (e.type === "assistant" && m.model && m.model !== "<synthetic>") {
            if (pending) { pending.t++; pending.md[m.model] = (pending.md[m.model] || 0) + 1; pending = null; }
            for (const c of m.content || []) if (c && c.type === "tool_use" && c.id && !seenTool.has(c.id)) { seenTool.add(c.id); usageBucket(hours, h).tl++; }
            // 同一条回复流式拆成好几行、每行都带 usage：按 message.id 只算一次（取最后一行的）
            if (m.id && m.usage) msgs.set(m.id, [h, m.usage, m.model, e.sessionId]);
          }
        }
        // 子代理的 token 记在 <会话>/subagents/*.jsonl：实时统计（usageMeter 的 scanSubs）算它们，补算也要算，不然历史偏低（审查 B29）。
        // 只算 token；提问数、轮数、工具数照旧只看主会话
        const sid = f.slice(0, -6), sub = path.join(PATHS.projects, d, sid, "subagents");
        let subs = [];
        try { subs = fs.readdirSync(sub).filter((x) => x.endsWith(".jsonl")); } catch {}
        for (const sf of subs) {
          const rs = (await import("node:readline")).createInterface({ input: fs.createReadStream(path.join(sub, sf)), crlfDelay: Infinity });
          for await (const line of rs) {
            if (line.length < 20 || !line.includes('"type":"assistant"')) continue;
            let e; try { e = JSON.parse(line); } catch { continue; }
            const m = e.message || {};
            if (e.type !== "assistant" || !e.timestamp || !m.id || !m.usage || !m.model || m.model === "<synthetic>") continue;
            const ts = Date.parse(e.timestamp), h = Math.floor(ts / 3600e3);
            if (before(ts)) msgs.set(m.id, [h, m.usage, m.model, e.sessionId || sid]);
          }
        }
      }
    }
    for (const [h, u, model, sid] of msgs.values()) {
      const b = usageBucket(hours, h);
      const i = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), o = u.output_tokens || 0;
      b.i += i; b.o += o; b.c += u.cache_read_input_tokens || 0;
      if (model) b.mt[model] = (b.mt[model] || 0) + i + o;
      if (sid) b.st[sid] = (b.st[sid] || 0) + i + o;
    }
    if (gen !== usageGen) {
      log("使用统计：补算期间统计被清空，丢弃这次结果");
      return { files, prompts: 0, aborted: true };
    }
    if (extraOnly) {
      for (const [k, b] of Object.entries(hours)) { const o = USAGE.hours[k]; if (o) { o.c = b.c; o.mt = b.mt; o.st = b.st; } }
      USAGE.v = 2;
      usageSave(true);
      log("使用统计：给老数据补上了缓存命中、按型号与按会话的 token");
      return { files, prompts: 0 };
    }
    // 换掉上次补算的（since 之前的实时数据——比如清空后重新补——也一并以这次为准）
    for (const k of Object.keys(USAGE.hours)) if (+k < until) delete USAGE.hours[k];
    const edge = hours[until]; delete hours[until];
    for (const [k, b] of Object.entries(hours)) USAGE.hours[k] = { ...b, x: 1 };
    // 交界那个小时：实时记的（since 之后）加上补算的（since 之前）。上次补进去的记在 xi 里，重补时先减掉，不重复算
    const live = USAGE.hours[until];
    if (live?.xi) usageMerge(live, live.xi, -1);
    if (edge) { const b = usageBucket(USAGE.hours, until); usageMerge(b, edge, 1); b.xi = edge; }
    else if (live) delete live.xi;
    USAGE.imported = Date.now();
    USAGE.v = 2;
    usageSave(true);
    log(`使用统计：从 ${files} 个会话记录补算了 ${prompts} 条消息`);
    return { files, prompts };
  })().finally(() => { usageImporting = null; }));
}

// ── 路由：/api/ledger /api/usage /api/usage/ ──
export async function routeUsage(req, res, u, p) {
  if (req.method === "GET" && p === "/api/ledger") {
    try { return sendJson(res, 200, { items: readLedger(Number(u.searchParams.get("n")) || 100) }); }
    catch (e) { return sendJson(res, 500, { message: e.code || e.message }); }
  }
  // ── 官方账户登录：就是在跑 `claude auth login`，网关只当终端用 ──
  // OAuth 全程由 claude 自己完成，令牌由它写进它自己的 ~/.claude/.credentials.json；
  // 我们只转交用户在授权页拿到的一次性授权码（等同于在终端里粘贴），不读、不存任何凭据。
  // ── 使用统计 ──
  if (req.method === "GET" && p === "/api/usage") return sendJson(res, 200, { since: USAGE.since, imported: USAGE.imported, off: !!USAGE.off, importing: !!usageImporting, hours: USAGE.hours, now: Date.now() });
  if (req.method === "POST" && p.startsWith("/api/usage/")) {
    let b; try { b = JSON.parse((await readBody(req)) || "{}"); } catch { return sendJson(res, 400, { error: "bad json" }); }
    const op = p.slice(11);
    if (op === "import") return sendJson(res, 200, { ok: true, ...(await usageImport()) });
    if (op === "set") {
      const before = USAGE.off; USAGE.off = !!b.off;
      if (!usageSave(true)) { USAGE.off = before; return sendJson(res, 500, { ok: false, error: "write_failed", message: tz("没保存上：存储满了或没有权限") }); }
      return sendJson(res, 200, { ok: true, off: USAGE.off });
    }
    if (op === "clear") {
      usageGen++;                  // 旧补算的结果作废（#119-5）
      const before = { hours: USAGE.hours, since: USAGE.since, imported: USAGE.imported };
      if (b.all) { USAGE.hours = {}; USAGE.since = Date.now(); USAGE.imported = Date.now(); }
      else {
        const from = Number(b.from), to = Number(b.to);
        if (!(from < to)) return sendJson(res, 400, { error: "bad range" });
        USAGE.hours = { ...USAGE.hours };
        for (const k of Object.keys(USAGE.hours)) if (+k * 3600e3 >= from && +k * 3600e3 < to) delete USAGE.hours[k];
      }
      if (!usageSave(true)) { Object.assign(USAGE, before); return sendJson(res, 500, { ok: false, error: "write_failed", message: tz("没保存上：存储满了或没有权限") }); }
      return sendJson(res, 200, { ok: true });
    }
    // 导出目录被换成软链、或里面放了同名软链：不跟着写到别处（11-03 审查 L-1，同 profile.saveExport）
    const writeExport = (name, data) => {
      const base = process.env.CCAPP_SHARED && fs.existsSync(process.env.CCAPP_SHARED) ? process.env.CCAPP_SHARED : CFG.home;
      const dir = path.join(base, "exports");
      fs.mkdirSync(dir, { recursive: true });
      if (fs.lstatSync(dir).isSymbolicLink()) return sendJson(res, 400, { error: "bad dir" });
      const file = path.join(dir, name);
      // 临时文件 + fsync + 换名：直接 O_TRUNC 写失败会把上一次的导出也毁掉（197-9.9）；权限 0600（199-3-02）。
      // 导出目录里有人放了同名软链接：不跟过去写（换名会替换链接本身，先挡下来）
      try { if (fs.lstatSync(file).isSymbolicLink()) return sendJson(res, 400, { error: "bad target" }); } catch {}
      if (!writeAtomic(file, data, { mode: 0o600 })) return sendJson(res, 500, { error: "write failed" });
      return sendJson(res, 200, { ok: true, file });
    };
    // 月报图片：前端画好的 PNG 落到导出目录，再交给「保存到」/ 分享
    if (op === "card") {
      const name = String(b.name || ""), data = Buffer.from(String(b.data || ""), "base64");
      if (!/^[\w.-]+\.png$/.test(name) || data.length < 100 || data.readUInt32BE(0) !== 0x89504e47) return sendJson(res, 400, { error: "bad image" });
      return writeExport(name, data);
    }
    // 导出 CSV：前端按本地时区汇总好的逐日表，落到同一个导出目录
    if (op === "csv") {
      const name = String(b.name || ""), text = String(b.text || "");
      if (!/^[\w.-]+\.csv$/.test(name) || !text || text.length > 4e6) return sendJson(res, 400, { error: "bad csv" });
      return writeExport(name, "\ufeff" + text);   // 带 BOM，表格软件才认得出中文
    }
    return sendJson(res, 404, { error: "unknown op" });
  }
  return NEXT;
}
