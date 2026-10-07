// tts.js — provider vocali + cache (memoria, IndexedDB, stanza condivisa)
import { idbGet, idbPut, downloadRoomBlob, uploadRoomBlob, activeRoom, serverReady, supabaseClient } from "../core/store.js";
import { hashStr, sleep, toast } from "../core/util.js";
import { settings } from "../core/settings.js";
import { aiGate, waitMs } from "../core/ai.js";

export const TTS_NAMES = { browser: "Voce del browser", eleven: "ElevenLabs", openai: "OpenAI / compatibile", google: "Google Cloud", gemini: "Gemini" };

export function ttsProv() {
  const p = settings.ttsProv;
  if (p) return p;
  return settings.elKey ? "eleven" : "browser";
}

export function useEleven() { return ttsProv() !== "browser"; }

async function sha1hex(s) {
  try {
    const b = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
    return Array.prototype.map.call(new Uint8Array(b), x => ("0" + x.toString(16)).slice(-2)).join("");
  } catch (e) {
    return "h" + hashStr(s) + "-" + s.length + "-" + hashStr(s.split("").reverse().join(""));
  }
}

function base64ToBlob(b64) {
  const m = String(b64).match(/^data:(.*?);base64,(.*)$/);
  const type = m ? m[1] : "application/octet-stream";
  const bin = atob(m ? m[2] : String(b64).replace(/^data:.*?;base64,/, ""));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type });
}

async function ttsEleven(text, prev, next) {
  const body = { text, model_id: settings.elModel, voice_settings: { stability: 0.5, similarity_boost: 0.75 } };
  if (prev) body.previous_text = prev.slice(-300);
  if (next) body.next_text = next.slice(0, 300);
  if (!settings.elKey) throw new Error("Imposta la chiave ElevenLabs in Impostazioni.");
  const res = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" + encodeURIComponent(settings.elVoice) + "?output_format=mp3_44100_64", {
    method: "POST", headers: { "xi-api-key": settings.elKey, "Content-Type": "application/json", "Accept": "audio/mpeg" }, body: JSON.stringify(body)
  });
  if (!res.ok) {
    let msg = "";
    try { const j = await res.json(); const dt = j && j.detail; msg = typeof dt === "string" ? dt : (dt && (dt.message || dt.status)) || ""; } catch (e) {}
    const er = new Error(res.status === 401 ? "Chiave ElevenLabs non valida." : res.status === 429 ? "Troppe richieste o crediti ElevenLabs esauriti." : ("ElevenLabs: errore " + res.status + (msg ? " — " + msg : "")));
    er.status = res.status; throw er;
  }
  return await res.blob();
}

async function ttsOpenAI(text) {
  const base = (settings.oaUrl || "").replace(/\/+$/, "");
  if (!base) throw new Error("Imposta l'URL del servizio vocale in Impostazioni.");
  if (!settings.oaKey && !/localhost|127\.0\.0\.1/.test(base)) throw new Error("Imposta la chiave API del servizio vocale.");
  const h = { "Content-Type": "application/json" };
  if (settings.oaKey) h.Authorization = "Bearer " + settings.oaKey;
  const res = await fetch(base + "/audio/speech", { method: "POST", headers: h, body: JSON.stringify({ model: settings.oaModel, voice: settings.oaVoice, input: text, response_format: "mp3" }) });
  if (!res.ok) throw await httpErr("Voce", res);
  return await res.blob();
}

async function ttsGoogle(text) {
  if (!settings.gcKey) throw new Error("Imposta la chiave Google Cloud in Impostazioni.");
  const vn = settings.gcVoice || "it-IT-Neural2-A", lc = (vn.match(/^[a-z]{2,3}-[A-Z]{2}/) || ["it-IT"])[0];
  const res = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize?key=" + encodeURIComponent(settings.gcKey), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: { text }, voice: { languageCode: lc, name: vn }, audioConfig: { audioEncoding: "MP3" } })
  });
  if (!res.ok) throw await httpErr("Google TTS", res);
  const j = await res.json();
  if (!j.audioContent) throw new Error("Google TTS: risposta vuota.");
  return base64ToBlob("data:audio/mpeg;base64," + j.audioContent);
}

function pcmToWav(b64, rate) {
  const bin = atob(b64), n = bin.length, buf = new ArrayBuffer(44 + n), dv = new DataView(buf);
  function w(o, s) { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); }
  w(0, "RIFF"); dv.setUint32(4, 36 + n, true); w(8, "WAVEfmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, "data"); dv.setUint32(40, n, true);
  const u = new Uint8Array(buf, 44);
  for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: "audio/wav" });
}

