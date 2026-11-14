import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { CFG, GLIBC_PRELOAD, HERE, PATHS, PREFIX, glibcEnv, loadPgp, log, tz } from "./config.mjs";
import { verifiedInfo } from "./ccverified.mjs";
import { NEXT, readBody, sendJson } from "./http.mjs";
import { notifyFocus, notifySet, notifyStatus, notifyTest } from "./notify.mjs";

// ── Claude Code 的更新：版本检查、下载、验签、换版本，都由网关自己做 ──────────

const DEV_UPD_FILE = path.join(CFG.home, "ccapp-update.json");
const CC_BASE = "https://downloads.claude.ai/claude-code-releases";
// SteamOS / 桌面 Linux 移植：官方直链在部分网络连不上，Claude Code 的版本号与安装改走 npm 官方源
// （官方把同一份二进制发在 npm 平台包上；上游文档实测 package/claude 与官方直链逐字节相同）
const LINUX = process.platform === "linux" && !PREFIX;
const NPM_PKG = LINUX ? "@anthropic-ai/claude-code-linux-x64" : "@anthropic-ai/claude-code-linux-arm64";
// Linux 安装布局：HERE = <前缀>/versions/<版本>/src/gateway；VERSION 在 ../../VERSION，
// 前缀在 ../../../..（current/ 与 CLI 都在前缀下）。开发布局里读不到 VERSION，就跳过应用更新检查。
const APP_ROOT = path.resolve(HERE, "..", "..");
const APP_VERSION = (() => { try { return fs.readFileSync(path.join(APP_ROOT, "VERSION"), "utf8").trim(); } catch { return ""; } })();
const APP_PREFIX = path.resolve(APP_ROOT, "..", "..");
const APP_REPO = "FatBrother1/cccodroid-linux";
const NPM_REG = "https://registry.npmjs.org";
// npm registry 的签名公钥（https://registry.npmjs.org/-/npm/v1/keys，只留没过期的）；与 android/assets/scripts/install-claude.mjs 同一把。
// 官方直链那条路有 Anthropic 的 PGP 清单签名；npm 这条路靠这把钉死的公钥验「包名@版本:integrity」的 ECDSA 签名，
// 不能只信 registry 回来的 integrity —— 能改 integrity 的人也能连 tarball 一起换。
const NPM_KEYS = {"SHA256:DhQ8wR5APBvFHLF/+Tc+AYvPOdTpcIDqOhxsBHRwC7U":"MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEY6Ya7W++7aUPzvMTrezH6Ycx3c+HOKYCcNGybJZSCJq/fd7Qa8uuAKtdIkUQtQiEKERhAmE5lMMJhP8OkDOa2g=="};
const devUpd = {
  auto: true, channel: "stable", lastCheck: 0, checking: false, error: "",
  app: { id: "cccodroid", name: "cccodroid Steam Deck", current: APP_VERSION, latest: "", state: "unknown", message: "", done: 0, total: 0 },
  claude: { id: "claude", name: "Claude Code", current: "", latest: "", state: "unknown", message: "", done: 0, total: 0 },
};
try { Object.assign(devUpd, JSON.parse(fs.readFileSync(DEV_UPD_FILE, "utf8")), { checking: false, error: "" }); devUpd.claude.state = devUpd.claude.state === "installing" ? "unknown" : devUpd.claude.state; } catch {}
// 应用版本以磁盘上的 VERSION 为准（持久化文件里可能是上一次检查留下的旧值）。
// 显示名也固定回新名字：旧版写进 ccapp-update.json 的是 "cccodroid"，会被 Object.assign 带回来。
devUpd.app.id = "cccodroid";
devUpd.app.name = "cccodroid Steam Deck";
devUpd.app.current = APP_VERSION;
devUpd.app.state = devUpd.app.state === "installing" || devUpd.app.state === "downloading" ? "error" : (APP_VERSION ? devUpd.app.state : "unknown");
if (!APP_VERSION) devUpd.app.message = tz("开发布局：读不到应用版本，跳过应用更新检查");
const devUpdSave = () => { try { fs.writeFileSync(DEV_UPD_FILE, JSON.stringify(devUpd)); } catch {} };
const cmpVer = (a, b) => {
  const x = String(a).split(/[^0-9]+/).map(Number), y = String(b).split(/[^0-9]+/).map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 ? -1 : 1; }
  return 0;
};
// ccapp-update.json 里可能留着升级前查到的“最新版”（例如升到 0.1.2 后还存着
// 0.1.1）。它比当前版本旧，不能再当成可更新目标显示成“0.1.2 → 0.1.1”。
try {
  if (devUpd.app.latest && (!APP_VERSION || cmpVer(devUpd.app.latest, APP_VERSION) <= 0)) {
    devUpd.app.latest = "";
    if (devUpd.app.state === "available") {
      devUpd.app.state = APP_VERSION ? "uptodate" : "unknown";
      devUpd.app.message = APP_VERSION ? tz("已是最新（{v}）", { v: APP_VERSION }) : "";
    }
  }
} catch {}

