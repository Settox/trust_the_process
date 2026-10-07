// ai.js — livello comune modelli AI: limite rpm, retry 429/5xx, fallback catena
import { settings, aiProfile, aiChain } from "./settings.js";
import { sleep, toast } from "./util.js";
import { langName } from "./i18n.js";
import { svc } from "./svc.js";

const aiGateT = {};

export async function waitMs(ms, label, cancel, el) {
  const end = Date.now() + ms; let first = true;
  for (;;) {
    if (cancel && cancel()) throw new Error("Interrotto");
    const left = end - Date.now();
    if (left <= 0) return;
    const msg = label + " " + Math.ceil(left / 1000) + " s…";
    if (el) el.textContent = msg; else if (first) toast(msg);
    first = false;
    await sleep(Math.min(250, left));
  }
}

export async function aiGate(p, cancel, el) {
  const gap = 60000 / Math.max(0.2, p.rpm || 30) * (p._slow || 1);
  const now = Date.now();
  const t = Math.max(now, aiGateT[p.id] || 0);
  aiGateT[p.id] = t + gap;
  if (t > now) await waitMs(t - now, "Attendo il limite di richieste", cancel, el);
}

function retryMsOf(res, t) {
  let ms = 0;
  const h = res.headers && res.headers.get && res.headers.get("retry-after");
  if (h) { const s = parseFloat(h); ms = isNaN(s) ? Math.max(0, Date.parse(h) - Date.now()) : s * 1000; }
  const m = t.match(/"retryDelay"\s*:\s*"([\d.]+)s"/) || t.match(/retry in ([\d.]+)\s*s/i);
  if (m) ms = Math.max(ms, parseFloat(m[1]) * 1000);
  return Math.min(ms, 180000);
}

export async function httpErr(name, res) {
  let t = "";
  try { t = await res.text(); } catch (e) {}
  let msg = "";
  try { const j = JSON.parse(t); const er = j.error || (Array.isArray(j) && j[0] && j[0].error) || j; msg = (er && (er.message || er.status)) || ""; }
  catch (e) { msg = t.slice(0, 160); }
  const er2 = new Error(name + ": errore " + res.status + (msg ? " — " + String(msg).split("\n")[0].slice(0, 170) : ""));
  er2.status = res.status; er2.retryMs = retryMsOf(res, t); er2.daily = (res.status === 429 && /PerDay|per day|daily/i.test(t));
  return er2;
}

export function trSys(target) {
  return "Sei un traduttore letterario. Traduci il testo in " + (langName(target) || target) + " mantenendo tono, paragrafi e nomi propri. Se nel testo trovi marcatori come [[1]], [[2]], conservali identici all'inizio di ciascun paragrafo. Rispondi solo con la traduzione, senza commenti.";
}

function fatalErr(m) { const e = new Error(m); e.noRetry = true; return e; }

async function aiCall(p, sys, text, cancel) {
  await aiGate(p, cancel);
  let r, j;
  if (p.kind === "claude") {
    if (!p.key) throw fatalErr("Imposta la chiave Anthropic per «" + p.name + "».");
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": p.key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({ model: p.model, max_tokens: 8192, system: sys, messages: [{ role: "user", content: text }] })
    });
    if (!r.ok) throw await httpErr("Claude", r);
    j = await r.json();
    return (j.content || []).map(x => x.text || "").join("");
  }
  if (p.kind === "gemini") {
    if (!p.key) throw fatalErr("Imposta la chiave Gemini per «" + p.name + "».");
    const gc = { temperature: 0.2, maxOutputTokens: 8192 };
    if (/2\.5/.test(p.model) && /flash/.test(p.model)) gc.thinkingConfig = { thinkingBudget: 0 };
    const body = {
      systemInstruction: { parts: [{ text: sys }] },
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: gc,
      safetySettings: ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"].map(c => ({ category: c, threshold: "BLOCK_NONE" }))
    };
    r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(p.model) + ":generateContent", {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": p.key }, body: JSON.stringify(body)
    });
    if (!r.ok) throw await httpErr("Gemini", r);
    j = await r.json();
    const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
    const out = parts.map(x => x.text || "").join("");
    if (!out) { const why = (j.promptFeedback && j.promptFeedback.blockReason) || (j.candidates && j.candidates[0] && j.candidates[0].finishReason) || "risposta vuota"; throw fatalErr("Gemini non ha restituito testo (" + why + ")."); }
    return out;
  }
  const base = (p.url || "").replace(/\/+$/, "");
  if (!base) throw fatalErr("Imposta l'URL base per «" + p.name + "».");
  if (!p.key && !/localhost|127\.0\.0\.1/.test(base)) throw fatalErr("Imposta la chiave API per «" + p.name + "».");
  const h = { "Content-Type": "application/json" };
  if (p.key) h.Authorization = "Bearer " + p.key;
  r = await fetch(base + "/chat/completions", { method: "POST", headers: h, body: JSON.stringify({ model: p.model, temperature: 0.2, messages: [{ role: "system", content: sys }, { role: "user", content: text }] }) });
  if (!r.ok) throw await httpErr(p.name, r);
  j = await r.json();
  return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
}

