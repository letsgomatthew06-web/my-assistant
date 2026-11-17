// My Assistant — a private, free personal AI that lives on your device.
// Engines: Google Gemini (free API key, called straight from this device) or WebLLM (runs on-device).

const $ = (s) => document.querySelector(s);
const KEY = "my-assistant-v1";
const WEBLLM_URL = "https://esm.run/@mlc-ai/web-llm@0.2.89";
const GEMINI = "https://generativelanguage.googleapis.com/v1beta";
const PREFERRED = [
  "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash",
  "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-2.5-flash-lite",
];

/* ---------- storage (falls back to memory if the browser blocks it) ---------- */
let persistent = true;
const mem = {};
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { persistent = false; return mem[k] ?? null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { persistent = false; mem[k] = v; } },
  del(k) { try { localStorage.removeItem(k); } catch { delete mem[k]; } },
};

const defaults = () => ({
  settings: { name: "Assistant", user: "", style: "friendly", engine: "gemini", key: "", model: "auto", localModel: "Llama-3.2-1B-Instruct-q4f32_1-MLC", pinHash: "", models: [] },
  about: "",
  memories: [],
  chats: [],
  current: null,
});
let S = load();
function load() {
  try { const d = JSON.parse(store.get(KEY)); if (d && d.settings) return { ...defaults(), ...d, settings: { ...defaults().settings, ...d.settings } }; } catch {}
  return defaults();
}
function save() { store.set(KEY, JSON.stringify(S)); }

/* ---------- helpers ---------- */
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
async function sha(t) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ma:" + t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600); }
function esc(s) { return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

let md = null;
(async () => {
  try {
    const [{ marked }, purify] = await Promise.all([
      import("https://cdn.jsdelivr.net/npm/marked@15/lib/marked.esm.js"),
      import("https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.es.mjs"),
    ]);
    marked.setOptions({ breaks: true, gfm: true });
    md = (t) => purify.default.sanitize(marked.parse(t), { ADD_ATTR: ["target"] });
    renderThread();
  } catch { /* plain text fallback */ }
})();
const renderMd = (t) => (md ? md(t) : "<p>" + esc(t).replace(/\n/g, "<br>") + "</p>");

/* ---------- lock ---------- */
async function boot() {
  if (S.settings.pinHash) {
    $("#lock").hidden = false;
    $("#lock-input").focus();
  } else openApp();
}
$("#lock-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const v = $("#lock-input").value;
  if ((await sha(v)) === S.settings.pinHash) { $("#lock-input").value = ""; $("#lock-error").textContent = ""; $("#lock").hidden = true; openApp(); }
  else { $("#lock-error").textContent = "That passcode doesn't match."; $("#lock-input").select(); }
});
$("#lock-now").addEventListener("click", () => {
  if (!S.settings.pinHash) { toast("Set a passcode in Settings to use the lock."); openSettings(); return; }
  $("#app").hidden = true; $("#lock").hidden = false; $("#lock-input").focus();
});

function openApp() {
  $("#app").hidden = false;
  if (!S.current || !S.chats.find((c) => c.id === S.current)) S.current = S.chats[0]?.id || null;
  refreshChrome(); renderList(); renderThread();
  if (!persistent) $("#fine").textContent = "This browser blocks saving, so chats clear when you close it.";
}

/* ---------- chrome ---------- */
function engineReady() { return S.settings.engine === "local" || !!S.settings.key; }
function refreshChrome() {
  $("#brand-name").textContent = S.settings.name || "Assistant";
  document.title = S.settings.name || "My Assistant";
  const pill = $("#engine-pill");
  if (S.settings.engine === "local") { pill.textContent = "On-device"; pill.className = "engine-pill ok"; }
  else if (S.settings.key) { pill.textContent = "Gemini"; pill.className = "engine-pill ok"; }
  else { pill.textContent = "Not set up"; pill.className = "engine-pill"; }
  const c = curChat();
  $("#chat-title").textContent = c ? c.title : "New chat";
  $("#input").placeholder = `Message ${S.settings.name || "your assistant"}…`;
}
const curChat = () => S.chats.find((c) => c.id === S.current);

