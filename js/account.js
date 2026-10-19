// Reselling HQ accounts: sign in (email link, code or password), your settings and reports in Supabase,
// download my data, delete my account. The database rules make sure you only ever see your own rows.
(() => {
const $ = s => document.querySelector(s);
const LOCAL_KEYS = ["rhq-settings", "rhq-pw", "rhq-data/users/me", "rhq-setup"];
let client = null, user = null, state = "loading", resolveReady;
const ready = new Promise(r => { resolveReady = r; });

/* ---------- the sign-in screen ---------- */
function gate(to, msg) {
  state = to;
  $("#gate").hidden = state === "in";
  document.querySelector(".shell").hidden = state !== "in";
  for (const el of document.querySelectorAll("#gate [data-state]")) el.hidden = !el.dataset.state.split(" ").includes(state);
  setMsg(msg || "");
}
function setMsg(t, err) { const el = $("#gateMsg"); el.textContent = t; el.classList.toggle("err", !!err); }
function busy(btn, on, label) { btn.disabled = on; if (label) btn.textContent = label; }
const emailOf = () => $("#gEmail").value.trim().toLowerCase();

function friendly(e) {
  const m = String((e && (e.message || e.msg)) || "");
  if (/private for now|hook|not allowed|signups not allowed/i.test(m)) return "Reselling HQ is private for now, so this email can't sign in.";
  if (/invalid login|invalid credentials/i.test(m)) return "That email and password don't match. Try again, or use an email link instead.";
  if (/expired|invalid.*(otp|token)|token.*(invalid|expired)/i.test(m)) return "That code didn't work or has expired. Ask for a new email and use the newest code.";
  if (/rate limit|too many|security purposes/i.test(m)) return "Too many sign-in emails just now. Wait a few minutes and try again.";
  if (/email not confirmed/i.test(m)) return "Open the link in the email we sent first, then try again.";
  if (/fetch|network/i.test(m)) return "Couldn't reach the sign-in service. Check your connection and try again.";
  return "Sign-in didn't work" + (m ? " (" + m.slice(0, 120) + ")" : "") + ". Try again.";
}

$("#gLinkForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (state === "pw") return $("#gPw").focus(); // Enter in the email box on the password screen
  const email = emailOf(), btn = $("#gLinkBtn");
  if (!/^\S+@\S+\.\S+$/.test(email)) return setMsg("Type the email address you use for Reselling HQ.", true);
  busy(btn, true, "Sending…");
  const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + "/" } });
  busy(btn, false, "Email me a sign-in link");
  if (error) return setMsg(friendly(error), true);
  $("#gSentTo").textContent = email;
  gate("sent");
});
$("#gCodeForm").addEventListener("submit", async e => {
  e.preventDefault();
  const token = $("#gCode").value.replace(/\D/g, ""), btn = $("#gCodeBtn");
  if (token.length < 6) return setMsg("Type the code from the email (numbers only).", true);
  busy(btn, true, "Checking…");
  const { error } = await client.auth.verifyOtp({ email: emailOf(), token, type: "email" });
  busy(btn, false, "Sign in with code");
  if (error) setMsg(friendly(error), true);
});
$("#gPwForm").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = $("#gPwBtn");
  busy(btn, true, "Signing in…");
  const { error } = await client.auth.signInWithPassword({ email: emailOf(), password: $("#gPw").value });
  busy(btn, false, "Sign in");
  if (error) setMsg(friendly(error), true);
});
$("#gUsePw").addEventListener("click", () => { gate("pw"); $("#gPw").focus(); });
$("#gUseLink").addEventListener("click", () => gate("out"));
$("#gBack").addEventListener("click", () => gate("out"));

