// 更新状态只读：打开更新页取 upd_status 不联网；只有显式 upd_check 才发请求。
// 同时验证手动检查不会写 lastAutoCheck，checkedOnce 在检查结束后置位。
import "../gw/config.mjs";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PATHS } from "../gw/config.mjs";
import { NEXT } from "../gw/http.mjs";
import { routeDevside } from "../gw/devside.mjs";

async function serve(...routes) {
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    for (const r of routes) if ((await r(req, res, u, u.pathname)) !== NEXT) return;
    res.writeHead(404).end();
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  return {
    get: async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; },
    post: async (p, body) => {
      const r = await fetch(base + p, { method: "POST", body: JSON.stringify(body || {}), headers: { "content-type": "application/json" } });
      return { status: r.status, body: await r.json() };
    },
  };
}

const root = fs.mkdtempSync(path.join(process.env.CCAPP_WORKSPACE, "f9-"));
const fake = path.join(root, "fake-claude.sh");
const sh = fs.existsSync("/system/bin/sh") ? "/system/bin/sh" : "/bin/sh";
fs.writeFileSync(fake, `#!${sh}\necho 9.9.9\n`, { mode: 0o700 });
const prev = { claude: PATHS.claude, loader: PATHS.loader, claudeLoader: PATHS.claudeLoader };
PATHS.claude = process.execPath;
PATHS.loader = PATHS.claudeLoader = fake;
after(() => { Object.assign(PATHS, prev); fs.rmSync(root, { recursive: true, force: true }); });

let fetchCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith("http://127.0.0.1")) return realFetch(url, opts);
  fetchCalls++;
  if (u.includes("api.github.com")) {
    return new Response(JSON.stringify([{ tag_name: "v9.9.9", draft: false, prerelease: false,
      assets: [{ name: "cccodroid-9.9.9-linux-x86_64.tar.gz", browser_download_url: "http://x/pkg.tar.gz" }] }]),
    { status: 200, headers: { "content-type": "application/json" } });
  }
  if (u.includes("downloads.claude.ai")) return new Response("9.9.9", { status: 200 });
  throw new Error("unexpected fetch: " + u);
};

const go = await serve(routeDevside);

test("upd_status 只读：取状态不联网，checkedOnce 初始为 false", async () => {
  fetchCalls = 0;
  const r = await go.get("/api/app/upd_status");
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.checkedOnce, false);
  assert.equal(r.body.lastCheck, 0);
  assert.equal(fetchCalls, 0, "upd_status 不应触发联网检查");
});

test("upd_check 显式检查：lastCheck 置位、lastAutoCheck 不动、checkedOnce 置位", async () => {
  fetchCalls = 0;
  const r = await go.post("/api/app/upd_check", {});
  assert.equal(r.status, 200);
  for (let i = 0; i < 100; i++) {
    const s = await go.get("/api/app/upd_status");
    if (!s.body.checking) break;
    await new Promise((ok) => setTimeout(ok, 30));
  }
  const s = await go.get("/api/app/upd_status");
  assert.equal(s.body.checking, false);
  assert.ok(s.body.lastCheck > 0, "手动检查应更新 lastCheck");
  assert.equal(s.body.lastAutoCheck, 0, "手动检查不应冒充自动检查");
  assert.equal(s.body.checkedOnce, true);
  assert.ok(fetchCalls >= 1, "显式检查应至少发出一次请求");
  assert.equal(s.body.items[1].latest, "9.9.9");
});
