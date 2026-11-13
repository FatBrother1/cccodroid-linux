// ── Linux 版「可选组件 / 自定义组件」────────────────────────────────────
// 上游的组件市场是 Termux/arm64 包，Steam Deck 是 x86_64，不能直接装。
// 这里给 Linux 一套能用的等价物：
//   · 可选组件：检测系统里已有的命令；能用户级安装的（Flatpak / 官方静态包）直接装到
//     <前缀>/components，命令链进 <前缀>/prefix/bin（Claude 与终端都在 PATH 里）。
//     需要 root 的只给命令和说明，不假装能替你输密码。
//   · 自定义组件：用户导入 x86_64 ELF / AppImage / 脚本，复制到
//     <前缀>/home/.cccodroid/custom/<id>，生成同名命令和 Claude 技能；可随时移除。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CFG, log, tz } from "./config.mjs";
import { NEXT, readBody, sendJson } from "./http.mjs";
import { pathBlocked } from "./files.mjs";

const run = promisify(execFile);
const ROOT = path.resolve(CFG.home, "..");                 // 安装前缀
const COMP_DIR = path.join(ROOT, "components");
const BIN_DIR = path.join(ROOT, "prefix", "bin");
const CUSTOM_DIR = path.join(CFG.home, ".cccodroid", "custom");
const SKILLS = path.join(CFG.home, ".claude", "skills");
const REC = "cccodroid-custom.json";
const CMD_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
// 网关把 HOME / XDG_* 收进了应用自己的 home（会话、配置都留在前缀里）。
// Flatpak 的用户安装和 remote 是按 HOME / XDG_DATA_HOME 找的：直接用网关环境会看不到
// 用户自己的 flathub，报 `No remote refs found for 'flathub'`。这里用 passwd 里的真实 home。
const REAL_HOME = os.userInfo().homedir;
const flatpakEnv = () => ({
  ...process.env,
  HOME: REAL_HOME,
  XDG_DATA_HOME: path.join(REAL_HOME, ".local", "share"),
  XDG_CONFIG_HOME: path.join(REAL_HOME, ".config"),
  XDG_CACHE_HOME: path.join(REAL_HOME, ".cache"),
  XDG_STATE_HOME: path.join(REAL_HOME, ".local", "state"),
});
const shq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";

// 可选组件清单：method=flatpak 用户级安装；download 官方静态包；guide 只给命令。
const CATALOG = [
  { id: "chromium", name: "浏览器组件（无头 Chromium）", category: "dev", bins: ["chromium", "chromium-browser", "google-chrome-stable"], method: "flatpak", pkg: "org.chromium.Chromium", size: "约 300 MB",
    desc: "让 Claude 打开网页、截图、导出 PDF、读渲染后的 DOM。装的是 Flatpak 用户级应用，不需要 root。" },
  { id: "ffmpeg", name: "FFmpeg（音视频）", category: "media", bins: ["ffmpeg", "ffprobe"], method: "download", url: "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz", archive: "tar.xz", size: "约 40 MB", versionArgs: ["-version"],
    desc: "转码、剪辑、抽帧、录屏后处理。装官方静态版到应用目录，不碰系统分区。" },
  { id: "yt-dlp", name: "yt-dlp（视频下载）", category: "net", bins: ["yt-dlp"], method: "download", url: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux", size: "约 30 MB",
    desc: "从支持的站点下载视频/音频，配合 FFmpeg 使用。装官方单文件版到应用目录。" },
  { id: "restic", name: "备份与同步（restic）", category: "net", bins: ["restic"], method: "guide", size: "视安装方式",
    desc: "加密、去重的增量备份。需要 root 或系统包管理器；也可以从 restic.net 下静态包放到用户目录。",
    guide: "SteamOS 推荐：先装 Flatpak 版备份工具，或在 Konsole 执行 `sudo pacman -S restic`（会解锁只读根分区，系统更新后可能丢失）。更稳的是从 https://restic.net 下载 linux_amd64 静态包，解压后把 restic 放进 ~/.local/bin。" },
  { id: "apktool", name: "APK 检查工具（apktool + dex2jar）", category: "dev", bins: ["apktool"], method: "guide", size: "约 40 MB（含 JRE）",
    desc: "解码 APK 的资源、Manifest、smali；dex2jar 把 classes.dex 转成 JAR。只用于自己开发或已获授权的应用。",
    guide: "先装 Java（`sudo pacman -S jre-openjdk` 或 Flatpak），再从 https://apktool.org 下载 apktool.jar，把 `java -jar apktool.jar` 包成 ~/.local/bin/apktool。没有 root 时建议用 Distrobox 装。" },
  { id: "gradle", name: "Gradle（Java 构建）", category: "dev", bins: ["gradle"], method: "guide", size: "约 130 MB",
    desc: "Java / Android 项目构建。建议用项目自带的 gradlew，或把 Gradle 发行版解压到用户目录。",
    guide: "从 https://gradle.org/releases 下载 -bin.zip，解压到 ~/Applications/gradle，把 bin/gradle 链进 ~/.local/bin；同时需要 JDK（`sudo pacman -S jdk-openjdk` 或 Distrobox）。" },
  { id: "sevenzip", name: "7-Zip", category: "other", bins: ["7z", "7zz"], method: "guide", size: "约 2 MB", versionArgs: ["i"],
    desc: "解压 7z / zip / rar / iso 等几十种格式。",
    guide: "SteamOS 上可用 `sudo pacman -S 7zip`；不想动系统分区就下载 7zz 静态包放到 ~/.local/bin。" },
  { id: "imagemagick", name: "ImageMagick", category: "media", bins: ["magick", "convert"], method: "guide", size: "约 30 MB",
    desc: "批量改图、转格式、裁剪、加水印。",
    guide: "SteamOS 上可用 `sudo pacman -S imagemagick`；也可以从 https://imagemagick.org 下载 AppImage/静态包放到 ~/.local/bin。" },
];