async function ttsGemini(text) {
  const key = settings.gmKey || ((settings.aiProfiles || []).filter(x => x.kind === "gemini" && x.key)[0] || {}).key;
  if (!key) throw new Error("Imposta la chiave Gemini in Impostazioni.");
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(settings.gmModel || "gemini-2.5-flash-preview-tts") + ":generateContent", {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ parts: [{ text }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: settings.gmVoice || "Kore" } } } } })
  });
  if (!res.ok) throw await httpErr("Gemini voce", res);
  const j = await res.json();
  const pt = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts || []).filter(x => x.inlineData)[0];
  if (!pt) throw new Error("Gemini non ha restituito audio (modello o voce non validi?).");
  const m = String(pt.inlineData.mimeType || "").match(/rate=(\d+)/);
  return pcmToWav(pt.inlineData.data, m ? +m[1] : 24000);
}

async function ttsRetry(fn, gateP, cancel) {
  for (let a = 0; a < 4; a++) {
    let wait = 0;
    try { if (gateP) await aiGate(gateP, cancel); return await fn(); }
    catch (e) {
      if (e.message === "Interrotto") throw e;
      if (e instanceof TypeError && a < 2) wait = 1500;
      else if ((e.status === 429 || e.status >= 500) && !e.daily) wait = Math.min(60000, e.retryMs || 4000 * Math.pow(2, a));
      else throw e;
      if (a === 3) throw e;
      await waitMs(wait, "Servizio vocale occupato, riprovo tra", cancel);
    }
  }
}

import { httpErr } from "../core/ai.js";

const ttsInFlight = {};
const ttsMem = {};

export async function cloudTTS(text, prev, next) {
  const pv = ttsProv();
  let sig;
  if (pv === "eleven") sig = pv + "|" + settings.elVoice + "|" + settings.elModel + "|" + text;
  else if (pv === "openai") sig = pv + "|" + settings.oaUrl + "|" + settings.oaModel + "|" + settings.oaVoice + "|" + text;
  else if (pv === "google") sig = pv + "|" + settings.gcVoice + "|" + text;
  else sig = pv + "|" + settings.gmModel + "|" + settings.gmVoice + "|" + text;
  const key = await sha1hex(sig);
  if (ttsMem[key]) return ttsMem[key];
  if (ttsInFlight[key]) return await ttsInFlight[key];

  ttsInFlight[key] = (async function () {
    try {
      try {
        const rec = await idbGet("tts", key);
        if (rec && rec.blob) { ttsMem[key] = URL.createObjectURL(rec.blob); return ttsMem[key]; }
      } catch (e) {}
      if (activeRoom && serverReady && supabaseClient) {
        try {
          const shared = await downloadRoomBlob(key, "tts", "audio/mpeg");
          if (shared) {
            try { await idbPut("tts", key, { blob: shared, ts: Date.now(), shared: true }); } catch (e) {}
            ttsMem[key] = URL.createObjectURL(shared);
            return ttsMem[key];
          }
        } catch (e) {}
      }
      let blob;
      if (pv === "eleven") blob = await ttsEleven(text, prev, next);
      else if (pv === "openai") blob = await ttsRetry(() => ttsOpenAI(text), null, () => false);
      else if (pv === "google") blob = await ttsRetry(() => ttsGoogle(text), null, () => false);
      else blob = await ttsRetry(() => ttsGemini(text), { id: "tts-gemini", rpm: settings.gmRpm || 3 }, () => false);
      try { await idbPut("tts", key, { blob, ts: Date.now() }); } catch (e) {}
      if (activeRoom && serverReady && supabaseClient) { try { await uploadRoomBlob(key, blob, "tts"); } catch (e) {} }
      ttsMem[key] = URL.createObjectURL(blob);
      return ttsMem[key];
    } finally { delete ttsInFlight[key]; }
  })();
  return await ttsInFlight[key];
}

export const elTTS = cloudTTS;

export function pickSysVoice(lang) {
  const vs = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  const l2 = String(lang || "").slice(0, 2).toLowerCase();
  if (settings.sysVoice) { const f = vs.filter(v => v.voiceURI === settings.sysVoice)[0]; if (f && (!l2 || String(f.lang).toLowerCase().indexOf(l2) === 0)) return f; }
  return vs.filter(v => v.lang && v.lang.toLowerCase().indexOf(l2) === 0)[0] || null;
}

export function fillSysVoices() {
  const sel = document.getElementById("setSysVoice");
  if (!sel) return;
  const vs = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  const cur = settings.sysVoice || "";
  sel.innerHTML = "";
  const o0 = document.createElement("option"); o0.value = ""; o0.textContent = "Automatica (la migliore per la lingua)"; sel.appendChild(o0);
  vs.slice().sort((a, b) => a.lang < b.lang ? -1 : a.lang > b.lang ? 1 : 0).forEach(v => {
    const o = document.createElement("option"); o.value = v.voiceURI; o.textContent = v.name + " (" + v.lang + ")"; sel.appendChild(o);
  });
  sel.value = cur;
}