function renderList() {
  const list = $("#chat-list");
  list.innerHTML = "";
  if (!S.chats.length) { list.innerHTML = `<p class="help" style="padding:0 10px">Your chats will show up here.</p>`; return; }
  const lbl = document.createElement("div"); lbl.className = "list-label"; lbl.textContent = "Recent"; list.append(lbl);
  for (const c of S.chats) {
    const row = document.createElement("div");
    row.className = "chat-item" + (c.id === S.current ? " active" : "");
    row.innerHTML = `<button class="open" data-testid="link-chat-${c.id}">${esc(c.title)}</button><button class="icon-btn del" aria-label="Delete chat" data-testid="button-delete-chat-${c.id}"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>`;
    row.querySelector(".open").onclick = () => { S.current = c.id; save(); closeDrawer(); refreshChrome(); renderList(); renderThread(); };
    row.querySelector(".del").onclick = () => {
      S.chats = S.chats.filter((x) => x.id !== c.id);
      if (S.current === c.id) S.current = S.chats[0]?.id || null;
      save(); refreshChrome(); renderList(); renderThread(); toast("Chat deleted");
    };
    list.append(row);
  }
}

const SUGGEST = [
  "Plan my day around 3 things I need to get done",
  "Help me write a quick, friendly email",
  "Explain something to me like I'm new to it",
  "Give me a few dinner ideas with what I have",
];
function renderThread() {
  const th = $("#thread");
  const c = curChat();
  th.innerHTML = "";
  if (!c || !c.messages.length) {
    const w = document.createElement("div"); w.className = "welcome";
    const hi = S.settings.user ? `Hi ${esc(S.settings.user)}.` : "Hi there.";
    if (!engineReady()) {
      w.innerHTML = `<h2>${hi}<br>Let's get your assistant running.</h2>
      <p>It's free. Pick how it thinks — you can switch anytime.</p>
      <div class="setup-card">
        <h3>Recommended: free Gemini key</h3>
        <ol><li>Open <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a> and sign in with Google.</li><li>Tap "Create API key" and copy it.</li><li>Paste it in Settings.</li></ol>
        <div class="row"><button class="btn primary" id="go-key" data-testid="button-setup-key">Paste my key</button><button class="btn ghost" id="go-local" data-testid="button-setup-local">Run on my phone</button></div>
      </div>`;
      th.append(w);
      $("#go-key").onclick = () => openSettings("gemini");
      $("#go-local").onclick = () => openSettings("local");
      return;
    }
    w.innerHTML = `<h2>${hi}<br>What can I help with?</h2><p>I remember what you tell me, and everything stays on this device.</p><div class="suggest"></div>`;
    const g = w.querySelector(".suggest");
    SUGGEST.forEach((s, i) => { const b = document.createElement("button"); b.textContent = s; b.dataset.testid = "button-suggest-" + i; b.onclick = () => { $("#input").value = s; autosize(); $("#input").focus(); }; g.append(b); });
    th.append(w);
    return;
  }
  c.messages.forEach((m, i) => th.append(msgEl(m, i === c.messages.length - 1)));
  th.scrollTop = th.scrollHeight;
}
function msgEl(m, last) {
  const d = document.createElement("div");
  d.className = "msg " + (m.role === "user" ? "user" : "ai");
  const b = document.createElement("div"); b.className = "bubble";
  if (m.role === "user") b.textContent = m.content;
  else {
    b.innerHTML = renderMd(m.content);
    b.querySelectorAll("a").forEach((a) => { a.target = "_blank"; a.rel = "noopener"; });
    if (m.saved?.length) { const n = document.createElement("div"); n.className = "mem-note"; n.innerHTML = `<svg viewBox="0 0 24 24"><path d="M5 12l4 4 10-10"/></svg>Saved to memory: ${esc(m.saved.join("; "))}`; b.append(n); }
    const tools = document.createElement("div"); tools.className = "msg-tools";
    const cp = document.createElement("button"); cp.textContent = "Copy"; cp.onclick = async () => { try { await navigator.clipboard.writeText(m.content); toast("Copied"); } catch { toast("Couldn't copy on this browser"); } };
    tools.append(cp);
    if (last) { const rg = document.createElement("button"); rg.textContent = "Try again"; rg.dataset.testid = "button-regenerate"; rg.onclick = regenerate; tools.append(rg); }
    b.append(tools);
  }
  d.append(b); return d;
}

