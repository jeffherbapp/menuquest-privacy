// The admin panel (A3). The page decides nothing: it shows the panel only after admin-api
// (which checks the sign-in, the database's admin list and the authenticator code) answers
// admin: true. Text from the server is always set with textContent, never as HTML.
(() => {
  "use strict";

  const SUPABASE_URL = "https://anufzyrmkdzgfmwxasul.supabase.co";
  // The publishable key is meant to be public. It can't read anything admin: admin-api checks
  // the signed-in admin on every request, and the admin tables are closed to it.
  const PUBLISHABLE_KEY = "sb_publishable_UB7Gr7e5WMitvojxORa7Ow_srPYffZV";
  const API = SUPABASE_URL + "/functions/v1/admin-api/";

  const $ = (id) => document.getElementById(id);
  const sections = ["loading", "step-email", "step-code", "step-enroll", "step-mfa", "denied", "problem", "panel"];

  if (!window.supabase || !window.supabase.createClient) {
    show("problem", "The sign-in library didn't load. Check your connection and try again.");
    return;
  }

  const db = window.supabase.createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: {
      // Kept only for this browser tab, so closing it signs you out.
      storage: window.sessionStorage,
      storageKey: "menuquest-admin",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true, // the link in the sign-in email
      flowType: "implicit",
    },
  });

  let email = "";
  let enrollingFactor = null;

  function show(id, problem) {
    for (const s of sections) $(s).hidden = s !== id;
    $("sign-out").hidden = !["step-enroll", "step-mfa", "denied", "panel", "problem"].includes(id);
    if (id === "problem") $("problem-text").textContent = problem || "Try again in a minute.";
    if (id !== "panel") $("who").textContent = "";
    const input = $(id).querySelector("input");
    if (input) setTimeout(() => input.focus(), 0);
  }

  function say(form, text, isError) {
    const status = form.querySelector(".status");
    status.textContent = text || "";
    status.className = "status" + (isError ? " err" : "");
  }

  function busy(form, on) {
    for (const b of form.querySelectorAll("button")) b.disabled = on;
  }

  async function callApi(route, body) {
    const { data } = await db.auth.getSession();
    const token = data.session && data.session.access_token;
    if (!token) return { status: 401, body: {} };
    const res = await fetch(API + route, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token, "apikey": PUBLISHABLE_KEY },
      body: JSON.stringify(body || {}),
      cache: "no-store",
    });
    let json = {};
    try { json = await res.json(); } catch (_) { /* not JSON */ }
    return { status: res.status, body: json };
  }

  // MARK: Dashboard (A4)

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  const num = (v) => (typeof v === "number" && isFinite(v) ? v.toLocaleString() : "–");
  const get = (obj, path) => path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);

  /** A card with a heading, big numbers, and optionally a Today / 7 days / 30 days table. */
  function card(title, tiles, rows, note) {
    const c = el("section", "card dash-card");
    c.append(el("h2", null, title));
    if (tiles.length) {
      const t = el("div", "tiles");
      for (const [label, value] of tiles) {
        const tile = el("div", "tile");
        tile.append(el("span", "tile-value", num(value)), el("span", "tile-label", label));
        t.append(tile);
      }
      c.append(t);
    }
    if (rows.length) {
      const table = el("table", "periods");
      const head = el("tr");
      for (const h of ["", "Today", "7 days", "30 days"]) head.append(el("th", null, h));
      const thead = el("thead");
      thead.append(head);
      table.append(thead);
      const tbody = el("tbody");
      for (const [label, values] of rows) {
        const tr = el("tr");
        tr.append(el("th", null, label));
        for (const k of ["today", "d7", "d30"]) tr.append(el("td", null, num(values && values[k])));
        tbody.append(tr);
      }
      table.append(tbody);
      c.append(table);
    }
    if (note) c.append(el("p", "note", note));
    return c;
  }

  function renderDashboard(d) {
    const box = $("dashboard");
    box.replaceChildren(
      card("Testers", [["active in 7 days", get(d, "users.active.d7")], ["active today", get(d, "users.active.today")]],
        [["Active", get(d, "users.active")], ["New installs", get(d, "users.new")]],
        "An install counts as active when the app used its sign-in in that period. Your admin account isn't counted."),
      card("Users", [
        ["installs", get(d, "users.total")], ["anonymous", get(d, "users.anonymous")],
        ["Sign in with Apple", get(d, "users.apple")], ["email", get(d, "users.email")],
      ], []),
      card("Restaurants", [
        ["added by users", get(d, "restaurants.added.total")],
        ["in the library", get(d, "restaurants.library_places")],
        ["with a menu ready", get(d, "restaurants.with_menu")],
      ], [["Added by users", get(d, "restaurants.added")]],
        "\"Added\" counts restaurants a user added first; adding one already in the library doesn't count again."),
      card("Menus", [["shared menus", get(d, "menus.shared_menus")]], [
        ["Website lookups", get(d, "menus.website_reads")],
        ["Photo scans", get(d, "menus.photo_scans")],
        ["New website menus", get(d, "menus.new_shared.website")],
        ["New scanned menus", get(d, "menus.new_shared.scan")],
        ["New menu versions", get(d, "menus.new_versions")],
      ], "Lookups and scans are requests from the app, including ones answered from a saved menu. Menu versions are the background reader's."),
    );
    const at = d && d.generated_at ? new Date(d.generated_at) : null;
    $("dash-status").textContent = at ? "Updated " + at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + ". Days are UTC days." : "";
  }

  async function loadDashboard() {
    $("dash-status").className = "status";
    $("dash-status").textContent = "Loading…";
    $("dash-refresh").disabled = true;
    try {
      const res = await callApi("dashboard");
      if (res.status === 200) return renderDashboard(res.body);
      if (res.status === 401) return route(); // the sign-in ended: start over
      if (res.status === 403) return show("denied");
      $("dash-status").className = "status err";
      $("dash-status").textContent = "Couldn't load the numbers (" + res.status + "). Try Refresh.";
    } catch (e) {
      console.error(e);
      $("dash-status").className = "status err";
      $("dash-status").textContent = "Couldn't reach the server. Try Refresh.";
    } finally {
      $("dash-refresh").disabled = false;
    }
  }


  // MARK: Spending and switches (A5)

  const usd = (v) => {
    const n = Number(v);
    if (!isFinite(n)) return "–";
    if (n > 0 && n < 0.005) return "<$0.01";
    return "$" + n.toFixed(2);
  };
  const sum = (o, keys) => keys.reduce((t, k) => t + (Number(o && o[k]) || 0), 0);
  const USER_KEYS = ["user_claude", "user_google", "est_scans", "est_tagging", "est_searches"];
  let costs = null;

  function meter(label, spent, cap) {
    const wrap = el("div", "meter");
    const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
    const line = el("div", "meter-label");
    line.append(el("span", null, label), el("span", "meter-value", usd(spent) + " of " + usd(cap)));
    const bar = el("div", "meter-bar");
    const fill = el("div", "meter-fill" + (pct >= 90 ? " hot" : ""));
    fill.style.width = pct.toFixed(1) + "%";
    bar.append(fill);
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", label + ": " + usd(spent) + " of " + usd(cap));
    wrap.append(line, bar);
    return wrap;
  }

  function switchRow(title, detail, on, onLabel, offLabel, buttonText, action) {
    const row = el("div", "switch-row");
    const text = el("div", "switch-text");
    const head = el("div", "switch-head");
    head.append(el("strong", null, title), el("span", "pill " + (on ? "on" : "off"), on ? onLabel : offLabel));
    text.append(head, el("p", "switch-detail", detail));
    const button = el("button", "button small" + (on ? " quiet" : ""), buttonText);
    button.type = "button";
    button.addEventListener("click", action);
    row.append(text, button);
    return row;
  }

  function renderCosts(c) {
    costs = c;
    const sw = c.switches || {};
    const caps = c.caps || {};
    const per = c.periods || {};
    const queued = c.queued || {};

    const card = el("section", "card costs-card");
    card.append(el("h2", null, "Spending"));

    // Switches
    const paused = sw.paid_paused === true;
    card.append(switchRow(
      "All paid lookups",
      paused
        ? "Paused" + (sw.paid_paused_at ? " since " + new Date(sw.paid_paused_at).toLocaleString() : "") +
          ". Testers see “Menu lookups are paused”. Saved menus still work."
        : "Restaurant search, website menus, photo scans and dish tagging for testers, plus background work.",
      !paused, "Running", "Paused", paused ? "Resume…" : "Pause all…",
      () => paused ? resumePaid() : pausePaid(),
    ));
    const bgOn = sw.background_on === true;
    card.append(switchRow(
      "Background work",
      "Prefetch, seeding and nightly re-reads. Limited by the caps below." +
        (queued.background ? " " + queued.background + " job" + (queued.background === 1 ? "" : "s") + " waiting." : ""),
      bgOn, "On", "Off", bgOn ? "Turn off" : "Turn on…",
      () => bgOn ? setBackground(false) : turnOnBackground(),
    ));

    // Caps
    const capBox = el("div", "caps");
    capBox.append(
      meter("Background today", caps.today_usd, Number(caps.daily_usd)),
      meter("Background this month", caps.month_usd, Number(caps.monthly_usd)),
    );
    card.append(capBox, el("p", "note",
      "The caps count background work and quality tests, not testers' own adds. Over a cap, background work waits for the next UTC day or month."));

    // Table
    const cols = [["today", "Today"], ["d7", "7 days"], ["month", "This month"], ["last_month", "Last month"]];
    const rows = [
      ["Testers: website menus (Claude)", ["user_claude"]],
      ["Testers: website menus (Google)", ["user_google"]],
      ["Testers: photo scans (est.)", ["est_scans"]],
      ["Testers: dish tagging (est.)", ["est_tagging"]],
      ["Testers: restaurant search (est.)", ["est_searches"]],
      ["Background (Claude)", ["background_claude"]],
      ["Background (Google)", ["background_google"]],
      ["Quality tests (Claude)", ["tests_claude"]],
      ["Quality tests (Google)", ["tests_google"]],
    ];
    const allKeys = rows.flatMap((r) => r[1]);
    const table = el("table", "periods money");
    const thead = el("thead");
    const head = el("tr");
    for (const h of ["", ...cols.map((c2) => c2[1])]) head.append(el("th", null, h));
    thead.append(head);
    const tbody = el("tbody");
    for (const [label, keys] of rows) {
      const tr = el("tr");
      tr.append(el("th", null, label));
      for (const [k] of cols) tr.append(el("td", null, usd(sum(per[k], keys))));
      tbody.append(tr);
    }
    const total = el("tr", "total");
    total.append(el("th", null, "Claude and Google"));
    for (const [k] of cols) total.append(el("td", null, usd(sum(per[k], allKeys))));
    tbody.append(total);
    const supa = el("tr");
    const supaHead = el("th", null, "Supabase (fixed) ");
    const edit = el("button", "link-button inline", "Edit");
    edit.type = "button";
    edit.addEventListener("click", editSupabasePrice);
    supaHead.append(edit);
    supa.append(supaHead, el("td", null, ""), el("td", null, ""), el("td", null, usd(c.supabase_monthly_usd)), el("td", null, usd(c.supabase_monthly_usd)));
    tbody.append(supa);
    table.append(thead, tbody);
    const scroller = el("div", "table-scroll");
    scroller.append(table);
    card.append(scroller, el("p", "note",
      "Claude and Google rows come from the cost log. “est.” rows are estimated from token counts and request counts at list prices. Days and months are UTC."));

    $("costs").replaceChildren(card);
  }

  async function loadCosts() {
    try {
      const res = await callApi("costs");
      if (res.status === 200) return renderCosts(res.body);
      if (res.status === 401) return route();
      if (res.status === 403) return show("denied");
      $("costs").replaceChildren(el("p", "status err", "Couldn't load spending (" + res.status + "). Try Refresh."));
    } catch (e) {
      console.error(e);
      $("costs").replaceChildren(el("p", "status err", "Couldn't reach the server for spending. Try Refresh."));
    }
  }

  /** Sends a switch change; shows the server's refusal if any; reloads the numbers. */
  async function change(route_, body) {
    $("dash-status").className = "status";
    $("dash-status").textContent = "Saving…";
    try {
      const res = await callApi(route_, body);
      if (res.status === 401) return route();
      if (res.status !== 200) {
        const m = res.body && res.body.error && res.body.error.message;
        $("dash-status").className = "status err";
        $("dash-status").textContent = m || "That didn't work (" + res.status + ").";
        return;
      }
      $("dash-status").textContent = "Saved.";
    } catch (e) {
      console.error(e);
      $("dash-status").className = "status err";
      $("dash-status").textContent = "Couldn't reach the server. Nothing changed.";
      return;
    }
    await loadCosts();
  }

  function turnOnBackground() {
    const c = costs || {};
    const caps = c.caps || {};
    const left = (cap, spent) => usd(Math.max(0, Number(cap) - Number(spent)));
    const ok = window.confirm(
      "Turn background work on?\n\n" +
      "It can spend up to the caps: " + usd(caps.daily_usd) + " a day and " + usd(caps.monthly_usd) + " a month.\n" +
      "Already counted: " + usd(caps.today_usd) + " today, " + usd(caps.month_usd) + " this month.\n" +
      "So at most " + left(caps.daily_usd, caps.today_usd) + " more today and " + left(caps.monthly_usd, caps.month_usd) + " more this month.\n" +
      ((c.queued && c.queued.background) ? c.queued.background + " background jobs are waiting." : "No background jobs are waiting right now."));
    if (ok) change("set_background", { on: true, confirm: true });
  }

  function setBackground(on) {
    change("set_background", { on });
  }

  function pausePaid() {
    const ok = window.confirm(
      "Pause all paid lookups?\n\n" +
      "Testers can't search restaurants, look up website menus, scan photos or tag dishes until you resume. " +
      "They'll see “Menu lookups are paused”. Saved menus keep working.\n\n" +
      "Background work turns off too.");
    if (ok) change("set_paid_pause", { paused: true });
  }

  function resumePaid() {
    const per = (costs && costs.periods) || {};
    const week = sum(per.d7, USER_KEYS);
    const ok = window.confirm(
      "Resume paid lookups?\n\n" +
      "Testers' lookups cost about " + usd(week) + " in the last 7 days (about " + usd(week / 7) + " a day). " +
      "Each tester also has daily limits.\n\n" +
      "Background work stays off; turn it on separately.");
    if (ok) change("set_paid_pause", { paused: false, confirm: true });
  }

  function editSupabasePrice() {
    const now = costs ? Number(costs.supabase_monthly_usd) : 25;
    const answer = window.prompt("Supabase plan price per month, in US dollars:", String(now));
    if (answer === null) return;
    const value = Number(String(answer).replace(/[$,\s]/g, ""));
    if (!isFinite(value) || value < 0 || value > 10000) {
      $("dash-status").className = "status err";
      $("dash-status").textContent = "Enter a number from 0 to 10,000.";
      return;
    }
    change("set_supabase_price", { usd: value });
  }


  // MARK: Menu library (A6)

  const lib = { filter: "flagged", query: "", place: null, menuId: null, data: null, preview: null };

  const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "–");
  const day = (iso) => (iso ? new Date(iso).toLocaleDateString([], { dateStyle: "medium" }) : "–");

  /** An outside link, only for http(s) addresses. Opens in a new tab without a referrer. */
  function outLink(url, text) {
    let ok = false;
    try { ok = /^https?:$/.test(new URL(url).protocol); } catch (_) { /* not a URL */ }
    if (!ok) return el("span", "muted", text || url || "");
    const a = el("a", null, text || url);
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  }

  function linkLine(url) {
    const p = el("p", "muted small-print");
    p.append(outLink(url, "Read from " + url));
    return p;
  }

  function button(text, cls, onClick) {
    const b = el("button", cls || "link-button inline", text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  function badge(text, kind) {
    return el("span", "pill " + (kind || "off"), text);
  }

  function libSay(text, isError) {
    $("lib-status").className = "status" + (isError ? " err" : "");
    $("lib-status").textContent = text || "";
  }

  function showTab(name) {
    for (const b of document.querySelectorAll(".tab")) b.setAttribute("aria-pressed", String(b.dataset.tab === name));
    $("tab-overview").hidden = name !== "overview";
    $("tab-menus").hidden = name !== "menus";
    try { sessionStorage.setItem("menuquest-admin-tab", name); } catch (_) { /* fine */ }
    if (name === "menus" && !$("lib-items").childElementCount && !lib.place) loadLibrary();
  }

  async function loadLibrary() {
    libSay("Loading…");
    try {
      const res = await callApi("library", { query: lib.query, filter: lib.filter, limit: 100 });
      if (res.status === 401) return route();
      if (res.status === 403) return show("denied");
      if (res.status !== 200) return libSay("Couldn't load menus (" + res.status + ").", true);
      renderLibrary(res.body);
    } catch (e) {
      console.error(e);
      libSay("Couldn't reach the server.", true);
    }
  }

  function renderLibrary(d) {
    const counts = d.counts || {};
    const filters = [["flagged", "Flagged"], ["short", "Short"], ["reported", "Reported"], ["hidden", "No menu"], ["all", "All"]];
    $("lib-filters").replaceChildren(...filters.map(([key, label]) => {
      const b = button(label + " " + num(counts[key]), "chip", () => { lib.filter = key; loadLibrary(); });
      b.setAttribute("aria-pressed", String(lib.filter === key));
      return b;
    }));
    const items = Array.isArray(d.items) ? d.items : [];
    libSay(items.length ? "" : "Nothing here." + (lib.query ? " Try another search." : ""));
    $("lib-items").replaceChildren(...items.map((it) => {
      const li = el("li");
      const row = el("button", "lib-row");
      row.type = "button";
      const top = el("span", "lib-name", it.name || it.place_id);
      const tags = el("span", "lib-tags");
      if (it.short) tags.append(badge("Short", "off"));
      if (it.reports > 0) tags.append(badge(it.reports + " report" + (it.reports === 1 ? "" : "s"), "off"));
      if (it.no_menu) tags.append(badge("No visible menu", "off"));
      const meta = el("span", "lib-meta", it.no_menu
        ? (it.versions + " hidden version" + (it.versions === 1 ? "" : "s"))
        : num(it.item_count) + " dishes · " + (it.source === "scan" ? "photo scan" : "website") + " · " + day(it.saved_at) +
          (it.versions > 1 ? " · " + it.versions + " versions" : "") + " · " + num(it.links) + " link" + (it.links === 1 ? "" : "s"));
      row.append(top, tags, meta);
      row.addEventListener("click", () => openMenu(it.place_id, null));
      li.append(row);
      return li;
    }));
  }

  async function openMenu(place, menuId) {
    lib.place = place;
    lib.menuId = menuId;
    $("lib-list").hidden = true;
    $("lib-detail").hidden = false;
    $("lib-detail").replaceChildren(el("p", "status", "Loading…"));
    try {
      const res = await callApi("menu", { placeId: place, menuId });
      if (res.status === 401) return route();
      if (res.status === 403) return show("denied");
      if (res.status !== 200) {
        const m = res.body && res.body.error && res.body.error.message;
        return $("lib-detail").replaceChildren(backButton(), el("p", "status err", m || "Couldn't load that menu (" + res.status + ")."));
      }
      lib.data = res.body;
      renderMenu();
    } catch (e) {
      console.error(e);
      $("lib-detail").replaceChildren(backButton(), el("p", "status err", "Couldn't reach the server."));
    }
  }

  function backButton() {
    return button("← All menus", "link-button", () => {
      lib.place = null;
      lib.preview = null;
      $("lib-detail").hidden = true;
      $("lib-list").hidden = false;
      loadLibrary();
    });
  }

  function sectionsList(sections, limitPerSection) {
    const box = el("div", "menu-sections");
    for (const s of sections || []) {
      const det = el("details");
      const items = Array.isArray(s.items) ? s.items : [];
      det.append(el("summary", null, (s.name || s.category || "Section") + " (" + items.length + ")"));
      const ul = el("ul", "menu-items");
      for (const it of items.slice(0, limitPerSection || 500)) {
        const text = typeof it === "string" ? it : ((it && it.name) || "") + (it && it.price ? " · " + it.price : "");
        ul.append(el("li", null, text));
      }
      det.append(ul);
      box.append(det);
    }
    if (!box.childElementCount) box.append(el("p", "muted", "No sections."));
    return box;
  }

  function renderMenu() {
    const d = lib.data || {};
    const shown = d.shown;
    const box = $("lib-detail");
    const parts = [backButton()];

    const head = el("div", "detail-head");
    head.append(el("h2", null, d.name || d.place_id));
    const sub = el("p", "muted");
    if (d.website) sub.append(outLink(d.website, d.website), document.createTextNode(" · "));
    sub.append(document.createTextNode("place " + d.place_id));
    head.append(sub);
    parts.push(head);

    // The menu being shown
    const menuCard = el("section", "card");
    if (shown) {
      const title = el("h3", null, (shown.hidden ? "Hidden version: " : "Live menu: ") + num(shown.item_count) + " dishes");
      menuCard.append(title, el("p", "muted",
        (shown.source === "scan" ? "Photo scan" : "Website") + " · saved " + when(shown.created_at)));
      if (shown.source_url) menuCard.append(linkLine(shown.source_url));
      menuCard.append(sectionsList((shown.menu && shown.menu.sections) || []));
      if (lib.menuId) menuCard.append(button("Back to the live menu", "link-button", () => openMenu(lib.place, null)));
    } else {
      menuCard.append(el("h3", null, "No visible menu"), el("p", "muted", "Every saved version is hidden, or none was saved."));
    }
    parts.push(menuCard);

    // Re-read
    const rr = el("section", "card");
    rr.append(el("h3", null, "Read it again"));
    const est = usd(d.reread_estimate_usd);
    if (lib.preview) {
      const p = lib.preview;
      rr.append(el("p", null, "New read: " + num(p.newItems) + " dishes (live menu: " + num(p.liveItems) + "). Nothing is saved yet."));
      if (p.sourceUrl) rr.append(linkLine(p.sourceUrl));
      if (p.deferredLists && p.deferredLists.length) rr.append(el("p", "muted", "Lists left out: " + p.deferredLists.join(", ")));
      rr.append(sectionsList(p.sections));
      const row = el("div", "button-row");
      row.append(button("Save as the live menu…", "button small", saveReread), button("Discard", "button small quiet", () => { lib.preview = null; renderMenu(); }));
      rr.append(row);
    } else if (d.pending_read) {
      rr.append(el("p", null, "A re-read is waiting: " + num(d.pending_read.itemCount) + " dishes. Re-read again to see it before saving."));
      rr.append(button("Re-read (about " + est + ")…", "button small", reread));
    } else {
      rr.append(el("p", "muted", "Reads the menu links below under today's rules and shows you the result. Nothing changes until you save it."));
      rr.append(button("Re-read (about " + est + ")…", "button small", reread));
    }
    const rrStatus = el("p", "status", "");
    rrStatus.id = "rr-status";
    rrStatus.setAttribute("role", "status");
    rr.append(rrStatus);
    parts.push(rr);

    // Links
    const links = el("section", "card");
    links.append(el("h3", null, "Menu links"));
    const ul = el("ul", "plain-list");
    for (const l of d.links || []) {
      const li = el("li");
      li.append(outLink(l.url, l.url));
      const meta = el("span", "muted small-print", " " + [l.label, l.format, l.status, l.is_primary ? "primary" : null, l.discovered_by ? "by " + l.discovered_by : null]
        .filter(Boolean).join(" · "));
      li.append(meta);
      if (l.status === "active") li.append(document.createTextNode(" "), button("Remove", null, () => removeLink(l)));
      ul.append(li);
    }
    if (!ul.childElementCount) ul.append(el("li", "muted", "No links saved."));
    links.append(ul);
    const form = el("form", "link-form");
    const url = el("input");
    url.type = "url"; url.placeholder = "https://restaurant.example/menu"; url.required = true; url.setAttribute("aria-label", "Menu link");
    const label = el("input");
    label.type = "text"; label.placeholder = "Label (optional)"; label.maxLength = 60; label.setAttribute("aria-label", "Label");
    const add = el("button", "button small", "Use this link");
    add.type = "submit";
    form.append(url, label, add);
    form.addEventListener("submit", (e) => { e.preventDefault(); setLink(url.value, label.value); });
    links.append(el("p", "muted", "Fixing a link changes where the next re-read looks. It doesn't change the live menu."), form);
    parts.push(links);

    // Versions
    const vers = el("section", "card");
    vers.append(el("h3", null, "Saved versions"));
    const vl = el("ul", "plain-list");
    for (const v of d.versions || []) {
      const li = el("li");
      li.append(el("span", null, day(v.created_at) + " · " + num(v.item_count) + " dishes · " + (v.source === "scan" ? "scan" : "website")));
      if (v.hidden) li.append(document.createTextNode(" "), badge("hidden", "off"));
      if (v.reports) li.append(document.createTextNode(" "), badge(v.reports + " report" + (v.reports === 1 ? "" : "s"), "off"));
      li.append(document.createTextNode(" "), button("View", null, () => openMenu(lib.place, v.id)));
      li.append(document.createTextNode(" "), button(v.hidden ? "Restore…" : "Hide…", null, () => setHidden(v, !v.hidden)));
      vl.append(li);
    }
    vers.append(vl, el("p", "muted", "Testers get the newest visible version."));
    parts.push(vers);

    // Reports and last attempt
    if ((d.reports || []).length || d.last_attempt) {
      const more = el("section", "card");
      if ((d.reports || []).length) {
        more.append(el("h3", null, "Reports from testers"));
        const rl = el("ul", "plain-list");
        for (const r of d.reports) rl.append(el("li", null, day(r.created_at) + " · " + r.reason + (r.note ? ": “" + r.note + "”" : "")));
        more.append(rl);
      }
      if (d.last_attempt) {
        more.append(el("h3", null, "Last lookup"));
        more.append(el("p", "muted", when(d.last_attempt.attempted_at) + " · " + (d.last_attempt.outcome || "") +
          (d.last_attempt.detail ? " · " + d.last_attempt.detail : "")));
      }
      parts.push(more);
    }

    box.replaceChildren(...parts);
  }

  function rrSay(text, isError) {
    const s = $("rr-status");
    if (!s) return;
    s.className = "status" + (isError ? " err" : "");
    s.textContent = text || "";
  }

  /** Runs a library change; reloads the restaurant when it works. */
  async function libChange(routeName, body, okText) {
    rrSay("Saving…");
    try {
      const res = await callApi(routeName, body);
      if (res.status === 401) return route();
      if (res.status !== 200) {
        const m = res.body && res.body.error && res.body.error.message;
        rrSay(m || "That didn't work (" + res.status + ").", true);
        return false;
      }
      await openMenu(lib.place, lib.menuId);
      rrSay(okText || "Saved.");
      return true;
    } catch (e) {
      console.error(e);
      rrSay("Couldn't reach the server. Nothing changed.", true);
      return false;
    }
  }

  async function reread() {
    const d = lib.data || {};
    const ok = window.confirm("Read " + (d.name || "this menu") + " again?\n\n" +
      "This asks Claude to read the menu pages: about " + usd(d.reread_estimate_usd) + ", counted with background spending.\n" +
      "Nothing changes for testers until you save the result. It can take up to two minutes.");
    if (!ok) return;
    const buttons = $("lib-detail").querySelectorAll("button");
    for (const b of buttons) b.disabled = true;
    rrSay("Reading… this can take up to two minutes.");
    try {
      const res = await callApi("reread", { placeId: lib.place, confirm: true });
      if (res.status === 401) return route();
      if (res.status !== 200) {
        const m = res.body && res.body.error && res.body.error.message;
        for (const b of buttons) b.disabled = false;
        return rrSay(m || "The re-read didn't work (" + res.status + ").", true);
      }
      lib.preview = res.body;
      renderMenu();
      rrSay("Here's the new read. Save it to make it live.");
    } catch (e) {
      console.error(e);
      for (const b of buttons) b.disabled = false;
      rrSay("Lost touch with the server. If the read finished, it's waiting: open this menu again.", true);
    }
  }

  async function saveReread() {
    const p = lib.preview || {};
    const ok = window.confirm("Make this the live menu?\n\n" +
      num(p.newItems) + " dishes replace " + num(p.liveItems) + " for every tester, from their next refresh or add.\n" +
      "The current menu is kept: hide the new version to bring it back.");
    if (!ok) return;
    if (await libChange("save_reread", { placeId: lib.place, confirm: true }, "Saved. It's the live menu now.")) lib.preview = null;
  }

  function setLink(url, label) {
    if (!/^https?:\/\/\S+$/i.test(String(url).trim())) return rrSay("Enter a full web address starting with http:// or https://.", true);
    libChange("set_menu_link", { placeId: lib.place, url: String(url).trim(), label: String(label || "").trim() || null }, "Link saved. Re-read to use it.");
  }

  function removeLink(link) {
    if (!window.confirm("Stop using this link?\n\n" + link.url)) return;
    libChange("remove_menu_link", { sourceId: link.id }, "Link removed.");
  }

  function setHidden(version, hidden) {
    const visibleOthers = (lib.data.versions || []).filter((v) => !v.hidden && v.id !== version.id).length;
    const msg = hidden
      ? "Hide this version (" + num(version.item_count) + " dishes)?\n\n" +
        (visibleOthers ? "Testers will get the newest other visible version." : "It's the only visible version: testers will have no saved menu for this restaurant.")
      : "Restore this version (" + num(version.item_count) + " dishes)?\n\nIf it's the newest visible one, testers get it.";
    if (!window.confirm(msg)) return;
    libChange("set_menu_hidden", { menuId: version.id, hidden, confirm: true }, hidden ? "Hidden." : "Restored.");
  }

  // Works out what to show from the current sign-in and admin-api's answer.
  async function route() {
    show("loading");
    try {
      const { data } = await db.auth.getSession();
      if (!data.session) return show("step-email");

      const res = await callApi("whoami");
      const code = res.body && res.body.error && res.body.error.code;
      if (res.status === 200 && res.body.admin === true) {
        $("who").textContent = String(res.body.email || res.body.userId || "");
        show("panel");
        let tab = "overview";
        try { tab = sessionStorage.getItem("menuquest-admin-tab") === "menus" ? "menus" : "overview"; } catch (_) { /* fine */ }
        showTab(tab);
        await loadCosts();
        return await loadDashboard();
      }
      if (res.status === 401) {
        await db.auth.signOut({ scope: "local" });
        return show("step-email");
      }
      if (res.status === 403 && code === "mfa_required") return await secondStep();
      if (res.status === 403) return show("denied");
      return show("problem", "The admin server didn't answer (" + res.status + ").");
    } catch (e) {
      console.error(e);
      return show("problem", "Couldn't reach the server. Check your connection.");
    }
  }

  // The authenticator step: set it up the first time, ask for the code after that.
  async function secondStep() {
    const { data, error } = await db.auth.mfa.listFactors();
    if (error) throw error;
    const verified = (data.totp || []).find((f) => f.status === "verified");
    if (verified) {
      enrollingFactor = null;
      $("mfa-form").dataset.factor = verified.id;
      return show("step-mfa");
    }
    // Clear any half-finished setup from before, then start a new one.
    for (const f of data.all || []) {
      if (f.factor_type === "totp" && f.status !== "verified") await db.auth.mfa.unenroll({ factorId: f.id });
    }
    const enrolled = await db.auth.mfa.enroll({ factorType: "totp", friendlyName: "MenuQuest admin" });
    if (enrolled.error) throw enrolled.error;
    enrollingFactor = enrolled.data.id;
    $("enroll-qr").src = enrolled.data.totp.qr_code; // a data: URL made by Supabase Auth
    $("enroll-secret").textContent = enrolled.data.totp.secret;
    return show("step-enroll");
  }

  const digits = (s) => String(s || "").replace(/\D/g, "");

  $("email-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    email = form.email.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return say(form, "Enter a valid email address.", true);
    busy(form, true);
    say(form, "Sending…");
    const { error } = await db.auth.signInWithOtp({
      email,
      // Never makes a new account: only existing accounts can get a code.
      options: { shouldCreateUser: false, emailRedirectTo: location.origin + "/admin/" },
    });
    busy(form, false);
    say(form, "");
    // The same next step whether or not the address has an account, so this form can't be used
    // to check who has one. Only a rate limit is reported.
    if (error && (error.status === 429 || /rate limit/i.test(error.message || ""))) {
      return say(form, "Too many codes requested. Wait a minute and try again.", true);
    }
    $("code-form").reset();
    show("step-code");
  });

  $("code-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const token = digits(form.code.value);
    if (token.length < 6) return say(form, "Enter the code from the email.", true);
    busy(form, true);
    say(form, "Checking…");
    const { error } = await db.auth.verifyOtp({ email, token, type: "email" });
    busy(form, false);
    if (error) return say(form, "That code didn't work. Check it, or request a new one.", true);
    say(form, "");
    await route();
  });

  $("code-back").addEventListener("click", () => {
    $("email-form").reset();
    show("step-email");
  });

  $("enroll-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const code = digits(form.code.value);
    if (code.length !== 6 || !enrollingFactor) return say(form, "Enter the 6-digit code from the app.", true);
    busy(form, true);
    say(form, "Checking…");
    const { error } = await db.auth.mfa.challengeAndVerify({ factorId: enrollingFactor, code });
    busy(form, false);
    if (error) return say(form, "That code didn't work. Wait for the next one and try again.", true);
    form.reset();
    say(form, "");
    await route();
  });

  $("mfa-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const code = digits(form.code.value);
    if (code.length !== 6) return say(form, "Enter the 6-digit code from the app.", true);
    busy(form, true);
    say(form, "Checking…");
    const { error } = await db.auth.mfa.challengeAndVerify({ factorId: form.dataset.factor, code });
    busy(form, false);
    if (error) return say(form, "That code didn't work. Wait for the next one and try again.", true);
    form.reset();
    say(form, "");
    await route();
  });

  $("sign-out").addEventListener("click", async () => {
    await db.auth.signOut({ scope: "local" });
    show("step-email");
  });

  $("retry").addEventListener("click", () => route());
  for (const b of document.querySelectorAll(".tab")) b.addEventListener("click", () => showTab(b.dataset.tab));
  $("lib-search").addEventListener("submit", (e) => {
    e.preventDefault();
    lib.query = $("lib-query").value.trim().slice(0, 200);
    if (lib.query) lib.filter = "all";
    loadLibrary();
  });
  $("dash-refresh").addEventListener("click", async () => {
    await loadCosts();
    await loadDashboard();
  });

  // The email link signs in through the URL (route() waits for that); tidy it away once read.
  db.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" && location.hash.includes("access_token")) {
      history.replaceState(null, "", location.pathname);
    }
  });

  route();
})();
