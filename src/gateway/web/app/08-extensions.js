  // ── 扩展：插件 / 技能 / MCP ──────────────────────────────────────────
  const ext = { q: "", offset: 0, busy: false };
  const sdot = (st, label) => `<span class="sdot ${st}"><i></i>${esc(label)}</span>`;
  const extItem = (title, meta, acts, desc, tags) => `<div class="item"${tags ? ` data-tags="${esc(tags.join(" "))}"` : ""}>
      <div class="it-title">${title}</div>
      ${meta ? `<div class="it-meta">${meta}</div>` : ""}
      ${desc || ""}
      ${acts ? `<div class="it-acts">${acts}</div>` : ""}</div>`;


  function loadExt() { loadGhField(); loadExtPlugins(); loadExtCmds(); loadExtSkills(); loadExtMcp(); loadExtMarkets(); loadExtHooks(); loadComp(); loadCustom(); }

  // ── Linux 版可选组件：检测 / 用户级安装 / 给命令 ─────────────────────
  let lastComp = [];
  async function loadComp() {
    const box = $("comp-list"); if (!box) return;
    let r;
    try { r = await api("/api/components"); }
    catch (e) { box.innerHTML = `<div class="tiny err">${esc(e.message)}</div>`; return; }
    if (!r || !r.ok) { box.innerHTML = `<div class="tiny err">${esc((r && r.message) || t("取不到组件列表"))}</div>`; return; }
    lastComp = r.items || [];
    $("comp-count").textContent = `${lastComp.filter((x) => x.installed).length}/${lastComp.length}`;
    box.innerHTML = lastComp.map((it) => {
      const meta = `<span>${esc(it.category || "other")}</span><span>${esc(it.size || "")}</span>` +
        (it.installed ? `<span class="ok">${t("已安装")}${it.version ? " · " + esc(it.version) : ""}</span>` : `<span>${t("未安装")}</span>`);
      const acts = it.installed
        ? (it.managed ? `<button data-comp="remove" data-id="${esc(it.id)}">${t("移除")}</button>` : "")
        : it.method === "guide" ? `<button data-comp="guide" data-id="${esc(it.id)}">${t("复制安装命令")}</button>`
          : `<button data-comp="install" data-id="${esc(it.id)}">${t("安装")}</button>`;
      const guide = !it.installed && it.method === "guide" && it.guide ? `<div class="tiny">${esc(it.guide)}</div>` : "";
      return extItem(esc(it.name), meta, acts, `<div class="tiny">${esc(it.desc || "")}</div>${guide}`, [it.category || "other"]);
    }).join("") || `<div class="tiny">${t("没有组件")}</div>`;
    renderIdx("comp", CAT());
  }
  $("comp-check").addEventListener("click", () => { $("comp-list").innerHTML = `<div class="tiny">${t("检测中…")}</div>`; loadComp(); });
  $("comp-list").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-comp]"); if (!b) return;
    const it = lastComp.find((x) => x.id === b.dataset.id); if (!it) return;
    if (b.dataset.comp === "guide") {
      try { await navigator.clipboard.writeText(it.guide || ""); toast(t("安装命令已复制")); }
      catch { toast(it.guide || t("没有安装说明"), true); }
      return;
    }
    if (b.dataset.comp === "remove") {
      if (!confirm(t("移除组件「{n}」？只会删应用目录里的文件。", { n: it.name }))) return;
      const r = await post("/api/components/remove", { id: it.id }).catch((e2) => ({ ok: false, message: e2.message }));
      toast(r.message || (r.ok ? t("已移除") : t("移除失败")), !r.ok); loadComp(); return;
    }
    b.disabled = true;
    const r = await post("/api/components/install", { id: it.id }).catch((e2) => ({ ok: false, message: e2.message }));
    toast(r.message || (r.ok ? t("已安装") : t("安装失败")), !r.ok);
    loadComp();
  });

  // ── 自定义组件：导入 x86_64 程序 → 命令 + 技能 ─────────────────────
  let lastCustom = [];
  async function loadCustom() {
    const box = $("custom-list"); if (!box) return;
    let r;
    try { r = await api("/api/custom"); }
    catch (e) { box.innerHTML = `<div class="tiny err">${esc(e.message)}</div>`; return; }
    lastCustom = (r && r.items) || [];
    $("custom-count").textContent = lastCustom.length;
    box.innerHTML = lastCustom.length ? lastCustom.map((it) => extItem(
      esc(it.name || it.cmd),
      `<span>${esc(it.cmd)}</span><span>${esc(it.source || "")}</span>`,
      `<button data-custom="remove" data-id="${esc(it.id)}">${t("移除")}</button>`, "", ["on"])).join("")
      : `<div class="tiny">${t("还没有自定义组件。导入后会生成同名命令和 Claude 技能。")}</div>`;
  }
  $("custom-add").addEventListener("click", async () => {
    const path = $("custom-path").value.trim(), cmd = $("custom-cmd").value.trim(), name = $("custom-name").value.trim();
    if (!path || !cmd) return toast(t("路径和命令名都要填"), true);
    const r = await post("/api/custom/import", { path, cmd, name }).catch((e) => ({ ok: false, message: e.message }));
    toast(r.message || (r.ok ? t("已导入") : t("导入失败")), !r.ok);
    if (r.ok) { $("custom-path").value = ""; $("custom-cmd").value = ""; $("custom-name").value = ""; }
    loadCustom();
  });
  $("custom-list").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-custom]"); if (!b) return;
    const it = lastCustom.find((x) => x.id === b.dataset.id); if (!it) return;
    if (!confirm(t("移除自定义组件「{n}」？会删掉它的程序、命令和技能。", { n: it.name || it.cmd }))) return;
    const r = await post("/api/custom/remove", { id: it.id }).catch((e2) => ({ ok: false, message: e2.message }));
    toast(r.message || (r.ok ? t("已移除") : t("移除失败")), !r.ok); loadCustom();
  });

  // ── 分类索引条：扩展页每节一条，横向滚动。点一下只看那一类，点「全部」复原；刷新列表后选中的分类保留 ──
  // 条目带 data-tags（空格分隔的分类键）。labels 定顺序和显示名；没列出的键（如插件市场名 m:<名字>）按名字附在后面
  const tg = (s) => encodeURIComponent(String(s));
  const extPick = {}, extLabels = {};
  const CAT = () => ({ dev: t("开发工具"), office: t("文档办公"), media: t("图像影音"), science: t("科学计算"), eda: t("电子设计"),
    cad: t("3D 与建模"), ai: t("AI 推理"), gpu: t("GPU 与驱动"), net: t("网络"), mcp: "MCP", other: t("其他") });   // MCP：各语言都叫这个名，不进词典
  function renderIdx(sec, labels) {
    if (labels) extLabels[sec] = labels; else labels = extLabels[sec] || [];
    const bar = $(sec + "-idx"); if (!bar) return;
    const safeDecode = (x) => { try { return decodeURIComponent(x); } catch { return x; } };   // 坏的百分号序列别把整个列表画崩（审查 v0.5.5 W-L6）
    const items = [...document.querySelectorAll(`details[data-sec="${sec}"] .item[data-tags]`)];
    const count = new Map();
    for (const it of items) for (const g of it.dataset.tags.split(" ")) count.set(g, (count.get(g) || 0) + 1);
    const known = new Set(labels.map(([g]) => g));
    const chips = [...labels.filter(([g]) => count.get(g)),
      ...[...count.keys()].filter((g) => !known.has(g)).sort().map((g) => [g, safeDecode(g.replace(/^[a-z]+:/, ""))])];
    if (extPick[sec] && !count.get(extPick[sec])) extPick[sec] = "";
    const cur = extPick[sec] || "";
    bar.classList.toggle("hidden", chips.length < 2 && !cur);      // 只有一类时没什么可切的
    bar.innerHTML = [["", t("全部"), items.length], ...chips.map(([g, l]) => [g, l, count.get(g)])]
      .map(([g, l, n]) => `<button class="idx-chip${g === cur ? " on" : ""}" data-sec="${sec}" data-idx="${esc(g)}">${esc(l)}${g ? `<span>${n}</span>` : ""}</button>`).join("");
    for (const it of items) it.classList.toggle("hidden", !!cur && !it.dataset.tags.split(" ").includes(cur));
  }
  $("tab-ext").addEventListener("click", (e) => {
    const c = e.target.closest(".idx-chip"); if (!c) return;
    extPick[c.dataset.sec] = c.dataset.idx; renderIdx(c.dataset.sec);
  });
  // 节头照设计稿：图标块 + 标题，下面一句说明（原来是节里第一行小字，挪进标题里）；节不再折叠，靠顶上的分区导航跳
  for (const d of document.querySelectorAll("#tab-ext details.ext-sec")) {
    d.open = true;
    const sum = d.querySelector(":scope > summary"), tip = sum.nextElementSibling;
    if (tip && tip.classList.contains("tiny")) { tip.classList.add("sec-desc"); sum.appendChild(tip); }
    sum.addEventListener("click", (e) => e.preventDefault());
  }

  // ── gh 登录卡：设备码流程。令牌只在 gh 自己那儿，网关只回账号名与状态 ──
  const ghAuth = { html: "", at: 0, timer: 0, polling: false };
  // 没有组件系统的地方（开发端）：gh 在 PATH 里就单独给一张 GitHub 卡片，登录卡同一套
  async function loadGhField() {
    const st = await api("/api/gh/auth").catch(() => null);
    $("gh-field").classList.toggle("hidden", !(st && st.installed));
    if (!st || !st.installed) return;
    $("gh-field-box").innerHTML = '<div class="item"><div class="it-title">GitHub CLI（gh）</div><div class="gh-auth" id="gh-auth">' + ghAuth.html + "</div></div>";
    loadGhAuth(true);
  }
  async function loadGhAuth(force) {
    clearTimeout(ghAuth.timer);
    // 组件列表下载时一秒刷一次，gh auth status 要联网验令牌，别跟着每秒跑
    if (!force && !ghAuth.polling && Date.now() - ghAuth.at < 30000) return;
    ghAuth.at = Date.now();
    const r = await api("/api/gh/auth").catch((e) => ({ installed: true, accounts: [], error: e.message }));
    const j = r.job, wasPolling = ghAuth.polling;
    ghAuth.polling = !!j && ["starting", "waiting"].includes(j.state);
    if (wasPolling && j && j.state === "done") toast(j.git ? t("GitHub 已登录，git 推送已配好") : t("GitHub 已登录，但 git 凭据没配上，可在终端运行 gh auth setup-git"), !j.git);
    let h = "";
    if (j && j.state === "starting") h = '<div class="tiny">' + t("正在向 GitHub 申请一次性码…") + "</div>" + '<div class="it-acts"><button data-g="cancel">' + t("取消") + "</button></div>";
    else if (j && j.state === "waiting") {
      h = '<div class="tiny">' + t("在浏览器里输入这个一次性码，授权后这里会自动完成：") + "</div>" +
        '<div class="gh-code" data-g="copy">' + esc(j.code) + "</div>" +
        '<div class="it-acts"><button data-g="open" data-code="' + esc(j.code) + '" data-url="' + esc(j.url || "https://github.com/login/device") + '">' + t("复制并打开浏览器") + "</button>" +
        '<button data-g="cancel">' + t("取消") + "</button></div>";
    } else {
      const acc = r.accounts || [];
      h = acc.length ? acc.map((a) => '<div class="gh-acc"><span>@' + esc(a.login) + "</span>" +
          (a.active && acc.length > 1 ? '<span class="badge">' + t("当前") + "</span>" : "") +
          (a.ok ? "" : '<span class="warn">' + t("登录已失效") + "</span>") +
          (a.active ? "" : '<button data-g="switch" data-user="' + esc(a.login) + '">' + t("切换到这个") + "</button>") +
          '<button data-g="logout" data-user="' + esc(a.login) + '">' + t("退出") + "</button></div>").join("")
        : '<div class="tiny">' + t("还没登录 GitHub。登录后 gh 和 git 推送都能用。") + "</div>";
      if (j && j.state === "error") h += '<div class="tiny err">' + (j.error === "timeout" ? t("一次性码过期了，重新登录吧") : t("登录失败：{msg}", { msg: esc(j.error) })) + "</div>";
      if (r.error) h += '<div class="tiny err">' + esc(r.error) + "</div>";
      h += '<div class="it-acts"><button data-g="login">' + (acc.length ? t("再登录一个账号") : t("登录 GitHub")) + "</button></div>";
    }
    ghAuth.html = h;
    const box = $("gh-auth");
    if (box) box.innerHTML = h;
    if (ghAuth.polling && box && pageOn("ext"))
      ghAuth.timer = setTimeout(loadGhAuth, 2000);
  }

  async function loadExtPlugins() {
    const box = $("ext-plugins");
    let r;
    try { r = await api("/api/ext/plugins"); } catch (e) { box.innerHTML = `<div class="tiny">${esc(e.message)}</div>`; return; }
    if (r.ok === false) { box.innerHTML = `<div class="tiny">${esc(r.message)}</div>`; return; }
    $("ext-p-count").textContent = r.installed.length;
    box.innerHTML = r.installed.length ? r.installed.map((p) => extItem(
      esc(p.id.split("@")[0]) + (p.enabled ? "" : ` <span class="badge">${t("已停用")}</span>`),
      `<span>${esc(p.id.split("@")[1] || "")}</span><span>${esc(String(p.version || "").slice(0, 16))}</span><span>${esc(p.scope || "")}</span>`,
      `<button data-x="${p.enabled ? "disable" : "enable"}" data-id="${esc(p.id)}">${p.enabled ? t("停用") : t("启用")}</button>
       <button data-x="uninstall" data-id="${esc(p.id)}">${t("卸载")}</button>`, "", [p.enabled ? "on" : "off", "m:" + tg(p.id.split("@")[1] || "")])).join("")
      : `<div class="tiny">${t("还没装插件。在下面搜索可安装的。")}</div>`;
    renderIdx("plugin", [["on", t("已启用")], ["off", t("已停用")]]);
  }

  async function searchPlugins(more) {
    const box = $("ext-catalog");
    // 翻页在途再点「再显示」：两次都按同一个 offset 取，同一页追加两遍、最后一页反而没取（审查 F-003）
    if (more && ext.busy) return;
    // 连着搜两个词，慢的那个迟到不许盖掉新词的结果（审查 F-004）；新搜索也让在途的翻页作废
    // 新搜索清掉分类筛选：否则选了「已启用 / 某个市场」后搜别的，结果全被旧筛选藏起来（195-J.2）
    if (!more) { latest("plugcat"); ext.busy = false; ext.offset = 0; extPick.plugin = ""; ext.q = $("ext-p-q").value.trim(); box.innerHTML = `<div class="tiny">${t("正在拉取插件目录…")}</div>`; }
    const n = LATEST.plugcat, ok = () => LATEST.plugcat === n;
    if (more) ext.busy = true;
    let r;
    try { r = await api(`/api/ext/plugins?available=1&q=${encodeURIComponent(ext.q)}&offset=${ext.offset}`); }
    catch (e) { if (!ok()) return; ext.busy = false; box.innerHTML = `<div class="tiny">${esc(e.message)}</div>`; return; }
    if (!ok()) return;
    ext.busy = false;
    if (r.ok === false) { box.innerHTML = `<div class="tiny">${esc(r.message)}</div>`; return; }
    const html = (r.available || []).map((p) => extItem(
      esc(p.name),
      `<span>${esc(p.marketplace)}</span>${p.version ? `<span>${esc(p.version)}</span>` : ""}`,
      `<button data-x="install" data-id="${esc(p.id)}">${t("安装")}</button>`,
      `<div class="tiny ext-desc">${esc(p.description)}</div>`, ["m:" + tg(p.marketplace)])).join("");
    const old = box.querySelector(".ext-more-btn"); if (old) old.remove();
    if (!more) box.innerHTML = `<div class="tiny">${t("找到 {n} 个", { n: Number(r.total) || 0 })}</div>` + html;
    else box.insertAdjacentHTML("beforeend", html);
    ext.offset += (r.available || []).length;
    if (ext.offset < (r.total || 0)) box.insertAdjacentHTML("beforeend", `<button class="btn ghost sm ext-more-btn">${t("再显示 40 个")}</button>`);
    renderIdx("plugin");
  }

  async function installPlugin(id, btn) {
    btn.disabled = true; btn.textContent = t("安装中…");
    let r = await post("/api/ext/plugins/install", { id }).catch((e) => ({ ok: false, message: e.message }));
    // 要执行命令才能装的插件：claude 把命令亮出来，人点头了才装
    if (r.needConfirm) {
      if (confirm(t("这个插件安装时要在本机执行下面这条命令，确认是你信任的来源再继续：\n\n{cmd}", { cmd: r.command }))) {
        r = await post("/api/ext/plugins/install", { id, accept: r.sha256 }).catch((e) => ({ ok: false, message: e.message }));
      } else {
        // 用户自己点的取消不是「安装失败」（195-J.12）
        toast(t("已取消"));
        btn.disabled = false; btn.textContent = t("安装");
        return;
      }
    }
    if (r.ok) { toast(t("已安装 {name}，下一条消息生效", { name: id.split("@")[0] })); btn.closest(".item").remove(); loadExtPlugins(); }
    else { toast(t("安装失败：{msg}", { msg: r.message || "" }), true); btn.disabled = false; btn.textContent = t("安装"); }
  }

  async function loadExtMarkets() {
    // 读失败要报错，不能画成「只有内置的官方目录」（195-N.4 / X.2）
    const r = await api("/api/ext/marketplaces").catch((e) => ({ items: [], err: e.message }));
    if (r.ok === false) r.err = r.err || r.message || "?";
    if (r.err) {
      $("ext-markets").innerHTML = `<div class="tiny err">${esc(t("插件市场读取失败：{msg}", { msg: r.err }))}</div><div class="it-acts"><button class="btn ghost sm" data-x="market-retry">${t("重试")}</button></div>`;
      return;
    }
    $("ext-markets").innerHTML = (r.items || []).map((m) => extItem(esc(m.name), `<span>${esc(m.source)}</span>`,
      `<button data-x="market-rm" data-id="${esc(m.name)}">${t("移除")}</button>`)).join("")
      || `<div class="tiny">${t("只有内置的官方目录。可以添加别的插件市场（GitHub 仓库或网址）。")}</div>`;
  }

  async function loadExtSkills() {
    // 读失败不能显示成「还没有技能」、计数 0（审查 F-007）
    const r = await api("/api/ext/skills").catch((e) => ({ items: [], err: e.message || "?" }));
    if (r.ok === false) r.err = r.message || "?";   // 200 + {ok:false}（195-X.2）
    if (r.err) {
      $("ext-s-count").textContent = "—";
      $("ext-skills").innerHTML = `<div class="tiny err">${esc(t("技能列表读取失败：{msg}", { msg: r.err }))}</div><div class="it-acts"><button class="btn ghost sm" id="ext-s-retry">${esc(t("重试"))}</button></div>`;
      $("ext-s-retry").onclick = () => loadExtSkills();
      return;
    }
    $("ext-s-count").textContent = (r.items || []).length;
    // 发行版：skill 经检查后以插件「user」交给 Claude Code，斜杠调用时名字带 user: 前缀（见 gw/seal.mjs）
    // 模式（F5）：开 / 只露名字（省上下文）/ 只能你用斜杠调用 / 关。发行版的技能由网关打包交给 claude，只认开 / 关
    const modes = r.sealed ? [["on", t("开")], ["off", t("关")]] : [["on", t("开")], ["name-only", t("只露名字")], ["user-invocable-only", t("只能你调用")], ["off", t("关")]];
    const modeSel = (s) => s.orphan ? "" : `<select class="sk-mode" data-id="${esc(s.dir)}" aria-label="${esc(t("技能模式"))}">${modes.map(([v, l]) => `<option value="${v}"${(s.mode || "on") === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    $("ext-skills").innerHTML = (r.sealed && (r.items || []).length ? `<div class="tiny">${esc(t("cccodroid 检查过这些技能再交给 Claude Code，用斜杠调用时名字前面带 user:，比如 /user:{name}。", { name: r.items[0].name }))}</div>` : "") + (r.items || []).map((s) => extItem(esc(s.name) + (s.mode && s.mode !== "on" ? ` <span class="badge">${esc((modes.find(([v]) => v === s.mode) || [, t("已停用")])[1])}</span>` : ""), "",
      modeSel(s) + `<button data-x="skill-rm" data-id="${esc(s.dir)}">${t("删除")}</button>`,
      `<div class="tiny ext-desc">${esc(s.orphan ? t("这个文件夹里没有 SKILL.md（可能是以前导入到一半失败留下的），可以删掉。") : !isZh() && s.descEn ? s.descEn : s.description)}</div>`, [s.component ? "comp" : s.official ? "official" : "user"])).join("")
      || `<div class="tiny">${t("~/.claude/skills 里还没有技能。插件也可能自带技能。")}</div>`;
    renderIdx("skill", [["official", t("官方")], ["comp", t("组件自带")], ["user", t("自己装的")]]);
    if ($("ext-s-catbox").open) loadSkillCat();
  }

  $("ext-skills").addEventListener("change", async (e) => {
    const sel = e.target.closest("select.sk-mode");
    if (!sel) return;
    sel.disabled = true;
    const r = await post("/api/ext/skills/mode", { dir: sel.dataset.id, mode: sel.value }).catch((err) => ({ ok: false, message: err.message }));
    toast(r.ok ? t("下一轮对话起生效") : t("失败：{msg}", { msg: r.message || "" }), !r.ok);
    loadExtSkills();
  });

  // ── Hooks（自动规则）：到某个时刻自动跑一条命令。常用规则点一下就加，也能自己写；每条都能先试运行看效果 ──
  const HK = { data: null, scope: localStorage.getItem("cc.hookScope") || "user", edit: null, recipe: null };
  const HK_EV = {
    PreToolUse: [tk("用工具之前"), tk("Claude 每次调用工具（改文件、跑命令、联网……）之前。退出码 2 会拦下这次调用，stderr 里写的原因会转告 Claude。")],
    PostToolUse: [tk("用完工具之后"), tk("工具执行成功之后。适合格式化、记录、检查；动作已经做了，退出码 2 只会把 stderr 反馈给 Claude。")],
    UserPromptSubmit: [tk("你发出消息时"), tk("你每发一条消息。命令打印的内容会作为补充说明一起交给 Claude；退出码 2 会拦下这条消息。")],
    Stop: [tk("Claude 答完一轮时"), tk("Claude 这一轮回答结束。适合自动存档、提醒；退出码 2 会让它接着干（小心死循环）。")],
    SessionStart: [tk("会话开始时"), tk("新开、继续、清空或压缩后的会话开始时。命令打印的内容会作为背景交给 Claude。")],
    SessionEnd: [tk("会话结束时"), tk("会话结束时，适合收尾清理。")],
    Notification: [tk("Claude 发提醒时"), tk("Claude 要你确认权限、或者闲着等你回复时。")],
    PermissionRequest: [tk("要你确认权限时"), tk("弹出权限确认之前。进阶用法：输出 JSON 可以替你自动允许或拒绝。")],
    PostToolUseFailure: [tk("工具出错之后"), tk("工具执行失败之后。")],
    SubagentStart: [tk("子代理开始时"), ""],
    SubagentStop: [tk("子代理结束时"), tk("子代理干完活时；退出码 2 会让它接着干。")],
    PreCompact: [tk("压缩上下文之前"), ""],
    PostCompact: [tk("压缩上下文之后"), ""],
  };
  const hkEvName = (ev) => (HK_EV[ev] ? t(HK_EV[ev][0]) : ev);
  const HK_TOOL_EV = ["PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest"];
  const HK_MATCH_CHIPS = {
    tool: ["Bash", "Edit|Write|MultiEdit", "Read", "WebFetch|WebSearch", "mcp__.*"],
    SessionStart: ["startup", "resume", "clear", "compact"],
    PreCompact: ["manual", "auto"], PostCompact: ["manual", "auto"],
    Notification: ["permission_prompt", "idle_prompt"],
  };
  const hkChips = (ev) => (HK_TOOL_EV.includes(ev) ? HK_MATCH_CHIPS.tool : HK_MATCH_CHIPS[ev]);
  const shq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
  /** 把命令拆成参数（认单引号、双引号、反斜杠），用来从常用规则的命令里取回参数 */
  function shArgs(cmd) {
    const out = []; let cur = null, q = "";
    for (let i = 0; i < cmd.length; i++) {
      const c = cmd[i];
      if (q === "'") { if (c === "'") q = ""; else cur += c; continue; }
      if (q === '"') { if (c === '"') q = ""; else if (c === "\\" && i + 1 < cmd.length) cur += cmd[++i]; else cur += c; continue; }
      if (/\s/.test(c)) { if (cur != null) out.push(cur); cur = null; continue; }
      if (cur == null) cur = "";
      if (c === "'" || c === '"') q = c; else if (c === "\\" && i + 1 < cmd.length) cur += cmd[++i]; else cur += c;
    }
    if (cur != null) out.push(cur);
    return out;
  }
  const lines = (s) => String(s || "").split("\n").map((x) => x.trim()).filter(Boolean);
  const hkScript = (name) => `node "$HOME/.claude/hooks/${name}"`;
  const HK_RECIPES = [
    { id: "guard-files", title: tk("保护重要文件"), desc: tk("Claude 想改 .env、密钥、签名文件时直接拦下，并告诉它原因。"),
      event: "PreToolUse", matcher: "Edit|Write|MultiEdit|NotebookEdit", script: "cc-guard-files.mjs",
      label: tk("受保护的文件（一行一个；* 是通配符，带 / 就按路径比）"), param: ".env\n.env.*\n*.pem\n*.key\n*.keystore\n*.jks\nid_rsa*\nid_ed25519*",
      cmd: (p) => hkScript("cc-guard-files.mjs") + " " + lines(p).map(shq).join(" "), back: (a) => a.slice(2).join("\n") },
    { id: "guard-bash", title: tk("拦下危险命令"), desc: tk("命令里出现强推、硬重置、删根目录这类内容就不让跑，并告诉 Claude 换个做法。"),
      event: "PreToolUse", matcher: "Bash", script: "cc-guard-bash.mjs",
      label: tk("禁止的内容（一行一个；写成 /…/ 就是正则）"),
      param: "git push --force\ngit push -f\n/git\\s+reset\\s+--hard/\n/\\brm\\s+-\\w*[rR]\\w*\\s+(\\/|~\\/?|\\$HOME\\/?)(\\s|$)/\nmkfs\n/\\bdd\\s+if=/",
      cmd: (p) => hkScript("cc-guard-bash.mjs") + " " + lines(p).map(shq).join(" "), back: (a) => a.slice(2).join("\n") },
    { id: "autosave", title: tk("每轮自动存档（git）"), desc: tk("Claude 每答完一轮，项目里有改动就自动提交一次，随时能退回任意一步。只提交不推送；不是 git 仓库的项目什么也不做。"),
      event: "Stop", matcher: "", script: "cc-autosave.mjs", single: true, label: tk("提交说明的开头"), param: tk("自动存档"),
      cmd: (p) => hkScript("cc-autosave.mjs") + " " + shq(String(p).trim() || t("自动存档")), back: (a) => a[2] || "" },
    { id: "prompt-note", title: tk("每条消息附上固定要求"), desc: tk("你每发一条消息，自动把这段话一起交给 Claude，比如「回答用中文」「改之前先说思路」。"),
      event: "UserPromptSubmit", matcher: "", label: tk("要附上的话"), param: tk("回答用中文；动手改之前先简单说一下打算怎么做。"),
      cmd: (p) => "printf '%s\\n' " + shq(String(p).trim()), test: (c) => /^printf '%s\\n' /.test(c), back: (a) => a[2] || "" },
    { id: "session-file", title: tk("开会话时读入进度文件"), desc: tk("每次开新会话（或压缩上下文后），把项目里的一个文件读给 Claude，比如进度、大纲、人物表。文件不存在就跳过。"),
      event: "SessionStart", matcher: "", single: true, label: tk("文件（相对项目目录）"), param: tk("进度.md"),
      cmd: (p) => "cat " + shq(String(p).trim()) + " 2>/dev/null || true", test: (c) => /^cat '.*' 2>\/dev\/null \|\| true$/.test(c), back: (a) => a[1] || "" },
    { id: "bash-log", title: tk("记下 Claude 跑过的命令"), desc: tk("每条命令连同时间、目录追加到 ~/.claude/bash-history.log，方便事后翻看。"),
      event: "PostToolUse", matcher: "Bash", script: "cc-bash-log.mjs", cmd: () => hkScript("cc-bash-log.mjs") },
    { id: "format", title: tk("改完代码自动格式化"), desc: tk("Claude 改完代码文件，用本机已装的工具（ruff / black、prettier、gofmt、clang-format……）整理格式；没装就不动。Markdown 和纯文本不碰。"),
      event: "PostToolUse", matcher: "Edit|Write|MultiEdit", script: "cc-format.mjs", cmd: () => hkScript("cc-format.mjs") },
  ];
  const hkRecipeOf = (ev, h) => h && h.type === "command" && HK_RECIPES.find((r) => r.event === ev &&
    (r.script ? String(h.command).includes(r.script) : r.test(String(h.command))));
  const hkScopeData = () => HK.data && HK.data.scopes.find((s) => s.scope === HK.scope);
  const hkFlat = (sc) => {
    const out = [];
    const hooks = sc && sc.hooks;
    if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) return out;
    for (const [ev, groups] of Object.entries(hooks)) {
      if (!Array.isArray(groups)) continue;                       // 合法 JSON 但形状不对：整个 Hooks 区不能因此崩掉
      groups.forEach((g, gi) => {
        if (!g || typeof g !== "object" || !Array.isArray(g.hooks)) return;
        for (let hi = 0; hi < g.hooks.length; hi++) out.push({ ev, gi, hi, matcher: typeof g.matcher === "string" ? g.matcher : "", h: g.hooks[hi] });
      });
    }
    return out;
  };

  async function loadExtHooks() {
    let d;
    try { d = await api("/api/ext/hooks"); } catch (e) { $("ext-hooks").innerHTML = `<div class="tiny">${esc(e.message)}</div>`; return; }
    if (d && d.ok === false) { $("ext-hooks").innerHTML = `<div class="tiny err">${esc(d.message || "?")}</div>`; return; }
    HK.data = d;
    if (!d.scopes.some((s) => s.scope === HK.scope)) HK.scope = "user";
    renderHooks();
  }

  function renderHooks() {
    const d = HK.data; if (!d || !Array.isArray(d.scopes)) return;
    const total = d.scopes.reduce((a, s) => a + hkFlat(s).length, 0);
    $("ext-h-count").textContent = total;
    const proj = String(d.dir || "").split("/").pop() || d.dir;
    const SC = { user: t("所有项目"), project: t("本项目（{name}）", { name: proj }), local: t("本项目·只在本机") };
    $("hook-scope").innerHTML = d.scopes.map((s) =>
      `<button class="idx-chip${s.scope === HK.scope ? " on" : ""}" data-hscope="${esc(s.scope)}">${esc(SC[s.scope])}<span>${hkFlat(s).length}</span></button>`).join("");
    const sc = hkScopeData();
    const SCD = {
      user: t("写在 ~/.claude/settings.json，所有项目都生效。"),
      project: t("写在项目的 .claude/settings.json，只在这个项目生效；项目进了 git 的话会跟着仓库走。"),
      local: t("写在项目的 .claude/settings.local.json，只在这个项目、这台设备上生效。"),
    };
    // 发行版不跑这里配的钩子（见 gw/edition.mjs、seal.mjs）：配置照样能看能改，只是不加载
    $("hook-bar").innerHTML = (d.sealed ? `<div class="tiny warn">${esc(t("发行版不运行这里配置的 hooks：hooks 能执行任意命令、把任意内容放进对话，cccodroid 没法检查。规则留在文件里，不会被删。"))}</div>` : "") + `<div class="tiny">${esc(SCD[HK.scope])}
        ${sc && sc.file && sc.exists ? `<a href="#" data-hk="open-file">${t("打开配置文件")}</a>` : ""}</div>
      <label class="tiny hk-pause"><input type="checkbox" data-hk="pause"${sc && sc.disableAll ? " checked" : ""}> ${t("暂停这一层的 hooks（规则留着，先不跑）")}</label>`;
    if (!sc || sc.error && !sc.badJson) { $("ext-hooks").innerHTML = `<div class="tiny warn">${esc((sc && sc.error) || "")}</div>`; return; }
    if (sc.badJson) {
      $("ext-hooks").innerHTML = `<div class="tiny warn">${esc(t("这个配置文件不是合法的 JSON（{msg}），先打开修好，这里才能改。", { msg: sc.error }))}</div>`;
      return;
    }
    const items = hkFlat(sc);
    $("ext-hooks").innerHTML = items.map((it, i) => {
      const r = hkRecipeOf(it.ev, it.h);
      const title = r ? t(r.title) : hkEvName(it.ev);
      const meta = [r ? hkEvName(it.ev) : it.ev, it.matcher ? t("匹配：{m}", { m: it.matcher }) : "", it.h.timeout ? t("超时 {n} 秒", { n: it.h.timeout }) : ""].filter(Boolean);
      const body = it.h.type === "command" ? it.h.command : JSON.stringify(it.h);
      return `<div class="item hk-item${sc.disableAll ? " off" : ""}" data-i="${i}">
        <div class="it-title">${esc(title)}</div>
        <div class="it-meta">${meta.map((m) => `<span>${esc(m)}</span>`).join("")}</div>
        <div class="hk-cmd mono">${esc(body)}</div>
        <div class="it-acts">${it.h.type === "command" ? `<button data-hk="test">${t("试运行")}</button><button data-hk="edit">${t("修改")}</button>` : ""}
          <button data-hk="del">${t("删除")}</button></div>
        <div class="hk-out"></div></div>`;
    }).join("") || `<div class="tiny">${t("这里还没有规则。下面「常用规则」点一下就能加。")}</div>`;
    $("hook-recipes").innerHTML = HK_RECIPES.map((r) => extItem(esc(t(r.title)), `<span>${esc(hkEvName(r.event))}</span>`,
      `<button data-hk="recipe" data-id="${esc(r.id)}">${t("添加…")}</button>`, `<div class="tiny ext-desc">${esc(t(r.desc))}</div>`)).join("");
    if (!items.length && !HK.edit && !HK.recipe) $("hook-recipes-box").open = true;
  }

  /** 表单：新建 / 修改 / 从常用规则添加。常用规则只填参数，命令自动拼好（也能直接改命令） */
  function hkForm(init) {
    const box = $("hook-form-box"), f = $("hook-form");
    box.open = true;
    const r = HK.recipe;
    const evs = HK.data.events;
    const main = Object.keys(HK_EV).filter((e) => evs.includes(e));
    const more = evs.filter((e) => !main.includes(e));
    if (init.event && !evs.includes(init.event)) more.push(init.event);
    f.innerHTML = `
      ${r ? `<div class="hk-rtitle">${esc(t(r.title))}</div><div class="tiny">${esc(t(r.desc))}</div>` : ""}
      <label class="tiny">${t("什么时候跑")}</label>
      <select data-f="event">${main.map((e) => `<option value="${esc(e)}">${esc(hkEvName(e))} · ${esc(e)}</option>`).join("")}
        ${more.length ? `<optgroup label="${esc(t("其他（进阶）"))}">${more.map((e) => `<option value="${esc(e)}">${esc(e)}</option>`).join("")}</optgroup>` : ""}</select>
      <div class="tiny hk-evdesc"></div>
      <div class="hk-match"><label class="tiny hk-mlabel"></label>
        <input data-f="matcher" autocomplete="off" spellcheck="false" placeholder="${esc(t("留空 = 全部"))}">
        <div class="hk-chips"></div></div>
      ${r && r.label ? `<label class="tiny">${esc(t(r.label))}</label>
        ${r.single ? `<input data-f="param" autocomplete="off" spellcheck="false">` : `<textarea data-f="param" rows="5" class="mono" spellcheck="false"></textarea>`}` : ""}
      <label class="tiny">${t("运行的命令")}${r ? ` <span class="hk-auto">${t("（按上面自动生成，也可以直接改）")}</span>` : ""}</label>
      <textarea data-f="command" rows="3" class="mono" spellcheck="false" autocapitalize="off" placeholder="${esc(t("例如：echo 你好 >> ~/log.txt"))}"></textarea>
      <div class="hk-row"><label class="tiny">${t("超时（秒，留空用默认 60）")}</label><input data-f="timeout" type="number" min="1" max="600" inputmode="numeric"></div>
      <div class="row-actions"><button class="btn sm ghost" data-hk="f-test">${t("试运行")}</button>
        <button class="btn sm" data-hk="f-save">${HK.edit ? t("保存修改") : t("添加")}</button>
        <button class="btn sm ghost" data-hk="f-cancel">${t("取消")}</button></div>
      <div class="hk-out"></div>`;
    const q = (k) => f.querySelector(`[data-f="${k}"]`);
    q("event").value = init.event || "PreToolUse";
    q("matcher").value = init.matcher || "";
    q("command").value = init.command || "";
    q("timeout").value = init.timeout || "";
    if (q("param")) q("param").value = init.param != null ? init.param : t(r.param);
    const sync = () => {
      const ev = q("event").value, chips = hkChips(ev);
      f.querySelector(".hk-evdesc").textContent = HK_EV[ev] ? t(HK_EV[ev][1]) : "";
      f.querySelector(".hk-match").classList.toggle("hidden", !chips && !q("matcher").value);
      f.querySelector(".hk-mlabel").textContent = HK_TOOL_EV.includes(ev) ? t("管哪些工具（工具名，可用 | 分隔或写正则；留空 = 全部）") : t("只在这几种情况跑（留空 = 全部）");
      f.querySelector(".hk-chips").innerHTML = (chips || []).map((c) => `<button type="button" class="idx-chip" data-chip="${esc(c)}">${esc(c)}</button>`).join("");
    };
    q("event").addEventListener("change", sync);
    if (q("param")) q("param").addEventListener("input", () => { q("command").value = r.cmd(q("param").value); });
    if (r && !init.command) q("command").value = r.cmd(q("param") ? q("param").value : "");
    sync();
    box.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  const hkFormVal = () => {
    const f = $("hook-form"), q = (k) => f.querySelector(`[data-f="${k}"]`);
    const to = parseInt(q("timeout").value, 10);
    return { event: q("event").value, matcher: q("matcher").value.trim(), command: q("command").value.trim(), timeout: to > 0 ? to : 0 };
  };
  // 「自己写一条」展开时要真的给出表单：以前只展开一块空白，没法从零新建（审查 09-03 / #49 P2-10）
  $("hook-form-box").addEventListener("toggle", () => {
    const box = $("hook-form-box");
    if (box.open && !$("hook-form").children.length && HK.data) { HK.edit = null; HK.recipe = null; hkForm({}); }
    else if (!box.open) { HK.edit = null; HK.recipe = null; $("hook-form").innerHTML = ""; }
  });
  function hkCloseForm() { HK.edit = null; HK.recipe = null; $("hook-form").innerHTML = ""; $("hook-form-box").open = false; }

  async function hkSave(hooks, extra) {
    const sc = hkScopeData();
    const r = await api("/api/ext/hooks/save", { method: "POST", body: JSON.stringify({ scope: HK.scope, dir: HK.data.dir, hooks, ...extra }) });
    if (r.ok === false) {
      toast(r.code === "badjson" ? t("这个配置文件不是合法的 JSON（{msg}），先打开修好，这里才能改。", { msg: r.message }) : t("保存失败：{msg}", { msg: r.message }), true);
      return false;
    }
    toast(t("已保存，下一条消息生效"));
    await loadExtHooks();
    return !!sc;
  }
  const hkClone = () => JSON.parse(JSON.stringify((hkScopeData() || {}).hooks || {}));

  /** 试运行结果：按事件和退出码说人话 */
  function hkShowResult(box, res, ev, cmd, matcher, timeout) {
    const blockEv = ["PreToolUse", "PermissionRequest", "UserPromptSubmit"].includes(ev);
    const ctxEv = ["UserPromptSubmit", "SessionStart"].includes(ev);
    let v, cls = "ok";
    if (res.timedOut) { v = t("超时了，命令没跑完就被停掉。"); cls = "warn"; }
    else if (res.code === 0) v = ctxEv && res.stdout.trim() ? t("正常结束：打印的内容会作为补充说明交给 Claude。") : blockEv ? t("放行：Claude 照常继续。") : t("正常结束。");
    else if (res.code === 2) { v = blockEv ? t("拦下（退出码 2）：Claude 这一步不会执行，stderr 里的话会转告它。") : ev === "Stop" || ev === "SubagentStop" ? t("退出码 2：Claude 会接着干，stderr 里的话会转告它。") : t("退出码 2：stderr 里的话会反馈给 Claude。"); cls = "warn"; }
    else { v = t("出错了（退出码 {n}）：不会拦下，Claude 照常继续。", { n: res.code }); cls = "err"; }
    const pre = (label, s) => s.trim() ? `<div class="tiny">${label}</div><pre class="hk-pre">${esc(s.slice(0, 4000))}</pre>` : "";
    box.innerHTML = `<div class="hk-verdict ${cls}">${esc(v)} <span class="tiny">${res.ms} ms</span></div>
      ${pre(t("输出（stdout）"), res.stdout)}${pre(t("错误输出（stderr）"), res.stderr)}
      <details class="ext-more"><summary>${t("模拟的输入（可以改了再试）")}</summary>
        <textarea class="mono hk-input" rows="8" spellcheck="false">${esc(res.input)}</textarea>
        <button class="btn sm ghost" data-hk="retest">${t("再试一次")}</button></details>`;
    box.querySelector('[data-hk="retest"]').onclick = (e) => { e.preventDefault(); hkRunTest(box, ev, cmd, matcher, timeout, box.querySelector(".hk-input").value); };
  }
  async function hkRunTest(box, ev, cmd, matcher, timeout, input) {
    if (!cmd) return toast(t("命令是空的"), true);
    box.innerHTML = `<div class="tiny">${t("运行中…")}</div>`;
    // 内置脚本没装上时试运行必然失败：以前把这个错误吞了，用户只看到“命令跑不起来”（197-2.9）
    if (/\$HOME\/\.claude\/hooks\/cc-/.test(cmd)) {
      let inst;
      try { inst = await api("/api/ext/hooks/scripts", { method: "POST", body: "{}" }); }
      catch (e) { box.innerHTML = `<div class="tiny warn">${esc(t("内置脚本没装上：{msg}", { msg: e.message }))}</div>`; return; }
      if (inst.ok === false) { box.innerHTML = `<div class="tiny warn">${esc(t("内置脚本没装上：{msg}", { msg: inst.message || "?" }))}</div>`; return; }
    }
    try {
      const res = await api("/api/ext/hooks/test", { method: "POST", body: JSON.stringify({ command: cmd, event: ev, matcher, timeout, input, dir: HK.data.dir }) });
      if (res.ok === false) throw new Error(res.message);
      hkShowResult(box, res, ev, cmd, matcher, timeout);
    } catch (e) { box.innerHTML = `<div class="tiny warn">${esc(e.message)}</div>`; }
  }

  $("ext-hook-sec").addEventListener("click", async (e) => {
    const chip = e.target.closest("[data-hscope]");
    if (chip) { HK.scope = chip.dataset.hscope; localStorage.setItem("cc.hookScope", HK.scope); hkCloseForm(); return renderHooks(); }
    const mc = e.target.closest("[data-chip]");
    if (mc) {
      const inp = $("hook-form").querySelector('[data-f="matcher"]');
      const cur = inp.value.split("|").filter(Boolean);
      for (const p of mc.dataset.chip.split("|")) if (!cur.includes(p)) cur.push(p);
      inp.value = cur.join("|");
      return;
    }
    const b = e.target.closest("[data-hk]");
    if (!b || b.dataset.hk === "pause") return;
    e.preventDefault();
    const a = b.dataset.hk;
    const items = hkFlat(hkScopeData());
    const it = b.closest(".hk-item") ? items[+b.closest(".hk-item").dataset.i] : null;
    if (a === "open-file") {
      // 用户级 settings.json 在 home 里，按路径政策不能经 /api/file 读：走扩展自己的只读接口展示（195-J.1）
      const sc = hkScopeData();
      let r;
      try { r = await api(`/api/ext/hooks/file?scope=${encodeURIComponent(HK.scope)}&dir=${encodeURIComponent(HK.data.dir)}`); }
      catch (e) { return toast(e.message, true); }
      let box = $("hk-file-view");
      if (!box) { box = document.createElement("div"); box.id = "hk-file-view"; $("hook-bar").after(box); }
      if (r.ok === false) { box.innerHTML = `<div class="tiny err">${esc(r.message || "?")}</div>`; return; }
      box.innerHTML = `<div class="tiny">${esc(r.file || (sc && sc.file) || "")}${r.exists ? "" : "（" + esc(t("文件还不存在")) + "）"}</div>` +
        `<pre class="hk-pre">${esc(r.text || "")}</pre>` +
        `<div class="it-acts"><button class="btn ghost sm" data-hk="close-file">${t("关闭")}</button></div>`;
      return;
    }
    if (a === "close-file") { $("hk-file-view")?.remove(); return; }
    if (a === "test" && it) return hkRunTest(b.closest(".hk-item").querySelector(".hk-out"), it.ev, it.h.command, it.matcher, it.h.timeout);
    if (a === "del" && it) {
      if (!confirm(t("删除这条规则？"))) return;
      const h = hkClone();
      h[it.ev][it.gi].hooks.splice(it.hi, 1);
      return hkSave(h);
    }
    if (a === "edit" && it) {
      HK.edit = { ev: it.ev, gi: it.gi, hi: it.hi, scope: HK.scope, orig: JSON.stringify({ m: it.matcher || "", h: it.h }) };
      HK.recipe = hkRecipeOf(it.ev, it.h) || null;
      const param = HK.recipe && HK.recipe.back ? HK.recipe.back(shArgs(it.h.command)) : undefined;
      return hkForm({ event: it.ev, matcher: it.matcher, command: it.h.command, timeout: it.h.timeout, param });
    }
    if (a === "recipe") {
      HK.edit = null;
      HK.recipe = HK_RECIPES.find((r) => r.id === b.dataset.id);
      return hkForm({ event: HK.recipe.event, matcher: HK.recipe.matcher });
    }
    if (a === "f-cancel") return hkCloseForm();
    if (a === "f-test") { const v = hkFormVal(); return hkRunTest($("hook-form").querySelector(".hk-out"), v.event, v.command, v.matcher, v.timeout); }
    if (a === "f-save") {
      const v = hkFormVal();
      if (!v.command) return toast(t("命令是空的"), true);
      // 内置脚本装不上就别保存规则：以前吞掉错误，界面提示“已保存”，实际这条规则永远跑不起来（197-2.9）
      if (/\$HOME\/\.claude\/hooks\/cc-/.test(v.command)) {
        let inst;
        try { inst = await api("/api/ext/hooks/scripts", { method: "POST", body: "{}" }); }
        catch (e) { return toast(t("内置脚本没装上：{msg}，规则没有保存", { msg: e.message }), true); }
        if (inst.ok === false) return toast(t("内置脚本没装上：{msg}，规则没有保存", { msg: inst.message || "?" }), true);
      }
      const h = hkClone();
      const entry = { type: "command", command: v.command };
      if (v.timeout) entry.timeout = v.timeout;
      if (HK.edit) {
        // 编辑期间列表可能变了（删了前面一条、别处改了文件）：按下标找到的得还是原来那条，不是就在同一事件里按内容重新找；
        // 都找不到就不存，不能把修改稿写到另一条规则上（#152-1）
        const same = (g, x) => g && x && JSON.stringify({ m: g.matcher || "", h: x }) === HK.edit.orig;
        let gi = HK.edit.gi, hi = HK.edit.hi;
        if (HK.edit.scope !== HK.scope || !same(h[HK.edit.ev]?.[gi], h[HK.edit.ev]?.[gi]?.hooks?.[hi])) {
          gi = hi = -1;
          (h[HK.edit.ev] || []).some((g, a) => (g.hooks || []).some((x, b) => same(g, x) && ((gi = a), (hi = b), true)));
        }
        if (gi < 0 || HK.edit.scope !== HK.scope) { toast(t("这条规则在你编辑期间被改动或删掉了，重新打开它再改"), true); return hkCloseForm(); }
        HK.edit.gi = gi; HK.edit.hi = hi;
        const old = h[HK.edit.ev][HK.edit.gi];
        const keep = old.hooks[HK.edit.hi];
        // 事件、匹配都没变就原地换；变了就从原组里摘掉，按新的事件 / 匹配放
        if (HK.edit.ev === v.event && (old.matcher || "") === v.matcher) { const nh = { ...keep, ...entry }; if (!v.timeout) delete nh.timeout; old.hooks[HK.edit.hi] = nh; }
        else { old.hooks.splice(HK.edit.hi, 1); hkPut(h, v, entry); }
      } else hkPut(h, v, entry);
      if (await hkSave(h)) hkCloseForm();
    }
  });
  $("ext-hook-sec").addEventListener("change", async (e) => {
    if (e.target.dataset.hk !== "pause") return;
    const on = e.target.checked;
    // 暂停的是当前这一层（所有项目 / 本项目 / 本项目·只在本机）：以前固定只停用户级，项目里的照跑却显示成停了（#152-2）
    const r = await api("/api/ext/hooks/save", { method: "POST", body: JSON.stringify({ scope: HK.scope, dir: HK.data.dir, disableAll: on }) });
    if (r.ok === false) { e.target.checked = !on; return toast(t("保存失败：{msg}", { msg: r.message }), true); }
    toast(on ? t("这一层的 hooks 已暂停") : t("hooks 已恢复"));
    loadExtHooks();
  });
  /** 放进事件下匹配规则相同的那组（没有就新开一组） */
  function hkPut(h, v, entry) {
    const groups = h[v.event] || (h[v.event] = []);
    let g = groups.find((x) => (x.matcher || "") === v.matcher);
    if (!g) { g = v.matcher ? { matcher: v.matcher, hooks: [] } : { hooks: [] }; groups.push(g); }
    g.hooks.push(entry);
  }

  async function loadExtMcp() {
    const box = $("ext-mcp");
    const r = await api("/api/ext/mcp").catch((e) => ({ items: [], err: e.message }));
    if (r.ok === false) r.err = r.message || "?";   // 200 + {ok:false} 也是失败，不能画成空列表（195-X.2）
    $("ext-m-count").textContent = r.err ? "—" : (r.items || []).length;
    box.innerHTML = (r.items || []).map((m) => extItem(
      esc(m.name) + (m.cloud ? ` <span class="badge">${t("账户连接器")}</span>` : ""),
      `<span class="mono">${esc(m.target)}</span>`,
      m.cloud ? "" : m.disabled ? `<button data-x="mcp-on" data-id="${esc(m.name)}" data-target="${esc(m.target)}">${t("启用")}</button><button data-x="mcp-forget" data-id="${esc(m.name)}">${t("移除")}</button>`
        : (m.user ? `<button data-x="mcp-off" data-id="${esc(m.name)}">${t("停用")}</button>` : "") + `<button data-x="mcp-rm" data-id="${esc(m.name)}">${t("移除")}</button>`,
      m.disabled ? `<div class="tiny ext-st">${esc(t("已停用：Claude 不会连它，定义存着，点启用就加回来。"))}</div>` : `<div class="tiny ext-st ${m.ok ? "ok" : "warn"}">${esc(m.status)}</div>`,
      m.cloud ? ["cloud"] : m.disabled ? ["off"] : [m.ok ? "ok" : "bad", /^https?:/i.test(m.target || "") ? "remote" : "local"])).join("")
      || `<div class="tiny">${esc(r.err || t("还没有 MCP 服务器。"))}</div>`;
    renderIdx("mcp", [["ok", t("已连接")], ["bad", t("连不上")], ["off", t("已停用")], ["cloud", t("账户连接器")], ["local", t("本地")], ["remote", t("远程")]]);
  }

  // ── 官方技能目录（anthropics/skills）：展开时才拉；装好后上面「技能」列表跟着刷新 ──
  const KB = (n) => (n < 1048576 ? Math.max(1, Math.ceil((n || 0) / 1024)) + " KB" : (n / 1048576).toFixed(1) + " MB");
  async function loadSkillCat(force) {
    const box = $("ext-s-cat");
    if (!box.children.length || force) box.innerHTML = `<div class="tiny">${t("正在拉取官方技能目录…")}</div>`;
    const r = await api("/api/ext/catalog/skills" + (force ? "?refresh=1" : "")).catch((e) => ({ ok: false, message: e.message }));
    if (!r.ok) { box.innerHTML = `<div class="tiny err">${esc(r.message || "")}</div><div class="it-acts"><button data-x="skillcat-retry">${t("重试")}</button></div>`; return; }
    box.innerHTML = r.items.map((x) => extItem(esc(x.name),
      `<span>${KB(x.bytes)}</span>${x.installed ? `<span>${t("已安装")}</span>` : ""}`,
      x.installed ? "" : `<button data-x="skillcat-install" data-id="${esc(x.dir)}">${t("安装")}</button>`,
      `<div class="tiny ext-desc">${esc(x.description)}</div><div class="tiny"><a class="weblink" href="https://github.com/${esc(r.repo)}/tree/main/skills/${esc(x.dir)}">${t("源码与许可证")}</a></div>`)).join("")
      || `<div class="tiny">${t("官方目录是空的。")}</div>`;
  }
  $("ext-s-catbox").addEventListener("toggle", () => { if ($("ext-s-catbox").open) loadSkillCat(); });

  // ── 官方 MCP 注册表：搜索 → 条目里展开小表单（名字、装法、环境变量 / 请求头）→ 交给 claude mcp add ──
  const mcpCat = { q: "", next: "", npx: false, items: new Map(), seq: 0 };
  const mcpShort = (n) => (String(n).split("/").pop() || "mcp").replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 64);
  async function searchMcpCat(more) {
    const box = $("ext-mcp-cat");
    if (!more) { mcpCat.q = $("ext-mcp-q").value.trim(); mcpCat.next = ""; mcpCat.items.clear(); box.innerHTML = `<div class="tiny">${t("正在查注册表…")}</div>`; }
    const my = ++mcpCat.seq;
    const r = await api(`/api/ext/catalog/mcp?q=${encodeURIComponent(mcpCat.q)}&cursor=${encodeURIComponent(more ? mcpCat.next : "")}`).catch((e) => ({ ok: false, message: e.message }));
    if (my !== mcpCat.seq) return;   // 之后又搜过 / 又点过「再显示」：迟到的旧回执不许盖掉新结果、串用游标（审查 B26）
    const old = box.querySelector(".mcpcat-more"); if (old) old.remove();
    if (!r.ok) { box.insertAdjacentHTML(more ? "beforeend" : "afterbegin", `<div class="tiny err">${esc(r.message || "")}</div>`); if (!more) box.querySelector(".tiny:not(.err)")?.remove(); return; }
    mcpCat.npx = r.npx; mcpCat.next = r.next;
    const html = r.items.filter((m) => !mcpCat.items.has(m.name)).map((m) => {
      mcpCat.items.set(m.name, m);
      const usable = m.options.filter((o) => o.kind === "remote" || r.npx);
      const meta = (m.version ? `<span>${esc(m.version)}</span>` : "") +
        m.options.map((o) => `<span>${o.kind === "remote" ? esc(t("远程") + " · " + o.transport) : "npm"}</span>`).join("") +
        (m.other.length ? `<span class="warn">${t("另有 {kinds} 装法，本机用不了", { kinds: esc(m.other.join(" / ")) })}</span>` : "");
      const acts = usable.length ? `<button data-x="mcpcat-add" data-id="${esc(m.name)}">${t("添加")}</button>`
        : `<span class="tiny warn">${m.options.length ? t("要 npx（cccodroid 自带的 Node 里有）") : t("本机装不了")}</span>`;
      return extItem(esc(m.title || m.name), meta, acts,
        `<div class="tiny mono">${esc(m.name)}</div><div class="tiny ext-desc">${esc(m.description)}</div>` +
        (webUrl(m.homepage) ? `<div class="tiny"><a class="weblink" href="${esc(m.homepage)}">${esc(m.homepage)}</a></div>` : "") + `<div class="mcpcat-form hidden"></div>`);
    }).join("");
    if (!more) box.innerHTML = html || `<div class="tiny">${t("没找到。换个关键词试试（英文更全）。")}</div>`;
    else box.insertAdjacentHTML("beforeend", html);
    if (r.next) box.insertAdjacentHTML("beforeend", `<button class="btn ghost sm mcpcat-more">${t("再显示 30 个")}</button>`);
  }
  function mcpCatForm(m, form, oi = 0) {
    const usable = m.options.filter((o) => o.kind === "remote" || mcpCat.npx), o = usable[oi];
    const fields = (o.kind === "npm" ? o.env : o.headers) || [];
    form.innerHTML = `<div class="ext-form">
      ${usable.length > 1 ? `<select data-f="opt">${usable.map((x, i) => `<option value="${i}"${i === oi ? " selected" : ""}>${x.kind === "npm" ? "npm · " + esc(x.package) : esc(t("远程") + " · " + x.target)}</option>`).join("")}</select>` : ""}
      <input data-f="name" value="${esc(mcpShort(m.name))}" placeholder="${esc(t("名字（字母、数字、- _ .）"))}" autocomplete="off">
      <div class="tiny mono">${esc(o.target)}</div>
      ${fields.map((x) => `<input data-k="${esc(x.name)}" data-req="${x.required ? 1 : ""}" type="${x.secret ? "password" : "text"}" autocomplete="off"
        placeholder="${esc(x.name + (x.required ? " *" : "") + (x.description ? " — " + x.description : ""))}">`).join("")}
      <button class="btn sm" data-x="mcpcat-go" data-id="${esc(m.name)}" data-oi="${oi}">${t("确认添加")}</button></div>`;
    form.classList.remove("hidden");
  }
  $("tab-ext").addEventListener("change", (e) => {
    if (e.target.dataset.f !== "opt") return;
    const form = e.target.closest(".mcpcat-form"), id = form.parentElement.querySelector("[data-x=mcpcat-add]")?.dataset.id;
    if (id) mcpCatForm(mcpCat.items.get(id), form, Number(e.target.value));
  });
  $("tab-ext").addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.classList.contains("mcpcat-more")) return searchMcpCat(true);
    const x = b.dataset.x;
    if (x === "skillcat-retry") return loadSkillCat(true);
    if (x === "market-retry") return loadExtMarkets();
    if (x === "skillcat-install") {
      b.disabled = true; b.textContent = t("安装中…");
      const r = await post("/api/ext/catalog/skills/install", { dir: b.dataset.id }).catch((er) => ({ ok: false, message: er.message }));
      toast(r.ok ? t("已安装 {name}，下一条消息生效", { name: b.dataset.id }) : t("安装失败：{msg}", { msg: r.message || "" }), !r.ok);
      if (r.ok) loadExtSkills(); else { b.disabled = false; b.textContent = t("安装"); }
      return;
    }
    if (x === "mcpcat-add") {
      const form = b.closest(".item").querySelector(".mcpcat-form");
      if (!form.classList.contains("hidden")) return form.classList.add("hidden");
      return mcpCatForm(mcpCat.items.get(b.dataset.id), form);
    }
    if (x === "mcpcat-go") {
      const m = mcpCat.items.get(b.dataset.id), form = b.closest(".mcpcat-form");
      const o = m.options.filter((y) => y.kind === "remote" || mcpCat.npx)[Number(b.dataset.oi) || 0];
      const vals = [...form.querySelectorAll("input[data-k]")].map((i) => [i.dataset.k, i.value.trim(), !!i.dataset.req]);
      const lack = vals.filter(([, v, req]) => req && !v).map(([k]) => k);
      if (lack.length) return toast(t("要先填：{names}", { names: lack.join(", ") }), true);
      const filled = vals.filter(([, v]) => v);
      const body = { name: form.querySelector("[data-f=name]").value.trim(), transport: o.transport, target: o.target,
        env: o.kind === "npm" ? filled.map(([k, v]) => k + "=" + v) : [], headers: o.kind === "remote" ? filled.map(([k, v]) => k + ": " + v) : [] };
      if (o.kind === "npm" && !confirm(t("这个 MCP 服务器会在本机运行下面的 npm 包（注册表里任何人都能发布，没人审核），确认是你信任的来源再继续：\n\n{cmd}", { cmd: o.target }))) return;
      b.disabled = true;
      const r = await post("/api/ext/mcp/add", body).catch((er) => ({ ok: false, message: er.message }));
      b.disabled = false;
      toast(r.ok ? t("已添加 {name}", { name: body.name }) : t("添加失败：{msg}", { msg: r.message || "" }), !r.ok);
      if (r.ok) { form.classList.add("hidden"); loadExtMcp(); }
    }
  });
  $("ext-mcp-search").addEventListener("click", () => searchMcpCat(false));
  $("ext-mcp-q").addEventListener("keydown", (e) => { if (e.key === "Enter") searchMcpCat(false); });
  $("ext-mcp-catbox").addEventListener("toggle", () => { if ($("ext-mcp-catbox").open && !$("ext-mcp-cat").children.length) searchMcpCat(false); });

  $("ext-p-search").addEventListener("click", () => searchPlugins(false));
  $("ext-p-q").addEventListener("keydown", (e) => { if (e.key === "Enter") searchPlugins(false); });
  $("ext-s-import").addEventListener("click", () => $("ext-s-file").click());
  $("ext-s-file").addEventListener("change", async (e) => {
    // 文件选择器不限类型（群里转来的 zip 常被标成别的类型，限了就选不中）；可一次选多个，zip 里有几个技能装几个
    const list = [...(e.target.files || [])]; e.target.value = "";
    if (!list.length) return;
    const ok = [], bad = [];
    for (const f of list) {
      // 后端整包接收上限 64 MB：先看大小，别把几百 MB 读进内存再撞 413（196 HTTP/静态/路由）
      if (f.size > 64 * 1024 * 1024) { bad.push(`${f.name}：${t("技能包超过 64 MB，请解压后逐个导入")}`); continue; }
      const r = await api("/api/ext/skills/import", { method: "POST", headers: { "content-type": "application/octet-stream" }, body: await f.arrayBuffer() })
        .catch((err) => ({ ok: false, message: err.message }));
      if (r.ok) ok.push(...(r.dirs || [r.dir]));
      else bad.push(`${f.name}：${r.message || ""}`);
      for (const x of r.skipped || []) bad.push(`${x.name}：${x.why}`);
    }
    if (ok.length) toast(t("已安装技能 {name}", { name: ok.join("、") }) + (bad.length ? "\n" + t("未装：{msg}", { msg: bad.join("；") }) : ""), !!bad.length);
    else toast(t("安装失败：{msg}", { msg: bad.join("；") }), true);
    loadExtSkills();
  });
  $("ext-m-add").addEventListener("click", async () => {
    const source = $("ext-m-src").value.trim();
    if (!source) return;
    toast(t("正在添加市场…"));
    const r = await post("/api/ext/marketplaces/add", { source }).catch((e) => ({ ok: false, message: e.message }));
    toast(r.ok ? t("已添加") : t("添加失败：{msg}", { msg: r.message || "" }), !r.ok);
    if (r.ok) $("ext-m-src").value = "";
    loadExtMarkets();
  });
  $("ext-mcp-add").addEventListener("click", async () => {
    const transport = $("ext-mcp-tr").value;
    // 请求头的值本身可能带英文逗号：有换行就按行分（一行一条），没换行才退回逗号（195-J.11）
    const raw = $("ext-mcp-env").value;
    const extra = (raw.includes("\n") ? raw.split("\n") : raw.split(",")).map((x) => x.trim()).filter(Boolean);
    const body = {
      name: $("ext-mcp-name").value.trim(), transport, target: $("ext-mcp-target").value.trim(),
      env: extra.filter((x) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(x)),
      headers: extra.filter((x) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(x) && x.includes(":")),
    };
    const r = await post("/api/ext/mcp/add", body).catch((e) => ({ ok: false, message: e.message }));
    toast(r.ok ? t("已添加 {name}", { name: body.name }) : t("添加失败：{msg}", { msg: r.message || "" }), !r.ok);
    if (r.ok) { ["ext-mcp-name", "ext-mcp-target", "ext-mcp-env"].forEach((id) => ($(id).value = "")); loadExtMcp(); }
  });

  $("tab-ext").addEventListener("click", async (e) => {
    if (e.target.classList.contains("ext-more-btn")) return searchPlugins(true);
    const g = e.target.closest("[data-g]");
    if (g && !g.disabled) {
      const a = g.dataset.g;
      if (a === "copy") { copyText(g.textContent.trim()); return toast(t("已复制")); }
      if (a === "open") { copyText(g.dataset.code); toast(t("一次性码已复制，在打开的页面里粘贴")); return openExternal(g.dataset.url); }
      if (a === "logout" && !confirm(t("退出 GitHub 账号 {name}？gh 会删掉它保存的令牌。", { name: g.dataset.user }))) return;
      g.disabled = true;
      const r = await post("/api/gh/" + a, { user: g.dataset.user || "" }).catch((err) => ({ ok: false, message: err.message }));
      if (!r.ok) toast(t("失败：{msg}", { msg: r.message || "" }), true);
      if (a === "login") ghAuth.polling = true;
      return loadGhAuth(true);
    }
    const b = e.target.closest("button[data-x]");
    if (!b || b.disabled) return;
    const x = b.dataset.x, id = b.dataset.id;
    if (x === "install") return installPlugin(id, b);
    const url = { uninstall: "/api/ext/plugins/uninstall", enable: "/api/ext/plugins/enable", disable: "/api/ext/plugins/disable",
      "skill-rm": "/api/ext/skills/delete", "mcp-rm": "/api/ext/mcp/remove", "market-rm": "/api/ext/marketplaces/remove",
      "mcp-off": "/api/ext/mcp/disable", "mcp-on": "/api/ext/mcp/enable", "mcp-forget": "/api/ext/mcp/forget" }[x];
    // 别的监听管的按钮（MCP 目录添加、技能目录重试…）也带 data-x：不认识的不归这里，以前会 POST /undefined 再报失败（审查 F-002）
    if (!url) return;
    const ask = {
      uninstall: t("卸载插件 {name}？", { name: id }),
      "skill-rm": t("删除技能 {name}？文件夹会被整个删掉。", { name: id }),
      "mcp-rm": t("移除 MCP 服务器 {name}？", { name: id }),
      "mcp-off": t("停用 MCP 服务器 {name}？它的设置会先存起来，随时能启用。", { name: id }),
      // 加回去的是停用名单里存着的那条：先亮给用户看，名单文件被改过也看得出来
      "mcp-on": t("启用 MCP 服务器 {name}？会加回这条：{target}", { name: id, target: b.dataset.target || "?" }),
      "mcp-forget": t("删掉停用着的 MCP 服务器 {name}？删了就不能一键启用了。", { name: id }),
      "market-rm": t("移除插件市场 {name}？从它装的插件也会一并卸载。", { name: id }),
    }[x];
    if (ask && !confirm(ask)) return;
    b.disabled = true;
    const key = x === "skill-rm" ? "dir" : x.startsWith("mcp-") || x === "market-rm" ? "name" : "id";
    const r = await post(url, { [key]: id }).catch((err) => ({ ok: false, message: err.message }));
    toast(r.ok ? t("完成") : t("失败：{msg}", { msg: r.message || "" }), !r.ok);
    b.disabled = false;
    if (x === "skill-rm") loadExtSkills();
    else if (x.startsWith("mcp-")) loadExtMcp();
    else if (x === "market-rm") { loadExtMarkets(); loadExtPlugins(); }
    else loadExtPlugins();
  });

  // ── 排障：安全模式 / 日志分享 / 修复账本 ───────────────────────────
  function paintSafeMode(on) {
    $("safe-mode").checked = !!on;
    let bar = $("safe-bar");
    if (on && !bar) {
      bar = document.createElement("div");
      bar.id = "safe-bar"; bar.className = "safe-bar";
      bar.innerHTML = `<span>${t("安全模式：自定义配置（CLAUDE.md、技能、插件、钩子、MCP）没有加载")}</span> <button class="btn sm ghost" id="safe-off">${t("退出安全模式")}</button>`;
      $("chat").before(bar);
      $("safe-off").onclick = () => setSafe(false);
    } else if (!on && bar) bar.remove();
  }
  async function setSafe(on) {
    const r = await post("/api/safe-mode", { on }).catch((e) => ({ ok: false, message: e.message }));
    if (!r.ok) { paintSafeMode(!on); return toast(r.message || "", true); }   // 没切成：开关拨回去（审查 D-05）
    paintSafeMode(r.safeMode);
    toast(r.safeMode ? t("已进入安全模式，下一条消息生效") : t("已退出安全模式，下一条消息生效"));
  }
  $("safe-mode").addEventListener("change", (e) => setSafe(e.target.checked));


  // ── 常用指令（0.4.20）：commands 目录里的 <名字>.md，两个范围（所有项目 / 本项目），和 Hooks 那节一样用小标签切 ──
  const UC = { data: null, scope: localStorage.getItem("cc.cmdScope") || "user", edit: null };
  const ucScope = () => UC.data && UC.data.scopes.find((s) => s.scope === UC.scope);
  async function loadExtCmds() {
    try { UC.data = await api("/api/commands"); } catch (e) { $("ext-cmds").innerHTML = `<div class="tiny">${esc(e.message)}</div>`; return; }
    renderCmds();
  }
  function renderCmds() {
    const d = UC.data; if (!d) return;
    $("ext-c-count").textContent = d.scopes.reduce((a, s) => a + s.items.length, 0);
    const proj = String(d.workspace || "").split("/").pop() || d.workspace;
    const SC = { user: t("所有项目"), project: t("本项目（{name}）", { name: proj }) };
    $("cmd-scope").innerHTML = d.scopes.map((s) => `<button class="idx-chip${s.scope === UC.scope ? " on" : ""}" data-cscope="${esc(s.scope)}">${esc(SC[s.scope])}<span>${+s.items.length || 0}</span></button>`).join("");
    const sc = ucScope();
    if (!sc) return;
    if (sc.error) { $("ext-cmds").innerHTML = `<div class="tiny warn">${esc(sc.error)}</div>`; return; }
    $("ext-cmds").innerHTML = sc.items.map((c, i) => `<div class="item uc-item" data-i="${i}">
        <div class="it-title"><span class="mono">/${esc(c.name)}</span>${c.hint ? ` <span class="uc-hint">${esc(c.hint)}</span>` : ""}</div>
        ${c.description ? `<div class="tiny ext-desc">${esc(c.description)}</div>` : ""}
        <div class="it-snip">${esc(c.body.trim().slice(0, 240))}</div>
        <div class="it-acts"><button data-uc="use">${t("插入输入框")}</button>${c.editable ? `<button data-uc="edit">${t("修改")}</button>` : ""}<button data-uc="del">${t("删除")}</button></div></div>`).join("")
      || `<div class="tiny">${UC.scope === "user" ? t("还没有常用指令。点「新建指令」存一条。") : t("这个项目还没有自己的指令。存在这里的指令写进项目的 .claude/commands，项目进了 git 会跟着仓库走。")}</div>`;
  }
  function ucForm(c) {
    UC.edit = c ? c.name : "";
    const f = $("cmd-form");
    MO.cancel(f);   // 上一次「取消」的退场还没播完：它到点会把这张新表单藏掉、清空（审查 09-04）
    f.innerHTML = `
      <label class="tiny">${t("名字（输入框里打 /名字 调用；字母、数字、- 和 _）")}</label>
      <div class="uc-name"><span class="mono">/</span><input data-f="name" class="mono" maxlength="40" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="issue"></div>
      <label class="tiny">${t("说明（显示在 / 列表里，可不填）")}</label>
      <input data-f="description" maxlength="200" autocomplete="off" placeholder="${esc(t("例如：按议题模板整理问题"))}">
      <label class="tiny">${t("参数提示（可不填）")}</label>
      <input data-f="hint" maxlength="80" autocomplete="off" placeholder="${esc(t("例如：<问题描述>"))}">
      <label class="tiny">${t("指令内容（发给 Claude 的话；$ARGUMENTS 换成 /名字 后面跟的内容）")}</label>
      <textarea data-f="body" rows="7" spellcheck="false" placeholder="${esc(t("例如：把下面的问题整理成 GitHub 议题：标题一句话，正文分「现象」「复现步骤」「期望」三段。\n\n$ARGUMENTS"))}"></textarea>
      <div class="row-actions"><button class="btn sm" data-uc="f-save">${c ? t("保存修改") : t("添加")}</button>
        <button class="btn sm ghost" data-uc="f-cancel">${t("取消")}</button></div>`;
    const q = (k) => f.querySelector(`[data-f="${k}"]`);
    if (c) { q("name").value = c.name; q("description").value = c.description || ""; q("hint").value = c.hint || ""; q("body").value = c.body || ""; }
    f.classList.remove("hidden");
    MO.play(f, "mo-in-fade", 1400);
    f.scrollIntoView({ block: "nearest", behavior: "smooth" });
    q(c ? "body" : "name").focus({ preventScroll: true });
  }
  function ucClose() { UC.edit = null; const f = $("cmd-form"); MO.leave(f, "mo-out-fade", 170, () => { f.classList.add("hidden"); f.innerHTML = ""; }); }
  $("ext-c-new").addEventListener("click", () => ucForm(null));
  $("ext-cmd-sec").addEventListener("click", async (e) => {
    const chip = e.target.closest("[data-cscope]");
    if (chip) { UC.scope = chip.dataset.cscope; localStorage.setItem("cc.cmdScope", UC.scope); if (UC.edit != null) ucClose(); return renderCmds(); }
    const b = e.target.closest("[data-uc]"); if (!b) return;
    const sc = ucScope(), it = b.closest(".uc-item"), c = it && sc ? sc.items[+it.dataset.i] : null;
    const act = b.dataset.uc;
    // 发行版把指令经合成插件交给 Claude，实际名字是 /user:<名字>；插入裸名会展开不了（195-J.6）
    // 插到光标处，别把还没发的草稿整个盖掉（196 输入框域；insertAtCursor 是输入框统一入口）
    if (act === "use" && c) { closePage(); insertAtCursor((UC.data.sealed ? "/user:" : "/") + c.name); inputEl.focus(); return; }
    if (act === "edit" && c) return ucForm(c);
    if (act === "del" && c) {
      if (!confirm(t("删除指令 /{name}？", { name: c.name }))) return;
      const r = await post("/api/commands/del", { scope: UC.scope, dir: UC.data.workspace, name: c.name }).catch((err) => ({ ok: false, message: err.message }));
      if (!r.ok) return toast(r.message, true);
      if (MO.on() && it.animate) await it.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateX(${MO.rtl() ? 24 : -24}px)` }], { duration: 155, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" }).finished.catch(() => {});
      await loadExtCmds(); loadCaps();
      return;
    }
    if (act === "f-cancel") return ucClose();
    if (act === "f-save") {
      const f = $("cmd-form"), q = (k) => f.querySelector(`[data-f="${k}"]`).value;
      const body = { scope: UC.scope, dir: UC.data.workspace, name: q("name").trim().replace(/^\//, ""), description: q("description"), hint: q("hint"), body: q("body") };
      if (UC.edit) { if (UC.edit !== body.name) body.oldName = UC.edit; } else body.fresh = true;
      const r = await post("/api/commands/save", body).catch((err) => ({ ok: false, message: err.message }));
      if (!r.ok) return toast(t("保存失败：{msg}", { msg: t(r.message || "") }), true);
      toast(t("已保存 /{name}，输入框里打 / 就能用", { name: r.name }));
      ucClose(); await loadExtCmds(); loadCaps();
      const row = [...document.querySelectorAll("#ext-cmds .uc-item .mono")].find((x) => x.textContent === "/" + r.name);
      if (row) MO.play(row.closest(".uc-item"), "mo-in-rise", 1400);
    }
  });
