// The admin panel's To research tab (R3). Pre-read places the Macs couldn't read, as an action
// list: why each one failed, what was tried, where to look, and what to do about it (a menu link,
// a menu file, the right website, or done without a menu). Every action is free: the Macs read.
// Every read and change goes through admin-api (sign-in, admin list, authenticator code, audit
// log), with the page's own helpers (window.MQAdmin, from admin.js). Text from the server is
// always set with textContent.
(() => {
  "use strict";

  const A = window.MQAdmin;
  if (!A) return;
  const { callApi, el, button, badge, outLink, num, when, route, show } = A;
  const $ = (id) => document.getElementById(id);

  const research = {
    loaded: false,
    data: null,
    area: "all",      // area id as text, or "all"
    reason: "todo",   // a reason, "todo" (everything to research) or "done"
    busy: new Set(),  // place ids with an action under way
  };

  // Most likely to pay off first (the server sorts the same way).
  const REASONS = [
    ["menu_unreadable", "Menu read, no dishes",
      "A menu page or file was found, but no dishes could be read from it. Look for a PDF or a photo of the menu on their site or socials, then paste the link or upload it."],
    ["not_found", "No menu on the site",
      "Their website has no menu page the reader could find. Look on the site and their socials for a menu page, PDF or photo."],
    ["blocked", "Site blocks readers",
      "Their website turns readers away, and we don't work around that. If the menu is somewhere else (a PDF on another site, a photo), paste or upload it. If not, mark it no menu online."],
    ["site_problem", "Website broken",
      "The website gave an error (a missing home page, a page too big). Check whether it moved: fix the website, or mark it closed."],
    ["other", "Other", "Check the website, then try again."],
    ["no_website", "No usable website",
      "Search for their own website or a menu. Fix the website if you find it; otherwise mark it closed or no menu online."],
  ];
  const REASON = Object.fromEntries(REASONS.map(([key, label, next]) => [key, { label, next }]));
  REASON.network = { label: "Network failure", next: "It failed on our side, not theirs. Retry it; nothing to research." };
  const OUTCOMES = [["closed", "Closed"], ["not_a_restaurant", "Not a restaurant"], ["no_menu_online", "No menu online"]];
  const OUTCOME = Object.fromEntries(OUTCOMES);
  const TRIED = { active: "found", failing: "read, no dishes" };
  const UPLOAD_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
  const MAX_UPLOAD = 10 * 1024 * 1024;

  function say(text, isError) {
    $("rs-status").className = "status" + (isError ? " err" : "");
    $("rs-status").textContent = text || "";
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
      say("Couldn't reach the server. Nothing changed.", true);
      return null;
    }
  }

  async function load(keepStatus) {
    research.loaded = true;
    if (!keepStatus) say("Loading…");
    const body = await api("research", {}, "Couldn't load the list");
    if (!body) return;
    research.data = body;
    if (!keepStatus) say("");
    render();
  }

  /** Opens the tab, optionally on one area (the Seed areas table's "To research" link). */
  function open(areaId) {
    if (areaId !== undefined) { research.area = String(areaId); research.reason = "todo"; }
    if (!research.loaded) load(false);
    else render();
  }

  const places = () => (research.data && research.data.places) || [];
  const inArea = (p) => research.area === "all" || String(p.area_id) === research.area;
  const toResearch = (p) => p.reason !== "done" && p.reason !== "network";

  function shown() {
    return places().filter(inArea).filter((p) =>
      research.reason === "todo" ? toResearch(p) : p.reason === research.reason);
  }

  function render() {
    renderControls();
    const list = shown();
    $("rs-items").replaceChildren(...list.map(placeCard));
    if (!list.length) {
      $("rs-items").append(el("p", "muted", research.reason === "done" ? "Nothing marked done yet." :
        research.reason === "todo" ? "Nothing left to research here." : "None."));
    }
  }

  function renderControls() {
    const all = places().filter(inArea);
    const count = (key) => all.filter((p) => key === "todo" ? toResearch(p) : p.reason === key).length;

    // Areas: every area with something on the list.
    const areas = new Map();
    for (const p of places()) if (p.area_id != null) areas.set(String(p.area_id), p.area || "Area " + p.area_id);
    const select = el("select");
    select.id = "rs-area";
    select.setAttribute("aria-label", "Area");
    select.append(new Option("All areas", "all"));
    for (const [id, label] of [...areas].sort((a, b) => a[1].localeCompare(b[1]))) select.append(new Option(label, id));
    select.value = areas.has(research.area) ? research.area : "all";
    research.area = select.value;
    select.addEventListener("change", () => { research.area = select.value; render(); });

    const head = el("div", "rs-head");
    head.append(select);
    const network = count("network");
    if (network > 0) {
      head.append(button("Retry " + num(network) + " network failure" + (network === 1 ? "" : "s"), "button small", retryNetwork));
    }
    head.append(button("Export CSV", "button small quiet", exportCsv), button("Refresh", "link-button inline", () => load(false)));

    const chips = el("div", "chips");
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", "Why it failed");
    const chip = (key, label) => {
      const n = count(key);
      const b = button(label + " " + num(n), "chip", () => { research.reason = key; render(); });
      b.setAttribute("aria-pressed", String(research.reason === key));
      return b;
    };
    chips.append(chip("todo", "To research"));
    for (const [key, label] of REASONS) if (count(key) > 0 || research.reason === key) chips.append(chip(key, label));
    chips.append(chip("done", "Done"));
    $("rs-controls").replaceChildren(head, chips);
  }

  function placeCard(p) {
    const card = el("section", "card rs-card");
    card.dataset.place = p.place_id;
    const head = el("div", "switch-head");
    head.append(el("strong", "rs-name", p.name));
    const r = REASON[p.reason];
    if (p.reason === "done") head.append(badge(OUTCOME[p.outcome] || "Done", "on"));
    else if (r) head.append(badge(r.label, "off"));
    if (p.website_mismatch) head.append(badge("Wrong website?", "off"));
    card.append(head);
    card.append(el("p", "muted", [p.category, p.town, p.area].filter(Boolean).join(" · ").replace(/_/g, " ")));

    if (p.reason === "done") {
      card.append(el("p", "muted", "Marked " + (OUTCOME[p.outcome] || p.outcome).toLowerCase() + " " + when(p.marked_at) +
        (p.note ? ": " + p.note : "")));
      const row = el("div", "button-row");
      row.append(button("Put back on the list", "button small quiet", () => act(p, "research_mark", { outcome: null }, "Back on the list.")));
      card.append(row);
      return card;
    }

    // Why it failed and what was tried.
    if (r) card.append(el("p", "rs-next", r.next));
    if (p.website_mismatch) {
      card.append(el("p", "rs-next", "None of the name is in its website" + (p.site_title ? " (“" + p.site_title + "”)" : "") +
        ": the place data may point at another business. Fix the website if so."));
    }
    const facts = el("p", "muted small-print");
    facts.textContent = "Last tried " + when(p.last_tried) + " · " + num(p.attempts) + " attempt" + (p.attempts === 1 ? "" : "s") +
      (p.last_error ? " · " + p.last_error : "") + (p.website_fixed ? " · website fixed by you" : "");
    card.append(facts);
    const tried = (p.tried || []).filter((t) => t.status !== "removed");
    if (tried.length) {
      const ul = el("ul", "rs-tried");
      for (const t of tried) {
        const li = el("li");
        li.append(outLink(t.url, shortUrl(t.url)), document.createTextNode(" · " + (t.format || "page") + ", " + (TRIED[t.status] || t.status)));
        ul.append(li);
      }
      card.append(el("p", "rs-label", "Tried"), ul);
    }

    // Where to look.
    const look = el("p", "rs-look");
    const q = [p.name, p.town, p.region].filter(Boolean).join(" ");
    look.append(el("span", "rs-label", "Look: "),
      outLink("https://www.google.com/search?q=" + encodeURIComponent(q + " menu"), "Google: menu"),
      document.createTextNode(" · "),
      outLink("https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q), "Google Maps"));
    if (p.website) look.append(document.createTextNode(" · "), outLink(p.website, "Website"));
    card.append(look);

    card.append(actions(p));
    return card;
  }

  function actions(p) {
    const box = el("div", "rs-actions");
    const disabled = research.busy.has(p.place_id);

    // A menu link: page, PDF or photo, anywhere.
    const form = el("form", "rs-link");
    const input = el("input");
    input.type = "url";
    input.placeholder = "Paste a menu link (page, PDF or photo)";
    input.setAttribute("aria-label", "Menu link for " + p.name);
    input.maxLength = 2000;
    const read = el("button", "button small", "Read it");
    read.type = "submit";
    form.append(input, read);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const url = input.value.trim();
      if (!/^https?:\/\//i.test(url)) { say("Paste a web address (http or https).", true); return; }
      act(p, "research_retry", { url }, "Queued: the Macs read it next.");
    });
    box.append(form);

    const row = el("div", "button-row");
    const file = el("input");
    file.type = "file";
    file.accept = UPLOAD_TYPES.join(",");
    file.hidden = true;
    file.addEventListener("change", () => { if (file.files && file.files[0]) upload(p, file.files[0]); file.value = ""; });
    row.append(file, button("Upload PDF or photo", "button small quiet", () => file.click()));
    row.append(button("Fix website", "button small quiet", () => {
      const v = window.prompt("The right website for " + p.name + ":", p.website || "https://");
      if (v === null) return;
      act(p, "research_set_website", { website: v.trim() }, "Website saved. The Macs look for its menu next.");
    }));
    if (["site_problem", "other", "network"].includes(p.reason)) {
      row.append(button("Retry", "button small quiet", () => act(p, "research_retry", {}, "Queued again.")));
    }
    const mark = el("select", "rs-mark");
    mark.setAttribute("aria-label", "Mark " + p.name + " done without a menu");
    mark.append(new Option("Done without a menu…", ""));
    for (const [key, label] of OUTCOMES) mark.append(new Option(label, key));
    mark.addEventListener("change", () => {
      const outcome = mark.value;
      if (!outcome) return;
      const note = window.prompt("A note for yourself (optional):", "");
      if (note === null) { mark.value = ""; return; }
      act(p, "research_mark", { outcome, note: note.trim() ? note.trim().slice(0, 300) : null }, "Marked " + OUTCOME[outcome].toLowerCase() + ".");
    });
    row.append(mark);
    box.append(row);
    if (disabled) for (const c of box.querySelectorAll("button, input, select")) c.disabled = true;
    return box;
  }

  /** One action on one place, then the list again (the place leaves it once queued or marked). */
  async function act(p, routeName, extra, okText) {
    if (research.busy.has(p.place_id)) return;
    research.busy.add(p.place_id);
    render();
    say("Saving…");
    const body = await api(routeName, { placeId: p.place_id, ...extra });
    research.busy.delete(p.place_id);
    if (body) {
      await load(true);
      say(p.name + ": " + okText);
    } else {
      render();
    }
  }

  /** A menu file: a one-time upload link from admin-api, the file straight to Storage, then read. */
  async function upload(p, f) {
    if (!UPLOAD_TYPES.includes(f.type)) { say("Upload a PDF or a photo (JPEG, PNG or WebP).", true); return; }
    if (f.size > MAX_UPLOAD) { say("Files can be up to 10 MB.", true); return; }
    research.busy.add(p.place_id);
    render();
    say("Uploading " + f.name + "…");
    const link = await api("research_upload", { placeId: p.place_id, contentType: f.type, bytes: f.size }, "Couldn't start the upload");
    let uploaded = false;
    if (link) {
      try {
        const res = await fetch(link.uploadUrl, { method: "PUT", headers: { "Content-Type": f.type, "x-upsert": "false" }, body: f });
        uploaded = res.ok;
        if (!res.ok) say("The upload didn't go through (" + res.status + "). Nothing was read.", true);
      } catch (e) {
        console.error(e);
        say("The upload didn't go through. Nothing was read.", true);
      }
    }
    research.busy.delete(p.place_id);
    if (uploaded) await act(p, "research_retry", { url: link.publicUrl }, "Uploaded. The Macs read it next.");
    else render();
  }

  async function retryNetwork() {
    say("Queuing…");
    const body = await api("retry_network_failures", research.area === "all" ? {} : { areaId: Number(research.area) });
    if (!body) return;
    await load(true);
    say(num(body.queued) + " queued again.");
  }

  function exportCsv() {
    const cols = ["name", "area", "town", "category", "reason", "website", "website_mismatch", "last_error", "attempts", "last_tried", "tried", "outcome", "note", "place_id"];
    const cell = (v) => {
      const s = v == null ? "" : String(v);
      // A leading =, +, - or @ would run as a formula in a spreadsheet.
      const safe = /^[=+\-@]/.test(s) ? "'" + s : s;
      return /[",\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
    };
    const rows = shown().map((p) => cols.map((c) =>
      cell(c === "reason" ? (REASON[p.reason] ? REASON[p.reason].label : p.reason)
        : c === "tried" ? (p.tried || []).map((t) => t.url).join(" ") : p[c])).join(","));
    const blob = new Blob([[cols.join(",")].concat(rows).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "menuquest-to-research.csv";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function shortUrl(url) {
    try {
      const u = new URL(url);
      const path = decodeURIComponent(u.pathname).replace(/\/$/, "");
      const s = u.hostname.replace(/^www\./, "") + path;
      return s.length > 70 ? s.slice(0, 67) + "…" : s;
    } catch (_) {
      return url;
    }
  }

  window.MQResearch = Object.freeze({ open });
})();
