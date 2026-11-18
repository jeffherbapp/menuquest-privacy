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
        return show("panel");
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

  // The email link signs in through the URL (route() waits for that); tidy it away once read.
  db.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" && location.hash.includes("access_token")) {
      history.replaceState(null, "", location.pathname);
    }
  });

  route();
})();
