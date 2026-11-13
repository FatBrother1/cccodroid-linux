// 11-04 构建与设备报告第六节的安全项回归（细节在私密台账）
import "../gw/config.mjs";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { CFG } from "../gw/config.mjs";
import { NEXT } from "../gw/http.mjs";

// CI 的 Linux 没有 /system/bin/sh（#113 同款）
const SH = fs.existsSync("/system/bin/sh") ? "/system/bin/sh" : "/bin/sh";
import { routeGit } from "../gw/git.mjs";

async function serve(...routes) {
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    for (const r of routes) if ((await r(req, res, u, u.pathname)) !== NEXT) return;
    res.writeHead(404).end();
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  after(() => srv.close());
  return async (p, body) => {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}${p}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
}

test("第一次推送：远端名是 --receive-pack=… 这种就拒绝，不把它当参数交给 git", async () => {
  { const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim(), bin = path.join(process.env.CCAPP_PREFIX, "bin", "git");
    if (!fs.existsSync(bin)) fs.symlinkSync(real, bin); }
  const gitGo = await serve(routeGit);
  const d = path.join(CFG.workspace, "hv2b-push");
  fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true });
  const g = (...a) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: d, encoding: "utf8" });
  g("init", "-q", "-b", "main"); fs.writeFileSync(path.join(d, "f.txt"), "a\n"); g("add", "f.txt"); g("commit", "-qm", "i");
  const mark = path.join(d, "pwned");
  g("config", `remote.--receive-pack=touch ${mark}.url`, d);
  const r = await gitGo("/api/git/push", { dir: d });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error, "bad_remote");
  assert.ok(!fs.existsSync(mark));
});

test("自定义接口条目里自带 explicit:false / local / login / id：都不认，密钥不回落到别家那把", () => {
  const home = fs.mkdtempSync(path.join(process.env.CCAPP_TMP, "hv2b-prov-"));
  fs.writeFileSync(path.join(home, "ccapp-config.json"), JSON.stringify({ apiKey: "sk-deepseek-fixture" }));
  fs.writeFileSync(path.join(home, "ccapp-providers.json"), JSON.stringify({ active: "custom-1", providers: {
    "custom-1": { label: "x", baseUrl: "https://evil.example.invalid", explicit: false, local: true, login: true, nativeModels: true, id: "deepseek" } } }));
  fs.writeFileSync(path.join(home, "ccapp-settings.json"), "{}");
  const gw = new URL("../gw/", import.meta.url).href;
  const src = `const p = await import(${JSON.stringify(gw + "providers.mjs")}); p.applyProvider();
    const P = p.PROVIDER; console.log(JSON.stringify({ id: P.id, explicit: P.explicit, local: !!P.local, login: !!P.login, native: !!P.nativeModels, key: p.API_KEY }));`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", src], {
    env: { ...process.env, CCAPP_HOME: home, HOME: home, CCAPP_TEST: "1", ANTHROPIC_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "" }, encoding: "utf8" });
  const j = JSON.parse(out.trim().split("\n").pop());
  assert.deepEqual(j, { id: "custom-1", explicit: true, local: false, login: false, native: false, key: null });
});
