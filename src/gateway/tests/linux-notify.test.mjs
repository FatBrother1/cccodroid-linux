// Linux 桌面通知（gw/notify.mjs）：什么时候发、什么时候不发、参数怎么交给 notify-send
import "../gw/config.mjs";
import { after, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccn-"));
const OUT = path.join(dir, "calls.jsonl");
const fake = path.join(dir, "notify-send");
fs.writeFileSync(fake, `#!/usr/bin/env node\nrequire("node:fs").appendFileSync(${JSON.stringify(OUT)}, JSON.stringify(process.argv.slice(2)) + "\\n");\n`, { mode: 0o755 });
process.env.CCAPP_NOTIFY_BIN = fake;

const N = await import("../gw/notify.mjs");
const { publish } = await import("../gw/bus.mjs");
const { CFG } = await import("../gw/config.mjs");
N.startNotify();

mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
beforeEach(() => { mock.timers.tick(61_000); N.notifyFocus({ focused: false }); });
after(() => { mock.timers.reset(); fs.rmSync(dir, { recursive: true, force: true }); });

const calls = () => (fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
async function sent(n, ms = 4000) {
  const t0 = process.hrtime.bigint();
  while (calls().length < n && Number(process.hrtime.bigint() - t0) / 1e6 < ms) await new Promise((r) => setTimeout(r, 40));
  return calls();
}
async function quiet() { await new Promise((r) => setTimeout(r, 400)); return calls(); }
const parts = (args) => { const i = args.indexOf("--"); return { title: args[i + 1], body: args[i + 2], head: args.slice(0, i) }; };

let rid = 0;
function run({ text = "整理一下日志", ms = 30_000, sid = "s-" + rid, end = {} } = {}) {
  const runId = "r" + ++rid;
  publish({ type: "run_start", runId, sessionId: sid, text, startedAt: Date.now() });
  mock.timers.tick(ms);
  publish({ type: "run_end", runId, at: Date.now(), sessionId: sid, aborted: false, ...end });
  return runId;
}

test("状态：有 notify-send 时可用，默认两项都开", () => {
  assert.deepEqual(N.notifyStatus(), { ok: true, done: true, ask: true, system: true, chDone: true, chAsk: true });
});

test("窗口不在前台、跑了 30 秒：发一条「任务完成」，会话名和用时在正文里，参数在 -- 之后", async () => {
  run({ text: "整理一下日志" });
  const all = await sent(1);
  assert.equal(all.length, 1);
  const { title, body, head } = parts(all[0]);
  assert.equal(title, "任务完成");
  assert.match(body, /^整理一下日志\n用时 30s$/);
  assert.ok(head.includes("string:desktop-entry:cccodroid"));
});

test("窗口在前台时不发；租约 45 秒到期后又发", async () => {
  const before = calls().length;
  N.notifyFocus({ focused: true });
  run();
  assert.equal((await quiet()).length, before);
  N.notifyFocus({ focused: true });
  mock.timers.tick(46_000);
  run();
  assert.equal((await sent(before + 1)).length, before + 1);
});

test("很快结束的不发；失败的即使很快也发；被中止、空闲压缩、定时任务轮次不发", async () => {
  const n0 = calls().length;
  run({ ms: 3_000 });
  run({ ms: 30_000, end: { aborted: true } });
  run({ ms: 30_000, end: { auto: "idle" } });
  run({ ms: 30_000, end: { sched: true } });
  assert.equal((await quiet()).length, n0);
  run({ ms: 2_000, end: { failed: true } });
  const all = await sent(n0 + 1);
  assert.equal(all.length, n0 + 1);
  assert.equal(parts(all[n0]).title, "出错了");
});

test("需要确认：每个请求只发一次，正文不含命令内容；关掉「等你确认」就不发", async () => {
  const n0 = calls().length;
  const runId = "r-ask";
  publish({ type: "run_start", runId, sessionId: "s-ask", text: "部署", startedAt: Date.now() });
  publish({ type: "perm_request", runId, id: "p1", tool: "Bash", input: { command: "curl -H 'Authorization: Bearer SECRET-TOKEN-123' https://x" } });
  publish({ type: "perm_request", runId, id: "p1", tool: "Bash", input: { command: "again" } });
  const all = await sent(n0 + 1);
  assert.equal((await quiet()).length, n0 + 1);
  const { title, body } = parts(all[n0]);
  assert.equal(title, "需要确认");
  assert.match(body, /Bash/);
  assert.ok(!JSON.stringify(all[n0]).includes("SECRET-TOKEN-123"));

  assert.equal(N.notifySet({ ask: false }).ask, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(CFG.home, "ccapp-notify.json"), "utf8")).ask, false);
  publish({ type: "perm_request", runId, id: "p2", tool: "Bash", input: {} });
  assert.equal((await quiet()).length, n0 + 1);
  N.notifySet({ ask: true });

  mock.timers.tick(61_000);
  publish({ type: "perm_request", runId, id: "p3", tool: "ExitPlanMode", input: {} });
  assert.equal(parts((await sent(n0 + 2))[n0 + 1]).title, "计划待批准");
});