/** 跑某个 claude 二进制的 --version（新下载的那个在换上去之前先这样试跑一次） */
function claudeVersionOf(bin) {
  return new Promise((ok) => {
    const pre = GLIBC_PRELOAD ? ["--preload", GLIBC_PRELOAD] : [];
    execFile(PATHS.claudeLoader, ["--library-path", PATHS.claudeLib, ...pre, bin, "--version"], { timeout: 30000, env: glibcEnv() }, (e, out) => {
      const m = String(out || "").match(/\d+\.\d+\.\d+/);
      ok(m ? m[0] : "");
    });
  });
}

/** npm 平台包的 registry 元数据（缩写格式也带 dist.tarball / dist.integrity），缓存 10 分钟 */
let npmCache = { at: 0, data: null };
async function npmMeta(force = false) {
  if (!force && npmCache.data && Date.now() - npmCache.at < 600e3) return npmCache.data;
  const r = await fetch(`${NPM_REG}/${encodeURIComponent(NPM_PKG)}`, {
    headers: { Accept: "application/vnd.npm.install-v1+json" }, signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error("npm HTTP " + r.status);
  npmCache = { at: Date.now(), data: await r.json() };
  return npmCache.data;
}

// 应用本体（cccodroid-linux）的最新发布：GitHub Releases 的 latest（只读公共 API，不需要登录）。
// 国内网络直连 api.github.com 经常 fetch failed；gh-proxy.com 能代理 API（其他几个
// 常见前缀只代理 release 资产，不代理 API），所以直连失败时走它。
const GH_API = `https://api.github.com/repos/${APP_REPO}/releases?per_page=30`;
const GH_API_PROXIES = ["https://gh-proxy.com/"];
let appCache = { at: 0, data: null };
async function appLatest(force = false) {
  if (!force && appCache.data && Date.now() - appCache.at < 600e3) return appCache.data;
  // /releases/latest 会把 v0.1.0-deb 这种「包型发布」也算进去；这里只认
  // 形如 v0.1.0 且带 tar.gz 的正式发布，否则会把 deb 发布的标签当成应用版本。
  let r = null, last = null;
  for (const [u, ms] of [[GH_API, 12000], ...GH_API_PROXIES.map((p) => [p + GH_API, 20000])]) {
    try {
      const rr = await fetch(u, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "cccodroid-linux" },
        signal: AbortSignal.timeout(ms),
      });
      if (rr.ok) { r = rr; break; }
      last = new Error("GitHub HTTP " + rr.status);
    } catch (e) {
      last = e;
    }
  }
  if (!r) throw last || new Error("fetch failed");
  const list = await r.json();
  const rel = (Array.isArray(list) ? list : []).find((x) =>
    x && !x.draft && !x.prerelease && /^v\d+\.\d+\.\d+$/.test(String(x.tag_name || "")) &&
    Array.isArray(x.assets) && x.assets.some((a) => String(a.name || "").endsWith(".tar.gz")));
  if (!rel) throw new Error(tz("没有找到带 tar.gz 的正式发布"));
  const tag = String(rel.tag_name || "");
  const version = tag.replace(/^v/, "");
  const assets = Array.isArray(rel.assets) ? rel.assets : [];
  const pick = (s) => assets.find((a) => String(a.name || "").endsWith(s)) || null;
  appCache = { at: Date.now(), data: { version, tag, tar: pick(".tar.gz"), sha: pick(".tar.gz.sha256"), sig: pick(".tar.gz.sig"), html: rel.html_url || "" } };
  return appCache.data;
}

