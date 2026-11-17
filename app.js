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
  projects: [],
  active: "personal",
  tasks: [],
  drafts: [],
  sites: [],
  briefs: {},
  view: "today",
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
  if (!S.current || !S.chats.find((c) => c.id === S.current)) S.current = null;
  renderBizSelect(); renderNav(); show(S.view || "today");
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
  const titles = { today: "Today", tasks: "Tasks", drafts: "Drafts", sites: "Websites" };
  $("#chat-title").textContent = S.view === "chat" ? (c ? c.title : "New chat") : titles[S.view] || "";
  $("#input").placeholder = `Message ${S.settings.name || "your assistant"}…`;
}
const curChat = () => S.chats.find((c) => c.id === S.current);

function renderList() {
  const list = $("#chat-list");
  list.innerHTML = "";
  const chats = S.chats.filter((c) => (c.pid || "personal") === S.active);
  if (!chats.length) { list.innerHTML = `<p class="help" style="padding:0 10px">Your chats will show up here.</p>`; return; }
  const lbl = document.createElement("div"); lbl.className = "list-label"; lbl.textContent = "Recent"; list.append(lbl);
  for (const c of chats) {
    const row = document.createElement("div");
    row.className = "chat-item" + (c.id === S.current ? " active" : "");
    row.innerHTML = `<button class="open" data-testid="link-chat-${c.id}">${esc(c.title)}</button><button class="icon-btn del" aria-label="Delete chat" data-testid="button-delete-chat-${c.id}"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>`;
    row.querySelector(".open").onclick = () => { S.current = c.id; save(); closeDrawer(); show("chat"); };
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
const BIZ_SUGGEST = [
  "Find 5 types of local businesses that would buy this and how to reach them",
  "Draft a short cold email to a potential customer",
  "Write 3 social posts to announce what I offer",
  "Give me a 7-day plan to land my first customer",
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
    const bz = biz();
    w.innerHTML = `<h2>${hi}<br>${bz ? `What should we do for ${esc(bz.name)}?` : "What can I help with?"}</h2><p>I remember what you tell me, and everything stays on this device.</p><div class="suggest"></div>`;
    const g = w.querySelector(".suggest");
    (bz ? BIZ_SUGGEST : SUGGEST).forEach((s, i) => { const b = document.createElement("button"); b.textContent = s; b.dataset.testid = "button-suggest-" + i; b.onclick = () => { $("#input").value = s; autosize(); $("#input").focus(); }; g.append(b); });
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
    if (m.tasks?.length) { const n = document.createElement("div"); n.className = "inline-note"; n.innerHTML = `<svg viewBox="0 0 24 24"><path d="M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/></svg><span>Added ${m.tasks.length} task${m.tasks.length > 1 ? "s" : ""}. <button type="button">View tasks</button></span>`; n.querySelector("button").onclick = () => show("tasks"); b.append(n); }
    if (m.drafts?.length) for (const id of m.drafts) { const d = S.drafts.find((x) => x.id === id); if (!d) continue; const n = document.createElement("div"); n.className = "inline-note"; n.innerHTML = `<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4zM4 7l8 6 8-6"/></svg><span>Draft ready: ${esc(d.title)}. <button type="button">Review it</button></span>`; n.querySelector("button").onclick = () => show("drafts"); b.append(n); }
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
$("#new-chat").onclick = () => { S.current = null; save(); closeDrawer(); show("chat"); $("#input").focus(); };

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
  if (!c) { c = { id: uid(), title: text.slice(0, 48), messages: [], pid: S.active }; S.chats.unshift(c); S.current = c.id; }
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
You act like a hands-on assistant and AI employee: you don't just advise, you produce the actual work (plans, drafts, task lists). You can't send anything or browse the web yourself; the user approves and sends drafts.
SPECIAL TAGS (the app turns these into saved items; never mention or explain them):
- MEMORY: When the user asks you to remember something, or shares a lasting fact or preference, add on its own line: [[remember: short fact in third person]]
- TASKS: When you propose concrete to-dos the user should do, or they ask you to add a task, add one line per task: [[task: short action starting with a verb]]
- DRAFTS: When you write an email, social post, text message, or other message meant to be sent, put the final copy inside a draft block instead of in the normal reply:
[[draft: email | Short title]]
Subject: ...

Body...
[[/draft]]
Use kind email, post, message, or other. Then briefly tell the user it's in their Drafts for review.`;
  const bz = biz();
  if (bz) p += `\n\nThe user is working on their business. Business profile:\nName: ${bz.name}\nWhat it does: ${bz.idea || "-"}\nWho it's for: ${bz.who || "-"}\nOffer and price: ${bz.offer || "-"}\nCurrent goal: ${bz.goal || "-"}`;
  const open = curTasks().filter((t) => !t.done).slice(0, 15);
  if (open.length) p += `\n\nThe user's open tasks:\n${open.map((t) => "- " + t.text).join("\n")}`;
  if (S.about.trim()) p += `\n\nAbout the user (written by them):\n${S.about.trim()}`;
  if (S.memories.length) p += `\n\nThings you've remembered about the user:\n${S.memories.map((m) => "- " + m.text).join("\n")}`;
  return p;
}
function stripTags(t) {
  const saved = [], tasks = [], drafts = [];
  let out = t.replace(/\[\[draft:\s*([^|\]]+?)\s*(?:\|\s*([^\]]*?))?\s*\]\]([\s\S]*?)\[\[\/draft\]\]/gi, (_, k, title, body) => {
    drafts.push({ kind: (k || "other").trim().toLowerCase(), title: (title || "Draft").trim(), body: body.trim() }); return "";
  });
  const od = out.search(/\[\[draft:/i);
  if (od !== -1) out = out.slice(0, od);
  out = out.replace(/\[\[remember:\s*([^\]]+?)\]\]/gi, (_, f) => { saved.push(f.trim()); return ""; });
  out = out.replace(/\[\[task:\s*([^\]]+?)\]\]/gi, (_, f) => { tasks.push(f.trim()); return ""; });
  const open = out.lastIndexOf("[[");
  if (open !== -1 && out.indexOf("]]", open) === -1) out = out.slice(0, open);
  return { text: out.replace(/\n{3,}/g, "\n\n").trim(), saved, tasks, drafts };
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
    await generate({ system: systemPrompt(), messages: history, onText, signal: abort.signal, bubble: b });
    finish();
  } catch (err) {
    if (err.name === "AbortError") { finish(true); }
    else { row.remove(); showError(err); }
  } finally { setBusy(false); abort = null; }

  function finish(stopped) {
    const { text, saved, tasks, drafts } = stripTags(raw);
    if (!text && !saved.length && !tasks.length && !drafts.length) { row.remove(); if (!stopped) showError(new Error("The AI sent back an empty reply. Try again.")); return; }
    for (const f of saved) if (!S.memories.some((m) => m.text.toLowerCase() === f.toLowerCase())) S.memories.push({ id: uid(), text: f });
    for (const t of tasks) addTask(t, true);
    const dids = drafts.map((d) => addDraft(d));
    c.messages.push({ role: "assistant", content: text || "Done.", saved: saved.length ? saved : undefined, tasks: tasks.length ? tasks : undefined, drafts: dids.length ? dids : undefined });
    renderNav();
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
async function generate({ system, messages, onText, signal, bubble, maxTokens }) {
  if (!engineReady()) throw new Error("Set up your AI in Settings first.");
  if (S.settings.engine === "local") return runLocal(system, messages, onText, bubble, signal, maxTokens);
  return runGemini(system, messages, onText, signal, maxTokens);
}
async function ask(system, prompt, opts = {}) {
  let out = "";
  await generate({ system, messages: [{ role: "user", content: prompt }], onText: (t) => { out += t; opts.onText?.(out); }, signal: opts.signal, bubble: opts.bubble, maxTokens: opts.maxTokens });
  return out;
}
async function runGemini(system, history, onText, signal, maxTokens) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: history.map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.content }] })),
    generationConfig: { temperature: 0.7, maxOutputTokens: maxTokens || 4096 },
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
async function runLocal(system, history, onText, bubble, signal, maxTokens) {
  if (!navigator.gpu) throw new Error("This browser can't run AI on-device (no WebGPU). Use the free Gemini key instead, or try the latest Chrome.");
  const model = S.settings.localModel;
  if (!engine || engineModel !== model) {
    if (!bubble) { bubble = document.createElement("div"); (document.querySelector("#site-status") || document.body).append(bubble); }
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
  const messages = [{ role: "system", content: system }, ...history.slice(-12).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content }))];
  const stream = await engine.chat.completions.create({ messages, stream: true, temperature: 0.7, max_tokens: maxTokens ? Math.min(maxTokens, 3000) : 1024 });
  for await (const ch of stream) {
    if (signal?.aborted) { try { engine.interruptGenerate(); } catch {} const e = new Error("stopped"); e.name = "AbortError"; throw e; }
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
  save(); dlg.close(); show(S.view);
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

/* ================= Workspace: business, nav, today, tasks, drafts, sites ================= */
function biz() { return S.active === "personal" ? null : S.projects.find((p) => p.id === S.active) || null; }
const curTasks = () => S.tasks.filter((t) => (t.pid || "personal") === S.active);
const curDrafts = () => S.drafts.filter((d) => (d.pid || "personal") === S.active);
const curSites = () => S.sites.filter((x) => (x.pid || "personal") === S.active);
const today = () => new Date().toISOString().slice(0, 10);

const ICONS = {
  today: '<path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/><circle cx="12" cy="12" r="4"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  tasks: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>',
  drafts: '<path d="M4 4h16v16H4z"/><path d="M4 7l8 6 8-6"/>',
  sites: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>',
};
const VIEWS = [["today", "Today"], ["chat", "Chat"], ["tasks", "Tasks"], ["drafts", "Drafts"], ["sites", "Sites"]];
function renderNav() {
  const counts = { tasks: curTasks().filter((t) => !t.done).length, drafts: curDrafts().filter((d) => d.status === "pending").length };
  const side = $("#side-nav"), bar = $("#tabbar");
  side.innerHTML = ""; bar.innerHTML = "";
  for (const [v, label] of VIEWS) {
    const ic = `<svg viewBox="0 0 24 24">${ICONS[v]}</svg>`;
    const n = counts[v] || 0;
    const a = document.createElement("button");
    a.className = "nav-btn" + (S.view === v ? " active" : ""); a.dataset.testid = "nav-" + v;
    a.innerHTML = `${ic}<span>${label}</span>${n ? `<span class="count">${n}</span>` : ""}`;
    a.onclick = () => { closeDrawer(); show(v); };
    side.append(a);
    const t = document.createElement("button");
    t.className = "tab" + (S.view === v ? " active" : ""); t.dataset.testid = "tab-" + v;
    t.innerHTML = `${ic}<span>${label}</span>${n && v === "drafts" ? `<span class="dot">${n}</span>` : ""}`;
    t.onclick = () => show(v);
    bar.append(t);
  }
}
function show(v) {
  S.view = v; save();
  for (const [x] of VIEWS) $("#view-" + x).hidden = x !== v;
  $("#new-chat").hidden = v !== "chat";
  $("#chat-list").hidden = v !== "chat";
  renderNav(); refreshChrome();
  if (v === "chat") { renderList(); renderQuick(); renderThread(); }
  if (v === "today") renderToday();
  if (v === "tasks") renderTasks();
  if (v === "drafts") renderDrafts();
  if (v === "sites") renderSites();
}
document.addEventListener("click", (e) => { const g = e.target.closest("[data-go]"); if (g) show(g.dataset.go); });

/* ----- business switcher ----- */
function renderBizSelect() {
  const sel = $("#biz-select");
  sel.innerHTML = `<option value="personal">Personal</option>` + S.projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("") + `<option value="__new">+ Add a business</option>`;
  sel.value = S.active;
}
$("#biz-select").onchange = (e) => {
  if (e.target.value === "__new") { e.target.value = S.active; openBiz(null); return; }
  S.active = e.target.value; S.current = null; save(); show(S.view);
};
let editingBiz = null;
function openBiz(id) {
  editingBiz = id;
  const p = S.projects.find((x) => x.id === id) || {};
  $("#biz-title").textContent = id ? "Edit business" : "Add a business";
  $("#b-name").value = p.name || ""; $("#b-idea").value = p.idea || ""; $("#b-who").value = p.who || "";
  $("#b-offer").value = p.offer || ""; $("#b-goal").value = p.goal || "";
  $("#b-delete").hidden = !id;
  closeDrawer(); $("#biz").showModal();
}
$("#edit-biz").onclick = () => openBiz(S.active === "personal" ? null : S.active);
$("#b-save").addEventListener("click", (e) => {
  e.preventDefault();
  const name = $("#b-name").value.trim();
  if (!name) { $("#b-name").focus(); toast("Give your business a name"); return; }
  const data = { name, idea: $("#b-idea").value.trim(), who: $("#b-who").value.trim(), offer: $("#b-offer").value.trim(), goal: $("#b-goal").value.trim() };
  if (editingBiz) Object.assign(S.projects.find((x) => x.id === editingBiz), data);
  else { const p = { id: uid(), ...data }; S.projects.push(p); S.active = p.id; S.current = null; }
  save(); $("#biz").close(); renderBizSelect(); show(S.view); toast("Business saved");
});
let bizDelArmed = false;
$("#b-delete").onclick = () => {
  if (!bizDelArmed) { bizDelArmed = true; $("#b-delete").textContent = "Tap again to delete it and its tasks, drafts and sites"; setTimeout(() => { bizDelArmed = false; $("#b-delete").textContent = "Delete this business"; }, 4000); return; }
  const id = editingBiz;
  S.projects = S.projects.filter((p) => p.id !== id);
  for (const k of ["tasks", "drafts", "sites", "chats"]) S[k] = S[k].filter((x) => x.pid !== id);
  S.active = "personal"; save(); $("#biz").close(); renderBizSelect(); show(S.view); toast("Business deleted");
};
$("#biz").addEventListener("click", (e) => { if (e.target.id === "biz") $("#biz").close(); });

/* ----- quick actions in chat ----- */
function renderQuick() {
  const q = $("#quick"); q.innerHTML = "";
  if (!engineReady()) return;
  const items = biz()
    ? [["Draft outreach email", "Draft a short, friendly cold email I can send to a potential customer."], ["Social post", "Write a social media post that promotes what I offer."], ["Plan my week", "Make a plan for this week toward my current goal and add the tasks."], ["Find customers", "Who exactly should I reach out to first, and where do I find them? Add the next steps as tasks."], ["Build a website", null]]
    : [["Plan my day", "Help me plan my day. Ask me what's on my plate if you need to, then add the tasks."], ["Write an email", "Help me write an email. Ask me who it's to and what it's about."], ["Quick idea", "Give me a quick, useful idea for something I could do today."], ["Build a website", null]];
  for (const [label, prompt] of items) {
    const b = document.createElement("button"); b.textContent = label; b.type = "button";
    b.onclick = () => { if (!prompt) { show("sites"); $("#site-prompt").focus(); return; } input.value = prompt; $("#composer").requestSubmit(); };
    q.append(b);
  }
}

/* ----- tasks ----- */
function addTask(text, quiet) {
  if (curTasks().some((t) => !t.done && t.text.toLowerCase() === text.toLowerCase())) return;
  S.tasks.unshift({ id: uid(), text, done: false, pid: S.active });
  save(); if (!quiet) toast("Task added");
}
function taskEl(t) {
  const li = document.createElement("li"); li.className = "task" + (t.done ? " done" : "");
  li.innerHTML = `<input type="checkbox" ${t.done ? "checked" : ""} aria-label="Mark done" data-testid="checkbox-task-${t.id}" /><span class="t">${esc(t.text)}</span><button class="icon-btn" aria-label="Delete task"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
  li.querySelector("input").onchange = (e) => { t.done = e.target.checked; save(); renderNav(); if (S.view === "today") renderToday(); else renderTasks(); };
  li.querySelector("button").onclick = () => { S.tasks = S.tasks.filter((x) => x.id !== t.id); save(); renderNav(); S.view === "today" ? renderToday() : renderTasks(); };
  return li;
}
function renderTasks() {
  const open = curTasks().filter((t) => !t.done), done = curTasks().filter((t) => t.done);
  const ul = $("#task-list"); ul.innerHTML = "";
  if (!open.length) ul.innerHTML = `<li class="empty-note">No open tasks. Add one above or ask your assistant to plan something.</li>`;
  open.forEach((t) => ul.append(taskEl(t)));
  const dl = $("#done-list"); dl.innerHTML = ""; done.forEach((t) => dl.append(taskEl(t)));
  $("#done-sum").textContent = `Done (${done.length})`;
  $("#plan-tasks").textContent = biz() ? `Suggest tasks for ${biz().name}` : "Suggest tasks for me";
}
$("#task-form").addEventListener("submit", (e) => { e.preventDefault(); const v = $("#task-input").value.trim(); if (!v) return; addTask(v); $("#task-input").value = ""; renderTasks(); renderNav(); });
$("#plan-tasks").onclick = async () => {
  const btn = $("#plan-tasks"); if (btn.disabled) return;
  btn.disabled = true; const old = btn.textContent; btn.textContent = "Thinking…";
  try {
    const out = await ask(systemPrompt(), "Suggest the 5 most useful next tasks for me right now, based on what you know. Respond ONLY with [[task: ...]] lines, nothing else. Don't repeat tasks I already have.", { maxTokens: 800 });
    const { tasks } = stripTags(out);
    const lines = tasks.length ? tasks : out.split("\n").map((l) => l.replace(/^[-*\d.\s]+/, "").trim()).filter((l) => l && l.length < 140).slice(0, 5);
    lines.forEach((t) => addTask(t, true)); toast(`Added ${lines.length} tasks`);
  } catch (e) { toast(e.message); }
  btn.disabled = false; btn.textContent = old; renderTasks(); renderNav();
};

/* ----- drafts ----- */
function addDraft(d) {
  const x = { id: uid(), kind: d.kind, title: d.title, body: d.body, status: "pending", pid: S.active, at: Date.now() };
  S.drafts.unshift(x); save(); return x.id;
}
function parseEmail(body) {
  const m = body.match(/^\s*subject:\s*(.+)\n+/i);
  return m ? { subject: m[1].trim(), text: body.slice(m[0].length).trim() } : { subject: "", text: body };
}
function draftEl(d, compact) {
  const el = document.createElement("div"); el.className = "draft"; el.dataset.testid = "card-draft-" + d.id;
  el.innerHTML = `<div class="draft-top"><span class="tag kind">${esc(d.kind)}</span><h4>${esc(d.title)}</h4><span class="tag ${d.status === "approved" ? "ok" : ""}">${d.status === "approved" ? "Approved" : "Needs your OK"}</span></div>
    <textarea class="field" aria-label="Draft text">${esc(d.body)}</textarea>
    <div class="row"></div>`;
  const ta = el.querySelector("textarea");
  if (compact) ta.rows = 4;
  ta.oninput = () => { d.body = ta.value; save(); };
  const row = el.querySelector(".row");
  const mk = (label, cls, fn, tid) => { const b = document.createElement("button"); b.type = "button"; b.className = "btn sm " + cls; b.textContent = label; b.onclick = fn; if (tid) b.dataset.testid = tid; row.append(b); };
  if (d.kind === "email") mk(d.status === "approved" ? "Open in email again" : "Approve & open email", "primary", () => {
    const { subject, text } = parseEmail(d.body);
    d.status = "approved"; save();
    location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
    setTimeout(() => { renderNav(); S.view === "today" ? renderToday() : renderDrafts(); }, 300);
  }, "button-approve-" + d.id);
  else mk(d.status === "approved" ? "Copy again" : "Approve & copy", "primary", async () => {
    try { await navigator.clipboard.writeText(d.body); toast("Copied. Paste it wherever you post."); } catch { toast("Copy blocked here. Select the text and copy it."); }
    d.status = "approved"; save(); renderNav(); S.view === "today" ? renderToday() : renderDrafts();
  }, "button-approve-" + d.id);
  if (navigator.share) mk("Share", "ghost", () => navigator.share({ text: d.body }).catch(() => {}));
  mk("Rewrite", "ghost", async (e) => {
    const b = e.target; b.disabled = true; b.textContent = "Rewriting…";
    try {
      const out = await ask(systemPrompt(), `Rewrite this ${d.kind} so it's clearer, warmer and more likely to get a reply. Keep the same format (keep a "Subject:" line if it has one). Return only the rewritten text, no tags.\n\n${d.body}`, { maxTokens: 1500 });
      d.body = stripTags(out).text || d.body; d.status = "pending"; save();
    } catch (err) { toast(err.message); }
    S.view === "today" ? renderToday() : renderDrafts(); renderNav();
  });
  mk("Delete", "ghost", () => { S.drafts = S.drafts.filter((x) => x.id !== d.id); save(); renderNav(); S.view === "today" ? renderToday() : renderDrafts(); });
  return el;
}
function renderDrafts() {
  const acts = $("#draft-actions"); acts.innerHTML = "";
  const kinds = biz()
    ? [["Cold email", "Draft a short cold email to a potential customer for my business."], ["Follow-up", "Draft a polite follow-up email to someone who didn't reply."], ["Social post", "Write a social post promoting my business."], ["Text message", "Write a short, friendly text message I can send to a past customer asking for a referral."]]
    : [["Email", "Help me draft an email. Ask me who it's to and what it's about."], ["Text message", "Help me write a text message. Ask me what it's for."], ["Social post", "Help me write a social media post. Ask me what it's about."]];
  for (const [label, prompt] of kinds) {
    const b = document.createElement("button"); b.type = "button"; b.className = "btn ghost sm"; b.textContent = "+ " + label;
    b.onclick = () => { if (!engineReady()) { openSettings("gemini"); return; } S.current = null; show("chat"); input.value = prompt; $("#composer").requestSubmit(); };
    acts.append(b);
  }
  const list = $("#draft-list"); list.innerHTML = "";
  const ds = curDrafts();
  if (!ds.length) { list.innerHTML = `<p class="empty-note">No drafts yet. Tap one of the buttons above, or ask for an email or post in chat.</p>`; return; }
  ds.forEach((d) => list.append(draftEl(d)));
}

