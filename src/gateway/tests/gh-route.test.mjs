// GitHub 登录（gw/gh.mjs，原来夹在组件模块里）：抽出来之后行为不变——gh 取终端 PATH 里的那个，只给账号名与状态
import "../gw/config.mjs";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { CFG, PREFIX } from "../gw/config.mjs";
import { NEXT } from "../gw/http.mjs";
import { termEnv } from "../gw/terminal.mjs";
import { routeGh } from "../gw/gh.mjs";

// 终端 PATH 是网关自己拼的（不看 process.env.PATH）：假 gh 放进里面落在测试 home / 假前缀下的那一项
const pathDirs = () => String(termEnv().PATH || "").split(":");
const binDir = [path.join(CFG.home, ".local", "bin"), path.join(PREFIX || "/nonexistent", "bin")].find((d) => pathDirs().includes(d));
const FAKE = binDir && path.join(binDir, "gh");
const log = path.join(CFG.home, "gh-route-argv.log");
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if ((await routeGh(req, res, u, u.pathname)) === NEXT) res.writeHead(404).end("next");
});
await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
after(() => { srv.close(); if (FAKE) fs.rmSync(FAKE, { force: true }); fs.rmSync(log, { force: true }); });
const call = async (p, method, body) => {
  const r = await fetch(`http://127.0.0.1:${srv.address().port}${p}`, method ? { method, body: body === undefined ? undefined : JSON.stringify(body) } : {});
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, text, json };
};
const sh = fs.existsSync("/bin/sh") ? "/bin/sh" : "/system/bin/sh";
const withGh = () => {
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(FAKE, `#!${sh}
if [ "$1" = auth ] && [ "$2" = status ]; then
  echo '{"hosts":{"github.com":[{"login":"alice","active":true,"state":"success"},{"login":"bob","active":false,"state":"error"}]}}'
  exit 0
fi
if [ "$1" = auth ] && { [ "$2" = logout ] || [ "$2" = switch ]; }; then echo "$@" > '${log}'; exit 0; fi
exit 1
`, { mode: 0o755 });
};
const withoutGh = () => { fs.rmSync(FAKE, { force: true }); return !pathDirs().some((d) => d && fs.existsSync(path.join(d, "gh"))); };

test("不是 /api/gh/ 的请求不认领", async () => {
  const r = await call("/api/other");
  assert.equal(r.status, 404);
  assert.equal(r.text, "next");
});

test("PATH 里没有 gh：auth 回 installed:false，登录回 ok:false", async (t) => {
  assert.ok(binDir, "终端 PATH 里没有测试 home 下的目录");
  if (!withoutGh()) return t.skip("这台机器的 PATH 里本来就有 gh");
  assert.deepEqual((await call("/api/gh/auth")).json, { installed: false });
  const r = await call("/api/gh/login", "POST", {});
  assert.equal(r.json.ok, false);
  assert.ok(r.json.message);
});

test("有 gh：auth 读出账号名、是否当前、令牌是否有效，不带别的", async () => {
  withGh();
  const r = await call("/api/gh/auth");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { installed: true, accounts: [{ login: "alice", active: true, ok: true }, { login: "bob", active: false, ok: false }], job: null });
});

test("logout / switch：用户名过格式校验再交给 gh；方法不对回 405", async () => {
  withGh();
  assert.equal((await call("/api/gh/logout", "POST", { user: "a b; rm" })).status, 400);
  assert.equal((await call("/api/gh/logout", "POST", {})).status, 400);
  assert.deepEqual((await call("/api/gh/switch", "POST", { user: "bob" })).json, { ok: true });
  assert.equal(fs.readFileSync(log, "utf8").trim(), "auth switch -h github.com -u bob");
  assert.deepEqual((await call("/api/gh/logout", "POST", { user: "alice" })).json, { ok: true });
  assert.equal(fs.readFileSync(log, "utf8").trim(), "auth logout -h github.com -u alice");
  assert.equal((await call("/api/gh/auth", "PUT", {})).status, 405);
  assert.equal((await call("/api/gh/nope", "POST", { user: "alice" })).status, 404);
});