/* ---------- drawer ---------- */
const openDrawer = () => $("#app").classList.add("drawer-open");
const closeDrawer = () => $("#app").classList.remove("drawer-open");
$("#open-drawer").onclick = openDrawer;
$("#close-drawer").onclick = closeDrawer;
$("#scrim").onclick = closeDrawer;
$("#new-chat").onclick = () => { S.current = null; save(); closeDrawer(); refreshChrome(); renderList(); renderThread(); $("#input").focus(); };

/* ---------- composer ---------- */
const input = $("#input");
function autosize() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 180) + "px"; }
input.addEventListener("input", autosize);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && window.matchMedia("(hover: hover)").matches) { e.preventDefault(); $("#composer").requestSubmit(); }
});
let busy = false, abort = null;
$("#composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) { abort?.abort(); return; }
  const text = input.value.trim();
  if (!text) return;
  if (!engineReady()) { openSettings("gemini"); return; }
  let c = curChat();
  if (!c) { c = { id: uid(), title: text.slice(0, 48), messages: [] }; S.chats.unshift(c); S.current = c.id; }
  else { S.chats = [c, ...S.chats.filter((x) => x.id !== c.id)]; }
  c.messages.push({ role: "user", content: text });
  input.value = ""; autosize(); save(); refreshChrome(); renderList(); renderThread();
  await respond(c);
});
async function regenerate() {
  const c = curChat(); if (!c || busy) return;
  if (c.messages.at(-1)?.role === "assistant") c.messages.pop();
  save(); renderThread(); await respond(c);
}

function setBusy(v) {
  busy = v;
  const s = $("#send");
  s.classList.toggle("stop", v);
  s.setAttribute("aria-label", v ? "Stop" : "Send");
  s.innerHTML = v ? `<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>` : `<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
}

/* ---------- prompt ---------- */
const STYLE = {
  friendly: "Be warm, friendly, and concise. Use plain language.",
  direct: "Be brief and direct. Lead with the answer. No filler.",
  detailed: "Be thorough and well organized, with clear steps or sections when helpful.",
  coach: "Be encouraging and practical, like a supportive coach. Offer a clear next step.",
};
function systemPrompt() {
  const s = S.settings;
  const now = new Date().toLocaleString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  let p = `You are ${s.name || "Assistant"}, a private personal assistant for one person${s.user ? `, ${s.user}` : ""}. ${STYLE[s.style] || STYLE.friendly}
Current date and time: ${now}.
You help with planning, writing, ideas, explanations, decisions, reminders-to-self, and everyday questions. Format with short paragraphs and Markdown lists when useful. If you don't know something or it may be outdated, say so honestly.
MEMORY: When the user asks you to remember something, or shares a lasting personal fact or preference they'd clearly want you to keep, add one line at the very end of your reply in exactly this form: [[remember: short fact in third person]]. Use one line per fact. Never mention this tag.`;
  if (S.about.trim()) p += `\n\nAbout the user (written by them):\n${S.about.trim()}`;
  if (S.memories.length) p += `\n\nThings you've remembered about the user:\n${S.memories.map((m) => "- " + m.text).join("\n")}`;
  return p;
}
function stripTags(t) {
  const saved = [];
  let out = t.replace(/\[\[remember:\s*([^\]]+?)\]\]/gi, (_, f) => { saved.push(f.trim()); return ""; });
  const open = out.lastIndexOf("[[");
  if (open !== -1 && out.indexOf("]]", open) === -1) out = out.slice(0, open);
  return { text: out.trim(), saved };
}

