#!/usr/bin/env node
// 首次安装用的 Claude Code 下载器：从 npm 官方平台包取 Anthropic 的原生二进制。
// 为什么走 npm：官方直链 downloads.claude.ai 在部分网络连不上；Anthropic 把同一份二进制发在
// @anthropic-ai/claude-code-linux-<arch> 里。这里用钉死的 npm 公钥验「包名@版本:integrity」的 ECDSA 签名，
// 再校 sha512、解出 package/claude、试跑 --version，最后原子换上去。
// 用法：
//   node install-claude.mjs --dest <路径> [--version 2.1.x] [--from 本地文件]
//   环境变量：CCCODROID_NPM_REGISTRY（默认先 npmmirror 再 npmjs）、CCCODROID_NPM_PKG（覆盖包名）
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : ""; };
const dest = opt("--dest");
const wantVer = opt("--version");
const from = opt("--from");
if (!dest) { console.error("用法：install-claude.mjs --dest <路径> [--version 版本] [--from 本地文件]"); process.exit(2); }

const ARCH = process.arch === "arm64" ? "arm64" : "x64";
const PKG = process.env.CCCODROID_NPM_PKG || `@anthropic-ai/claude-code-linux-${ARCH}`;
const REGS = (process.env.CCCODROID_NPM_REGISTRY || "").split(",").filter(Boolean).concat(["https://registry.npmmirror.com", "https://registry.npmjs.org"]);
// npm registry 的签名公钥（https://registry.npmjs.org/-/npm/v1/keys，只留没过期的）
const NPM_KEYS = { "SHA256:DhQ8wR5APBvFHLF/+Tc+AYvPOdTpcIDqOhxsBHRwC7U": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEY6Ya7W++7aUPzvMTrezH6Ycx3c+HOKYCcNGybJZSCJq/fd7Qa8uuAKtdIkUQtQiEKERhAmE5lMMJhP8OkDOa2g==" };
const log = (m) => console.error(`[install-claude] ${m}`);
const die = (m) => { console.error(`[install-claude] 失败：${m}`); process.exit(1); };

async function getJson(url, ms = 20000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { Accept: "application/vnd.npm.install-v1+json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return JSON.parse(await r.text());
}

async function meta() {
  const errs = [];
  for (const reg of REGS) {
    try {
      log(`读取 npm 元数据：${reg}`);
      const j = await getJson(`${reg}/${encodeURIComponent(PKG)}`);
      if (j && j.versions) return { reg, j };
      errs.push(`${reg}: 没有 versions`);
    } catch (e) { errs.push(`${reg}: ${e.message}`); }
  }
  throw new Error("取不到 npm 元数据（" + errs.join("；") + "）");
}

function verifyNpm(ver, version) {
  const integ = String((ver.dist && ver.dist.integrity) || "");
  if (!/^sha512-/.test(integ)) throw new Error("npm 元数据里没有 sha512 integrity");
  const msg = Buffer.from(`${ver.name || PKG}@${version}:${integ}`);
  const sigs = (ver.dist.signatures) || [];
  const ok = sigs.some((s) => NPM_KEYS[s.keyid] && crypto.verify("sha256", msg,
    { key: Buffer.from(NPM_KEYS[s.keyid], "base64"), format: "der", type: "spki" }, Buffer.from(s.sig, "base64")));
  if (!ok) throw new Error("npm 的签名验不过，拒绝安装");
  return integ;
}

async function download(url, part, sizeHint) {
  let have = 0;
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const r = await fetch(url, { headers: have ? { range: `bytes=${have}-` } : {} });
      if (r.status !== 200 && r.status !== 206) throw new Error("HTTP " + r.status);
      if (r.status === 200) { have = 0; fs.rmSync(part, { force: true }); }
      const out = fs.openSync(part, "a");
      try { for await (const chunk of r.body) { fs.writeSync(out, chunk); have += chunk.length; if (sizeHint && have % (16 << 20) < chunk.length) log(`已下载 ${(have / 1048576).toFixed(0)} MB / ${(sizeHint / 1048576).toFixed(0)} MB`); } }
      finally { fs.closeSync(out); }
      return;
    } catch (e) {
      if (attempt >= 8) throw e;
      log(`下载中断（${e.message}），续传…`);
      await new Promise((ok) => setTimeout(ok, attempt * 1500));
      have = fs.existsSync(part) ? fs.statSync(part).size : 0;
    }
  }
}

function runVersion(bin) {
  return new Promise((ok) => {
    execFile(bin, ["--version"], { timeout: 30000 }, (e, out) => {
      const m = String(out || "").match(/\d+\.\d+\.\d+/);
      ok(m ? m[0] : "");
    });
  });
}

async function main() {
  if (from) {
    const src = path.resolve(from);
    if (!fs.existsSync(src)) die(`找不到 ${src}`);
    fs.copyFileSync(src, dest + ".part");
    fs.chmodSync(dest + ".part", 0o755);
    const v = await runVersion(dest + ".part");
    if (!v) die("这个文件跑不起来（--version 没有输出）");
    fs.renameSync(dest + ".part", dest);
    log(`已安装本地提供的 Claude Code ${v} → ${dest}`);
    return;
  }
  const { reg, j } = await meta();
  const version = wantVer || (j["dist-tags"] && j["dist-tags"].latest) || "";
  if (!/^\d+\.\d+\.\d+/.test(version)) die("没有可安装的版本号");
  const ver = j.versions[version];
  if (!ver || !ver.dist || !ver.dist.tarball) die(`npm 上没有 ${version}`);
  const integ = verifyNpm(ver, version);
  const tarball = String(ver.dist.tarball).replace(/^http:/, "https:");
  if (!/^https:\/\//.test(tarball)) die("tarball 地址不是 https");
  log(`安装 Claude Code ${version}（${reg}）`);
  const part = dest + ".npm.part";
  fs.rmSync(part, { force: true });
  await download(tarball, part, Number(ver.dist.unpackedSize) || 0);
  const h = crypto.createHash("sha512");
  for await (const b of fs.createReadStream(part)) h.update(b);
  if ("sha512-" + h.digest("base64") !== integ) { fs.rmSync(part, { force: true }); die("包与 npm 的 sha512 不符"); }
  const tmp = path.join(path.dirname(dest), ".npm-extract-" + process.pid);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  await new Promise((ok, no) => execFile("tar", ["-xzf", part, "-C", tmp, "package/claude"], { timeout: 300000 }, (e) => e ? no(e) : ok()));
  const cand = path.join(tmp, "package", "claude");
  if (!fs.existsSync(cand)) { fs.rmSync(tmp, { recursive: true, force: true }); die("包里没有 package/claude"); }
  fs.chmodSync(cand, 0o755);
  const v = await runVersion(cand);
  if (v !== version) { fs.rmSync(tmp, { recursive: true, force: true }); die(`试跑失败（--version 得到「${v}」，期望 ${version}）`); }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest + ".prev", { force: true });
  if (fs.existsSync(dest)) fs.renameSync(dest, dest + ".prev");
  fs.renameSync(cand, dest);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(part, { force: true });
  log(`完成：Claude Code ${v} → ${dest}`);
}

main().catch((e) => die(e.message || String(e)));
