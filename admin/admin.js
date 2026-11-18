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