/* ---------- respond ---------- */
async function respond(c) {
  setBusy(true);
  abort = new AbortController();
  const th = $("#thread");
  const row = document.createElement("div"); row.className = "msg ai";
  const b = document.createElement("div"); b.className = "bubble";
  b.innerHTML = `<span class="typing"><i></i><i></i><i></i></span>`;
  row.append(b); th.append(row); th.scrollTop = th.scrollHeight;
  let raw = "";
  const onText = (chunk) => {
    raw += chunk;
    b.innerHTML = renderMd(stripTags(raw).text || "…");
    const near = th.scrollHeight - th.scrollTop - th.clientHeight < 140;
    if (near) th.scrollTop = th.scrollHeight;
  };
  try {
    const history = c.messages.slice(-30);
    if (S.settings.engine === "local") await runLocal(history, onText, b, abort.signal);
    else await runGemini(history, onText, abort.signal);
    finish();
  } catch (err) {
    if (err.name === "AbortError") { finish(true); }
    else { row.remove(); showError(err); }
  } finally { setBusy(false); abort = null; }

  function finish(stopped) {
    const { text, saved } = stripTags(raw);
    if (!text && !saved.length) { row.remove(); if (!stopped) showError(new Error("The AI sent back an empty reply. Try again.")); return; }
    for (const f of saved) if (!S.memories.some((m) => m.text.toLowerCase() === f.toLowerCase())) S.memories.push({ id: uid(), text: f });
    c.messages.push({ role: "assistant", content: text || "(saved to memory)", saved: saved.length ? saved : undefined });
    if (c.messages.length === 2 && c.title.length >= 48) c.title = c.title.trim() + "…";
    save(); renderThread();
  }
}
function showError(err) {
  const th = $("#thread");
  const d = document.createElement("div"); d.className = "msg ai";
  d.innerHTML = `<div class="bubble"><div class="err-bubble" data-testid="text-error">${esc(err.message || String(err))}</div></div>`;
  th.append(d); th.scrollTop = th.scrollHeight;
}