test("定时任务的结果通知：不看窗口在不在前台，但受「任务完成」开关管", async () => {
  const n0 = calls().length;
  N.notifyFocus({ focused: true });
  publish({ type: "sched_note", taskId: "t1", title: "定时任务完成：日报", text: "已生成", sessionId: null, ok: true });
  const all = await sent(n0 + 1);
  assert.deepEqual([parts(all[n0]).title, parts(all[n0]).body], ["定时任务完成：日报", "已生成"]);
  N.notifySet({ done: false });
  publish({ type: "sched_note", taskId: "t1", title: "定时任务完成：日报", text: "x", sessionId: null, ok: true });
  run();
  assert.equal((await quiet()).length, n0 + 1);
  N.notifySet({ done: true });
});

test("会话名里的选项样字符、换行和标记不会被当成参数或标记", async () => {
  const n0 = calls().length;
  run({ text: "--help <b>粗</b> & `id`\n第二行" });
  const all = await sent(n0 + 1);
  const a = all[n0], i = a.indexOf("--");
  assert.ok(i > 0 && i === a.length - 3);
  assert.equal(parts(a).body.split("\n")[0], "--help &lt;b&gt;粗&lt;/b&gt; &amp; `id`");
  assert.ok(!parts(a).body.includes("第二行"));
});

test("一分钟内最多 6 条，窗口过去后恢复", async () => {
  const n0 = calls().length;
  for (let i = 0; i < 9; i++) publish({ type: "sched_note", taskId: "t" + i, title: "定时任务完成：n" + i, text: "", sessionId: null, ok: true });
  assert.equal((await sent(n0 + 6)).length, n0 + 6);
  assert.equal((await quiet()).length, n0 + 6);
  mock.timers.tick(61_000);
  publish({ type: "sched_note", taskId: "tz", title: "定时任务完成：z", text: "", sessionId: null, ok: true });
  assert.equal((await sent(n0 + 7)).length, n0 + 7);
});

test("notify_test 不受前台状态和开关影响", async () => {
  const n0 = calls().length;
  N.notifyFocus({ focused: true });
  assert.deepEqual(N.notifyTest(), { ok: true });
  assert.equal((await sent(n0 + 1)).length, n0 + 1);
});

test("server.mjs 带着通知模块能正常启动（模块互相引用成环，导入期订阅会撞上 bus.mjs 没初始化完）", async () => {
  const port = await new Promise((ok) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); }); });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ccn-boot-"));
  const env = { ...process.env, CCAPP_HOME: home, HOME: home, CCAPP_WORKSPACE: path.join(home, "ws"), CCAPP_PORT: String(port), CCAPP_NOTIFY_BIN: fake };
  delete env.NODE_TEST_CONTEXT; delete env.CCAPP_TEST;
  const child = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname, String(port)], { env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => { out += d; }); child.stderr.on("data", (d) => { out += d; });
  const up = await new Promise((ok) => {
    const t0 = Date.now();
    const tick = () => {
      if (child.exitCode !== null) return ok(false);
      const c = net.connect(port, "127.0.0.1");
      c.on("connect", () => { c.destroy(); ok(true); });
      c.on("error", () => { if (Date.now() - t0 > 15000) ok(false); else setTimeout(tick, 200); });
    };
    tick();
  });
  child.kill();
  fs.rmSync(home, { recursive: true, force: true });
  assert.ok(up, "网关没起来：" + out.slice(-600));
  assert.ok(!/ReferenceError|Cannot access/.test(out), out.slice(-600));
});
