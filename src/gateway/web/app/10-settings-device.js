
  // ── 更新：Claude Code（版本、通道、自动更新）──
    const UPD_TEXT = { uptodate: t("已是最新"), available: t("有新版本"), downloading: t("下载中"), ready: t("已下载，待安装"), installing: t("安装中"), error: t("出错"), unknown: t("未检查"), verifying: t("校验中"), damaged: t("已损坏"), missing: t("未安装") };
  let updPoll = null;
  let updFollowUntil = 0;
  const followUpd = () => { updFollowUntil = Date.now() + 15000; };
  let lastUpd = {};
  // 更新状态取不到时不能把整个分类藏掉（用户会以为没有更新功能）；明确说失败、给重试（195-M.8）
  function updFailed(msg) {
    $("upd-field").classList.remove("hidden");
    // 还没有成功过：画错误和重试；已经有旧结果就留着旧行，但底部补一个重试
    if (!lastUpd.items) {
      $("upd-items").innerHTML = `<div class="tiny err">${esc(t("取不到更新状态：{msg}", { msg }))}</div>
        <div class="it-acts"><button class="btn ghost sm" id="upd-retry">${t("重试")}</button></div>`;
    } else if (!$("upd-retry")) {
      $("upd-items").insertAdjacentHTML("beforeend", `<div class="it-acts"><button class="btn ghost sm" id="upd-retry">${t("重试")}</button></div>`);
    }
    $("upd-last").textContent = "✗ " + msg;
    const rt = $("upd-retry"); if (rt) rt.onclick = loadUpd;   // 反复失败也只挂一个监听
  }
  async function loadUpd() {
    let st;
    try { st = await api("/api/app/upd_status"); }
    catch (e) { return updFailed(e.message || "?"); }
    if (st && st.ok === false && st.message) return updFailed(st.message);
    if (!st || !st.ok || !st.items) return;          // 旧版 / 开发端：确实没有这项
    lastUpd = st;
    $("upd-field").classList.remove("hidden");
    $("upd-auto").checked = !!st.auto;
    $("upd-channel").value = st.channel === "pinned" ? "pinned" : st.channel || "stable";
    $("upd-channel").querySelector("option[value=pinned]").textContent = st.channel === "pinned" && st.pin ? t("CLI：固定 {v}", { v: st.pin }) : t("CLI：固定版本…");
    let moving = st.checking;
    $("upd-items").innerHTML = st.items.map((it) => {
      const busy = it.state === "downloading" || it.state === "installing" || it.state === "verifying";
      moving ||= busy;
      const ver = esc(it.current || "?") + (it.latest && it.latest !== it.current && it.state !== "uptodate" ? " → " + esc(it.latest) : "");
      const prog = it.state === "downloading" && it.total ? `（${fmtSize(it.done) || "0 MB"} / ${fmtSize(it.total)} · ${Math.floor(it.done * 100 / it.total)}%）`
        : (it.state === "installing" || it.state === "verifying") && it.total ? `（${Math.floor(it.done * 100 / it.total)}%）` : "";
      const cls = it.state === "error" || it.state === "damaged" || it.state === "missing" ? "err" : it.state === "uptodate" ? "ok" : it.state === "unknown" ? "" : "warn";
      const btn = it.state === "missing" ? t("安装…") : it.state === "available" ? (it.id === "claude" ? t("更新") : t("下载并安装"))
        : it.state === "ready" ? t("安装") : it.state === "damaged" ? t("修复") : it.state === "error" && it.latest ? t("重试") : "";
      const verBtn = it.id === "claude" && it.current && !busy
        ? `<button class="btn sm ghost" data-item="claude" data-act="versions">${t("版本…")}</button>` : "";
      return `<div class="row-actions" style="justify-content:space-between">
        <div><b>${esc(it.name)}</b> <span class="tiny">${ver}</span><br>
          <span class="prov-state ${cls}" style="margin:0">${UPD_TEXT[it.state] || esc(it.state)}${prog}${it.message ? " · " + esc(it.message) : ""}</span></div>
        <div class="row-actions">${verBtn}${btn ? `<button class="btn sm" data-item="${esc(it.id)}"${act ? ` data-act="${act}"` : ""}>${btn}</button>` : ""}</div></div>`;
    }).join("");
    $("upd-last").textContent = st.checking ? t("检查中…") : st.error ? "✗ " + st.error
      : st.lastCheck ? t("上次检查：{at}", { at: new Date(st.lastCheck).toLocaleString() }) : t("还没检查过");
    clearTimeout(updPoll);
    // 点完按钮 / 换完渠道后的一小段时间也接着刷：后台的检查、换版本要过一会儿才开始，只看「正在进行」会漏掉结果
    if ((moving || st.checking || Date.now() < updFollowUntil) && pageOn("settings")) updPoll = setTimeout(loadUpd, 1500);
  }
  /** Claude Code 版本选单：跟随 stable / latest，或固定到某一版（固定后自动更新、检查更新都不动它） */
  async function openClaudeVersions() {
    if ($("ccv-pick")) return;
    const it = ((lastUpd && lastUpd.items) || []).find((x) => x.id === "claude") || {};
    const mode = (lastUpd && lastUpd.channel) || "stable", pin = (lastUpd && lastUpd.pin) || "";
    const m = document.createElement("div");
    m.id = "ccv-pick";
    m.innerHTML = `<div class="sheet-panel mp-panel">
      <div class="mp-head"><b>${t("Claude Code 版本")}</b><button class="mp-x" type="button" aria-label="${t("关闭")}">${uiI("x")}</button></div>
      <div class="mp-lbl">${t("跟随渠道（自动更新跟着它走）")}</div><div class="ccv-ch"><div class="tiny">${t("读取中…")}</div></div>
      <div class="mp-lbl">${t("固定到某一版（自动更新不再改它）")}</div>
      <label class="searchbox mp-sb"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input class="mp-q" type="search" inputmode="decimal" autocomplete="off" placeholder="${t("搜索版本号")}"></label>
      <div class="mp-list"><div class="tiny">${t("读取中…")}</div></div>
      <div class="tiny mp-note">${t("登录、会话和设置不受影响；版本越旧，越可能缺新功能。")}</div>
      </div>`;
    OV.open(m, { kind: "modal", keep: true, cover: true });
    const close = () => OV.close(m);
    m.addEventListener("click", (e) => { if (e.target === m || e.target.closest(".mp-x")) close(); });
    let info;
    try { info = await api("/api/claude/versions?lang=" + encodeURIComponent(I18N.lang || "zh")); } catch (e) { info = { ok: false, message: e.message, versions: [] }; }
    if (!m.isConnected) return;
    const chBox = m.querySelector(".ccv-ch"), list = m.querySelector(".mp-list"), q = m.querySelector(".mp-q");
    const chRow = (ch, v, sub) => `<button type="button" class="mp-item${mode === ch ? " cur" : ""}" data-ch="${ch}"><span>${t("跟随 {ch}", { ch })}${v ? " · " + esc(v) : ""}</span><small>${esc(sub)}</small></button>`;
    chBox.innerHTML = chRow("stable", info.stable, t("官方稳定渠道")) + chRow("latest", info.latest, t("最新发布，比 stable 新，也可能没那么稳"));
    const tags = (v) => [v === info.stable ? "stable" : "", v === info.latest ? "latest" : "", v === it.current ? t("当前装的") : "", mode === "pinned" && v === pin ? t("已固定") : ""].filter(Boolean).join(" · ");
    const paint = () => {
      const kw = q.value.trim();
      const vs = (info.versions || []).filter((v) => !kw || v.includes(kw));
      list.innerHTML = vs.slice(0, 200).map((v) => {
        const tg = esc(tags(v));
        return `<button type="button" class="mp-item${mode === "pinned" && v === pin ? " cur" : ""}" data-v="${esc(v)}"><span>${esc(v)}</span>${tg ? `<small>${tg}</small>` : ""}</button>`;
      }).join("")
        || `<div class="tiny">${info.versions && info.versions.length ? t("没有匹配的版本") : esc(info.message || t("取不到版本列表"))}</div>`;
    };
    paint();
    q.addEventListener("input", paint);
    m.querySelector(".mp-panel").addEventListener("click", async (e) => {
      const b = e.target.closest(".mp-item");
      if (!b) return;
      const ch = b.dataset.ch || "pinned", v = b.dataset.v || "";
      if (ch === mode && (ch !== "pinned" || v === pin) && it.state !== "missing") { close(); toast(t("已经是这个设置")); return; }
      const target = ch === "pinned" ? v : info[ch];
      if (target && bad[target] && !confirm(t("{v} 有已知问题：{why}\n\n仍然换到这一版？", { v: target, why: bad[target].text }))) return;
      close();
      const r = await post("/api/app/upd_set", ch === "pinned" ? { channel: ch, version: v } : { channel: ch }).catch((e2) => ({ ok: false, message: e2.message }));
      // 卸载过（未安装）：改设置不会自动装回，要再明说装一次
      if (it.state === "missing" && r.ok !== false) {
        const r2 = await post("/api/app/upd_apply", { item: "claude", version: ch === "pinned" ? v : ch }).catch((e2) => ({ ok: false, message: e2.message }));
        toast(r2.message || (r2.ok ? t("开始") : t("失败")), !r2.ok);
      } else toast(r.ok === false ? (r.message || t("失败")) : ch === "pinned" ? t("已固定到 {v}，正在切换", { v }) : t("已改为跟随 {ch}", { ch }), r.ok === false);
      followUpd(); setTimeout(loadUpd, 500);
    });
  }
  $("upd-items").addEventListener("click", async (e) => {
    const item = e.target.dataset && e.target.dataset.item;
    if (!item) return;
    const act = e.target.dataset.act;
    if (act === "pick" || act === "versions") { openClaudeVersions(); return; }   // 换版本：走版本选单
    const r = await post("/api/app/upd_apply", { item }).catch((e2) => ({ ok: false, message: e2.message }));
    toast(r.message || (r.ok ? t("开始") : t("失败")), !r.ok);
    followUpd(); setTimeout(loadUpd, 500);
  });
  // ── 通知：任务跑完 / 等确认时提醒（Linux 版发桌面通知）──
  async function loadNotify() {
    let st;
    try { st = await api("/api/app/notify_status"); }
    catch (e) {
      // 网关刚起 / 断网：以前直接隐藏整块，和「这个版本没有这项」分不出来（稳定性报告 FIND-032）
      $("ntf-err").textContent = t("读取失败") + (e && e.message ? "：" + e.message : "");
      $("ntf-err-block").classList.remove("hidden");
      return;
    }
    $("ntf-err-block").classList.add("hidden");
    if (!st.ok) return;                              // 开发端 / 旧版：没有这项
    ntfBeacon();
    $("ntf-field").classList.remove("hidden");
    $("ntf-done").checked = !!st.done;
    $("ntf-ask").checked = !!st.ask;
  }
  for (const k of ["done", "ask"])
    // 没存上：说出来，并按网关的真实状态把开关拨回去（#177-7）
    $("ntf-" + k).addEventListener("change", (e) => post("/api/app/notify_set", { [k]: e.target.checked })
      .then((j) => { if (j && j.ok === false) throw new Error(j.message || t("保存失败")); })
      .then(loadNotify, (err) => { toast(t("保存失败：{msg}", { msg: err.message || "" }), true); loadNotify(); }));
  $("ntf-retry").addEventListener("click", () => loadNotify());
  // 去系统设置里改完通知权限再回来，设置页不会重新打开：状态要自己重拉一次，不然一直显示改之前的（稳定性报告 FIND-031）
  document.addEventListener("visibilitychange", () => { if (!document.hidden && setOpen) loadNotify(); });
  // Linux 桌面通知要知道窗口在不在前台：网关说「通知可用」之后才开始报，在前台时每 20 秒续一次，网关 45 秒没收到就当离开了
  let ntfBeating = false, ntfLast = null;
  function ntfBeat() {
    const f = !document.hidden && document.hasFocus();
    if (!f && ntfLast === false) return;
    ntfLast = f;
    post("/api/app/notify_focus", { focused: f }).catch(() => {});
  }
  function ntfBeacon() {
    if (ntfBeating) return;
    ntfBeating = true;
    setInterval(ntfBeat, 20000);
    window.addEventListener("focus", ntfBeat); window.addEventListener("blur", ntfBeat);
    document.addEventListener("visibilitychange", ntfBeat);
    ntfBeat();
  }


  // 打开更新页时自动查一次：正在查、正在下/装，或 20 秒内刚查过就只刷新显示
  async function updOnOpen() {
    await loadUpd();
    const busy = (lastUpd.items || []).some((it) => ["downloading", "installing", "verifying"].includes(it.state));
    if (lastUpd.checking || busy || Date.now() - (lastUpd.lastCheck || 0) < 20000) return;
    await post("/api/app/upd_check").catch(() => {});
    followUpd(); setTimeout(loadUpd, 300);
  }
  $("upd-check").addEventListener("click", async () => {
    // 200 + {ok:false} 也是失败，以前只接网络错误，按钮像没反应（195-M.8）。
    // 检查要访问 GitHub / npm，慢的时候几秒才有结果；先立刻给一句反馈，别让人以为按钮坏了。
    toast(t("正在检查更新…"));
    let r = null;
    try { r = await post("/api/app/upd_check"); } catch (e2) { return toast(e2.message, true); }
    if (r && r.ok === false) toast(r.message || t("检查更新失败"), true);
    followUpd(); setTimeout(loadUpd, 300);
  });
  // 存不上（网关回 ok:false 或断了）：开关先退回上次读到的值，再重读（审查 #52 D-05）
  const updBack = (msg) => { toast(msg || t("保存失败"), true); if (lastUpd && lastUpd.items) { $("upd-auto").checked = !!lastUpd.auto; $("upd-channel").value = lastUpd.channel === "pinned" ? "pinned" : lastUpd.channel || "stable"; } loadUpd(); };
  $("upd-auto").addEventListener("change", (e) => post("/api/app/upd_set", { auto: e.target.checked })
    .then((r) => (r && r.ok === false ? updBack(r.message) : loadUpd())).catch((e2) => updBack(e2.message)));
  $("upd-channel").addEventListener("change", (e) => {
    // 固定版本要先挑一版：开选单，下拉框先退回原样，挑完 loadUpd 会刷新成「固定 x.y.z」
    if (e.target.value === "pinned") { e.target.value = (lastUpd && lastUpd.channel) || "stable"; openClaudeVersions(); return; }
    followUpd(); post("/api/app/upd_set", { channel: e.target.value }).then((r) => (r && r.ok === false ? updBack(r.message) : loadUpd())).catch((e2) => updBack(e2.message));
  });