async function aiTryProfile(p, sys, text, cancel) {
  for (let a = 0; a < 7; a++) {
    if (cancel && cancel()) throw new Error("Interrotto");
    let wait = 0;
    try { return await aiCall(p, sys, text, cancel); }
    catch (e) {
      if (e.message === "Interrotto" || e.noRetry) throw e;
      if (e.daily) { p._dead = true; const d = new Error("Quota giornaliera esaurita su «" + p.name + "». Riprova domani, cambia modello o attiva la fatturazione del servizio."); d.daily = true; throw d; }
      if (e instanceof TypeError) { if (a >= 2) { const n = new Error("Rete o permessi (CORS) bloccano la richiesta a «" + p.name + "»."); n.noRetry = true; throw n; } wait = 2000 * (a + 1); }
      else if (e.status === 429 || e.status >= 500) { p._slow = Math.min(4, (p._slow || 1) * 1.35); wait = (e.retryMs || Math.min(90000, 4000 * Math.pow(2, a))) * (1 + Math.random() * 0.15) + 400; aiGateT[p.id] = Date.now() + wait; }
      else throw e;
      if (a === 6) throw e;
      await waitMs(wait, "«" + p.name + "» ha raggiunto il limite: riprovo tra", cancel);
    }
  }
}

export async function aiRun(sys, text, cancel) {
  const chain = aiChain();
  if (!chain.length) { const e0 = new Error("Nessun modello AI disponibile: aggiungine uno in Impostazioni (oppure la quota giornaliera è esaurita)."); e0.final = true; throw e0; }
  let last = null;
  for (let ci = 0; ci < chain.length; ci++) {
    const p = chain[ci];
    try { return await aiTryProfile(p, sys, text, cancel); }
    catch (e) { last = e; if (e.message === "Interrotto") break; if (ci < chain.length - 1) toast("«" + p.name + "» non disponibile: passo a «" + chain[ci + 1].name + "»."); }
  }
  last.final = true; throw last;
}

export async function aiTranslate(text, target) { return aiRun(trSys(target), text, () => false); }

export async function aiTranslateList(texts, target, cancel) {
  const joined = texts.map((t, i) => "[[" + (i + 1) + "]] " + t).join("\n\n");
  const outp = await aiRun(trSys(target), joined, cancel);
  const parts = outp.split(/\[\[(\d+)\]\]/);
  const map = {};
  for (let i = 1; i < parts.length; i += 2) map[+parts[i]] = (parts[i + 1] || "").trim();
  const res = []; let ok = true;
  for (let k = 1; k <= texts.length; k++) { if (map[k] == null || map[k] === "") { ok = false; break; } res.push(map[k]); }
  if (ok) return res;
  const res2 = [];
  for (let q = 0; q < texts.length; q++) res2.push(await aiTranslate(texts[q], target));
  return res2;
}

export async function aiNodeAction(n, kind) {
  if (!aiProfile()) { toast("Aggiungi prima un modello AI nelle impostazioni."); svc.openSettings && svc.openSettings(); return; }
  const txt = svc.plainText ? svc.plainText(n.body || "") : (n.body || "").replace(/<[^>]+>/g, "");
  if (!txt.trim()) { toast("Il nodo è vuoto."); return; }
  const S = {
    sum: ["Riassunto", "Riassumi il testo in italiano in modo chiaro e fedele, in poche frasi. Rispondi solo con il riassunto."],
    exp: ["Spiegazione", "Spiega il testo in italiano in modo semplice, come a uno studente curioso, con un esempio se utile. Rispondi solo con la spiegazione."],
    ask: ["Domande", "Scrivi in italiano 5 domande di verifica sul testo, numerate, senza risposte."],
    tr: ["Traduzione", "Traduci il testo in " + langName(settings.trTarget || "en") + " mantenendo tono e nomi propri. Rispondi solo con la traduzione."]
  }[kind];
  if (!S) return;
  toast("Il modello sta lavorando…");
  try {
    const out = await aiRun(S[1], txt, () => false);
    const nn = svc.addNode({ x: n.x + n.w + 50, y: n.y, title: S[0], body: (out.trim()).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>"), source: "AI · " + aiProfile().name });
    svc.addConnection(n.id, nn.id, svc.getCurrentColor ? svc.getCurrentColor() : "#8ab4ff");
    toast(S[0] + " creato");
  } catch (e) { toast(e.message || "Errore del modello AI"); }
}
