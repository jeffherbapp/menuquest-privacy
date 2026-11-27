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
        ["pre-loaded from Overture", get(d, "restaurants.preloaded.overture")],
        ["of those, added since", get(d, "restaurants.preloaded.overture_attached")],
        ["chain menus", get(d, "restaurants.preloaded.chains")],
      ], [["Added by users", get(d, "restaurants.added")]],
        "\"Added\" counts restaurants a user added first; adding one already in the library doesn't count again. " +
        "Pre-loaded places (Overture pre-reads and chain menus) are counted apart: nobody sees them until someone adds the restaurant."),
      card("Menus", [["shared menus", get(d, "menus.shared_menus")], ["pre-loaded menus", get(d, "menus.preloaded_menus")]], [
        ["Website lookups", get(d, "menus.website_reads")],
        ["Photo scans", get(d, "menus.photo_scans")],
        ["New website menus", get(d, "menus.new_shared.website")],
        ["New scanned menus", get(d, "menus.new_shared.scan")],
        ["New pre-loaded menus", get(d, "menus.new_shared.preloaded")],
        ["New menu versions", get(d, "menus.new_versions")],
      ], "Lookups and scans are requests from the app, including ones answered from a saved menu. Menu versions are the background reader's. Pre-loaded menus are the Mac Studio's free reads of Overture places and chains."),
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

  const lib = { filter: "flagged", query: "", place: null, menuId: null, data: null, preview: null, review: null, reviewCount: 0 };

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

  // A13: a Google place someone added, an Overture pre-read ("ov:…") or a chain's menu file ("chain:…").
  function placeKind(id) {
    const s = String(id || "");
    return s.startsWith("ov:") ? "overture" : s.startsWith("chain:") ? "chain" : "google";
  }
  const KIND_BADGE = { overture: "Overture pre-read", chain: "Chain menu" };

  function libSay(text, isError) {
    $("lib-status").className = "status" + (isError ? " err" : "");
    $("lib-status").textContent = text || "";
  }

  function showTab(name) {
    for (const b of document.querySelectorAll(".tab")) b.setAttribute("aria-pressed", String(b.dataset.tab === name));
    $("tab-overview").hidden = name !== "overview";
    $("tab-menus").hidden = name !== "menus";
    $("tab-tests").hidden = name !== "tests";
    $("tab-background").hidden = name !== "background";
    if (name === "background" && !bg.loaded) loadBackground();
    $("tab-research").hidden = name !== "research";
    if (name === "research" && window.MQResearch) window.MQResearch.open();
    $("tab-trips").hidden = name !== "trips";
    $("tab-users").hidden = name !== "users";
    $("tab-feedback").hidden = name !== "feedback";
    if (name === "feedback" && !fb.loaded) loadFeedback(false);
    if (name === "users" && !users.loaded) { loadUsers(false); loadFeatures(); }
    if (name === "trips" && window.MQTrips) window.MQTrips.open();
    if (name === "tests" && !gate.loaded) loadGate();
    try { sessionStorage.setItem("menuquest-admin-tab", name); } catch (_) { /* fine */ }
    if (name === "menus" && !$("lib-items").childElementCount && !lib.place) loadLibrary();
  }

  async function loadLibrary() {
    libSay("Loading…");
    try {
      const [res, queue] = await Promise.all([
        callApi("library", { query: lib.query, filter: lib.filter === "review" ? "all" : lib.filter, limit: 100 }),
        callApi("review_queue"),
      ]);
      if (res.status === 401 || queue.status === 401) return route();
      if (res.status === 403 || queue.status === 403) return show("denied");
      if (res.status !== 200) return libSay("Couldn't load menus (" + res.status + ").", true);
      lib.reviewCount = queue.status === 200 ? Number(queue.body.count) || 0 : 0;
      renderLibrary(res.body, queue.status === 200 ? queue.body : null);
    } catch (e) {
      console.error(e);
      libSay("Couldn't reach the server.", true);
    }
  }

  function renderLibrary(d, queue) {
    const counts = Object.assign({}, d.counts || {}, { review: lib.reviewCount });
    const filters = [["review", "Review"], ["flagged", "Flagged"], ["short", "Short"], ["reported", "Reported"], ["hidden", "No menu"], ["preloaded", "Pre-loaded"], ["all", "All"]];
    $("lib-filters").replaceChildren(...filters.map(([key, label]) => {
      const b = button(label + " " + num(counts[key]), "chip" + (key === "review" && counts.review > 0 ? " attention" : ""), () => { lib.filter = key; loadLibrary(); });
      b.setAttribute("aria-pressed", String(lib.filter === key));
      return b;
    }));
    if (lib.filter === "review") return renderQueue(queue);
    const items = Array.isArray(d.items) ? d.items : [];
    lib.attached = {};
    for (const it of items) if (it.attached_to) lib.attached[it.place_id] = it.attached_to;
    libSay(items.length ? "" : "Nothing here." + (lib.query ? " Try another search." : ""));
    $("lib-items").replaceChildren(...items.map((it) => {
      const li = el("li");
      const row = el("button", "lib-row");
      row.type = "button";
      const top = el("span", "lib-name", it.name || it.place_id);
      const tags = el("span", "lib-tags");
      const kind = it.kind || placeKind(it.place_id);
      if (KIND_BADGE[kind]) tags.append(badge(KIND_BADGE[kind], "on"));
      if (it.attached_to) tags.append(badge("Added since", "on"));
      if (it.short) tags.append(badge("Short", "off"));
      if (it.reports > 0) tags.append(badge(it.reports + " report" + (it.reports === 1 ? "" : "s"), "off"));
      if (it.no_menu && !it.attached_to) tags.append(badge("No visible menu", "off"));
      const meta = el("span", "lib-meta", it.no_menu
        ? (it.attached_to ? "Its menu was copied to the restaurant someone added" : it.versions + " hidden version" + (it.versions === 1 ? "" : "s"))
        : num(it.item_count) + " dishes · " + (it.source === "scan" ? "photo scan" : "website") + " · " + day(it.saved_at) +
          (it.versions > 1 ? " · " + it.versions + " versions" : "") + " · " + num(it.links) + " link" + (it.links === 1 ? "" : "s"));
      row.append(top, tags, meta);
      row.addEventListener("click", () => openMenu(it.place_id, null));
      li.append(row);
      return li;
    }));
  }

  function renderQueue(queue) {
    const items = (queue && Array.isArray(queue.items)) ? queue.items : [];
    libSay(queue ? (items.length ? "Background re-reads that found far fewer dishes than the live menu. The live menu stays until you approve." : "Nothing waiting for review.") : "Couldn't load the review queue.", !queue);
    $("lib-items").replaceChildren(...items.map((it) => {
      const li = el("li");
      const row = el("button", "lib-row");
      row.type = "button";
      const tags = el("span", "lib-tags");
      tags.append(badge(num(it.new_count) + " vs " + num(it.live_count) + " dishes", "off"));
      row.append(el("span", "lib-name", it.name || it.place_id), tags,
        el("span", "lib-meta", "Re-read " + when(it.created_at) + (it.model ? " · " + it.model : "")));
      row.addEventListener("click", () => { lib.review = it; openMenu(it.place_id, it.menu_id || null); });
      li.append(row);
      return li;
    }));
  }

  function reviewCard() {
    const it = lib.review;
    const card = el("section", "card review-card");
    card.append(el("h3", null, "Waiting for your review"));
    card.append(el("p", null, "A background re-read found " + num(it.new_count) + " dishes; the live menu has " + num(it.live_count) +
      ". It was set aside because that's less than half. It's shown below."));
    const row = el("div", "button-row");
    row.append(
      button("Approve: make it live…", "button small", () => decide(true)),
      button("Reject: keep it hidden", "button small quiet", () => decide(false)),
    );
    if (lib.data && lib.data.shown && lib.data.shown.id !== it.menu_id) {
      card.append(el("p", "status err", "The re-read's menu wasn't found; it can only be rejected."));
    }
    card.append(row);
    const st = el("p", "status", "");
    st.id = "review-status";
    st.setAttribute("role", "status");
    card.append(st);
    return card;
  }

  async function decide(approve) {
    const it = lib.review;
    if (!it) return;
    const ok = approve
      ? window.confirm("Make this re-read the live menu?\n\n" + num(it.new_count) + " dishes replace " + num(it.live_count) +
          " for every tester, from their next refresh or add.\nThe current menu is kept: hide the new version to bring it back.")
      : window.confirm("Reject this re-read?\n\nIt stays hidden and the live menu (" + num(it.live_count) + " dishes) stays as it is.");
    if (!ok) return;
    const st = $("review-status");
    if (st) { st.className = "status"; st.textContent = "Saving…"; }
    try {
      const res = await callApi("review_decide", approve ? { versionId: it.version_id, approve: true, confirm: true } : { versionId: it.version_id, approve: false });
      if (res.status === 401) return route();
      if (res.status !== 200) {
        const m = res.body && res.body.error && res.body.error.message;
        if (st) { st.className = "status err"; st.textContent = m || "That didn't work (" + res.status + ")."; }
        return;
      }
      lib.review = null;
      lib.place = null;
      $("lib-detail").hidden = true;
      $("lib-list").hidden = false;
      await loadLibrary();
      libSay(approve ? "Approved: it's the live menu now." : "Rejected: it stays hidden.");
    } catch (e) {
      console.error(e);
      if (st) { st.className = "status err"; st.textContent = "Couldn't reach the server. Nothing changed."; }
    }
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
      lib.review = null;
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
    const kind = placeKind(d.place_id);
    const attached = lib.attached && lib.attached[d.place_id];
    if (kind === "overture") {
      const p = el("p", "muted", "Pre-loaded from Overture by the Mac Studio. Nobody sees this menu until someone adds the restaurant; then it's copied to their restaurant.");
      if (attached) p.append(document.createTextNode(" "), button("Open the restaurant it was copied to", "link-button", () => openMenu(attached, null)));
      head.append(p);
    } else if (kind === "chain") {
      head.append(el("p", "muted", "A chain's menu file. Each location someone adds gets its own copy; the copies are refreshed when the chain is read again (monthly)."));
    }
    parts.push(head);
    if (lib.review && lib.review.place_id === lib.place) parts.push(reviewCard());

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
      (placeKind(d.place_id) !== "google" ? "The Mac Studio reads pre-loaded menus for free in the background; this uses paid Claude instead.\n" : "") +
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
    const kind = placeKind(lib.place);
    const who = kind === "chain"
      ? " in the chain's menu file. Locations added from now on get it; ones already added keep their copy until the chain's next monthly read.\n"
      : kind === "overture" ? ". Nobody sees it until someone adds this restaurant.\n"
      : " for every tester, from their next refresh or add.\n";
    const ok = window.confirm("Make this the live menu?\n\n" +
      num(p.newItems) + " dishes replace " + num(p.liveItems) + who +
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


  // MARK: Quality-gate tests (A9a). Read-only.

  const gate = { runs: [], picked: [], places: [], place: null, data: null, onlyDiffs: false, showTags: false, hidden: new Set(), loaded: false };
  const METRICS = [
    ["recall", "recall", "Dishes found"], ["precision", "precision", "Dishes that are real"], ["priceExact", "price_exact", "Prices exact"],
    ["section", "section", "Right section"], ["dishType", "dish_type", "Dish type"], ["protein", "protein", "Protein"],
    ["spice", "spice", "Spice"], ["cuisine", "cuisine", "Cuisine"], ["methods", "methods", "Methods"],
    ["flavors", "flavors", "Flavors"], ["ingredients", "ingredients", "Ingredients"], ["validJson", "valid_json", "Valid answers"],
  ];

  /** A short letter per run: S for the Studio, H Haiku, L Flash-Lite, F Flash, else the model's first letter. */
  function runLabels(runs) {
    const labels = new Map();
    const used = new Map();
    for (const r of runs) {
      const m = String(r.model_name || "").toLowerCase();
      let l = r.executor === "mac" ? "S" : m.includes("haiku") ? "H" : m.includes("flash-lite") ? "L" : m.includes("flash") ? "F"
        : (m.replace(/[^a-z]/g, "")[0] || "?").toUpperCase();
      used.set(l, (used.get(l) || 0) + 1);
      labels.set(r.id, l);
    }
    for (const r of runs) if (used.get(labels.get(r.id)) > 1) labels.set(r.id, labels.get(r.id) + r.id);
    return labels;
  }
  const runById = (id) => gate.runs.find((r) => r.id === id);
  // Letters for the picked runs (S, H, L, F); runs not picked fall back to their letter among all runs.
  const label = (id) => {
    const picked = runLabels(gate.picked.map(runById).filter(Boolean));
    return picked.get(id) || (gate.labels && gate.labels.get(id)) || "#" + id;
  };
  const pct = (v) => (typeof v === "number" || (typeof v === "string" && v !== "")) && isFinite(Number(v)) ? (Number(v) * 100).toFixed(1) + "%" : "–";
  const sec = (v) => (v === null || v === undefined || v === "" ? "–" : Number(v).toFixed(1) + " s");

  function gateSay(text, isError) {
    $("gate-status").className = "status" + (isError ? " err" : "");
    $("gate-status").textContent = text || "";
  }

  async function loadGate() {
    gate.loaded = true;
    gateSay("Loading runs…");
    try {
      const res = await callApi("gate_runs");
      if (res.status === 401) return route();
      if (res.status === 403) return show("denied");
      if (res.status !== 200) return gateSay("Couldn't load the runs (" + res.status + ").", true);
      gate.runs = Array.isArray(res.body) ? res.body : [];
      gate.labels = runLabels(gate.runs);
      // Start with the newest run, the run whose menus it reused, and every run that reused them.
      const newest = gate.runs[0];
      if (newest) {
        const root = newest.source_run || newest.id;
        gate.picked = gate.runs.filter((r) => r.id === root || r.source_run === root).map((r) => r.id).sort((a, b) => a - b).slice(0, 8);
      }
      renderPicker();
      await loadPlaces();
    } catch (e) {
      console.error(e);
      gateSay("Couldn't reach the server.", true);
    }
  }

  function renderPicker() {
    $("gate-picked").textContent = gate.picked.length ? "· " + gate.picked.map((id) => label(id) + " #" + id).join(", ") : "";
    $("gate-runs").replaceChildren(...gate.runs.map((r) => {
      const row = el("label", "gate-run");
      const box = el("input");
      box.type = "checkbox";
      box.checked = gate.picked.includes(r.id);
      box.addEventListener("change", () => {
        gate.picked = box.checked ? [...gate.picked, r.id].sort((a, b) => a - b) : gate.picked.filter((x) => x !== r.id);
        renderPicker();
        if (gate.picked.length >= 2 && gate.picked.length <= 8) loadPlaces();
        else gateSay("Pick 2 to 8 runs.", true);
      });
      row.append(box,
        el("strong", null, label(r.id) + " #" + r.id),
        el("span", null, " " + (r.model_name || "?") + " · " + (r.executor === "mac" ? "Mac Studio" : "cloud") + " · " + (r.prompt_version || "") +
          (r.source_run ? " · menus of #" + r.source_run : "") + " · " + day(r.created_at)),
        document.createTextNode(" "), badge(r.passed ? "passed" : "didn't pass", r.passed ? "on" : "off"));
      return row;
    }));
  }

  async function loadPlaces() {
    renderSummary();
    gateSay("Loading restaurants…");
    try {
      const res = await callApi("gate_places", { runs: gate.picked });
      if (res.status === 401) return route();
      if (res.status !== 200) {
        const m = res.body && res.body.error && res.body.error.message;
        return gateSay(m || "Couldn't load restaurants (" + res.status + ").", true);
      }
      gate.places = Array.isArray(res.body) ? res.body : [];
      gateSay("");
      renderPlaces();
      const keep = gate.places.find((p) => p.place_id === gate.place) || gate.places[0];
      if (keep) await loadGateMenu(keep.place_id);
      else { $("gate-menu").replaceChildren(el("p", "muted", "No restaurants in these runs.")); $("gate-controls").hidden = true; }
    } catch (e) {
      console.error(e);
      gateSay("Couldn't reach the server.", true);
    }
  }

  function renderSummary() {
    const runs = gate.picked.map(runById).filter(Boolean);
    if (runs.length < 2) return $("gate-summary").replaceChildren();
    const t = el("table", "periods gate-summary");
    const head = el("tr");
    head.append(el("th", null, ""), el("th", "muted", "Pass mark"));
    for (const r of runs) {
      const th = el("th", null, label(r.id) + " #" + r.id);
      th.title = r.model_name || "";
      head.append(th);
    }
    const thead = el("thead");
    thead.append(head);
    const tbody = el("tbody");
    const marks = (runs[0] && runs[0].thresholds) || {};
    const row = (name, mark, cells) => {
      const tr = el("tr");
      tr.append(el("th", null, name), el("td", "muted", mark));
      for (const c of cells) tr.append(c);
      tbody.append(tr);
    };
    row("Model", "", runs.map((r) => el("td", "small-print", r.model_name || "–")));
    row("Passed", "", runs.map((r) => el("td", r.passed ? "good" : "bad", r.passed ? "yes" : "no")));
    for (const [camel, snake, name] of METRICS) {
      const mark = marks[camel];
      row(name, mark !== undefined ? "≥ " + pct(mark) : "", runs.map((r) => {
        const v = r.summary ? r.summary[snake] : undefined;
        const td = el("td", null, pct(v));
        const t2 = (r.thresholds || {})[camel];
        if (v !== undefined && v !== null && t2 !== undefined && Number(v) < Number(t2)) td.className = "bad";
        return td;
      }));
    }
    const s = (r, k) => (r.summary ? r.summary[k] : undefined);
    row("Menus done", "", runs.map((r) => el("td", null, num(s(r, "menus_done")))));
    row("Broken answers", "", runs.map((r) => el("td", Number(s(r, "broken")) > 0 ? "bad" : null, num(s(r, "broken")))));
    row("Seconds per menu", "", runs.map((r) => el("td", null, sec(s(r, "avg_seconds")))));
    row("Run cost", "", runs.map((r) => el("td", null, usd(s(r, "run_usd")))));
    row("Per 1,000 menus", "", runs.map((r) => el("td", null, usd(s(r, "usd_per_1000")))));
    row("…at the later price", "", runs.map((r) => el("td", "muted", s(r, "usd_per_1000_later_price") == null ? "–" : usd(s(r, "usd_per_1000_later_price")))));
    row("…batch estimate", "", runs.map((r) => el("td", "muted", s(r, "usd_per_1000_batch_est") == null ? "–" : usd(s(r, "usd_per_1000_batch_est")))));
    row("Claude per 1,000 (batch / standard)", "", runs.map((r) => el("td", "muted",
      s(r, "claude_usd_per_1000_batch") == null ? "–" : usd(s(r, "claude_usd_per_1000_batch")) + " / " + usd(s(r, "claude_usd_per_1000_standard")))));
    t.append(thead, tbody);
    $("gate-summary").replaceChildren(t);
  }

  function renderPlaces() {
    const sel = $("gate-place-select");
    sel.replaceChildren(...gate.places.map((p) => {
      const o = el("option", null, p.name + " (" + num(p.claude_dishes) + ")");
      o.value = p.place_id;
      return o;
    }));
    sel.value = gate.place || (gate.places[0] && gate.places[0].place_id) || "";
    $("gate-places").replaceChildren(...gate.places.map((p) => {
      const li = el("li");
      const b = el("button", "gate-place" + (p.place_id === gate.place ? " active" : ""));
      b.type = "button";
      b.append(el("span", "gate-place-name", p.name));
      const counts = el("span", "gate-place-counts");
      counts.append(el("span", "count claude", "C " + num(p.claude_dishes)));
      for (const id of gate.picked) {
        const r = p.runs && p.runs[String(id)];
        if (!r) continue;
        const txt = label(id) + " " + (r.status === "invalid" ? "✕" : num(r.dishes));
        counts.append(el("span", "count" + (r.status === "invalid" ? " bad" : "") + (r.left_out ? " faded" : ""), txt));
      }
      b.append(counts);
      b.addEventListener("click", () => loadGateMenu(p.place_id));
      li.append(b);
      return li;
    }));
  }

  async function loadGateMenu(place) {
    gate.place = place;
    for (const b of document.querySelectorAll(".gate-place")) b.classList.remove("active");
    renderPlaces();
    $("gate-menu").replaceChildren(el("p", "status", "Loading…"));
    try {
      const res = await callApi("gate_menu", { placeId: place, runs: gate.picked });
      if (res.status === 401) return route();
      if (res.status !== 200) {
        const m = res.body && res.body.error && res.body.error.message;
        return $("gate-menu").replaceChildren(el("p", "status err", m || "Couldn't load that menu (" + res.status + ")."));
      }
      gate.data = res.body;
      renderGateMenu();
    } catch (e) {
      console.error(e);
      $("gate-menu").replaceChildren(el("p", "status err", "Couldn't reach the server."));
    }
  }

  function renderControls() {
    const c = $("gate-controls");
    c.hidden = false;
    const toggle = (text, on, flip) => {
      const b = button(text, "chip", () => { flip(); renderGateMenu(); });
      b.setAttribute("aria-pressed", String(on));
      return b;
    };
    const chips = [
      toggle("Only differences", gate.onlyDiffs, () => { gate.onlyDiffs = !gate.onlyDiffs; }),
      toggle("Show tags", gate.showTags, () => { gate.showTags = !gate.showTags; }),
    ];
    for (const id of gate.picked) {
      chips.push(toggle(label(id) + " #" + id, !gate.hidden.has(id), () => {
        if (gate.hidden.has(id)) gate.hidden.delete(id); else gate.hidden.add(id);
      }));
    }
    const legend = el("p", "muted small-print gate-legend");
    legend.append(el("span", "swatch extra", ""), document.createTextNode(" not on Claude's menu  "),
      el("span", "swatch price", ""), document.createTextNode(" different price  "),
      el("span", "swatch addon", ""), document.createTextNode(" add-on (not scored)"));
    c.replaceChildren(el("div", "chips"), legend);
    c.firstChild.append(...chips);
  }

  function tagLine(tags) {
    if (!tags) return null;
    const bits = [];
    if (tags.dishType) bits.push(tags.dishType);
    if (tags.protein && tags.protein !== "none") bits.push(tags.protein);
    if (tags.spice && tags.spice !== "none") bits.push("spice: " + tags.spice);
    if (Array.isArray(tags.flavors) && tags.flavors.length) bits.push(tags.flavors.join(", "));
    if (Array.isArray(tags.ingredients) && tags.ingredients.length) bits.push(tags.ingredients.join(", "));
    return bits.length ? el("p", "dish-tags", bits.join(" · ")) : null;
  }

  function dishNode(item, isClaude) {
    const li = el("li", "dish" + (item.mark ? " " + item.mark : "") + (item.missedBy && item.missedBy.length ? " missed" : ""));
    const top = el("div", "dish-top");
    top.append(el("span", "dish-name", item.name || "(no name)"), el("span", "dish-price", item.price || ""));
    li.append(top);
    if (item.mark === "price") li.append(el("p", "dish-note", "Claude: " + (item.claudePrice || "no price")));
    if (isClaude && item.missedBy && item.missedBy.length) {
      li.append(el("p", "dish-note", "missed by " + item.missedBy.filter((id) => !gate.hidden.has(id)).map(label).join("/")));
    }
    if (item.description) li.append(el("p", "dish-desc", item.description));
    if (gate.showTags) { const t = tagLine(item.tags); if (t) li.append(t); }
    return li;
  }

  const interesting = (item, isClaude) => isClaude
    ? !!(item.missedBy && item.missedBy.some((id) => !gate.hidden.has(id)))
    : item.mark === "extra" || item.mark === "price";

  function menuColumn(title, sub, notes, menu, isClaude) {
    const col = el("section", "gate-col" + (isClaude ? " claude" : ""));
    col.append(el("h3", null, title));
    if (sub) col.append(el("p", "muted small-print", sub));
    for (const n of notes) col.append(el("p", "gate-note", n));
    if (!menu) return col;
    let shown = 0;
    for (const s of menu.sections || []) {
      const items = (s.items || []).filter((i) => !gate.onlyDiffs || interesting(i, isClaude));
      if (!items.length) continue;
      col.append(el("h4", null, s.name || "Menu"));
      const ul = el("ul", "dishes");
      for (const i of items) ul.append(dishNode(i, isClaude));
      col.append(ul);
      shown += items.length;
    }
    if (gate.onlyDiffs && !shown) col.append(el("p", "muted", "No differences."));
    if ((menu.deferredLists || []).length && !gate.onlyDiffs) {
      col.append(el("h4", null, "Drink lists"));
      const ul = el("ul", "dishes");
      for (const d of menu.deferredLists) {
        const li = el("li", "dish deferred");
        li.append(el("span", "dish-name", d.name + (d.approxItems ? " (about " + d.approxItems + ")" : "")), el("span", "dish-note", "tap to add"));
        ul.append(li);
      }
      col.append(ul);
    }
    return col;
  }

  function renderGateMenu() {
    const d = gate.data;
    if (!d) return;
    renderControls();
    const head = el("div", "gate-head");
    head.append(el("h2", null, d.name || d.place_id));
    const cols = el("div", "gate-cols");
    const many = (d.references || []).length > 1;
    (d.references || []).forEach((ref, i) => {
      const runs = ref.runs.filter((id) => !gate.hidden.has(id));
      if (!runs.length && many) return;
      cols.append(menuColumn("Claude" + (many ? " (for " + ref.runs.map((id) => label(id) + " #" + id).join(", ") + ")" : ""),
        num(ref.dishes) + " dishes as scored", ref.menu ? [] : ["Claude couldn't read this menu (" + (ref.status || "no read") + ")."], ref.menu, true));
    });
    for (const r of d.reads || []) {
      if (gate.hidden.has(r.run_id)) continue;
      const run = runById(r.run_id) || {};
      const notes = [];
      if (r.status === "invalid" || (!r.menu && r.invalid)) notes.push("Broken answer: " + (r.invalid || "not valid"));
      else if (!r.menu) notes.push("No read (" + r.status + ").");
      if (r.left_out) notes.push("Left out of the score: Claude's read looked cut short.");
      if (r.earlier_rules) notes.push("Scored with earlier rules; these marks use today's.");
      if (r.unmarked) notes.push("No marks: " + r.unmarked);
      if (many) notes.push("Compared with Claude's read for " + (d.references[r.reference].runs.map((id) => label(id) + " #" + id).join(", ")) + ".");
      cols.append(menuColumn(label(r.run_id) + " #" + r.run_id + " · " + (run.model_name || ""),
        num(r.dishes) + " dishes · " + sec(r.seconds) + (r.cost_usd != null ? " · " + usd(r.cost_usd) : ""), notes, r.menu, false));
    }
    $("gate-menu").replaceChildren(head, cols);
  }


  // MARK: Background (A8a): seeding and the Studio's free work, caps, seed areas, queue.

  const bg = { data: null, loaded: false, seed: null, studio: null, checks: null };

  function bgSay(text, isError) {
    $("bg-status").className = "status" + (isError ? " err" : "");
    $("bg-status").textContent = text || "";
  }

  async function loadBackground() {
    bg.loaded = true;
    bgSay("Loading…");
    try {
      const [res, studio, checks, reads, chains, loading] = await Promise.all([callApi("background"), callApi("studio"), callApi("checks"), callApi("studio_reads"), callApi("chains"), callApi("area_loading")]);
      if (res.status === 401 || studio.status === 401) return route();
      if (res.status === 403 || studio.status === 403) return show("denied");
      if (res.status !== 200) return bgSay("Couldn't load background work (" + res.status + ").", true);
      bg.data = res.body;
      bg.studio = studio.status === 200 ? studio.body : null;
      bg.studioReads = reads.status === 200 ? reads.body : null;
      bg.chains = chains.status === 200 ? chains.body : null;
      bg.checks = checks.status === 200 ? checks.body : null;
      bg.loading = loading.status === 200 ? loading.body : null;
      bgSay("");
      renderBackground();
    } catch (e) {
      console.error(e);
      bgSay("Couldn't reach the server.", true);
    }
  }

  /** Sends a change, shows a refusal plainly, reloads. */
  async function bgChange(routeName, body, okText) {
    bgSay("Saving…");
    try {
      const res = await callApi(routeName, body);
      if (res.status === 401) return route();
      if (res.status !== 200) {
        const m = res.body && res.body.error && res.body.error.message;
        return bgSay(m || "That didn't work (" + res.status + ").", true);
      }
      await loadBackground();
      bgSay(okText || "Saved.");
    } catch (e) {
      console.error(e);
      bgSay("Couldn't reach the server. Nothing changed.", true);
    }
  }

  // G0: the one-off Google quality probe. Counts only; the answer lives in this page until it's
  // reloaded, and the server keeps nothing from Google either.
  let probeResult = null;

  function googleProbeCard() {
    const c = el("section", "card costs-card");
    c.append(el("h2", null, "Google quality probe (G0)"));
    c.append(el("p", "muted", "Looks up 20 restaurants that have an MQ menu (up to 10 in Glen Ellyn and Lombard, the rest " +
      "from the curated cities) with Google Place Details: rating, review count and review summary. It shows only counts: " +
      "how many pass 4.3 stars and 200 reviews, and how often the summary names a dish on our menu. Nothing from Google is " +
      "saved. 20 calls fit in Google's free 1,000 a month, so the real cost is $0 (the spending log counts about $0.40 " +
      "at list price against the caps). It runs once; a second run within 7 days asks again."));
    const run = el("button", "button small", "Run probe (20 Google calls)…");
    run.type = "button";
    run.addEventListener("click", () => runGoogleProbe(false));
    c.append(run);
    if (probeResult) c.append(probeTable(probeResult));
    return c;
  }

  async function runGoogleProbe(again) {
    const ok = window.confirm((again ? "Run the probe again?" : "Run the Google probe?") + "\n\n" +
      "20 Google Place Details calls (rating, review count, review summary). $0 within Google's free tier. " +
      "Only counts are shown; nothing is saved.");
    if (!ok) return;
    bgSay("Asking Google about 20 restaurants…");
    try {
      const res = await callApi("google_probe", again ? { confirm: true, again: true } : { confirm: true });
      if (res.status === 401) return route();
      const err = res.body && res.body.error;
      if (res.status === 409 && err && err.code === "already_ran") {
        bgSay("");
        return runGoogleProbe(true);
      }
      if (res.status !== 200) return bgSay((err && err.message) || "That didn't work (" + res.status + ").", true);
      probeResult = res.body;
      renderBackground();
      bgSay("Probe done: " + num(probeResult.counts && probeResult.counts.answered) + " of " +
        num(probeResult.counts && probeResult.counts.asked) + " answered.");
    } catch (e) {
      console.error(e);
      bgSay("Couldn't reach the server. Nothing was run.", true);
    }
  }

  function probeTable(r) {
    const k = r.counts || {};
    const wrap = el("div");
    const rows = [
      ["Restaurants asked", k.asked],
      ["… in Glen Ellyn / Lombard", k.localAsked],
      ["… in curated cities", k.citiesAsked],
      ["Groups (towns and cities)", k.groups],
      ["Google answered", k.answered],
      ["No answer", k.noAnswer],
      ["Pass 4.3★ and 200 reviews", k.passBar],
      ["… local", k.passBarLocal],
      ["… cities", k.passBarCities],
      ["Have a review summary", k.withSummary],
      ["Summary names a dish on our menu", k.summaryNamesDish],
      ["… a two-word-or-longer dish", k.summaryNamesSpecificDish],
      ["Dish names found in all summaries", k.dishMentions],
    ];
    const t = el("table", "periods money");
    const tb = el("tbody");
    for (const [label, v] of rows) {
      const tr = el("tr");
      tr.append(el("th", null, label), el("td", null, num(v)));
      tb.append(tr);
    }
    t.append(tb);
    wrap.append(el("h3", null, "Results"), t);
    for (const [title, obj] of [["Stars", k.stars], ["Review counts", k.reviews]]) {
      wrap.append(el("h3", null, title));
      const ul = el("ul", "plain-list");
      for (const [label, v] of Object.entries(obj || {})) ul.append(el("li", null, label + ": " + num(v)));
      wrap.append(ul);
    }
    wrap.append(el("p", "muted", "Field mask: " + (r.fieldMask || "–") + " · " + num(r.googleCalls) + " calls · logged at about $" +
      (typeof r.ledgerEstimateUsd === "number" ? r.ledgerEstimateUsd.toFixed(2) : "–") + " list price. " + (r.note || "")));
    return wrap;
  }

  /** F4: an area's free loading (Overture import, then the Studio's pre-reads), with its buttons. */
  function freeLoadingCell(area) {
    const td = el("td", "free-loading");
    const f = (bg.loading || []).find((x) => x.id === area.id);
    if (!f) { td.textContent = "–"; return td; }
    const im = f.import || {};
    const importing = im.requested_at && !im.finished_at;
    const lines = [];
    if (importing) lines.push(im.started_at ? "Importing on the Studio…" : "Import waiting for the Studio");
    else if (im.error) lines.push("Import failed: " + im.error);
    if (f.imported > 0) {
      lines.push(num(f.imported) + " imported" + (im.finished_at ? " (" + day(im.finished_at) + ")" : "") +
        (f.chains ? ", " + num(f.chains) + " chain locations" : "") +
        (f.never_menus ? ", " + num(f.never_menus) + " without a menu site" : ""));
      if (f.queued > 0) {
        lines.push(num(f.read) + " of " + num(f.queued) + " menus read" +
          (f.waiting ? ", " + num(f.waiting) + " waiting" : "") + (f.failed ? ", " + num(f.failed) + " couldn't be read" : ""));
      }
      lines.push(num(f.left) + " left to pre-read");
    } else if (!importing && !im.error) {
      lines.push(im.finished_at ? "Imported: none found" : "Not imported yet");
    }
    for (const l of lines) td.append(el("div", null, l));
    const actions = el("div");
    if (!importing) {
      actions.append(button(f.imported > 0 ? "Import again" : "Import places", null, () =>
        bgChange("import_area", { areaId: area.id }, "Import asked for. The Studio takes it on its next check.")));
    }
    if (f.left > 0) {
      if (!importing) actions.append(document.createTextNode(" · "));
      actions.append(button("Pre-read…", null, () => {
        const v = window.prompt("How many places in " + area.label + " to pre-read? (" + num(f.left) + " left, most likely first)",
          String(Math.min(f.left, 50)));
        if (v === null) return;
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 1000) return bgSay("Enter a whole number from 1 to 1,000.", true);
        bgChange("preread_area", { areaId: area.id, limit: n }, "Queued for the Studio. Menus come in as it reads them.");
      }));
    }
    if (f.failed > 0) {
      actions.append(document.createTextNode(" · "));
      actions.append(button("To research", null, () => { showTab("research"); if (window.MQResearch) window.MQResearch.open(area.id); }));
    }
    td.append(actions);
    return td;
  }

  function renderBackground() {
    const d = bg.data || {};
    const sw = d.switches || {};
    const caps = d.caps || {};
    const parts = [];

    // Switches
    const s = el("section", "card costs-card");
    s.append(el("h2", null, "Switches"));
    const bgLine = el("p", "muted", "Background work is " + (sw.background_on ? "on" : "off") +
      (sw.paid_paused ? " and all paid lookups are paused" : "") + ". Change those on Overview.");
    s.append(bgLine);
    const seedingOn = sw.seeding_on === true;
    s.append(switchRow(
      "Seeding",
      "Google searches for new places in your seed areas ($0.032 a search), and a Google website lookup when one isn't known. " +
        "Needs background work on too" + (seedingOn && !sw.background_on ? ": it's off, so seeding is waiting." : "."),
      seedingOn, "On", "Off", seedingOn ? "Turn off" : "Turn on…",
      () => seedingOn ? bgChange("set_seeding", { on: false }, "Seeding is off.") : turnOnSeeding(),
    ));
    const freeOn = sw.studio_free_on === true;
    s.append(switchRow(
      "Free work on the Macs",
      "The Macs find menu links, read menus and import places, with no paid calls, even with everything else off. " +
        ((d.studio || []).length ? (d.studio || []).map((m) => m.name + (m.enabled ? "" : " (off)")).join(" and ") : "No Mac registered.") +
        " · " + num(d.waiting_free) + " free job" + (d.waiting_free === 1 ? "" : "s") + " waiting.",
      freeOn, "On", "Off", freeOn ? "Turn off" : "Turn on",
      () => bgChange("set_studio_free", { on: !freeOn }, freeOn ? "Free work on the Macs is off." : "Free work on the Macs is on."),
    ));
    parts.push(s);

    // A9b: the Macs
    if (bg.studio) parts.push(studioCard(bg.studio));
    // A10: nightly checks
    if (bg.checks) parts.push(checksCard(bg.checks));

    // Caps
    const c = el("section", "card costs-card");
    c.append(el("h2", null, "Spending caps"));
    c.append(el("p", "muted", "Background work, seeding and quality tests stop at these (UTC days and months). Testers' own adds don't count. " +
      "So far: " + usd(caps.today_usd) + " today, " + usd(caps.month_usd) + " this month."));
    const form = el("form", "caps-form");
    const field = (labelText, value) => {
      const wrap = el("label", "cap-field");
      const input = el("input");
      input.type = "number"; input.min = "0"; input.step = "0.5"; input.value = String(Number(value) || 0); input.inputMode = "decimal";
      wrap.append(el("span", null, labelText), input);
      return { wrap, input };
    };
    const daily = field("Per day ($)", caps.daily_usd);
    const monthly = field("Per month ($)", caps.monthly_usd);
    const save = el("button", "button small", "Save caps");
    save.type = "submit";
    form.append(daily.wrap, monthly.wrap, save);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const dv = Number(daily.input.value);
      const mv = Number(monthly.input.value);
      if (!isFinite(dv) || !isFinite(mv) || dv < 0 || mv < 0) return bgSay("Enter amounts of $0 or more.", true);
      const raising = dv > Number(caps.daily_usd) || mv > Number(caps.monthly_usd);
      if (raising && !window.confirm("Raise the caps?\n\nBackground work, seeding and quality tests could then spend up to " +
        usd(dv) + " a day and " + usd(mv) + " a month (now " + usd(caps.daily_usd) + " and " + usd(caps.monthly_usd) + ").")) return;
      bgChange("set_caps", raising ? { daily: dv, monthly: mv, confirm: true } : { daily: dv, monthly: mv }, "Caps saved.");
    });
    c.append(form);
    parts.push(c);

    // Seeding
    const sd = el("section", "card costs-card");
    const seeding = d.seeding || {};
    sd.append(el("h2", null, "Seed areas"));
    const totals = el("p", "muted", num(seeding.seeded_total) + " of " + num(seeding.target_total) + " places seeded overall. ");
    totals.append(button("Change the overall target", null, () => {
      const v = window.prompt("Most places to seed overall:", String(seeding.target_total || 0));
      if (v === null) return;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) return bgSay("Enter a whole number.", true);
      bgChange("set_seed_total", { total: n }, "Overall target saved.");
    }));
    sd.append(totals);
    const t = el("table", "periods money");
    const head = el("tr");
    for (const h of ["Area", "Target", "Seeded", "With links", "Last run", "Free loading", ""]) head.append(el("th", null, h));
    const thead = el("thead");
    thead.append(head);
    const tbody = el("tbody");
    for (const a of seeding.areas || []) {
      const tr = el("tr", a.active ? null : "faded-row");
      tr.append(el("th", null, a.label + (a.active ? "" : " (off)")), el("td", null, num(a.target)), el("td", null, num(a.seeded)),
        el("td", null, num(a.with_links)), el("td", null, a.last_run_at ? day(a.last_run_at) : "–"),
        freeLoadingCell(a));
      const actions = el("td");
      actions.append(
        button("Target", null, () => {
          const v = window.prompt("Places to seed in " + a.label + ":", String(a.target));
          if (v === null) return;
          const n = Number(v);
          if (!Number.isInteger(n) || n < 1) return bgSay("Enter a whole number of 1 or more.", true);
          bgChange("save_seed_area", { id: a.id, label: a.label, target: n, active: a.active }, "Area saved.");
        }),
        document.createTextNode(" · "),
        button("Seed…", null, () => seedEstimate(a.id)),
        document.createTextNode(" · "),
        button(a.active ? "Turn off" : "Turn on", null, () =>
          bgChange("save_seed_area", { id: a.id, label: a.label, target: a.target, active: !a.active }, a.active ? "Area off." : "Area on.")),
      );
      tr.append(actions);
      tbody.append(tr);
    }
    t.append(thead, tbody);
    const scroller = el("div", "table-scroll");
    scroller.append(t);
    sd.append(scroller);
    if (!bg.loading) sd.append(el("p", "muted", "Couldn't load the free loading counts."));
    const add = el("form", "link-form");
    const label = el("input");
    label.type = "text"; label.placeholder = "Area, e.g. Wheaton, IL"; label.maxLength = 120; label.required = true; label.setAttribute("aria-label", "Area");
    const target = el("input");
    target.type = "number"; target.min = "1"; target.value = "40"; target.setAttribute("aria-label", "Target places");
    const addBtn = el("button", "button small", "Add area");
    addBtn.type = "submit";
    add.append(label, target, addBtn);
    add.addEventListener("submit", (e) => {
      e.preventDefault();
      const n = Number(target.value);
      if (label.value.trim().length < 2) return bgSay("Name the area, for example \"Wheaton, IL\".", true);
      if (!Number.isInteger(n) || n < 1) return bgSay("The target must be a whole number of 1 or more.", true);
      bgChange("save_seed_area", { label: label.value.trim(), target: n, active: true }, "Area added.");
    });
    sd.append(el("p", "muted", "Adding an area spends nothing. Free loading: \"Import places\" has the Studio take the town's " +
      "restaurants from Overture's free map data, then \"Pre-read…\" has it read their menus in advance. Both are free: " +
      "no Google, no Claude. Chain locations share their chain's menu and are skipped. \"Seed…\" is the paid Google way " +
      "and shows what a run could cost before anything is spent."), add);
    if (bg.seed) sd.append(seedCard());
    parts.push(sd);
    if (bg.chains) parts.push(chainsCard(bg.chains));
    parts.push(googleProbeCard());

    // Queue
    const q = el("section", "card costs-card");
    q.append(el("h2", null, "Queue"));
    const qt = el("table", "periods money");
    const qh = el("tr");
    for (const h of ["Reason", "Kind", "Where", "Status", "Jobs"]) qh.append(el("th", null, h));
    const qthead = el("thead");
    qthead.append(qh);
    const qbody = el("tbody");
    for (const r of d.queue || []) {
      const tr = el("tr");
      tr.append(el("th", null, r.reason), el("td", null, r.kind), el("td", null, r.executor === "mac" ? "Studio" : "cloud"),
        el("td", (r.status === "failed" || r.status === "dead") ? "bad" : null, r.status), el("td", null, num(r.count)));
      qbody.append(tr);
    }
    if (!qbody.childElementCount) {
      const tr = el("tr");
      tr.append(el("td", "muted", "No jobs."));
      qbody.append(tr);
    }
    qt.append(qthead, qbody);
    const qs = el("div", "table-scroll");
    qs.append(qt);
    q.append(qs);
    const fails = d.failures || [];
    q.append(el("h3", null, "Recent problems"));
    if (!fails.length) q.append(el("p", "muted", "None."));
    else {
      const ul = el("ul", "plain-list");
      for (const f of fails) {
        ul.append(el("li", null, when(f.at) + " · " + f.reason + " " + f.kind + " · " + f.status + " after " + f.attempts +
          " tr" + (f.attempts === 1 ? "y" : "ies") + (f.error ? " · " + f.error : "")));
      }
      q.append(ul);
    }
    parts.push(q);

    $("bg-body").replaceChildren(...parts);
  }

  // A10: the Nightly checks card.
  function checksCard(c) {
    const card = el("section", "card costs-card");
    card.append(el("h2", null, "Nightly checks"));
    const sw = c.switches || {};
    const on = sw.checks_free_on === true;
    card.append(switchRow(
      "Nightly checks (free)",
      "Each night at 3 am Central (09:00 UTC), saved menu links that are due are fetched and compared with the last copy: no Claude, no Google. " +
        "If a menu changed, its re-read (Claude) still waits for background work" + (sw.background_on ? " (on)." : ", which is off."),
      on || sw.background_on, on ? "On" : "On with background", "Off", on ? "Turn off" : "Turn on",
      () => bgChange("set_checks_free", { on: !on }, on ? "Free nightly checks are off." : "Free nightly checks are on."),
    ));
    const links = c.links || {};
    card.append(el("p", "muted", num(links.active) + " saved links · " + num(links.due) + " due now · " + num(links.changed) + " changed · " +
      num(links.failing) + " failing · last checked " + (links.last_checked_at ? when(links.last_checked_at) : "never") +
      " · next run " + (c.schedule && c.schedule.next_run ? when(c.schedule.next_run) : "–")));
    const row = el("div", "button-row");
    const can = on || sw.background_on;
    const now = button("Check now", "button small" + (can ? "" : " quiet"), () => {
      if (!can) return bgSay("Turn on free nightly checks first.", true);
      bgChange("queue_checks", {}, "Checks queued: they run within a few minutes.");
    });
    row.append(now);
    card.append(row);

    const r = c.recent || {};
    const t = el("table", "periods");
    const head = el("tr");
    for (const h of ["", "Runs", "Failed", "Links checked", "Changed"]) head.append(el("th", null, h));
    const thead = el("thead");
    thead.append(head);
    const tbody = el("tbody");
    for (const [label, d] of [["24 hours", r.d1], ["7 days", r.d7]]) {
      const tr = el("tr");
      tr.append(el("th", null, label), el("td", null, num(d && d.done)), el("td", d && d.failed > 0 ? "bad" : null, num(d && d.failed)),
        el("td", null, num(d && d.links_checked)), el("td", null, num(d && d.links_changed)));
      tbody.append(tr);
    }
    t.append(thead, tbody);
    card.append(t);
    const rr = c.rereads || {};
    const rrLine = el("p", "muted", num(r.waiting) + " checks waiting · " + num(rr.waiting) + " re-reads waiting (paid; need background work) · " +
      num(rr.done_d7) + " re-read this week · " + num(rr.for_review) + " set aside for review ");
    if (rr.for_review > 0) {
      rrLine.append(button("Review them", null, () => { lib.filter = "review"; showTab("menus"); loadLibrary(); }));
    }
    card.append(rrLine);

    card.append(el("h3", null, "Recent changes"));
    const changes = c.changes || [];
    if (!changes.length) card.append(el("p", "muted", "None yet."));
    else {
      const ul = el("ul", "plain-list");
      for (const ch of changes) {
        const li = el("li");
        li.append(el("strong", null, ch.name || ch.place_id), document.createTextNode(" · " + when(ch.changed_at) + " · "), outLink(ch.url, ch.url));
        ul.append(li);
      }
      card.append(ul);
    }
    return card;
  }

  // A9b: the Macs card (the Studio, and the MacBook overnight). Each Mac has its own on/off and
  // quiet hours.
  const ZONES = ["America/Chicago", "America/New_York", "America/Denver", "America/Los_Angeles", "America/Phoenix", "UTC"];

  /** One Mac: its state, its own on/off, and its own quiet hours (tucked away until changed). */
  function macBox(w) {
    const box = el("div", "mac-box");
    const head = el("div", "mac-head");
    const title = el("div", "switch-head");
    const quietNow = w.quiet && w.quiet.now;
    title.append(el("strong", null, w.name),
      badge(!w.enabled ? "Off" : quietNow ? "Quiet hours" : w.online ? "Online" : "Offline", w.enabled && w.online && !quietNow ? "on" : "off"));
    head.append(title, button(w.enabled ? "Turn off this Mac" : "Turn on this Mac", "button small" + (w.enabled ? " quiet" : ""), () =>
      bgChange("set_studio_enabled", { workerId: w.id, enabled: !w.enabled },
        w.enabled ? w.name + " is off: it takes no work." : w.name + " is on.")));
    box.append(head);
    box.append(el("p", "muted mac-meta", (w.model || "?") + " · runtime " + (w.runtime || "?") +
      " · last seen " + (w.last_seen_at ? when(w.last_seen_at) : "never") + " · may do: " + (w.kinds || []).join(", ")));
    if ((w.running || []).length) {
      box.append(el("p", null, "Working on: " + w.running.map((j) => j.reason + " " + j.kind + " since " + when(j.since)).join("; ")));
    }

    // Quiet hours: one line; the form opens on "Change".
    const q = w.quiet || {};
    const quiet = el("details", "mac-quiet");
    const summary = el("summary");
    summary.append(el("span", null, "Quiet hours: " + (q.start
      ? "every day " + q.start + "–" + q.end + " (" + q.tz.replace("America/", "").replace("_", " ") + "). No new work then; a job it has finishes."
      : "none, takes work any time.")), el("span", "mac-change", q.start ? "Change" : "Set"));
    quiet.append(summary);
    const form = el("form", "caps-form");
    const time = (labelText, value) => {
      const wrap = el("label", "cap-field");
      const input = el("input");
      input.type = "time"; input.value = value || ""; input.step = "300";
      wrap.append(el("span", null, labelText), input);
      return { wrap, input };
    };
    const start = time("From", q.start);
    const end = time("To", q.end);
    const zoneWrap = el("label", "cap-field");
    const zone = el("select");
    const zones = ZONES.includes(q.tz) || !q.tz ? ZONES : [q.tz, ...ZONES];
    for (const z of zones) {
      const o = el("option", null, z.replace("America/", "").replace("_", " "));
      o.value = z;
      zone.append(o);
    }
    zone.value = q.tz || "America/Chicago";
    zoneWrap.append(el("span", null, "Time zone"), zone);
    const save = el("button", "button small", "Save");
    save.type = "submit";
    form.append(start.wrap, end.wrap, zoneWrap, save);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const a = start.input.value.slice(0, 5);
      const b = end.input.value.slice(0, 5);
      if (!a || !b) return bgSay("Pick both a start and an end, or use \"No quiet hours\".", true);
      if (a === b) return bgSay("The start and end need to be different.", true);
      bgChange("set_quiet_hours", { workerId: w.id, start: a, end: b, tz: zone.value }, "Quiet hours saved for " + w.name + ".");
    });
    quiet.append(form);
    if (q.start) {
      quiet.append(button("No quiet hours", null, () =>
        bgChange("set_quiet_hours", { workerId: w.id, start: null, end: null, tz: q.tz || "America/Chicago" }, "Quiet hours removed for " + w.name + ".")));
    }
    box.append(quiet);
    return box;
  }

  function studioCard(st) {
    const card = el("section", "card costs-card");
    card.append(el("h2", null, "Macs"));
    const workers = (st.workers || []).slice().sort((x, y) =>
      (x.device === "studio" ? 0 : 1) - (y.device === "studio" ? 0 : 1) || String(x.name).localeCompare(String(y.name)));
    if (!workers.length) {
      card.append(el("p", "muted", "No Mac is registered."));
      return card;
    }
    for (const w of workers) card.append(macBox(w));

    // Recent work
    const r = st.recent || {};
    card.append(el("h3", null, "Recent work (both Macs)"));
    const t = el("table", "periods");
    const head = el("tr");
    for (const h of ["", "Done", "Failed", "Avg time"]) head.append(el("th", null, h));
    const thead = el("thead");
    thead.append(head);
    const tbody = el("tbody");
    for (const [label, d] of [["24 hours", r.d1], ["7 days", r.d7]]) {
      const tr = el("tr");
      tr.append(el("th", null, label), el("td", null, num(d && d.done)), el("td", d && d.failed > 0 ? "bad" : null, num(d && d.failed)),
        el("td", null, d && d.avg_seconds != null ? Math.round(Number(d.avg_seconds)) + " s" : "–"));
      tbody.append(tr);
    }
    t.append(thead, tbody);
    card.append(t, el("p", "muted", num(r.waiting) + " waiting · last finished " + (r.last_finished_at ? when(r.last_finished_at) : "never") +
      ". Average time is what the Macs report per job (quality-test reads take longest)."));
    if (bg.studioReads) studioReadsPart(card, bg.studioReads);
    return card;
  }

  // R5: menu reading on the Studio (MiQ), for background menus only (never one someone waits for).
  function studioReadsPart(card, sr) {
    card.append(el("h3", null, "Menu reading (MiQ)"));
    const head = el("div", "switch-head");
    const a = sr.approved;
    head.append(el("strong", null, sr.reading ? "Reading background menus" : "Not reading menus"), badge(sr.reading ? "On" : "Off", sr.reading ? "on" : "off"));
    card.append(head);
    const score = (x) => x ? "dishes found " + x.recall + " · extra dishes " + x.precision + " · prices " + x.prices : "";
    card.append(el("p", "muted", a
      ? "Approved: test run " + a.run + " (" + a.version + "), " + score(a) + ". The Studio reads nightly re-reads (and pre-loaded places later) for free. Its allergens are left out; Claude checks them when someone opens the menu."
      : "No MiQ test run is approved, so the Studio only finds menu links and does test reads."));
    const row = el("div", "button-row");
    if (sr.reading) {
      row.append(button("Stop menu reading", "button small quiet", () =>
        bgChange("stop_studio_reads", {}, "Stopped: the Studio reads no more menus for real. Menus it already saved stay.")));
    }
    for (const run of sr.approvable || []) {
      row.append(button("Approve test run " + run.run + " (" + run.version + ")", "button small", () => {
        const ok = window.confirm("Approve test run " + run.run + " (" + run.version + ")?\n\n" + score(run) +
          "\n\nThe Studio will read background menus with it and put them in the library for everyone. Allergens are still checked by Claude when someone opens a menu. You can stop it any time.");
        if (ok) bgChange("approve_studio_reads", { run: run.run, confirm: true }, "Approved: the Studio reads background menus with " + run.version + ".");
      }));
    }
    if (row.childNodes.length) card.append(row);
    const j = sr.jobs || {};
    card.append(el("p", "muted", num(j.waiting) + " menus waiting · " + num(j.running) + " being read · last 7 days: " + num(j.done_7d) + " done, " + num(j.failed_7d) + " failed."));
    const recent = sr.recent || [];
    if (!recent.length) {
      card.append(el("p", "muted", "The Studio hasn't saved any menus yet."));
      return;
    }
    const t = el("table", "periods");
    const hr = el("tr");
    for (const h of ["Restaurant", "Dishes", "Saved", "Allergens"]) hr.append(el("th", null, h));
    const thead = el("thead");
    thead.append(hr);
    const tbody = el("tbody");
    for (const m of recent) {
      const tr = el("tr");
      tr.append(el("td", null, (m.name || m.place_id) + (m.hidden ? " (waiting for review)" : "")), el("td", null, num(m.dishes)),
        el("td", null, when(m.created_at)), el("td", m.allergens_checked ? null : "bad", m.allergens_checked ? "Checked" : "Not yet"));
      tbody.append(tr);
    }
    t.append(thead, tbody);
    card.append(el("p", "muted", "The Studio's recent menus. Allergens are checked the first time someone opens one."), t);
  }

  // Chains C4: each chain is read once and its menu used for every location. Approve or ignore the
  // ones found, give a chain its menu page or file (often a menu or nutrition PDF), read it.
  function chainsCard(list) {
    const card = el("section", "card costs-card");
    card.append(el("h2", null, "Chains"));
    card.append(el("p", "muted", "Found among imported places (store-locator websites, or one website and name at several places). " +
      "An approved chain is read once on the Studio, without prices, and every location gets that menu when someone adds it. " +
      "Menus under 15 dishes aren't used. A chain's menu page or file is often a menu or nutrition PDF; chains rename those every season, " +
      "so a missing one is flagged here."));
    const row = el("div", "button-row");
    row.append(button("Read approved chains' menus", "button small", () =>
      bgChange("read_chains", {}, "Queued: the Studio reads approved chains whose menu is missing or a month old.")));
    row.append(button("Add a chain…", null, () => {
      const key = (window.prompt("The chain's main website, like wendys.com:") || "").trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "");
      if (!key) return;
      const name = (window.prompt("Its name, like Wendy's:") || "").trim();
      if (!name) return;
      bgChange("set_chain", { key, name, status: "approved" }, name + " added and approved.");
    }));
    card.append(row);
    if (!list.length) {
      card.append(el("p", "muted", "No chains yet. They're found after each Overture import."));
      return card;
    }
    const t = el("table", "periods");
    const hr = el("tr");
    for (const h of ["Chain", "Locations", "Menu", ""]) hr.append(el("th", null, h));
    const thead = el("thead");
    thead.append(hr);
    const tbody = el("tbody");
    for (const c of list) {
      const tr = el("tr");
      const name = el("td");
      name.append(el("strong", null, c.name), el("div", "muted", c.key + " · " + (c.detected_by === "store_locator" ? "store locator" : c.detected_by === "shared_site" ? "shared website" : "added by hand")));
      name.append(badge(c.status === "approved" ? "Approved" : c.status === "ignored" ? "Not a chain" : "Found", c.status === "approved" ? "on" : "off"));
      const menu = el("td");
      if (c.menu_missing_at) menu.append(el("div", "bad", "Needs a new menu file (the saved one is gone)"));
      if (c.reading) menu.append(el("div", null, "Reading…"));
      if (c.menu) {
        menu.append(el("div", c.menu.dishes < 15 ? "bad" : null, num(c.menu.dishes) + " dishes · read " + when(c.menu.read_at) +
          (c.menu.dishes < 15 ? " · too few to use" : "") + " · allergens " + (c.menu.allergens_checked ? "checked" : "not yet")));
      } else if (!c.reading) {
        menu.append(el("div", "muted", c.status === "approved" ? "Not read yet" : "—"));
      }
      if (c.menu_url) {
        const a = el("a", "muted", c.menu_url.length > 60 ? c.menu_url.slice(0, 57) + "…" : c.menu_url);
        a.href = c.menu_url; a.target = "_blank"; a.rel = "noopener noreferrer";
        menu.append(a);
      }
      const actions = el("td");
      if (c.status !== "approved") {
        actions.append(button("Approve", "button small", () => bgChange("set_chain", { key: c.key, status: "approved" }, c.name + " approved.")));
      }
      if (c.status !== "ignored") {
        actions.append(button("Not a chain", null, () => bgChange("set_chain", { key: c.key, status: "ignored" }, c.name + " is treated as separate restaurants.")));
      }
      actions.append(button("Menu page or file…", null, () => {
        const url = (window.prompt("The address of " + c.name + "'s national menu page or file (PDF):", c.menu_url || "") || "").trim();
        if (!url) return;
        if (!/^https?:\/\//i.test(url)) return bgSay("That needs to be a web address (http or https).", true);
        bgChange("set_chain", { key: c.key, status: c.status === "ignored" ? "approved" : c.status, menuUrl: url }, "Menu page saved for " + c.name + ". Use \"Read approved chains' menus\" to read it.");
      }));
      if (c.status === "approved") {
        actions.append(button("Read now", null, () => bgChange("read_chains", { keys: [c.key] }, "Queued: the Studio reads " + c.name + "'s menu.")));
      }
      tr.append(name, el("td", null, num(c.locations)), menu, actions);
      tbody.append(tr);
    }
    t.append(thead, tbody);
    card.append(t);
    return card;
  }

  // A8b: estimate, then run.
  async function seedEstimate(areaId) {
    bgSay("Working out the estimate…");
    try {
      const res = await callApi("seed_estimate", { areaId });
      if (res.status === 401) return route();
      if (res.status !== 200) {
        const m = res.body && res.body.error && res.body.error.message;
        return bgSay(m || "Couldn't estimate (" + res.status + ").", true);
      }
      bg.seed = { estimate: res.body, report: null };
      bgSay("");
      renderBackground();
      const card = document.querySelector(".seed-card");
      if (card) card.scrollIntoView({ block: "nearest" });
    } catch (e) {
      console.error(e);
      bgSay("Couldn't reach the server.", true);
    }
  }

  function seedCard() {
    const e = bg.seed.estimate;
    const r = bg.seed.report;
    const card = el("div", "seed-card");
    card.append(el("h3", null, "Seed " + e.area.label));
    if (r) {
      const lines = [
        num(r.newPlaces) + " new places found (" + num(r.searched) + " seen, " + num(r.inArea) + " in the area)",
        num(r.queued) + " queued for the Studio to find their menus",
        "OpenStreetMap gave " + num(r.osm && r.osm.match) + " a website, so no Google lookup is needed for those",
        num(r.googleRequests) + " Google searches · " + usd(r.googleUsd),
      ];
      if (r.stoppedBy) lines.push("Stopped early: " + r.stoppedBy.replace("_", " "));
      if (r.osmError) lines.push("OpenStreetMap didn't answer: " + r.osmError);
      if (r.skipped) lines.push("Skipped: " + r.skipped);
      const ul = el("ul", "plain-list");
      for (const l of lines) ul.append(el("li", null, l));
      card.append(el("p", null, "Done."), ul);
      card.append(button("Close", "button small quiet", () => { bg.seed = null; renderBackground(); }));
      return card;
    }
    const ul = el("ul", "plain-list");
    ul.append(
      el("li", null, "Room: " + num(e.room) + " more places here (" + num(e.seeded_here) + " of " + num(e.area.target) + "), " +
        num(e.seeded_total) + " of " + num(e.target_total) + " overall"),
      el("li", null, "At most " + num(e.max_searches) + " Google searches × $" + Number(e.per_search_usd || 0).toFixed(3) + " = " + usd(e.max_search_usd) +
        " now, stopping at the caps (" + usd(e.left_today_usd) + " left today, " + usd(e.left_month_usd) + " this month)"),
      el("li", null, "Later, at most " + usd(e.later_lookup_usd) + " for Google website lookups, only for places OpenStreetMap can't give a website (with background work on)"),
    );
    card.append(ul);
    const blockers = e.blocker_text || [];
    if (blockers.length) {
      for (const b of blockers) card.append(el("p", "status err", b));
    }
    const row = el("div", "button-row");
    const run = button("Run now…", "button small", () => seedRun());
    run.disabled = blockers.length > 0;
    row.append(run, button("Cancel", "button small quiet", () => { bg.seed = null; renderBackground(); }));
    card.append(row);
    return card;
  }

  async function seedRun() {
    const e = bg.seed && bg.seed.estimate;
    if (!e) return;
    const ok = window.confirm("Seed " + e.area.label + " now?\n\n" +
      "Up to " + num(e.max_searches) + " Google searches, at most " + usd(e.max_search_usd) + ", stopping at the caps. " +
      "New places go to the Studio to find their menu links. This can take a minute.");
    if (!ok) return;
    for (const b of document.querySelectorAll(".seed-card button")) b.disabled = true;
    bgSay("Seeding " + e.area.label + "… this can take a minute.");
    try {
      const res = await callApi("seed_run", { areaId: e.area.id, confirm: true });
      if (res.status === 401) return route();
      if (res.status !== 200) {
        const m = res.body && res.body.error && res.body.error.message;
        for (const b of document.querySelectorAll(".seed-card button")) b.disabled = false;
        return bgSay(m || "The run didn't work (" + res.status + ").", true);
      }
      const report = res.body;
      await loadBackground();
      bg.seed = { estimate: e, report };
      renderBackground();
      bgSay("Seeding finished.");
    } catch (err) {
      console.error(err);
      for (const b of document.querySelectorAll(".seed-card button")) b.disabled = false;
      bgSay("Lost touch with the server. Refresh to see whether the run finished.", true);
    }
  }

  function turnOnSeeding() {
    const d = bg.data || {};
    const caps = d.caps || {};
    const sw = d.switches || {};
    const ok = window.confirm("Turn seeding on?\n\n" +
      "Seeding searches Google for new places ($0.032 a search) and looks up websites it can't find elsewhere ($0.02 each). " +
      "It counts against the caps: " + usd(caps.daily_usd) + " a day, " + usd(caps.monthly_usd) + " a month " +
      "(" + usd(caps.today_usd) + " and " + usd(caps.month_usd) + " counted so far)." +
      (sw.background_on ? "" : "\n\nBackground work is off, so nothing will run until it's on."));
    if (ok) bgChange("set_seeding", { on: true, confirm: true }, "Seeding is on.");
  }


  // MARK: Users (A11a). Read-only, plus feature testers (the Trip Mode feature routes).

  const users = { loaded: false, filter: "active7", query: "", items: [], total: 0, id: null };
  const KIND = { anonymous: "Anonymous install", apple: "Sign in with Apple", email: "Email", other: "Other" };
  const FEATURE_NAMES = { trip_mode: "Trip Mode", table_sharing: "Invite to my table", receipt_scan: "Receipt Scan" };

  function usersSay(text, isError) {
    $("users-status").className = "status" + (isError ? " err" : "");
    $("users-status").textContent = text || "";
  }

  async function loadUsers(more) {
    users.loaded = true;
    if (!more) users.items = [];
    usersSay("Loading…");
    try {
      const res = await callApi("users", { query: users.query, filter: users.filter, limit: 50, offset: users.items.length });
      if (res.status === 401) return route();
      if (res.status === 403) return show("denied");
      if (res.status !== 200) return usersSay("Couldn't load accounts (" + res.status + ").", true);
      users.items = users.items.concat(res.body.items || []);
      users.total = res.body.total || 0;
      renderUsers(res.body.counts || {});
    } catch (e) {
      console.error(e);
      usersSay("Couldn't reach the server.", true);
    }
  }

  function renderUsers(counts) {
    const filters = [["active7", "Active 7 days"], ["all", "All"], ["apple", "Apple"], ["email", "Email"], ["anonymous", "Anonymous"], ["testers", "Testers"], ["admins", "Admins"]];
    $("users-filters").replaceChildren(...filters.map(([key, label]) => {
      const b = button(label + " " + num(counts[key]), "chip", () => { users.filter = key; loadUsers(false); });
      b.setAttribute("aria-pressed", String(users.filter === key));
      return b;
    }));
    usersSay(users.items.length ? "Showing " + num(users.items.length) + " of " + num(users.total) + "." : "No accounts match.");
    $("users-items").replaceChildren(...users.items.map((u) => {
      const li = el("li");
      const row = el("button", "lib-row");
      row.type = "button";
      const title = u.email || (KIND[u.kind] || u.kind) + " · " + String(u.id).slice(0, 8);
      const tags = el("span", "lib-tags");
      if (u.is_admin) tags.append(badge("Admin", "on"));
      for (const f of u.testers || []) tags.append(badge(FEATURE_NAMES[f] || f, "on"));
      row.append(el("span", "lib-name", title), tags,
        el("span", "lib-meta", (KIND[u.kind] || u.kind) + " · last active " + (u.last_active ? when(u.last_active) : "never") +
          (u.app_build ? " · app build " + u.app_build : "") + " · 7 days: " + num(u.lookups_7d) + " lookups, " + num(u.scans_7d) + " scans"));
      row.addEventListener("click", () => openUser(u.id));
      li.append(row);
      return li;
    }));
    $("users-more").hidden = users.items.length >= users.total;
  }

  // MARK: Features (A12): every app feature's switch and testers, from app_features.

  const FEATURE_MODES = [["off", "Off"], ["testers", "Testers list"], ["everyone", "Everyone"]];

  async function loadFeatures() {
    try {
      const res = await callApi("features");
      if (res.status !== 200) {
        $("features-card").replaceChildren(el("p", "status err", "Couldn't load the features (" + res.status + ")."));
        return;
      }
      renderFeatures(Array.isArray(res.body) ? res.body : []);
    } catch (e) {
      console.error(e);
      $("features-card").replaceChildren(el("p", "status err", "Couldn't reach the server for the features."));
    }
  }

  function renderFeatures(list) {
    const card = el("section", "card features-card");
    card.append(el("h2", null, "Features"));
    card.append(el("p", "muted", "What each feature shows in the app: nobody, the accounts on its testers list, or everyone. " +
      "The app asks when it opens. Add or remove testers from an account below."));
    for (const f of list) {
      const name = FEATURE_NAMES[f.name] || f.name;
      const block = el("div", "feature-block");
      const head = el("div", "switch-head");
      head.append(el("strong", null, name), el("span", "muted small-print", "changed " + when(f.updated_at)));
      const chips = el("div", "chips");
      for (const [mode, label] of FEATURE_MODES) {
        const b = button(label, "chip", () => setFeatureMode(f, mode));
        b.setAttribute("aria-pressed", String(f.mode === mode));
        chips.append(b);
      }
      block.append(head, chips);
      const testers = f.testers || [];
      const p = el("p", "muted", testers.length ? num(testers.length) + " tester" + (testers.length === 1 ? "" : "s") + ": " : "No testers yet.");
      testers.forEach((t, i) => {
        if (i) p.append(document.createTextNode(", "));
        p.append(button(t.note || String(t.user_id).slice(0, 8), null, () => openUser(t.user_id)));
      });
      block.append(p);
      card.append(block);
    }
    if (!list.length) card.append(el("p", "muted", "No features yet."));
    const st = el("p", "status", "");
    st.id = "features-status";
    st.setAttribute("role", "status");
    card.append(st);
    $("features-card").replaceChildren(card);
  }

  async function setFeatureMode(f, mode) {
    if (f.mode === mode) return;
    const name = FEATURE_NAMES[f.name] || f.name;
    const text = { off: "Nobody will see " + name + ".", testers: "Only the accounts on its testers list will see " + name + ".",
      everyone: "Every tester will see " + name + " the next time they open the app." }[mode];
    if (!window.confirm("Change " + name + " to \"" + FEATURE_MODES.find((m) => m[0] === mode)[1] + "\"?\n\n" + text)) return;
    const st = $("features-status");
    if (st) { st.className = "status"; st.textContent = "Saving…"; }
    try {
      const res = await callApi("set_feature_mode", { feature: f.name, mode, confirm: mode === "everyone" });
      if (res.status === 401) return route();
      if (res.status !== 200) {
        const m = res.body && res.body.error && res.body.error.message;
        if (st) { st.className = "status err"; st.textContent = m || "That didn't work (" + res.status + ")."; }
        return;
      }
      await loadFeatures();
      const st2 = $("features-status");
      if (st2) st2.textContent = text;
    } catch (e) {
      console.error(e);
      if (st) { st.className = "status err"; st.textContent = "Couldn't reach the server. Nothing changed."; }
    }
  }

  async function openUser(id) {
    users.id = id;
    $("users-list").hidden = true;
    $("features-card").hidden = true;
    $("users-detail").hidden = false;
    $("users-detail").replaceChildren(el("p", "status", "Loading…"));
    try {
      const res = await callApi("user", { userId: id });
      if (res.status === 401) return route();
      if (res.status !== 200) {
        const m = res.body && res.body.error && res.body.error.message;
        return $("users-detail").replaceChildren(usersBack(), el("p", "status err", m || "Couldn't load that account (" + res.status + ")."));
      }
      renderUser(res.body);
    } catch (e) {
      console.error(e);
      $("users-detail").replaceChildren(usersBack(), el("p", "status err", "Couldn't reach the server."));
    }
  }

  function usersBack() {
    return button("← All accounts", "link-button", () => {
      users.id = null;
      $("users-detail").hidden = true;
      $("users-list").hidden = false;
      $("features-card").hidden = false;
      loadUsers(false);
      loadFeatures();
    });
  }

  function renderUser(d) {
    const a = d.account || {};
    const parts = [usersBack()];
    const head = el("div", "detail-head");
    head.append(el("h2", null, a.email || KIND[a.kind] || "Account"));
    const idLine = el("p", "muted");
    idLine.append(document.createTextNode((KIND[a.kind] || a.kind) + " · account "), el("code", null, a.id || ""));
    head.append(idLine, el("p", "muted", "Started " + when(a.created_at) + " · last active " + (a.last_active ? when(a.last_active) : "never") +
      (a.app_build ? " · app build " + a.app_build : "") + (a.is_admin ? " · admin" : "")));
    parts.push(head);

    // Feature testers
    const feats = el("section", "card");
    feats.append(el("h3", null, "Features"));
    for (const f of d.features || []) {
      const row = el("div", "switch-row");
      const text = el("div", "switch-text");
      const name = FEATURE_NAMES[f.name] || f.name;
      const hd = el("div", "switch-head");
      hd.append(el("strong", null, name), badge(f.tester ? "On the testers list" : "Not a tester", f.tester ? "on" : "off"));
      text.append(hd, el("p", "switch-detail", f.mode === "everyone" ? "Everyone has " + name + " now." : f.mode === "off" ? name + " is off for everyone." :
        "Only the testers list has " + name + "."));
      const b = button(f.tester ? "Remove" : "Add as tester…", "button small" + (f.tester ? " quiet" : ""), () => setTester(f, !f.tester, a));
      row.append(text, b);
      feats.append(row);
    }
    if (!(d.features || []).length) feats.append(el("p", "muted", "No features to switch yet."));
    const st = el("p", "status", "");
    st.id = "user-status";
    st.setAttribute("role", "status");
    feats.append(st);
    parts.push(feats);

    // Usage
    const use = el("section", "card");
    use.append(el("h3", null, "Use"));
    const t = el("table", "periods");
    const hr = el("tr");
    for (const h of ["", "7 days", "30 days"]) hr.append(el("th", null, h));
    const thead = el("thead");
    thead.append(hr);
    const tbody = el("tbody");
    const label = { places: "Restaurant searches", "fetch-menu": "Website menu lookups", "parse-menu": "Photo scans", "tag-dishes": "Dish tagging",
      "share-menu": "Menus shared", "report-menu": "Menus reported" };
    for (const u of d.usage || []) {
      const tr = el("tr");
      tr.append(el("th", null, label[u.kind] || u.kind), el("td", null, num(u.d7 || 0)), el("td", null, num(u.d30 || 0)));
      tbody.append(tr);
    }
    if (!tbody.childElementCount) {
      const tr = el("tr");
      tr.append(el("td", "muted", "Nothing in the last 30 days."));
      tbody.append(tr);
    }
    t.append(thead, tbody);
    use.append(t);
    parts.push(use);

    // Menus and reports
    const mr = el("section", "card");
    mr.append(el("h3", null, "Menus contributed"));
    const ml = el("ul", "plain-list");
    for (const m of d.menus || []) {
      const li = el("li");
      li.append(button(m.name || m.place_id, null, () => { showTab("menus"); openMenu(m.place_id, null); }),
        document.createTextNode(" · " + (m.source === "scan" ? "photo scan" : m.source) + " · " + num(m.item_count) + " dishes · " + day(m.created_at) + (m.hidden ? " · hidden" : "")));
      ml.append(li);
    }
    if (!ml.childElementCount) ml.append(el("li", "muted", "None."));
    mr.append(ml, el("h3", null, "Menu reports"));
    const rl = el("ul", "plain-list");
    for (const r of d.reports || []) rl.append(el("li", null, day(r.created_at) + " · " + r.reason + (r.note ? ": “" + r.note + "”" : "")));
    if (!rl.childElementCount) rl.append(el("li", "muted", "None."));
    mr.append(rl);
    parts.push(mr);

    // Sessions
    const ss = el("section", "card");
    ss.append(el("h3", null, "Sign-in sessions"));
    const sl = el("ul", "plain-list");
    for (const s of d.sessions || []) {
      sl.append(el("li", null, (s.app_build ? "App build " + s.app_build : "Not the app (a browser or tool)") + " · started " + when(s.created_at) +
        " · last used " + (s.last_used ? when(s.last_used) : "–")));
    }
    if (!sl.childElementCount) sl.append(el("li", "muted", "None open."));
    ss.append(sl, el("p", "muted", "No IP addresses or locations are shown or kept here."));
    parts.push(ss);

    $("users-detail").replaceChildren(...parts);
  }

  async function setTester(feature, add, account) {
    const name = FEATURE_NAMES[feature.name] || feature.name;
    const who = account.email || (KIND[account.kind] || account.kind) + " " + String(account.id).slice(0, 8);
    if (add && !window.confirm("Add " + who + " to the " + name + " testers list?\n\nIt sees " + name + " in the app from its next launch" +
      (feature.mode === "off" ? " (once " + name + " is switched to the testers list)." : "."))) return;
    let note = null;
    if (add) {
      note = window.prompt("A note so you can tell this account apart (optional), e.g. \"Jeff's iPhone\":", account.email || "");
      if (note === null) return;
    }
    const st = $("user-status");
    if (st) { st.className = "status"; st.textContent = "Saving…"; }
    try {
      const res = await callApi(add ? "add_feature_tester" : "remove_feature_tester",
        add ? { feature: feature.name, userId: account.id, note: note.trim().slice(0, 100) || null } : { feature: feature.name, userId: account.id });
      if (res.status === 401) return route();
      if (res.status !== 200) {
        const m = res.body && res.body.error && res.body.error.message;
        if (st) { st.className = "status err"; st.textContent = m || "That didn't work (" + res.status + ")."; }
        return;
      }
      await openUser(account.id);
      loadFeatures();
      const st2 = $("user-status");
      if (st2) st2.textContent = add ? "Added." : "Removed.";
    } catch (e) {
      console.error(e);
      if (st) { st.className = "status err"; st.textContent = "Couldn't reach the server. Nothing changed."; }
    }
  }


  // MARK: Feedback (A11b): messages from the app's Settings → Send feedback.

  const fb = { loaded: false, status: "new", items: [], counts: {} };
  const ACCOUNT_KIND = { anonymous: "Anonymous install", apple: "Sign in with Apple", email: "Email account" };

  function fbSay(text, isError) {
    $("fb-status").className = "status" + (isError ? " err" : "");
    $("fb-status").textContent = text || "";
  }

  async function loadFeedback(more) {
    fb.loaded = true;
    if (!more) fb.items = [];
    fbSay("Loading…");
    try {
      const res = await callApi("feedback", { status: fb.status, limit: 50, offset: fb.items.length });
      if (res.status === 401) return route();
      if (res.status === 403) return show("denied");
      if (res.status !== 200) return fbSay("Couldn't load feedback (" + res.status + ").", true);
      fb.items = fb.items.concat(res.body.items || []);
      fb.counts = res.body.counts || {};
      renderFeedback();
    } catch (e) {
      console.error(e);
      fbSay("Couldn't reach the server.", true);
    }
  }

  function renderFeedback() {
    const c = fb.counts;
    $("fb-filters").replaceChildren(...[["new", "New"], ["handled", "Handled"], ["all", "All"]].map(([key, label]) => {
      const b = button(label + " " + num(c[key]), "chip" + (key === "new" && c.new > 0 ? " attention" : ""), () => { fb.status = key; loadFeedback(false); });
      b.setAttribute("aria-pressed", String(fb.status === key));
      return b;
    }));
    const total = fb.status === "all" ? c.all : c[fb.status];
    fbSay(fb.items.length ? "" : fb.status === "new" ? "Nothing new." : "None.");
    $("fb-items").replaceChildren(...fb.items.map(feedbackCard));
    $("fb-more").hidden = fb.items.length >= (total || 0);
  }

  function feedbackCard(f) {
    const card = el("section", "card fb-card" + (f.status === "new" ? " fb-new" : ""));
    const head = el("div", "switch-head");
    head.append(el("strong", null, when(f.created_at)), badge(f.status === "new" ? "New" : "Handled", f.status === "new" ? "off" : "on"));
    card.append(head);
    card.append(el("p", "fb-message", f.message));
    const meta = el("p", "muted small-print");
    meta.append(document.createTextNode((ACCOUNT_KIND[f.account] || f.account) + " · app " + (f.app_version || "?") + " · " +
      (f.os_version || "?") + " · " + (f.device || "?") + " · "));
    meta.append(button("Open account", null, () => { showTab("users"); openUser(f.user_id); }));
    card.append(meta);
    if (f.can_reply && f.reply_email) {
      const reply = el("p", null, "Reply to ");
      const a = el("a", null, f.reply_email);
      a.href = "mailto:" + encodeURIComponent(f.reply_email).replace(/%40/g, "@") + "?subject=" + encodeURIComponent("Your MenuQuest feedback");
      reply.append(a);
      card.append(reply);
    } else {
      card.append(el("p", "muted small-print", "No reply asked for."));
    }
    if (f.admin_note) card.append(el("p", "muted", "Note: " + f.admin_note));
    const row = el("div", "button-row");
    row.append(
      button(f.status === "new" ? "Mark handled" : "Mark new", "button small" + (f.status === "new" ? "" : " quiet"), () =>
        setFeedback(f, f.status === "new" ? "handled" : "new", f.admin_note)),
      button(f.admin_note ? "Edit note" : "Add note", "button small quiet", () => {
        const note = window.prompt("A note for yourself (only you see it):", f.admin_note || "");
        if (note === null) return;
        setFeedback(f, f.status, note);
      }),
    );
    card.append(row);
    return card;
  }

  async function setFeedback(f, status, note) {
    fbSay("Saving…");
    try {
      const res = await callApi("set_feedback", { id: f.id, status, note: note ? String(note).trim().slice(0, 500) : null });
      if (res.status === 401) return route();
      if (res.status !== 200) {
        const m = res.body && res.body.error && res.body.error.message;
        return fbSay(m || "That didn't work (" + res.status + ").", true);
      }
      await loadFeedback(false);
      fbSay(status === "handled" ? "Marked handled." : "Saved.");
    } catch (e) {
      console.error(e);
      fbSay("Couldn't reach the server. Nothing changed.", true);
    }
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
        try { tab = ["menus", "tests", "background", "trips", "users", "feedback"].includes(sessionStorage.getItem("menuquest-admin-tab")) ? sessionStorage.getItem("menuquest-admin-tab") : "overview"; } catch (_) { /* fine */ }
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
  $("gate-place-select").addEventListener("change", (e) => loadGateMenu(e.target.value));
  $("bg-refresh").addEventListener("click", () => loadBackground());
  $("users-search").addEventListener("submit", (e) => {
    e.preventDefault();
    users.query = $("users-query").value.trim().slice(0, 200);
    if (users.query) users.filter = "all";
    loadUsers(false);
  });
  $("users-more").addEventListener("click", () => loadUsers(true));
  $("fb-more").addEventListener("click", () => loadFeedback(true));
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

  // Trip Mode (trips.js) builds its tab with the same helpers and the same checked API calls.
  window.MQAdmin = Object.freeze({ callApi, el, button, badge, outLink, usd, num, when, route, show });

  route();
})();
