// v0.7.5 MCP 编辑的路由接线：停用条目不需要起 claude，直接经 HTTP 走 get / edit；
// 远程 MCP 带环境变量的提交在 add 入口就被拒（不起 claude）。
import "../gw/config.mjs";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { NEXT } from "../gw/http.mjs";
import { routeExtensions } from "../gw/extensions.mjs";
import { extOff, saveExtOff, EXT_OFF_FILE } from "../gw/extoff.mjs";

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
      const r = await fetch(base + p, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
      return { status: r.status, body: await r.json() };
    },
  };
}
const go = await serve(routeExtensions);
after(() => { try { fs.rmSync(EXT_OFF_FILE, { force: true }); } catch {} });

test("路由：停用条目可读预填、可编辑，令牌值不回传", async () => {
  saveExtOff({ mcp: { dx: { type: "http", url: "http://old/mcp", headers: { Authorization: "Bearer tok", "X-A": "1" } } } });
  const g = await go.get("/api/ext/mcp/get?name=dx");
  assert.equal(g.status, 200);
  assert.equal(g.body.ok, true);
  assert.equal(g.body.transport, "http");
  assert.equal(g.body.target, "http://old/mcp");
  assert.deepEqual(g.body.headerNames, ["Authorization", "X-A"]);
  assert.equal(JSON.stringify(g.body).includes("Bearer tok"), false, "令牌值不能出现在预填响应里");
  const ed = await go.post("/api/ext/mcp/edit", { name: "dx", newName: "dx2", transport: "http", target: "http://new/mcp", dropHeaders: ["X-A"] });
  assert.equal(ed.body.ok, true, ed.body.message);
  const off = extOff();
  assert.equal(off.mcp.dx, undefined);
  assert.deepEqual(off.mcp.dx2, { type: "http", url: "http://new/mcp", headers: { Authorization: "Bearer tok" } });
});

test("路由：远程 MCP 带环境变量在 add / edit 入口都被拒", async () => {
  const a = await go.post("/api/ext/mcp/add", { name: "r1", transport: "http", target: "http://h/mcp", env: ["Authorization=Bearer tok"] });
  assert.equal(a.body.ok, false);
  assert.match(a.body.message, /远程 MCP 不支持环境变量/);
  saveExtOff({ mcp: { r2: { type: "http", url: "http://h/mcp" } } });
  const e = await go.post("/api/ext/mcp/edit", { name: "r2", transport: "http", target: "http://h/mcp", env: ["A=1"] });
  assert.equal(e.body.ok, false);
  assert.match(e.body.message, /远程 MCP 不支持环境变量/);
});
