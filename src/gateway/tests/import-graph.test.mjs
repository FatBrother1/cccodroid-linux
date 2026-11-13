// 静态检查：网关和测试里每个相对 import 指向的文件必须存在，具名导入必须是目标模块导出的名字。
// 删模块、改名、挪函数之后，悬空的 import 在这里一次报全；模块成环造成的导入期错误由 linux-notify.test.mjs 末尾的启动冒烟盯着。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const list = (dir, re) => { try { return fs.readdirSync(path.join(ROOT, dir)).filter((f) => re.test(f)).map((f) => path.join(ROOT, dir, f)); } catch { return []; } };
const SRC = [path.join(ROOT, "server.mjs"), ...list("gw", /\.mjs$/), ...list("guard", /\.mjs$/), ...list("archive", /\.mjs$/)];
const TESTS = list("tests", /\.mjs$/).filter((f) => f !== fileURLToPath(import.meta.url));

const text = new Map();
const read = (f) => { if (!text.has(f)) text.set(f, fs.readFileSync(f, "utf8")); return text.get(f); };

const EXPORTS = new Map();
/** 一个模块导出的名字（含 export * from 带出来的）；解析不了的写法宁可多放过，不误报 */
function exportsOf(file, seen = new Set()) {
  if (EXPORTS.has(file)) return EXPORTS.get(file);
  if (seen.has(file)) return new Set();
  seen.add(file);
  const out = new Set();
  const s = read(file);
  for (const m of s.matchAll(/^export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm)) out.add(m[1]);
  for (const m of s.matchAll(/^export\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) out.add(m[1]);
  for (const m of s.matchAll(/^export\s+(?:const|let|var)\s*\{([^}]*)\}/gm)) for (const x of m[1].split(",")) { const n = x.split(":").pop().split("=")[0].trim(); if (n) out.add(n); }
  if (/^export\s+default\b/m.test(s)) out.add("default");
  for (const m of s.matchAll(/^export\s*\{([^}]*)\}(?:\s*from\s*["']([^"']+)["'])?/gm)) {
    for (const x of m[1].split(",")) {
      const parts = x.replace(/\/\/.*$/gm, "").trim().split(/\s+as\s+/);
      const n = (parts[1] || parts[0]).trim();
      if (n) out.add(n);
    }
  }
  for (const m of s.matchAll(/^export\s*\*\s*from\s*["'](\.[^"']+)["']/gm)) {
    const t = path.resolve(path.dirname(file), m[1]);
    if (fs.existsSync(t)) for (const n of exportsOf(t, seen)) out.add(n);
  }
  EXPORTS.set(file, out);
  return out;
}

function problems(file) {
  const bad = [];
  const s = read(file), rel = path.relative(ROOT, file);
  const need = (raw, names, kind) => {
    const spec = raw.split("?")[0];                                   // ?reload=1 这类缓存刷新参数
    if (/^(zz-|evil)/.test(path.basename(spec))) return;                // 篡改类测试现场造出来的文件
    const t = path.resolve(path.dirname(file), spec);
    if (!fs.existsSync(t)) { bad.push(`${rel}: ${kind} ${spec} 指向的文件不存在`); return; }
    if (!names.length || !/\.m?js$/.test(t)) return;
    const have = exportsOf(t);
    for (const n of names) if (!have.has(n)) bad.push(`${rel}: 从 ${spec} 导入的 ${n} 不是它的导出`);
  };
  for (const m of s.matchAll(/^\s*import\s+([^"';]*?)\s*from\s*["'](\.[^"']+)["']/gm)) {
    const clause = m[1].replace(/\/\/.*$/gm, "");
    const names = [];
    const brace = clause.match(/\{([\s\S]*)\}/);
    if (brace) for (const x of brace[1].split(",")) { const n = x.trim().split(/\s+as\s+/)[0].trim(); if (n) names.push(n); }
    const head = clause.replace(/\{[\s\S]*\}/, "").replace(/\*\s*as\s+[\w$]+/, "").replace(/,/g, " ").trim();
    if (head) names.push("default");
    need(m[2], names, "import");
  }
  for (const m of s.matchAll(/^\s*import\s*["'](\.[^"']+)["']/gm)) need(m[1], [], "import");
  for (const m of s.matchAll(/\bimport\(\s*["'](\.[^"']+)["']\s*\)/g)) need(m[1], [], "import()");
  return bad;
}

test("网关代码：相对 import 都指向存在的文件，具名导入都是目标的导出", () => {
  assert.ok(SRC.length > 50, "扫到的网关文件太少：" + SRC.length);
  const bad = SRC.flatMap(problems);
  assert.deepEqual(bad, []);
});

test("测试代码：相对 import 也都有效（删了模块的测试要一起删）", () => {
  assert.ok(TESTS.length > 10, "扫到的测试文件太少：" + TESTS.length);
  const bad = TESTS.flatMap(problems);
  assert.deepEqual(bad, []);
});