/* ---------- Gemini ---------- */
function modelOrder() {
  const s = S.settings;
  if (s.model && s.model !== "auto") return [s.model];
  const avail = s.models || [];
  if (!avail.length) return PREFERRED;
  const ordered = PREFERRED.filter((m) => avail.includes(m));
  const extra = avail.filter((m) => /flash/.test(m) && !/image|tts|live|audio|embed|preview|exp/.test(m) && !ordered.includes(m));
  return [...ordered, ...extra].length ? [...ordered, ...extra] : PREFERRED;
}
async function runGemini(history, onText, signal) {
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt() }] },
    contents: history.map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.content }] })),
    generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
  };
  let lastErr;
  for (const model of modelOrder()) {
    const res = await fetch(`${GEMINI}/models/${model}:streamGenerateContent?alt=sse`, {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": S.settings.key },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let msg = ""; try { msg = (await res.json()).error?.message || ""; } catch {}
      if (res.status === 400 && /api key/i.test(msg)) throw new Error("Your Gemini key wasn't accepted. Double-check it in Settings.");
      if (res.status === 403) throw new Error("Google rejected this key (403). Make sure the Generative Language API is enabled for it in Google AI Studio.");
      lastErr = res.status === 429 ? new Error("You've hit today's free Gemini limit on every available model. It resets daily, or switch to \"On my phone\" in Settings.") : new Error(`Gemini error ${res.status}: ${msg || "unknown"}`);
      if ([404, 429, 500, 503].includes(res.status)) continue;
      throw lastErr;
    }
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ""; let got = false;
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        try {
          const j = JSON.parse(line.slice(5));
          const parts = j.candidates?.[0]?.content?.parts || [];
          for (const p of parts) if (p.text && !p.thought) { got = true; onText(p.text); }
        } catch {}
      }
    }
    if (got) return;
    lastErr = new Error("Gemini returned no text. Try again.");
  }
  throw lastErr || new Error("No Gemini model was available.");
}
async function listModels(key) {
  const res = await fetch(`${GEMINI}/models?pageSize=200`, { headers: { "x-goog-api-key": key } });
  if (!res.ok) { let m = ""; try { m = (await res.json()).error?.message || ""; } catch {} throw new Error(m || `Error ${res.status}`); }
  const j = await res.json();
  return (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent")).map((m) => m.name.replace(/^models\//, ""));
}

/* ---------- On-device (WebLLM) ---------- */
let engine = null, engineModel = null, webllm = null;
async function runLocal(history, onText, bubble, signal) {
  if (!navigator.gpu) throw new Error("This browser can't run AI on-device (no WebGPU). Use the free Gemini key instead, or try the latest Chrome.");
  const model = S.settings.localModel;
  if (!engine || engineModel !== model) {
    bubble.innerHTML = `<div class="help" data-testid="text-load-progress">Loading the on-device model… first time can take a few minutes.</div><div class="progress"><span></span></div>`;
    const bar = bubble.querySelector(".progress span"); const lab = bubble.querySelector(".help");
    webllm = webllm || (await import(WEBLLM_URL));
    if (engine) { try { await engine.unload(); } catch {} }
    engine = await webllm.CreateMLCEngine(model, {
      initProgressCallback: (p) => { bar.style.width = Math.round((p.progress || 0) * 100) + "%"; lab.textContent = p.text?.split(".")[0] || "Loading…"; },
    });
    engineModel = model;
    bubble.innerHTML = `<span class="typing"><i></i><i></i><i></i></span>`;
  }
  const messages = [{ role: "system", content: systemPrompt() }, ...history.slice(-12).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content }))];
  const stream = await engine.chat.completions.create({ messages, stream: true, temperature: 0.7, max_tokens: 1024 });
  for await (const ch of stream) {
    if (signal.aborted) { try { engine.interruptGenerate(); } catch {} const e = new Error("stopped"); e.name = "AbortError"; throw e; }
    const t = ch.choices?.[0]?.delta?.content; if (t) onText(t);
  }
}