// GitHub Releases 的资产直链在部分网络（尤其国内）连不上，但 API 能通。按顺序试直链和
// 三个常用 GitHub 加速前缀；只给「拿到响应头」设超时，开始收 body 后不再掐断大文件。
const GH_PROXIES = ["https://ghfast.top/", "https://gh-proxy.com/", "https://ghproxy.net/"];
async function fetchAsset(url, timeoutMs = 15000) {
  let last = null;
  for (const u of [url, ...GH_PROXIES.map((p) => p + url)]) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(u, { signal: ctrl.signal });
      clearTimeout(timer);
      if (r.ok || r.status === 206) return r;
      last = new Error("HTTP " + r.status);
    } catch (e) {
      clearTimeout(timer);
      last = e;
    }
  }
  throw last || new Error("fetch failed");
}

async function appCheck(force = false) {
  const a = devUpd.app;
  if (!a.current) { a.state = "unknown"; a.message = tz("开发布局：读不到应用版本"); return; }
  try {
    const j = await appLatest(force);
    a.latest = j.version;
    const d = cmpVer(j.version, a.current);
    if (d > 0) { a.state = "available"; a.message = ""; }
    else { a.state = "uptodate"; a.message = tz("已是最新（{v}）", { v: a.current }); }
  } catch (e) {
    // 检查失败时保留“上次查到的、确实比当前新”的 latest 才有意义；
    // 比当前旧或等于当前的一律清掉，避免界面显示 0.1.2 → 0.1.1。
    if (a.latest && (!a.current || cmpVer(a.latest, a.current) <= 0)) a.latest = "";
    a.state = "error"; a.message = tz("检查应用更新失败：{err}", { err: e.message });
  }
}

// 检查途中换了渠道：这次的结果是旧渠道的，不能记到新渠道名下；结束后按新渠道再查一次（#136）
let devUpdAgain = false;
async function devUpdCheck() {
  if (devUpd.checking) { devUpdAgain = true; return; }
  devUpd.checking = true; devUpd.error = "";
  const c = devUpd.claude, ch = devUpd.channel;
  await appCheck(true);
  try {
    if (!c.current || c.state !== "installing") c.current = await claudeVersionOf(PATHS.claude);
    let v = "", from = "official";
    try {
      const r = await fetch(`${CC_BASE}/${ch}`, { signal: AbortSignal.timeout(20000) });
      v = (await r.text()).trim();
    } catch (e) {
      if (!LINUX) throw e;
    }
    // 官方源连不上，或者回来的是网页/空内容（被劫持、反代）：Linux 上改问 npm 的 dist-tags
    if (LINUX && !/^\d+\.\d+\.\d+/.test(v)) {
      const j = await npmMeta();
      v = String((j["dist-tags"] || {})[ch] || "");
      from = "npm";
    }
    if (devUpd.channel !== ch) { devUpdAgain = true; return; }
    if (!/^\d+\.\d+\.\d+/.test(v)) throw new Error(tz("版本号不对：{v}", { v: v.slice(0, 40) }));
    c.latest = v; c.latestCh = ch; c.latestFrom = from;
    // 已装版本要和所选渠道「一致」：从 latest 切回 stable 时版本号变小，以前判成「已是最新」就一直停在 latest 上
    if (c.state !== "installing") {
      const d = cmpVer(v, c.current);
      // 当前版本比渠道版本新（例如 Claude Code 自动装过 latest，而 stable 还没跟上）：
      // 这不是「有新版本」，不能把按钮画成「更新」——点下去是降级。要降级请走「版本…」。
      if (d > 0) { c.state = "available"; c.message = devUpd.channel === "latest" ? "latest 渠道" : ""; }
      else {
        c.state = "uptodate";
        c.message = d < 0 && c.current
          ? tz("当前 {cur} 比 {ch} 渠道的 {v} 新；要降级请在「版本…」里选", { cur: c.current, ch: devUpd.channel, v })
          : "";
      }
    }
    devUpd.lastCheck = Date.now();
  } catch (e) { devUpd.error = LINUX ? tz("检查 Claude Code 更新失败：{err}", { err: e.message }) : tz("连不上 downloads.claude.ai：{err}", { err: e.message }); }
  finally {
    devUpd.checking = false; devUpdSave();
    if (devUpdAgain) { devUpdAgain = false; setImmediate(devUpdCheck); }
  }
}