function which(bin) {
  for (const d of String(process.env.PATH || "").split(":")) {
    if (!d) continue;
    const p = path.join(d, bin);
    try {
      const st = fs.statSync(p);
      if (st.isFile() && (st.mode & 0o111)) return p;
    } catch {}
  }
  return "";
}

async function versionOf(bin, args) {
  for (const a of [args, ["--version"], ["-version"]]) {
    if (!a) continue;
    try {
      const { stdout } = await run(bin, a, { timeout: 4000, maxBuffer: 64 << 10 });
      const line = String(stdout || "").split("\n").find((x) => x.trim());
      if (line) return line.trim().slice(0, 80);
    } catch {}
  }
  return "";
}

async function flatpakVersion(pkg) {
  if (!which("flatpak")) return "";
  try {
    const { stdout } = await run("flatpak", ["info", "--show-version", pkg], { timeout: 5000, env: flatpakEnv() });
    return String(stdout || "").trim().slice(0, 40);
  } catch { return ""; }
}

async function statusOf(it) {
  const found = it.bins.map((b) => ({ b, p: which(b) })).find((x) => x.p);
  let version = "";
  if (found) version = await versionOf(found.p, it.versionArgs);
  const fp = it.method === "flatpak" ? await flatpakVersion(it.pkg) : "";
  const managed = fs.existsSync(path.join(COMP_DIR, it.id));
  return { ...it, installed: !!(found || fp), version: version || fp || "", path: found ? found.p : "", managed };
}

function linkBin(src, name) {
  fs.mkdirSync(BIN_DIR, { recursive: true });
  const dest = path.join(BIN_DIR, name);
  try { fs.rmSync(dest, { force: true }); } catch {}
  fs.symlinkSync(path.relative(BIN_DIR, src), dest);
}

function findFile(dir, name) {
  let out = [];
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out = out.concat(findFile(p, name));
      else if (e.name === name) out.push(p);
      if (out.length >= 4) break;
    }
  } catch {}
  return out;
}

