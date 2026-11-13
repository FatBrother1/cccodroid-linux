// 封口 / 登录状态（0.6.9 审计 195-M.4、G.3）
import "../gw/config.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { routeCaps } from "../gw/caps.mjs";
import { sealArgv } from "../gw/edition.mjs";

function fakeRes() {
  const r = { code: 0, body: null, writeHead(c) { r.code = c; }, end(b) { r.body = b ? JSON.parse(String(b)) : null; } };
  return r;
}

test("status 暴露真实登录态字段（195-G.3）", async () => {
  const res = fakeRes();
  await routeCaps({ method: "GET", headers: {} }, res, new URL("http://x/api/status"), "/api/status");
  assert.equal(res.code, 200);
  assert.ok("auth" in res.body);
});

test("claude --version 不走封口（195-M.4）", () => {
  assert.deepEqual(sealArgv(["--version"]), ["--version"]);
  // 开会话的照旧封口
  assert.ok(sealArgv(["-p", "hi"]).includes("--setting-sources"));
});