/* ----- today ----- */
function renderToday() {
  const now = new Date(); const h = now.getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  $("#today-date").textContent = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) + (biz() ? " · " + biz().name : "");
  $("#today-hello").textContent = part + (S.settings.user ? ", " + S.settings.user : "") + ".";
  const key = S.active + ":" + today();
  const br = S.briefs[key];
  $("#brief-body").innerHTML = br ? renderMd(br) : `<p class="help">${engineReady() ? `Tap "Write my brief" and ${esc(S.settings.name || "your assistant")} will look at ${biz() ? "your business and " : ""}your tasks and tell you what to focus on today.` : `Set up your free AI first. <button type="button" class="btn ghost sm" id="brief-setup">Set up</button>`}</p>`;
  $("#brief-setup")?.addEventListener("click", () => openSettings("gemini"));
  $("#brief-btn").textContent = br ? "Refresh" : "Write my brief";
  const open = curTasks().filter((t) => !t.done), doneToday = curTasks().filter((t) => t.done).length, pend = curDrafts().filter((d) => d.status === "pending");
  $("#stats").innerHTML = `<div class="stat"><b>${open.length}</b><span>Open tasks</span></div><div class="stat"><b>${doneToday}</b><span>Done</span></div><div class="stat"><b>${pend.length}</b><span>Drafts to review</span></div>`;
  const ul = $("#today-tasks"); ul.innerHTML = "";
  if (!open.length) ul.innerHTML = `<li class="empty-note">Nothing open. Ask your assistant to plan your day.</li>`;
  open.slice(0, 5).forEach((t) => ul.append(taskEl(t)));
  const dc = $("#today-drafts"); dc.innerHTML = "";
  $("#today-drafts-card").hidden = !pend.length;
  pend.slice(0, 2).forEach((d) => dc.append(draftEl(d, true)));
}
$("#brief-btn").onclick = async () => {
  if (!engineReady()) { openSettings("gemini"); return; }
  const btn = $("#brief-btn"); if (btn.disabled) return; btn.disabled = true; btn.textContent = "Writing…";
  const body = $("#brief-body"); body.innerHTML = `<span class="typing"><i></i><i></i><i></i></span>`;
  const h = new Date().getHours();
  try {
    const out = await ask(systemPrompt(), `Write my ${h < 15 ? "morning" : "evening"} brief. Keep it short and skimmable:\n1. One line on where things stand${biz() ? " with the business" : ""}.\n2. "Today's focus": the top 3 things to do, most important first (use my open tasks if they're good; add new [[task: ...]] lines for any new ones).\n3. One quick win I can do in 10 minutes.\n${h >= 15 ? "Also ask what got done today." : ""}\nNo long intro.`, { onText: (t) => { body.innerHTML = renderMd(stripTags(t).text || "…"); }, bubble: body, maxTokens: 1200 });
    const { text, tasks } = stripTags(out);
    tasks.forEach((t) => addTask(t, true));
    S.briefs[S.active + ":" + today()] = text; save();
  } catch (e) { body.innerHTML = `<div class="err-bubble">${esc(e.message)}</div>`; btn.disabled = false; btn.textContent = "Try again"; return; }
  btn.disabled = false; renderToday(); renderNav();
};