/* ---------- settings ---------- */
const dlg = $("#settings");
function setEngineUI(v) {
  document.querySelectorAll('input[name="engine"]').forEach((r) => (r.checked = r.value === v));
  $("#gemini-box").hidden = v !== "gemini"; $("#local-box").hidden = v !== "local";
  if (v === "local") $("#gpu-status").textContent = navigator.gpu ? "Good news: this browser supports on-device AI." : "This browser doesn't support on-device AI (WebGPU). The Gemini option will work instead.";
}
function fillModels() {
  const sel = $("#s-model"); const cur = S.settings.model;
  sel.innerHTML = `<option value="auto">Auto (best free model, falls back if limit hit)</option>`;
  const list = (S.settings.models || []).length ? modelOrder().filter((m) => S.settings.models.includes(m)) : PREFERRED;
  for (const m of list) { const o = document.createElement("option"); o.value = m; o.textContent = m; sel.append(o); }
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : "auto";
}
function openSettings(engineChoice) {
  const s = S.settings;
  $("#s-name").value = s.name; $("#s-user").value = s.user; $("#s-style").value = s.style;
  $("#s-key").value = s.key; $("#s-local").value = s.localModel; $("#s-pin").value = "";
  $("#s-pin").placeholder = s.pinHash ? "Passcode set — type a new one to change" : "Leave blank for none";
  $("#key-status").textContent = "";
  fillModels(); setEngineUI(engineChoice || s.engine);
  closeDrawer(); dlg.showModal();
  if (engineChoice === "gemini") setTimeout(() => $("#s-key").focus(), 50);
}
$("#open-settings").onclick = () => openSettings();
document.querySelectorAll('input[name="engine"]').forEach((r) => r.addEventListener("change", () => setEngineUI(r.value)));
$("#test-key").onclick = async () => {
  const k = $("#s-key").value.trim(); const st = $("#key-status");
  if (!k) { st.textContent = "Paste your key first."; return; }
  st.textContent = "Checking…";
  try { S.settings.models = await listModels(k); fillModels(); st.textContent = `Key works. ${modelOrder().length} free-eligible models found.`; }
  catch (e) { st.textContent = "That key didn't work: " + e.message; }
};
$("#save-settings").addEventListener("click", async (e) => {
  e.preventDefault();
  const s = S.settings;
  s.name = $("#s-name").value.trim() || "Assistant";
  s.user = $("#s-user").value.trim();
  s.style = $("#s-style").value;
  s.engine = document.querySelector('input[name="engine"]:checked').value;
  const newKey = $("#s-key").value.trim();
  if (newKey !== s.key) { s.key = newKey; s.models = []; if (newKey) listModels(newKey).then((m) => { s.models = m; save(); }).catch(() => {}); }
  s.model = $("#s-model").value; s.localModel = $("#s-local").value;
  const pin = $("#s-pin").value;
  if (pin) s.pinHash = await sha(pin);
  save(); dlg.close(); refreshChrome(); renderThread();
  toast(pin ? "Saved. Passcode set." : "Saved");
});
$("#export").onclick = () => {
  const data = JSON.stringify({ ...S, settings: { ...S.settings, key: "" } }, null, 2);
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
  a.download = `assistant-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  toast("Backup downloaded (your key isn't included)");
};
$("#import").onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { const d = JSON.parse(await f.text()); if (!d.settings) throw 0; const key = S.settings.key; S = { ...defaults(), ...d, settings: { ...defaults().settings, ...d.settings, key: d.settings.key || key } }; save(); dlg.close(); openApp(); toast("Backup restored"); }
  catch { toast("That file isn't a valid backup."); }
  e.target.value = "";
};
let wipeArmed = false;
$("#wipe").onclick = () => {
  if (!wipeArmed) { wipeArmed = true; $("#wipe").textContent = "Tap again to erase all chats, memories and key"; setTimeout(() => { wipeArmed = false; $("#wipe").textContent = "Erase everything"; }, 4000); return; }
  store.del(KEY); S = defaults(); save(); dlg.close(); openApp(); toast("Everything erased");
};

/* ---------- memory ---------- */
const mdlg = $("#memory");
function renderMem() {
  const ul = $("#mem-list"); ul.innerHTML = "";
  if (!S.memories.length) { ul.innerHTML = `<li class="empty">Nothing saved yet.</li>`; return; }
  for (const m of S.memories) {
    const li = document.createElement("li");
    li.innerHTML = `<span>${esc(m.text)}</span><button type="button" class="icon-btn" aria-label="Forget this"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
    li.querySelector("button").onclick = () => { S.memories = S.memories.filter((x) => x.id !== m.id); save(); renderMem(); };
    ul.append(li);
  }
}
$("#open-memory").onclick = () => { $("#m-about").value = S.about; renderMem(); closeDrawer(); mdlg.showModal(); };
$("#m-add").onclick = () => { const v = $("#m-new").value.trim(); if (!v) return; S.memories.push({ id: uid(), text: v }); $("#m-new").value = ""; save(); renderMem(); };
$("#m-new").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#m-add").click(); } });
$("#save-memory").addEventListener("click", (e) => { e.preventDefault(); S.about = $("#m-about").value; save(); mdlg.close(); toast("Saved"); });
[dlg, mdlg].forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));

if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
boot();