async function installDownload(it) {
  fs.mkdirSync(COMP_DIR, { recursive: true });
  const dir = path.join(COMP_DIR, it.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, ".download");
  const r = await fetch(it.url, { redirect: "follow", signal: AbortSignal.timeout(900000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
  let bins = [];
  if (it.archive === "tar.xz") {
    await run("tar", ["-xJf", tmp, "-C", dir], { timeout: 180000, maxBuffer: 8 << 20 });
    fs.rmSync(tmp, { force: true });
    for (const b of it.bins) bins.push({ name: b, path: findFile(dir, b)[0] || "" });
  } else {
    const dest = path.join(dir, it.bins[0]);
    fs.renameSync(tmp, dest);
    fs.chmodSync(dest, 0o755);
    bins.push({ name: it.bins[0], path: dest });
  }
  for (const b of bins) if (b.path) linkBin(b.path, b.name);
  return bins.filter((b) => b.path).map((b) => b.name);
}

async function removeComponent(it) {
  const dir = path.join(COMP_DIR, it.id);
  for (const b of it.bins) {
    const p = path.join(BIN_DIR, b);
    try {
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink() && fs.readlinkSync(p).includes(path.join("components", it.id))) fs.unlinkSync(p);
      else if (st.isFile()) {
        const t = fs.readFileSync(p, "utf8");
        if (t.includes("cccodroid 可选组件") && it.pkg && t.includes(`run ${shq(it.pkg)}`)) fs.unlinkSync(p);
      }
    } catch {}
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

function readCustom() {
  const out = [];
  try {
    for (const d of fs.readdirSync(CUSTOM_DIR, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name.startsWith(".")) continue;
      try {
        const r = JSON.parse(fs.readFileSync(path.join(CUSTOM_DIR, d.name, REC), "utf8"));
        if (r && r.cmd && r.target && fs.existsSync(r.target)) out.push(r);
      } catch {}
    }
  } catch {}
  return out.sort((a, b) => (b.at || 0) - (a.at || 0));
}

function saveCustom(dir, rec) { fs.writeFileSync(path.join(dir, REC), JSON.stringify(rec, null, 2)); }

function skillText(rec) {
  return `---\nname: custom-${rec.id}\ndescription: ${JSON.stringify(`用户自己导入的命令「${rec.name}」（${rec.cmd}）。需要运行这个命令时使用。`)}\n---\n\n# ${rec.name}（自定义组件）\n\n这是用户在 cccodroid 扩展页「自定义组件」里导入的 x86_64 程序，**没有经过 cccodroid 验证**。\n\n- 命令：\`${rec.cmd}\`\n- 入口：\`${rec.target}\`\n- 来源：\`${rec.source}\`\n- 导入时间：${new Date(rec.at).toLocaleString()}\n\n直接运行 \`${rec.cmd} --help\` 或 \`${rec.cmd} --version\` 看用法；能不能用以实际运行为准。\n`;
}

async function importCustom(b) {
  const src = String(b.path || "").trim();
  const cmd = String(b.cmd || "").trim();
  if (!src) return { ok: false, message: tz("请填程序路径") };
  if (!CMD_RE.test(cmd)) return { ok: false, message: tz("命令名只能用字母、数字、点、下划线、连字符，最长 32 个字符") };
  let real;
  try { real = fs.realpathSync(path.isAbsolute(src) ? src : path.join(CFG.workspace, src)); }
  catch { return { ok: false, message: tz("路径不存在：{p}", { p: src }) }; }
  if (pathBlocked(real)) return { ok: false, message: tz("这个路径不允许导入") };
  if (which(cmd)) return { ok: false, message: tz("命令 {c} 已经存在，换个命令名", { c: cmd }) };
  const st = fs.statSync(real);
  let target = real;
  if (st.isDirectory()) {
    const cand = [path.join(real, "bin", cmd), path.join(real, cmd)].find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
    if (!cand) return { ok: false, message: tz("目录里找不到可执行文件；请直接选文件，或把程序放在 <目录>/bin/{c}", { c: cmd }) };
    target = cand;
  }
  if (!fs.statSync(target).isFile()) return { ok: false, message: tz("不是文件") };
  const head = Buffer.alloc(64);
  const fd = fs.openSync(target, "r");
  try { fs.readSync(fd, head, 0, 64, 0); } finally { fs.closeSync(fd); }
  const isElf = head.readUInt32BE(0) === 0x7f454c46;
  const isScript = head.toString("latin1", 0, 2) === "#!";
  if (isElf) {
    if (head[4] !== 2 || head.readUInt16LE(18) !== 62) return { ok: false, message: tz("这不是 x86_64 的 64 位程序（Deck 跑不了）") };
  } else if (!isScript) {
    return { ok: false, message: tz("只支持 x86_64 ELF、AppImage 或带 shebang 的脚本") };
  }
  const id = cmd + "-" + crypto.createHash("sha1").update(real + ":" + Date.now()).digest("hex").slice(0, 6);
  const dir = path.join(CUSTOM_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  const appDir = path.join(dir, "app");
  if (st.isDirectory()) {
    fs.cpSync(real, appDir, { recursive: true, dereference: true });
    target = path.join(appDir, path.relative(real, target));
  } else {
    fs.mkdirSync(appDir, { recursive: true });
    target = path.join(appDir, path.basename(real));
    fs.copyFileSync(real, target);
  }
  fs.chmodSync(target, 0o755);
  fs.mkdirSync(BIN_DIR, { recursive: true });
  const wrapper = path.join(BIN_DIR, cmd);
  const q = "'" + target.replace(/'/g, "'\\''") + "'";
  fs.writeFileSync(wrapper, `#!/bin/sh\n# cccodroid 自定义组件「${cmd}」\nexec ${q} "$@"\n`);
  fs.chmodSync(wrapper, 0o755);
  fs.mkdirSync(SKILLS, { recursive: true });
  const sk = path.join(SKILLS, "custom-" + id);
  fs.rmSync(sk, { recursive: true, force: true });
  fs.mkdirSync(sk, { recursive: true });
  const rec = { id, name: String(b.name || cmd).slice(0, 60), cmd, source: real, target, at: Date.now() };
  fs.writeFileSync(path.join(sk, "SKILL.md"), skillText(rec));
  saveCustom(dir, rec);
  log(`[custom] 导入 ${cmd} ← ${real}`);
  return { ok: true, item: rec };
}

async function removeCustom(id) {
  if (!/^[A-Za-z0-9._-]+$/.test(String(id || ""))) return { ok: false, message: "bad id" };
  const dir = path.join(CUSTOM_DIR, id);
  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(path.join(dir, REC), "utf8")); } catch {}
  fs.rmSync(dir, { recursive: true, force: true });
  if (rec && rec.cmd) { try { fs.rmSync(path.join(BIN_DIR, rec.cmd), { force: true }); } catch {} }
  fs.rmSync(path.join(SKILLS, "custom-" + id), { recursive: true, force: true });
  return { ok: true };
}

export async function routeLinuxComponents(req, res, u, p) {
  if (p === "/api/components" && req.method === "GET") {
    const items = await Promise.all(CATALOG.map(statusOf));
    return sendJson(res, 200, { ok: true, items });
  }
  if (p === "/api/components/install" && req.method === "POST") {
    let b; try { b = JSON.parse(await readBody(req) || "{}"); } catch { return sendJson(res, 400, { ok: false, message: "bad json" }); }
    const it = CATALOG.find((x) => x.id === b.id);
    if (!it) return sendJson(res, 404, { ok: false, message: "unknown component" });
    try {
      if (it.method === "guide") return sendJson(res, 200, { ok: false, message: it.guide, guide: it.guide });
      if (it.method === "flatpak") {
        await run("flatpak", ["remote-add", "--user", "--if-not-exists", "flathub", "https://flathub.org/repo/flathub.flatpakrepo"], { timeout: 120000, env: flatpakEnv(), maxBuffer: 8 << 20 });
        await run("flatpak", ["install", "-y", "--user", "flathub", it.pkg], { timeout: 900000, env: flatpakEnv(), maxBuffer: 8 << 20 });
        // 给 Claude 一个普通命令名：网关的 PATH 里有 <前缀>/prefix/bin，包装脚本负责带上真实 HOME。
        const fp = which("flatpak") || "flatpak";
        const env = flatpakEnv();
        const wrapper = path.join(BIN_DIR, it.bins[0]);
        fs.mkdirSync(BIN_DIR, { recursive: true });
        fs.writeFileSync(wrapper, `#!/bin/sh\n# cccodroid 可选组件「${it.name}」（Flatpak）\nexec env HOME=${shq(env.HOME)} XDG_DATA_HOME=${shq(env.XDG_DATA_HOME)} XDG_CONFIG_HOME=${shq(env.XDG_CONFIG_HOME)} XDG_CACHE_HOME=${shq(env.XDG_CACHE_HOME)} ${shq(fp)} run ${shq(it.pkg)} "$@"\n`);
        fs.chmodSync(wrapper, 0o755);
        return sendJson(res, 200, { ok: true, message: tz("已安装 {n}", { n: it.name }) });
      }
      const bins = await installDownload(it);
      return sendJson(res, 200, { ok: true, message: tz("已安装 {n}（{b}）", { n: it.name, b: bins.join(", ") }) });
    } catch (e) {
      return sendJson(res, 500, { ok: false, message: tz("安装失败：{err}", { err: e.message }) });
    }
  }
  if (p === "/api/components/remove" && req.method === "POST") {
    let b; try { b = JSON.parse(await readBody(req) || "{}"); } catch { return sendJson(res, 400, { ok: false, message: "bad json" }); }
    const it = CATALOG.find((x) => x.id === b.id);
    if (!it) return sendJson(res, 404, { ok: false, message: "unknown component" });
    try { await removeComponent(it); return sendJson(res, 200, { ok: true }); }
    catch (e) { return sendJson(res, 500, { ok: false, message: e.message }); }
  }
  if (p === "/api/custom" && req.method === "GET") return sendJson(res, 200, { ok: true, items: readCustom() });
  if (p === "/api/custom/import" && req.method === "POST") {
    let b; try { b = JSON.parse(await readBody(req) || "{}"); } catch { return sendJson(res, 400, { ok: false, message: "bad json" }); }
    const r = await importCustom(b);
    return sendJson(res, r.ok ? 200 : 400, r);
  }
  if (p === "/api/custom/remove" && req.method === "POST") {
    let b; try { b = JSON.parse(await readBody(req) || "{}"); } catch { return sendJson(res, 400, { ok: false, message: "bad json" }); }
    const r = await removeCustom(b.id);
    return sendJson(res, r.ok ? 200 : 400, r);
  }
  return NEXT;
}