/* ----- websites ----- */
const SITE_SYS = `You are an expert web designer. You build complete, beautiful, mobile-first single-file websites.
Rules:
- Output ONLY one complete HTML document starting with <!doctype html>. No explanation, no Markdown fences.
- All CSS in one <style> tag. Any JS minimal and inline. You may load Google Fonts. No other external files, frameworks, or image URLs.
- For visuals use CSS gradients, shapes, inline SVG icons and illustrations, or emoji. Never use broken image links.
- Make it look professionally designed: strong typography, a clear hero, good spacing, a distinctive color palette that fits the business, and clear call-to-action buttons (tel:, mailto:, or #contact).
- Fully responsive; must look great on a phone at 375px wide.
- Use realistic, specific copy based on the details given. Use clearly fake placeholders only for unknown phone numbers or emails, like (555) 123-4567.`;
function cleanHtml(t) {
  let h = t.trim().replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const i = h.search(/<!doctype html|<html/i); if (i > 0) h = h.slice(i);
  return h;
}
let siteBusy = false;
async function buildSite(prompt, existing) {
  if (!engineReady()) { openSettings("gemini"); return null; }
  if (siteBusy) return null; siteBusy = true;
  const st = $("#site-status");
  st.textContent = "Building your site… this can take up to a minute.";
  const bz = biz();
  const ctx = bz ? `\n\nBusiness details: ${bz.name}. ${bz.idea || ""} For: ${bz.who || ""}. Offer: ${bz.offer || ""}.` : "";
  const req = existing
    ? `Here is the current website HTML:\n\n${existing}\n\nApply this change and return the full updated HTML document: ${prompt}`
    : `Build this website: ${prompt}${ctx}`;
  try {
    const out = await ask(SITE_SYS, req, { maxTokens: 16000, onText: (t) => { st.textContent = `Building your site… ${Math.round(t.length / 1000)}k characters written`; } });
    const html = cleanHtml(out);
    if (!/<\/html>/i.test(html) && !/<body/i.test(html)) throw new Error("The AI didn't return a full page. Try again, or describe the site in a bit more detail.");
    st.textContent = ""; return html;
  } catch (e) { st.textContent = e.message; return null; }
  finally { siteBusy = false; }
}
$("#site-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const p = $("#site-prompt").value.trim(); if (!p) { $("#site-prompt").focus(); return; }
  const btn = $("#site-build"); btn.disabled = true;
  const html = await buildSite(p);
  btn.disabled = false;
  if (!html) return;
  const name = (html.match(/<title>([^<]{1,80})<\/title>/i)?.[1] || p.slice(0, 40)).trim();
  const site = { id: uid(), name, prompt: p, html, pid: S.active, at: Date.now() };
  S.sites.unshift(site); save(); $("#site-prompt").value = ""; renderSites(); openViewer(site.id);
});
$("#site-from-biz").onclick = () => {
  const bz = biz();
  if (!bz) { toast("Add a business first (top of the menu)."); openBiz(null); return; }
  $("#site-prompt").value = `A one-page website for ${bz.name}. ${bz.idea || ""} It's for ${bz.who || "local customers"}. Offer: ${bz.offer || "contact for pricing"}. Include a hero, services, how it works, pricing, a few short testimonials, FAQ, and a contact section.`;
};
function downloadSite(s) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([s.html], { type: "text/html" }));
  a.download = (s.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "site") + ".html"; a.click();
}
function renderSites() {
  const list = $("#site-list"); list.innerHTML = "";
  $("#site-from-biz").hidden = !biz();
  const ss = curSites();
  if (!ss.length) { list.innerHTML = `<p class="empty-note">No sites yet. Describe one above.</p>`; return; }
  for (const s of ss) {
    const el = document.createElement("div"); el.className = "site"; el.dataset.testid = "card-site-" + s.id;
    el.innerHTML = `<div class="thumb"><iframe sandbox="" tabindex="-1" aria-hidden="true"></iframe></div><div class="info"><b>${esc(s.name)}</b><span>${new Date(s.at).toLocaleDateString()}</span></div><div class="acts"><button class="btn primary sm" data-a="open">Open</button><button class="btn ghost sm" data-a="dl">Download</button><button class="btn ghost sm" data-a="del">Delete</button></div>`;
    el.querySelector("iframe").srcdoc = s.html;
    el.querySelector('[data-a="open"]').onclick = () => openViewer(s.id);
    el.querySelector('[data-a="dl"]').onclick = () => downloadSite(s);
    el.querySelector('[data-a="del"]').onclick = () => { S.sites = S.sites.filter((x) => x.id !== s.id); save(); renderSites(); };
    list.append(el);
  }
}
let viewing = null;
function openViewer(id) {
  const s = S.sites.find((x) => x.id === id); if (!s) return;
  viewing = s; $("#v-title").textContent = s.name; $("#v-frame").srcdoc = s.html;
  $(".viewer-stage").classList.toggle("phone", document.querySelector('input[name="vs"]:checked').value === "phone");
  $("#viewer").showModal();
}
$("#v-close").onclick = () => $("#viewer").close();
document.querySelectorAll('input[name="vs"]').forEach((r) => r.onchange = () => $(".viewer-stage").classList.toggle("phone", r.value === "phone" && r.checked));
$("#v-edit").addEventListener("submit", async (e) => {
  e.preventDefault();
  const ch = $("#v-change").value.trim(); if (!ch || !viewing) return;
  const btn = $("#v-apply"); btn.disabled = true; btn.textContent = "Updating…";
  const html = await buildSite(ch, viewing.html);
  btn.disabled = false; btn.textContent = "Update";
  if (!html) { toast($("#site-status").textContent || "Couldn't update the site"); return; }
  viewing.html = html; save(); $("#v-frame").srcdoc = html; $("#v-change").value = ""; renderSites(); toast("Site updated");
});

if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
boot();
