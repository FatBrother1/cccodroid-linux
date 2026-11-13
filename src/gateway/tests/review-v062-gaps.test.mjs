// v0.6.2 审查复核补的回归测试：#122-4 命令名预留、#120-4 工具结果跨页保留、#123-4 屏幕工具等待时长
import "../gw/config.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// 02-chat-view.js 里真实的结果表代码，单独拿出来跑
const chatSrc = fs.readFileSync(new URL("../web/app/02-chat-view.js", import.meta.url), "utf8");
const take = (text, start, end) => { const i = text.indexOf(start), j = text.indexOf(end, i); assert.ok(i >= 0 && j > i, start); return text.slice(i, j); };
function results() {
  const box = { Map, String };
  vm.runInNewContext(take(chatSrc, "  const TOOL_RESULTS = new Map();", "  /** 用户亲手收起") +
    "\nglobalThis.R = { TOOL_RESULTS, rememberResult, clearToolResults, get chars() { return resultChars; } };", box);
  return box.R;
}

test("工具结果单独存：同 id 覆盖、条数和总字数有上限、刚存的最后才丢（#120-4）", () => {
  const R = results();
  R.rememberResult("t1", false, "boom");
  R.rememberResult("t1", true, "ok!!");
  assert.deepEqual({ ...R.TOOL_RESULTS.get("t1") }, { ok: true, text: "ok!!" }, "同 id 后到的为准");
  assert.equal(R.chars, 4, "覆盖时字数不重复计");
  for (let i = 0; i < 2100; i++) R.rememberResult("n" + i, i % 2 === 0, "x");
  assert.equal(R.TOOL_RESULTS.size, 2000, "条数封顶");
  assert.ok(!R.TOOL_RESULTS.has("t1") && R.TOOL_RESULTS.has("n2099"), "先丢最早的");
  assert.equal(R.TOOL_RESULTS.get("n2098").ok, true);
  assert.equal(R.TOOL_RESULTS.get("n2099").ok, false, "失败状态留着");
  R.rememberResult("big", true, "y".repeat(8000001));
  assert.equal(R.TOOL_RESULTS.size, 1, "超总字数：只剩刚存的这一条");
  assert.ok(R.TOOL_RESULTS.has("big"));
  R.clearToolResults();
  assert.equal(R.TOOL_RESULTS.size, 0);
  assert.equal(R.chars, 0);
});

test("卡片重建时把先到的结果贴回去（#120-4）", () => {
  const src = take(chatSrc, "    if (id) {\n      TOOL_CARDS.set(id, api);", "    return api;");
  assert.match(src, /TOOL_RESULTS\.get\(id\)/);
  assert.match(src, /api\.result\(res\.ok, res\.text\)/);
});