/**
 * Linux 移植：官方直链连不上时，从 npm 官方源装 linux-x64 平台包。
 * 包里的 package/claude 与官方直链逐字节相同（上游文档实测）；这里按 registry 的 sha512 integrity 核对，再试跑 --version。
 */
async function devUpdInstallNpm(want) {
  const c = devUpd.claude;
  const part = PATHS.claude + ".npm.part";
  const tmp = path.join(path.dirname(PATHS.claude), ".npm-extract-" + process.pid);
  try {
    const j = await npmMeta(true);
    const ver = (j.versions || {})[want];
    if (!ver || !ver.dist || !ver.dist.tarball) throw new Error(tz("npm 上没有 {v}", { v: want }));
    const tarball = String(ver.dist.tarball).replace(/^http:/, "https:");
    const integ = String(ver.dist.integrity || "");
    if (!/^https:\/\//.test(tarball) || !/^sha512-/.test(integ)) throw new Error(tz("npm 元数据不完整"));
    const msg = Buffer.from(`${ver.name || NPM_PKG}@${want}:${integ}`);
    const signed = (ver.dist.signatures || []).some((s) => NPM_KEYS[s.keyid] && crypto.verify("sha256", msg,
      { key: Buffer.from(NPM_KEYS[s.keyid], "base64"), format: "der", type: "spki" }, Buffer.from(s.sig, "base64")));
    if (!signed) throw new Error(tz("npm 的签名验不过，不安装"));
    fs.rmSync(part, { force: true });
    let have = 0;
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await fetch(tarball, { headers: have ? { range: `bytes=${have}-` } : {} });
        if (r.status !== 200 && r.status !== 206) throw new Error("HTTP " + r.status);
        if (r.status === 200) { have = 0; fs.rmSync(part, { force: true }); }
        const out = fs.openSync(part, "a");
        try { for await (const chunk of r.body) { fs.writeSync(out, chunk); have += chunk.length; c.done = have; } }
        finally { fs.closeSync(out); }
        break;
      } catch (e) {
        if (attempt >= 6) throw e;
        c.message = tz("下载中断（{msg}），续传…", { msg: e.message });
        await new Promise((ok) => setTimeout(ok, attempt * 2000));
        have = fs.existsSync(part) ? fs.statSync(part).size : 0;
      }
    }
    c.message = "校验 sha512…";
    const h = crypto.createHash("sha512");
    for await (const b of fs.createReadStream(part)) h.update(b);
    if ("sha512-" + h.digest("base64") !== integ) { fs.rmSync(part, { force: true }); throw new Error(tz("包与 npm 的 sha512 不符")); }
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    await new Promise((ok, no) => execFile("tar", ["-xzf", part, "-C", tmp, "package/claude"], { timeout: 180000 }, (e) => e ? no(e) : ok()));
    const cand = path.join(tmp, "package", "claude");
    fs.chmodSync(cand, 0o755);
    const v = await claudeVersionOf(cand);
    if (v !== want) throw new Error(tz("新版试跑失败（--version 得到「{v}」）", { v }));
    // 旧版用硬链接留成 .prev，再用 rename 原子换上新版：任何时刻 PATHS.claude 都存在，正在起 claude 的那一轮不会撞上空档
    fs.rmSync(PATHS.claude + ".prev", { force: true });
    fs.linkSync(PATHS.claude, PATHS.claude + ".prev");
    fs.renameSync(cand, PATHS.claude);
    log(`Claude Code 已从 npm 更新 ${c.current} → ${v}`);
    c.current = v; c.state = "uptodate"; c.message = `已从 npm 更新到 ${v}（下一轮对话起生效；旧版留在 claude.prev）`;
  } catch (e) {
    c.state = "error"; c.message = e.message;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(part, { force: true }); } catch {}
    devUpdSave();
  }
}

