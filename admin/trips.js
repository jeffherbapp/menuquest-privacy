// The admin panel's Trips tab (Trip Mode T4). Review each city's must-go picks: approve, hide,
// edit, match a pick to Google, add one by hand, see where its menu stands; check local
// specialties; and build a city's starter list. Every read and change goes through admin-api
// (sign-in, admin list, authenticator code, audit log), with the page's own helpers
// (window.MQAdmin, from admin.js). Text from the server is always set with textContent.
(() => {
  "use strict";

  const A = window.MQAdmin;
  if (!A) return;
  const { callApi, el, button, badge, outLink, usd, num, when, route, show } = A;
  const $ = (id) => document.getElementById(id);

  const trip = {
    loaded: false,
    cityId: null,
    data: null,
    filter: "pending",
    estimate: null,
    finds: {},      // spot id -> { query, candidates } (Google results, never stored)
    editing: null,  // spot id being edited
    poll: null,
    pollUntil: 0,
  };

  const PRICES = ["$", "$$", "$$$", "$$$$"];
  const PRICE_TEXT = { "$": "under $20", "$$": "$20–40", "$$$": "$40–80", "$$$$": "over $80" };
  const MENU_TEXT = {
    not_matched: "Not matched to a restaurant yet",
    waiting: "Menu not read yet (reads start with T2)",
    no_website: "No website found",
    blocked: "Its site blocks reading",
    not_found: "No menu found on its site",
    error: "Menu read failed",
  };
  const OUTCOME_TEXT = {
    used: "used", robots: "robots.txt says no", ai_opt_out: "site opts out of AI use", not_allowed: "site not allowed",
    blocked: "site blocked us", not_found: "page not found", gone: "page gone", too_short: "too little text",
    not_a_page: "not a web page", busy: "site busy", network: "couldn't reach it", server_error: "site error",
    rate_limited: "site asked us to slow down", refused: "refused", too_big: "too big",
  };

  function say(text, isError) {
    $("trip-status").className = "status" + (isError ? " err" : "");
    $("trip-status").textContent = text || "";
  }

  /** Runs an API call; on sign-in trouble hands back to the sign-in flow. Returns the body or null. */
  async function api(routeName, body, failText) {
    try {
      const res = await callApi(routeName, body);
      if (res.status === 401) { route(); return null; }
      if (res.status === 403 && res.body && res.body.error && res.body.error.code !== "mfa_required") { show("denied"); return null; }
      if (res.status !== 200) {
        const m = res.body && res.body.error && res.body.error.message;
        say(m || (failText || "That didn't work") + " (" + res.status + ").", true);
        return null;
      }
      return res.body;
    } catch (e) {
      console.error(e);
      say("Couldn't reach the server.", true);
      return null;
    }
  }

  function input(type, value, label, opts) {
    const i = el("input");
    i.type = type;
    i.value = value || "";
    i.setAttribute("aria-label", label);
    i.placeholder = (opts && opts.placeholder) || label;
    if (opts && opts.max) i.maxLength = opts.max;
    return i;
  }

  function priceSelect(value) {
    const s = el("select");
    s.setAttribute("aria-label", "Price level");
    s.append(new Option("Price: not set", ""));
    for (const p of PRICES) s.append(new Option(p + "  (" + PRICE_TEXT[p] + " a person)", p));
    s.value = value || "";
    return s;
  }

  // MARK: Cities

  async function open() {
    if (trip.cityId) return openCity(trip.cityId, true);
    if (!trip.loaded) await loadCities();
  }

  async function loadCities() {
    stopPolling();
    trip.cityId = null;
    $("trip-detail").hidden = true;
    $("trip-list").hidden = false;
    say("Loading…");
    const cities = await api("trip_cities", {}, "Couldn't load cities");
    if (!cities) return;
    trip.loaded = true;
    say(cities.length ? "" : "No cities yet.");
    $("trip-list").replaceChildren(...cities.map((c) => {
      const li = el("li");
      const row = el("button", "lib-row");
      row.type = "button";
      row.append(el("span", "lib-name", c.name + (c.region ? ", " + c.region : "")));
      const tags = el("span", "lib-tags");
      if (c.pending) tags.append(badge(c.pending + " to review", "off"));
      if (c.approved) tags.append(badge(c.approved + " approved", "on"));
      if (!c.active) tags.append(badge("hidden from app", "off"));
      row.append(tags);
      const run = c.last_run;
      row.append(el("span", "lib-meta",
        num(c.menus_ready) + " of " + num(c.approved) + " approved have a menu" +
        (run ? " · last list " + when(run.started_at) + " (" + run.status + ", " + usd(run.usd) + ")" : " · no starter list yet")));
      row.addEventListener("click", () => openCity(c.id));
      li.append(row);
      return li;
    }));
  }

  /** `quiet`: a refresh after a change, which keeps the message about that change. */
  async function openCity(id, quiet) {
    if (trip.cityId !== id) trip.estimate = null;
    trip.cityId = id;
    if (!quiet) say("Loading…");
    const data = await api("trip_city", { cityId: id }, "Couldn't load the city");
    if (!data) return;
    trip.data = data;
    if (!quiet) say("");
    renderCity();
    const latest = (data.runs || [])[0];
    if (latest && latest.status === "running") startPolling(); else stopPolling();
  }

  async function reload() {
    if (trip.cityId) await openCity(trip.cityId, true);
  }

  // MARK: One city

  function renderCity() {
    const d = trip.data;
    const box = $("trip-detail");
    $("trip-list").hidden = true;
    box.hidden = false;
    const back = button("← All cities", "link-button", () => { trip.loaded = false; loadCities(); });
    const head = el("div", "detail-head");
    head.append(el("h2", null, d.city.name + (d.city.region ? ", " + d.city.region : "")));
    head.append(el("p", "muted", d.city.active ? "Shown in the app" : "Hidden from the app until Trip Mode ships (T6)"));
    box.replaceChildren(back, head, starterCard(), spotsCard(), addCard(), specialtiesCard());
  }

  // Starter list: the latest run, its guides, the cost, and the button.
  function starterCard() {
    const c = el("section", "card");
    c.append(el("h3", null, "Starter list"));
    const run = (trip.data.runs || [])[0];
    if (run) {
      const line = run.status === "running"
        ? "Building now (started " + when(run.started_at) + "). This page checks again every 15 seconds."
        : "Last run " + when(run.started_at) + ": " + run.status + (run.stop_reason ? " (" + run.stop_reason + ")" : "") +
          " · " + usd(run.usd) + " · " + num(run.spots_saved) + " picks and " + num(run.specialties_saved) + " specialties saved";
      c.append(el("p", null, line));
      const guides = Array.isArray(run.guides) ? run.guides : [];
      if (guides.length) {
        const det = el("details");
        det.append(el("summary", null, "Guides: " + guides.filter((g) => g.outcome === "used").length + " used, " +
          guides.filter((g) => g.outcome !== "used").length + " skipped"));
        const ul = el("ul", "plain-list");
        for (const g of guides) {
          const li = el("li");
          li.append(outLink(g.url, g.title || g.url));
          li.append(el("span", "muted small-print", " · " + (g.publisher ? g.publisher + " · " : "") + (OUTCOME_TEXT[g.outcome] || g.outcome)));
          ul.append(li);
        }
        det.append(ul);
        c.append(det);
      }
    } else {
      c.append(el("p", "muted", "No starter list yet. It finds recent guides (cheap eats, local favorites, best overall, a little fine dining), " +
        "reads the ones whose sites allow it, and saves about 30 picks as pending, balanced by price and cuisine."));
    }
    if (trip.estimate) {
      const e = trip.estimate;
      c.append(el("p", null, "Estimate: " + usd(e.estimateUsd) + " (stops at " + usd(e.suggestedMaxUsd) + " at most). Spent today " +
        usd(e.spend && e.spend.todayUsd) + " of " + usd(e.caps && e.caps.dailyCapUsd) + "; this month " +
        usd(e.spend && e.spend.monthUsd) + " of " + usd(e.caps && e.caps.monthlyCapUsd) + "." +
        (e.paidPaused ? " Everything paid is paused." : !e.fitsToday ? " It doesn't fit today's cap." : !e.fitsThisMonth ? " It doesn't fit this month's cap." : "")));
    }
    const row = el("div", "button-row");
    if (!run || run.status !== "running") {
      row.append(button(trip.estimate ? "Build the starter list (about " + usd(trip.estimate.estimateUsd) + ")…" : "Check the cost",
        "button small", trip.estimate ? buildList : checkCost));
    } else {
      row.append(button("Check now", "button small quiet", reload));
    }
    c.append(row);
    return c;
  }

  async function checkCost() {
    say("Checking the cost…");
    const e = await api("trip_estimate", { city: trip.data.city.slug }, "Couldn't check the cost");
    if (!e) return;
    trip.estimate = e;
    say("");
    renderCity();
  }

  async function buildList() {
    const e = trip.estimate;
    const ok = window.confirm("Build " + trip.data.city.name + "'s starter list?\n\n" +
      "Claude searches the web for guides and reads them: about " + usd(e.estimateUsd) + ", and never more than " + usd(e.suggestedMaxUsd) + ". " +
      "It's counted with background spending and stops before going over the daily or monthly cap.\n\n" +
      "Picks are saved as pending. Nothing shows in the app, and no menu is read, until you approve.");
    if (!ok) return;
    say("Starting…");
    const started = await api("trip_run", { city: trip.data.city.slug, maxUsd: e.suggestedMaxUsd, confirm: true }, "Couldn't start the run");
    if (!started) return;
    say("Started. It takes a few minutes; this page checks every 15 seconds.");
    trip.estimate = null;
    trip.pollUntil = 0;
    await reload();
  }

  function startPolling() {
    stopPolling();
    if (!trip.pollUntil) trip.pollUntil = Date.now() + 20 * 60_000;
    if (Date.now() > trip.pollUntil) return;
    trip.poll = setTimeout(async () => {
      if ($("tab-trips").hidden || !trip.cityId) return;
      await reload();
      const latest = (trip.data && trip.data.runs || [])[0];
      if (latest && latest.status !== "running") {
        trip.pollUntil = 0;
        trip.filter = "pending";
        say("The starter list is " + latest.status + ": " + num(latest.spots_saved) + " picks to review.");
        renderCity();
      }
    }, 15_000);
  }

  function stopPolling() {
    if (trip.poll) clearTimeout(trip.poll);
    trip.poll = null;
  }

  // Picks, filtered by status.
  function spotsCard() {
    const c = el("section", "card");
    const spots = trip.data.spots || [];
    const count = (s) => spots.filter((x) => s === "all" || x.status === s).length;
    c.append(el("h3", null, "Must-go picks"));
    const chips = el("div", "chips");
    for (const [key, label] of [["pending", "To review"], ["approved", "Approved"], ["hidden", "Hidden"], ["all", "All"]]) {
      const b = button(label + " " + num(count(key)), "chip" + (key === "pending" && count(key) > 0 ? " attention" : ""), () => { trip.filter = key; renderCity(); });
      b.setAttribute("aria-pressed", String(trip.filter === key));
      chips.append(b);
    }
    c.append(chips);
    const shown = spots.filter((s) => trip.filter === "all" || s.status === trip.filter);
    if (trip.filter === "approved" || trip.filter === "all") c.append(mixLine(spots.filter((s) => s.status === "approved")));
    if (!shown.length) c.append(el("p", "muted", "Nothing here."));
    const ul = el("ul", "trip-spots");
    for (const s of shown) ul.append(spotItem(s));
    c.append(ul);
    return c;
  }

  /** How the approved list is spread across price levels. */
  function mixLine(approved) {
    const parts = PRICES.map((p) => p + " " + approved.filter((s) => s.price_level === p).length);
    const unset = approved.filter((s) => !s.price_level).length;
    return el("p", "muted", "Approved by price: " + parts.join(" · ") + (unset ? " · not set " + unset : ""));
  }

  function spotItem(s) {
    const li = el("li", "trip-spot");
    const top = el("div", "trip-spot-head");
    top.append(el("strong", null, s.name));
    if (s.price_level) top.append(badge(s.price_level, "on"));
    if (s.status !== "pending") top.append(badge(s.status, s.status === "approved" ? "on" : "off"));
    li.append(top);
    const meta = [s.cuisine, s.neighborhood, s.source === "ai_starter" ? "from the AI list" : "added by you"].filter(Boolean).join(" · ");
    li.append(el("p", "muted", meta));
    if (s.reason) li.append(el("p", null, s.reason));
    if (s.source_url) {
      const p = el("p", "muted small-print");
      p.append(outLink(s.source_url, "Source guide"));
      li.append(p);
    }
    const m = s.menu || {};
    li.append(el("p", "muted small-print", m.status === "ready"
      ? "Menu ready · " + num(m.item_count) + " dishes · saved " + when(m.saved_at)
      : MENU_TEXT[m.status] || "Menu: " + (m.status || "unknown")));

    if (trip.editing === s.id) li.append(editForm(s));
    else {
      const row = el("div", "button-row");
      if (s.status !== "approved") {
        if (s.place_id) row.append(button("Approve", "button small", () => setSpot(s, "approved")));
        row.append(button(s.place_id ? "Match again on Google…" : "Find on Google…", s.place_id ? "button small quiet" : "button small", () => findPlace(s, null)));
      }
      row.append(button("Edit", "button small quiet", () => { trip.editing = s.id; renderCity(); }));
      if (s.status !== "hidden") row.append(button("Hide", "button small quiet", () => setSpot(s, "hidden")));
      if (s.status !== "pending") row.append(button("Back to review", "button small quiet", () => setSpot(s, "pending")));
      li.append(row);
    }
    const found = trip.finds[s.id];
    if (found) li.append(candidates(s, found));
    return li;
  }

  function candidates(s, found) {
    const box = el("div", "trip-candidates");
    box.append(el("p", "muted small-print", "Google results for “" + found.query + "”. Pick the right one to approve it. Only its place id is saved."));
    const ul = el("ul", "plain-list");
    for (const c of found.candidates) {
      const li = el("li");
      li.append(el("strong", null, c.name), el("span", "muted", " · " + c.address + (c.type ? " · " + c.type : "")));
      if (c.status && c.status !== "OPERATIONAL") li.append(document.createTextNode(" "), badge(c.status === "CLOSED_PERMANENTLY" ? "closed for good" : "closed for now", "off"));
      li.append(document.createTextNode(" "), button("This one: approve", "link-button inline", () => setSpot(s, "approved", c.placeId)));
      ul.append(li);
    }
    if (!found.candidates.length) ul.append(el("li", "muted", "No matches."));
    box.append(ul);
    const form = el("form", "link-form");
    const q = input("text", found.query, "Search Google for", { max: 200 });
    const go = el("button", "button small quiet", "Search again…");
    go.type = "submit";
    form.append(q, go);
    form.addEventListener("submit", (e) => { e.preventDefault(); findPlace(s, q.value); });
    box.append(form, button("Close", "link-button", () => { delete trip.finds[s.id]; renderCity(); }));
    return box;
  }

  async function findPlace(s, query) {
    const q = (query || [s.name, s.neighborhood].filter(Boolean).join(" ")).trim();
    if (!q) return;
    const ok = window.confirm("Search Google for “" + q + "” in " + trip.data.city.name + "?\n\nOne search: about $0.03, counted with background spending.");
    if (!ok) return;
    say("Searching Google…");
    const res = await api("trip_find_place", { cityId: trip.data.city.id, query: q, confirm: true }, "The search didn't work");
    if (!res) return;
    trip.finds[s.id] = { query: q, candidates: res.candidates || [] };
    say("");
    renderCity();
  }

  async function setSpot(s, status, placeId) {
    say("Saving…");
    const body = { spotId: s.id, status };
    if (placeId) body.placeId = placeId;
    const res = await api("trip_set_spot", body, "Couldn't save");
    if (!res) return;
    delete trip.finds[s.id];
    say(s.name + (status === "approved" ? " approved." : status === "hidden" ? " hidden." : " is back in review."));
    await reload();
  }

  function editForm(s) {
    const form = el("form", "trip-form");
    const name = input("text", s.name, "Name", { max: 200 });
    const hood = input("text", s.neighborhood, "Neighborhood", { max: 100 });
    const cuisine = input("text", s.cuisine, "Cuisine", { max: 60 });
    const price = priceSelect(s.price_level);
    const reason = el("textarea");
    reason.value = s.reason || "";
    reason.maxLength = 280;
    reason.rows = 2;
    reason.setAttribute("aria-label", "Why it's worth a visit");
    reason.placeholder = "Why it's worth a visit (one sentence)";
    const save = el("button", "button small", "Save");
    save.type = "submit";
    const row = el("div", "button-row");
    row.append(save, button("Cancel", "button small quiet", () => { trip.editing = null; renderCity(); }));
    form.append(name, hood, cuisine, price, reason, row);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      say("Saving…");
      const res = await api("trip_save_spot", {
        spotId: s.id,
        fields: { name: name.value, neighborhood: hood.value, cuisine: cuisine.value, price_level: price.value, reason: reason.value },
      }, "Couldn't save");
      if (!res) return;
      trip.editing = null;
      say("Saved.");
      await reload();
    });
    return form;
  }

  // Add a restaurant by hand: it lands in review, then Find on Google to approve it.
  function addCard() {
    const c = el("section", "card");
    c.append(el("h3", null, "Add a restaurant by hand"));
    const form = el("form", "trip-form");
    const name = input("text", "", "Name", { max: 200 });
    name.required = true;
    const hood = input("text", "", "Neighborhood", { max: 100 });
    const cuisine = input("text", "", "Cuisine", { max: 60 });
    const price = priceSelect("");
    const reason = input("text", "", "Why it's worth a visit (one sentence)", { max: 280 });
    const add = el("button", "button small", "Add to review");
    add.type = "submit";
    form.append(name, hood, cuisine, price, reason, add);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!name.value.trim()) return say("A name is needed.", true);
      say("Adding…");
      const res = await api("trip_save_spot", {
        cityId: trip.data.city.id,
        fields: { name: name.value, neighborhood: hood.value, cuisine: cuisine.value, price_level: price.value, reason: reason.value },
      }, "Couldn't add it");
      if (!res) return;
      trip.filter = "pending";
      say(name.value.trim() + " added. Use Find on Google to match and approve it.");
      await reload();
    });
    c.append(el("p", "muted", "It goes into review. Then use Find on Google to say which restaurant it is, and approve it."), form);
    return c;
  }

  // Local specialties: the dishes "Try the local specialty" quests ask for.
  function specialtiesCard() {
    const c = el("section", "card");
    c.append(el("h3", null, "Local specialties"));
    c.append(el("p", "muted", "A dish counts when its name contains one of the match words (for example “italian beef”)."));
    const ul = el("ul", "trip-spots");
    for (const t of trip.data.specialties || []) {
      const li = el("li", "trip-spot");
      const top = el("div", "trip-spot-head");
      top.append(el("strong", null, t.name));
      if (t.status !== "pending") top.append(badge(t.status, t.status === "approved" ? "on" : "off"));
      li.append(top);
      if (t.description) li.append(el("p", null, t.description));
      if (t.source_url) {
        const p = el("p", "muted small-print");
        p.append(outLink(t.source_url, "Source guide"));
        li.append(p);
      }
      const form = el("form", "link-form");
      const terms = input("text", (t.match_terms || []).join(", "), "Match words, separated by commas", { max: 200 });
      const save = el("button", "button small quiet", "Save words");
      save.type = "submit";
      form.append(terms, save);
      form.addEventListener("submit", (e) => { e.preventDefault(); saveSpecialty(t, { match_terms: words(terms.value) }); });
      li.append(form);
      const row = el("div", "button-row");
      if (t.status !== "approved") row.append(button("Approve", "button small", () => saveSpecialty(t, { status: "approved", match_terms: words(terms.value) })));
      if (t.status !== "hidden") row.append(button("Hide", "button small quiet", () => saveSpecialty(t, { status: "hidden" })));
      if (t.status !== "pending") row.append(button("Back to review", "button small quiet", () => saveSpecialty(t, { status: "pending" })));
      li.append(row);
      ul.append(li);
    }
    if (!ul.childElementCount) ul.append(el("li", "muted", "None yet. The starter list suggests some, or add one below."));
    c.append(ul);

    const form = el("form", "trip-form");
    const name = input("text", "", "Dish, e.g. Italian beef", { max: 100 });
    const desc = input("text", "", "One short sentence about it", { max: 280 });
    const terms = input("text", "", "Match words, separated by commas", { max: 200 });
    const add = el("button", "button small", "Add specialty");
    add.type = "submit";
    form.append(name, desc, terms, add);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!name.value.trim()) return say("A name is needed.", true);
      say("Adding…");
      const res = await api("trip_save_specialty", {
        cityId: trip.data.city.id, fields: { name: name.value, description: desc.value, match_terms: words(terms.value) },
      }, "Couldn't add it");
      if (!res) return;
      say(name.value.trim() + " added for review.");
      await reload();
    });
    c.append(form);
    return c;
  }

  function words(text) {
    return String(text || "").split(",").map((w) => w.trim()).filter(Boolean).slice(0, 5);
  }

  async function saveSpecialty(t, fields) {
    say("Saving…");
    const res = await api("trip_save_specialty", { specialtyId: t.id, fields }, "Couldn't save");
    if (!res) return;
    say(t.name + " saved.");
    await reload();
  }

  window.MQTrips = Object.freeze({ open });
})();
