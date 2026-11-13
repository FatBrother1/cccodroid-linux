import fs from "node:fs";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { log, tz } from "./config.mjs";
import { NEXT, readBody, sendJson } from "./http.mjs";
import { termEnv } from "./terminal.mjs";

// ── gh 登录卡：设备码流程（显示一次性码 → 用户在浏览器里授权 → gh 自己轮询到完成）──
// 令牌只由 gh 自己存（~/.config/gh/hosts.yml）：网关不读那个文件、不转发、不记 gh 的输出，
// 对外只给账号名与状态。登录成功后跑 gh auth setup-git，git 走 https 推送就能用
const GH = { job: null };
// 用终端 PATH 里的 gh
function ghBin() {
  for (const d of String(termEnv().PATH || "").split(":")) if (d && fs.existsSync(path.join(d, "gh"))) return path.join(d, "gh");
  return "";
}
const GH_USER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
function ghExec(args, timeout = 20000) {
  return new Promise((resolve) => execFile(ghBin(), args, { env: termEnv(), timeout },
    (e, out, err) => resolve({ code: e ? (typeof e.code === "number" ? e.code : 1) : 0, out: String(out || ""), err: String(err || "") })));
}
function ghKill(job) {
  if (!job.child) return;
  try { process.kill(-job.child.pid, "SIGKILL"); } catch { try { job.child.kill("SIGKILL"); } catch {} }
}
async function ghStatus() {
  const bin = ghBin();
  if (!bin || !fs.existsSync(bin)) return { installed: false };
  // 没登录时也是退出码 0、输出 {"hosts":{}}；令牌失效的账号 state 不是 success
  const r = await ghExec(["auth", "status", "--json", "hosts", "-h", "github.com"]);
  let accounts = [];
  try { accounts = (JSON.parse(r.out).hosts["github.com"] || []).map((a) => ({ login: String(a.login || ""), active: !!a.active, ok: a.state === "success" })); } catch {}
  const j = GH.job;
  return { installed: true, accounts, job: j ? { state: j.state, code: j.code, url: j.url, error: j.error, git: j.git } : null };
}
function ghLogin() {
  const bin = ghBin();
  if (!bin || !fs.existsSync(bin)) return { ok: false, message: tz("gh 没装") };
  if (GH.job && ["starting", "waiting"].includes(GH.job.state)) return { ok: true };
  // 没有终端时 gh 不等回车、不开浏览器，只把一次性码和网址打到 stderr；-s workflow 让推 .github/workflows 也行
  const child = spawn(bin, ["auth", "login", "--web", "-h", "github.com", "-p", "https", "-s", "workflow"],
    { env: termEnv(), stdio: ["ignore", "pipe", "pipe"], detached: true });
  const job = (GH.job = { state: "starting", code: "", url: "", error: "", git: null, child });
  let buf = "";
  const onData = (d) => {
    buf = (buf + d).slice(-4000);
    const m = buf.match(/one-time code: ([A-Z0-9]{4}-[A-Z0-9]{4})/);
    if (m && !job.code) { job.code = m[1]; job.state = "waiting"; }
    const u = buf.match(/https:\/\/github\.com\/login\/device\b/);
    if (u) job.url = u[0];
  };
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");   // 按流解码：多字节字符跨块不会被拆坏
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("error", (e) => { job.state = "error"; job.error = e.message; });
  // 设备码 15 分钟过期，过了还没授权就收掉
  const timer = setTimeout(() => { if (job.child) { job.state = "error"; job.error = "timeout"; ghKill(job); } }, 16 * 60000);
  child.on("exit", async (code) => {
    clearTimeout(timer);
    job.child = null;
    if (job.state === "cancelled" || job.error === "timeout") return;
    if (code !== 0) {
      // 只取最后一行报错给界面（剪贴板那两行提示是 gh 自己复制失败，不算错）
      const last = buf.split("\n").map((l) => l.trim()).filter((l) => l && !/clipboard|xsel|one-time code|Open this URL/i.test(l)).pop();
      job.state = "error"; job.error = (last || tz("gh 退出码 {code}", { code })).slice(0, 300);
      return;
    }
    const s = await ghExec(["auth", "setup-git", "-h", "github.com"]);
    job.git = s.code === 0;
    job.state = "done";
    log(`[gh] 登录完成${job.git ? "，已配好 git 凭据" : "，setup-git 失败"}`);
  });
  return { ok: true };
}
async function handleGh(req, res, p) {
  if (req.method === "GET" && p === "/api/gh/auth") return sendJson(res, 200, await ghStatus());
  if (req.method !== "POST") return sendJson(res, 405, { error: "method" });
  let body = {}; try { body = JSON.parse((await readBody(req)) || "{}"); } catch {}
  if (p === "/api/gh/login") return sendJson(res, 200, ghLogin());
  if (p === "/api/gh/cancel") {
    const j = GH.job;
    if (j && j.child) { j.state = "cancelled"; ghKill(j); }
    GH.job = null;
    return sendJson(res, 200, { ok: true });
  }
  const user = String(body.user || "");
  if (!GH_USER.test(user)) return sendJson(res, 400, { ok: false, message: "bad user" });
  const args = { "/api/gh/logout": ["auth", "logout", "-h", "github.com", "-u", user], "/api/gh/switch": ["auth", "switch", "-h", "github.com", "-u", user] }[p];
  if (!args) return sendJson(res, 404, { error: "not found" });
  if (GH.job && GH.job.state !== "starting" && GH.job.state !== "waiting") GH.job = null;
  const r = await ghExec(args);
  return sendJson(res, 200, r.code === 0 ? { ok: true } : { ok: false, message: (r.err.trim().split("\n").pop() || "").slice(0, 300) });
}

// ── 路由：/api/gh/ ──
export async function routeGh(req, res, u, p) {
  if (p.startsWith("/api/gh/")) return handleGh(req, res, p);
  return NEXT;
}