/* ---------- start up ---------- */
async function start() {
  gate("loading", "Checking you're signed in…");
  let cfg;
  try {
    const r = await fetch("/api/config");
    cfg = await r.json();
    if (!r.ok) throw cfg;
  } catch (e) {
    const notSetUp = e && e.error && e.error.code === "not_set_up";
    return gate("broken", notSetUp
      ? "Sign-in isn't set up on this website yet: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are missing in Vercel for this deployment."
      : "Couldn't reach Reselling HQ. Check your connection, then reload the page.");
  }
  if (!window.supabase) return gate("broken", "Couldn't load the sign-in screen. Reload the page.");
  client = window.supabase.createClient(cfg.supabaseUrl, cfg.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  // An email link that has expired comes back with the reason in the address.
  const hashErr = new URLSearchParams(location.hash.slice(1)).get("error_description");
  client.auth.onAuthStateChange((event, session) => {
    // Supabase asks us not to wait on its own calls inside this handler, so hand off.
    setTimeout(() => signedIn(session && session.user), 0);
  });
  const { data } = await client.auth.getSession();
  if (!data.session) gate("out", hashErr ? friendly({ message: hashErr }) : "");
}

let started = false;
async function signedIn(u) {
  if (!u) { user = null; if (started) location.reload(); return; } // signed out on another tab or the session ended
  if (user && user.id === u.id) { user = u; return; }
  user = u; started = true;
  if (/access_token|error_description/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search);
  $("#accEmail").textContent = u.email;
  let settings = {};
  try {
    const { data, error } = await client.from("settings").select("data").maybeSingle();
    if (error) throw error;
    settings = (data && data.data) || {};
  } catch {
    settings = null; // app.js says it couldn't load them
  }
  gate("in");
  resolveReady({ user: u, settings });
  if (settings) offerMove(settings); // never offer while the account's own settings couldn't be read
}

/* ---------- your data in the account ---------- */
async function token() {
  if (!client) return "";
  const { data } = await client.auth.getSession();
  return (data.session && data.session.access_token) || "";
}
async function saveSettings(data) {
  const { error } = await client.from("settings").upsert({ user_id: user.id, data, updated_at: new Date().toISOString() });
  if (error) throw error;
}
// Past reports, with the same shape the screens already use.
const reports = {
  orderBy() { return reports; },
  limit(n) { return { async get() {
    const { data, error } = await client.from("reports").select("data").order("ts", { ascending: false }).limit(n);
    if (error) throw error;
    return { docs: data.map(r => ({ data: () => r.data })) };
  } }; },
  doc: id => ({ async set(obj) {
    const { error } = await client.from("reports").upsert({ id, user_id: user.id, ts: obj.ts || Date.now(), data: obj });
    if (error) throw error;
  } }),
};

/* ---------- moving this device's old data into the account ---------- */
function localData() {
  const read = k => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
  const settings = read("rhq-settings"), setup = read("rhq-setup"), hist = read("rhq-data/users/me") || {};
  const list = Object.entries(hist).filter(([, r]) => r && r.kind === "report");
  return { settings, setup, list };
}
function clearLocal() { for (const k of LOCAL_KEYS) try { localStorage.removeItem(k); } catch {} }
function offerMove(accountSettings) {
  const { settings, list } = localData();
  if (!settings && !list.length) { clearLocal(); return; }
  const what = [settings ? "your settings" : "", list.length ? list.length + " past report" + (list.length > 1 ? "s" : "") : ""].filter(Boolean).join(" and ");
  $("#moveWhat").textContent = what;
  $("#moveCard").hidden = false;
  $("#moveNo").onclick = () => { $("#moveCard").hidden = true; };
  $("#moveYes").onclick = async () => {
    const btn = $("#moveYes"); busy(btn, true, "Moving…");
    try {
      const local = localData();
      if (local.settings || local.setup) {
        // Keep anything already saved in the account; fill the gaps from this device.
        const merged = { ...(local.settings || {}), ...(accountSettings || {}) };
        merged.setup = { ...(local.setup || {}), ...((accountSettings && accountSettings.setup) || {}) };
        await saveSettings(merged);
      }
      for (const [id, r] of local.list) await reports.doc(id).set(r);
      clearLocal();
      $("#moveCard").hidden = true;
      location.reload();
    } catch {
      busy(btn, false, "Move them into my account");
      $("#moveMsg").textContent = "Couldn't move them just now. Nothing was lost; try again in a moment.";
    }
  };
}

/* ---------- settings: account section ---------- */
$("#accSignOut").addEventListener("click", async () => { await client.auth.signOut(); location.reload(); });
$("#accPwForm").addEventListener("submit", async e => {
  e.preventDefault();
  const pw = $("#accPw").value, msg = $("#accPwMsg");
  if (pw.length < 8) { msg.textContent = "Use at least 8 characters."; return; }
  const { error } = await client.auth.updateUser({ password: pw });
  msg.textContent = error ? "Couldn't set it: " + String(error.message || "").slice(0, 120) : "Password set. You can now sign in with it on any device.";
  if (!error) $("#accPw").value = "";
});
$("#accDownload").addEventListener("click", async () => {
  const msg = $("#accMsg");
  try {
    const [p, s, r] = await Promise.all([
      client.from("profiles").select("*").maybeSingle(),
      client.from("settings").select("*").maybeSingle(),
      client.from("reports").select("*").order("ts", { ascending: false }),
    ]);
    for (const x of [p, s, r]) if (x.error) throw x.error;
    const file = { app: "Reselling HQ", exported: new Date().toISOString(), account: { id: user.id, email: user.email }, profile: p.data, settings: s.data, reports: r.data };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
    a.download = "reselling-hq-my-data-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.append(a); a.click(); a.remove();
    msg.textContent = "Downloaded.";
  } catch {
    msg.textContent = "Couldn't download your data just now. Try again in a moment.";
  }
});
$("#accDelete").addEventListener("click", async () => {
  const msg = $("#accMsg");
  const typed = prompt("This deletes your Reselling HQ account, settings and every saved report, for good. It can't be undone.\n\nType DELETE to confirm.");
  if (typed === null) return;
  if (typed.trim().toUpperCase() !== "DELETE") { msg.textContent = "Not deleted: you need to type DELETE."; return; }
  msg.textContent = "Deleting…";
  try {
    const r = await fetch("/api/account", { method: "DELETE", headers: { authorization: "Bearer " + (await token()) } });
    if (!r.ok) throw r;
  } catch {
    msg.textContent = "Couldn't delete your account just now. Nothing was deleted; try again in a moment.";
    return;
  }
  clearLocal();
  started = false;
  await client.auth.signOut({ scope: "local" }).catch(() => {});
  gate("out", "Your account and all its data have been deleted.");
});

window.RHQAccount = { ready, token, saveSettings, reports };
start().catch(() => gate("broken", "Couldn't start sign-in. Reload the page."));
})();