/**
 * 换新版：下到 claude.part（断点续传）→ 按官方清单核 sha256 → 试跑 --version → 旧的改名 claude.prev（留一版可回退）→ 新的换上。
 * 正在跑的 claude 已经映射了旧文件，换名不影响它；下一轮对话起用新版。
 */
async function devUpdInstall() {
  const c = devUpd.claude;
  if (c.state === "installing" || !c.latest) return;
  if (c.latestCh && c.latestCh !== devUpd.channel) return;   // 查到的是换渠道之前那个渠道的版本
  c.state = "installing"; c.message = ""; c.done = 0; c.total = 0;
  const want = c.latest;   // 开装时定死：装的途中换渠道会改 c.latest，清单、程序、试跑核对要是同一个版本（DeepSeek 复核 11-04）
  if (c.latestFrom === "npm") return devUpdInstallNpm(want);
  const part = PATHS.claude + ".part", tag = PATHS.claude + ".part.sha256";
  try {
    // 清单要过 Anthropic 的 PGP 签名（同 install-claude.mjs）：只靠 TLS 的话，装了别的根证书的代理能连清单带程序一起换掉（11-03 审查 L-11）
    const get = async (u) => { const r = await fetch(u, { signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error("HTTP " + r.status + " " + u); return Buffer.from(await r.arrayBuffer()); };
    const manBuf = await get(`${CC_BASE}/${want}/manifest.json`);
    const { ANTHROPIC_KEYS, verifyDetached } = await loadPgp();
    try { verifyDetached(manBuf, (await get(`${CC_BASE}/${want}/manifest.json.sig`)).toString("utf8"), ANTHROPIC_KEYS); }
    catch (e) { throw new Error(tz("官方清单的签名验不过：{msg}", { msg: e.message })); }
    const man = JSON.parse(manBuf.toString("utf8"));
    if (man.version && man.version !== want) throw new Error(tz("清单内容不对"));
    const plat = man.platforms && man.platforms["linux-arm64"];
    if (!plat || !/^[a-f0-9]{64}$/.test(plat.checksum)) throw new Error(tz("清单里没有 linux-arm64"));
    c.total = plat.size;
    let have = 0;
    try { if (fs.readFileSync(tag, "utf8").trim() === plat.checksum) have = fs.statSync(part).size; } catch {}
    if (!have) { fs.rmSync(part, { force: true }); fs.writeFileSync(tag, plat.checksum); }
    for (let attempt = 1; have < plat.size; attempt++) {
      try {
        const r = await fetch(`${CC_BASE}/${want}/linux-arm64/claude`, { headers: have ? { range: `bytes=${have}-` } : {} });
        if (r.status !== 200 && r.status !== 206) throw new Error("HTTP " + r.status);
        if (r.status === 200) { have = 0; fs.rmSync(part, { force: true }); }
        const out = fs.openSync(part, "a");
        try { for await (const chunk of r.body) { fs.writeSync(out, chunk); have += chunk.length; c.done = have; } }
        finally { fs.closeSync(out); }
      } catch (e) {
        if (attempt >= 8) throw e;
        c.message = `网络中断（${e.message}），${attempt * 3} 秒后续传…`;
        await new Promise((ok) => setTimeout(ok, attempt * 3000));
        have = fs.existsSync(part) ? fs.statSync(part).size : 0;
      }
    }
    c.message = "校验 sha256…";
    const h = crypto.createHash("sha256");
    for await (const b of fs.createReadStream(part)) h.update(b);
    const got = h.digest("hex");
    if (got !== plat.checksum) { fs.rmSync(part, { force: true }); throw new Error(tz("sha256 不符（期望 {want}…，实得 {got}…）", { want: plat.checksum.slice(0, 12), got: got.slice(0, 12) })); }
    fs.chmodSync(part, 0o755);
    const v = await claudeVersionOf(part);
    if (v !== want) throw new Error(tz("新版试跑失败（--version 得到「{v}」）", { v }));
    fs.rmSync(PATHS.claude + ".prev", { force: true });
    fs.renameSync(PATHS.claude, PATHS.claude + ".prev");
    fs.renameSync(part, PATHS.claude);
    fs.rmSync(tag, { force: true });
    log(`Claude Code 已更新 ${c.current} → ${v}`);
    c.current = v; c.state = "uptodate"; c.message = `已更新到 ${v}（下一轮对话起生效；旧版留在 claude.prev）`;
  } catch (e) {
    c.state = "error"; c.message = e.message;
  } finally { devUpdSave(); }
}

/**
 * 应用本体更新：从 GitHub Release 下载 tar.gz + .sha256 + .sig，核过 sha256 后
 * 交给 `cccodroid update`（它自己会用已装版本的发布公钥验签、原子切 current、重启网关）。
 * 必须放到 systemd-run 的独立 unit 里跑：update 会重启网关，网关 cgroup 里的子进程会被一起杀掉。
 */
async function devUpdInstallApp() {
  const a = devUpd.app;
  if (!a.current || a.state === "downloading" || a.state === "installing") return;
  a.state = "downloading"; a.message = tz("正在下载…"); a.done = 0; a.total = 0; devUpdSave();
  try {
    const j = await appLatest(true);
    if (!j.tar || !j.sha) throw new Error(tz("这个发布里没有 tar.gz 或 .sha256"));
    if (cmpVer(j.version, a.current) <= 0) { a.state = "uptodate"; a.message = tz("已是最新（{v}）", { v: a.current }); devUpdSave(); return; }
    const dir = path.join(CFG.home, "updates");
    fs.mkdirSync(dir, { recursive: true });
    const name = path.basename(String(j.tar.name || "cccodroid.tar.gz"));
    const file = path.join(dir, name), part = file + ".part";
    fs.rmSync(part, { force: true });
    const r = await fetchAsset(j.tar.browser_download_url, 15000);
    if (!r.ok) throw new Error("HTTP " + r.status);
    a.total = Number(r.headers.get("content-length") || 0);
    const out = fs.openSync(part, "w");
    try { for await (const chunk of r.body) { fs.writeSync(out, chunk); a.done += chunk.length; } }
    finally { fs.closeSync(out); }
    a.message = tz("校验 sha256…"); devUpdSave();
    const sr = await fetchAsset(j.sha.browser_download_url, 20000);
    if (!sr.ok) throw new Error("校验文件 HTTP " + sr.status);
    const want = (await sr.text()).trim().split(/\s+/)[0];
    if (!/^[a-f0-9]{64}$/i.test(want)) throw new Error(tz("校验文件内容不对"));
    const h = crypto.createHash("sha256");
    for await (const b of fs.createReadStream(part)) h.update(b);
    if (h.digest("hex") !== want.toLowerCase()) throw new Error(tz("sha256 不符，已放弃安装"));
    fs.renameSync(part, file);
    if (j.sig) {
      const gr = await fetchAsset(j.sig.browser_download_url, 20000);
      if (!gr.ok) throw new Error("签名文件 HTTP " + gr.status);
      fs.writeFileSync(file + ".sig", await gr.text());
    }
    const cli = path.join(APP_PREFIX, "current", "bin", "cccodroid");
    if (!fs.existsSync(cli)) throw new Error(tz("找不到 {p}", { p: cli }));
    a.state = "installing"; a.message = tz("正在安装，完成后网关会自动重启"); devUpdSave();
    const unit = "ccd-self-update-" + Date.now();
    execFile("systemd-run", ["--user", "--collect", "--unit", unit, cli, "update", file], { timeout: 20000 }, (e) => {
      if (e) { a.state = "error"; a.message = tz("启动更新失败：{err}", { err: e.message }); devUpdSave(); }
    });
  } catch (e) {
    a.state = "error"; a.message = e.message; devUpdSave();
  }
}

function devUpdStatus() {
  const { app, claude, ...rest } = devUpd;
  return { ok: true, ...rest, items: [app, claude] };
}

// 自动：启动 1 分钟后、之后每 30 分钟看一眼，距上次检查超过 6 小时就查；有新版且开着自动就装
if (!PREFIX) {
  const tick = async () => {
    if (!devUpd.auto || Date.now() - devUpd.lastCheck < 6 * 3600_000) return;
    await devUpdCheck();
    if (devUpd.auto && devUpd.claude.state === "available") devUpdInstall();
  };
  setTimeout(tick, 60_000);
  setInterval(tick, 30 * 60_000);
}

async function devApp(op, b) {
  if (op === "upd_status") {
    if ((!devUpd.lastCheck || devUpd.app.state === "unknown") && !devUpd.checking) devUpdCheck();
    else if (!devUpd.claude.current) devUpd.claude.current = await claudeVersionOf(PATHS.claude);
    return devUpdStatus();
  }
  if (op === "upd_check") { devUpdCheck(); await new Promise((r) => setTimeout(r, 200)); return devUpdStatus(); }
  if (op === "upd_set") {
    if (b.channel === "pinned") return { ok: false, message: tz("开发端不支持固定版本（只跟随 stable / latest）") };
    if (typeof b.auto === "boolean") devUpd.auto = b.auto;
    // 换渠道 = 明说要那个渠道的版本：查完对不上就直接换（自动更新关着也换）
    if ((b.channel === "stable" || b.channel === "latest") && b.channel !== devUpd.channel) {
      const want = devUpd.channel = b.channel, c = devUpd.claude;
      // 等到按新渠道查完再换：旧渠道的检查可能还在途，它的结果不算（#136）
      (async () => {
        for (let i = 0; i < 30 && c.latestCh !== want && devUpd.channel === want; i++) {
          await devUpdCheck();
          if (c.latestCh !== want) await new Promise((r) => setTimeout(r, 1000));
        }
        if (devUpd.channel === want && c.latestCh === want && c.state === "available") devUpdInstall();
      })().catch(() => {});
    }
    devUpdSave();
    return devUpdStatus();
  }
  if (op === "upd_apply") {
    if (b.item === "cccodroid") {
      if (devUpd.app.state !== "available" && devUpd.app.state !== "error") return { ok: false, message: tz("应用已是最新，或先检查更新") };
      devUpdInstallApp();
      return { ok: true, message: tz("开始更新 cccodroid…") };
    }
    if (b.item !== "claude") return { ok: false, message: tz("不认识的更新项：{item}", { item: String(b.item || "") }) };
    if (devUpd.claude.state !== "available" && devUpd.claude.state !== "error") return { ok: false, message: tz("没有可装的新版，先检查更新") };
    devUpdInstall();
    return { ok: true, message: tz("开始更新 Claude Code") };
  }
  if (op === "notify_status") return notifyStatus();
  if (op === "notify_set") return notifySet(b);
  if (op === "notify_focus") return notifyFocus(b);
  if (op === "notify_test") return notifyTest();
  return { ok: false, message: tz("开发端不支持：{op}", { op }) };
}

// ── Claude Code 版本选单：有哪些版本 + 官方 stable / latest 各是哪一版 ─────────────────────────
// 版本列表取 npm 镜像（Anthropic 每一版都发到 npm）；stable / latest 以官方为准（含 cccodroid.net 对官方的镜像），
// 官方和两个镜像都取不到时留空，不拿 npm 的 dist-tags 顶（两边是否始终同步没核实过）。
// 装哪一版都由 install-claude.mjs 按官方清单 / PGP / npm 签名把关
let ccVersions = { at: 0, data: null };
async function claudeVersions(force) {
  if (!force && ccVersions.data && Date.now() - ccVersions.at < 600e3) return ccVersions.data;
  const get = async (u, ms = 12000) => { const r = await fetch(u, { signal: AbortSignal.timeout(ms), headers: { Accept: "application/vnd.npm.install-v1+json" } }); if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); };
  const channel = async (ch) => {
    for (const b of ["https://downloads.claude.ai/claude-code-releases", "https://cccodroid.net/claude-code", "https://dl.cccodroid.net/claude-code"]) {
      try { const v = (await get(`${b}/${ch}`, 8000)).trim(); if (/^\d+\.\d+\.\d+/.test(v)) return v; } catch {}
    }
    return "";
  };
  let versions = [], err = "";
  for (const reg of ["https://registry.npmmirror.com", "https://registry.npmjs.org"]) {
    try {
      const j = JSON.parse(await get(`${reg}/${encodeURIComponent(NPM_PKG)}`, 20000));
      versions = Object.keys(j.versions || {}).filter((v) => /^\d+\.\d+\.\d+$/.test(v));
      if (versions.length) break;
    } catch (e) { err = e.message; }
  }
  versions.sort((a, b) => cmpVer(b, a));
  const [stable, latest] = await Promise.all([channel("stable"), channel("latest")]);
  const data = { ok: versions.length > 0 || !!stable, versions, stable, latest, message: versions.length ? "" : tz("取不到版本列表：{err}", { err }) };
  if (data.ok) ccVersions = { at: Date.now(), data };
  return data;
}

// /api/app/* 各操作收哪些字段
const APP_FIELDS = {
  upd_apply: { item: "string", version: "string" },
  upd_set: { auto: "boolean", channel: "string", version: "string", flavor: "string" },
  notify_set: { done: "boolean", ask: "boolean" },
  notify_focus: { focused: "boolean" },
};

// ── 路由：/api/claude/versions /api/app/ ──
export async function routeDevside(req, res, u, p) {
  if (req.method === "GET" && p === "/api/claude/versions") {
    const [vs, vi] = await Promise.all([claudeVersions(u.searchParams.get("refresh") === "1"), verifiedInfo((u.searchParams.get("lang") || "zh").startsWith("zh") ? "zh" : "en")]);
    return sendJson(res, 200, { ...vs, ...vi });
  }
  // Claude Code 更新和桌面通知设置
  if (p.startsWith("/api/app/")) {
    const op = p.slice(9);
    const OPS = ["upd_status", "upd_check", "upd_apply", "upd_set", "notify_status", "notify_set", "notify_focus", "notify_test"];
    if (!OPS.includes(op)) return sendJson(res, 404, { ok: false, message: tz("未知操作") });
    const raw = req.method === "POST" ? JSON.parse((await readBody(req)) || "{}") : {};
    // 只收各操作认的字段、认的类型（11-01 独立审查低-3）
    const b = {};
    for (const [k, ty] of Object.entries(APP_FIELDS[op] || {})) {
      const v = raw && raw[k];
      if (v === undefined) continue;
      if (typeof v !== ty || (ty === "string" && v.length > 4096) || (ty === "number" && !Number.isFinite(v))) return sendJson(res, 400, { ok: false, message: tz("请求参数不对") });
      b[k] = v;
    }
    return sendJson(res, 200, await devApp(op, b));
  }
  return NEXT;
}
