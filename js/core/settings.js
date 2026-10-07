// settings.js — impostazioni solo-dispositivo (chiavi API voce/traduzione)
import { uid } from "./util.js";

const SET_KEY = "spazio-teorie-settings";

export const settings = {
  elKey: "", elVoice: "21m00Tcm4TlvDq8ikWAM", elModel: "eleven_multilingual_v2",
  trProvider: "google", dblNode: true, myName: "", myHue: null,
  aiUrl: "https://api.openai.com/v1", aiKey: "", aiModel: "gpt-4o-mini",
  clKey: "", clModel: "claude-haiku-4-5-20251001",
  ltUrl: "", ltKey: "", trTarget: "en", speechLang: "it-IT",
  ttsProv: "", sysVoice: "", sysPitch: 1,
  oaUrl: "https://api.openai.com/v1", oaKey: "", oaModel: "gpt-4o-mini-tts", oaVoice: "alloy",
  gcKey: "", gcVoice: "it-IT-Neural2-A",
  gmKey: "", gmModel: "gemini-2.5-flash-preview-tts", gmVoice: "Kore", gmRpm: 3,
  aiProfiles: [], aiActive: "", aiFallback: true
};

try {
  const _s = JSON.parse(localStorage.getItem(SET_KEY) || "{}");
  for (const k in _s) settings[k] = _s[k];
  if (!_s.trProvider && "Translator" in self) settings.trProvider = "browser";
} catch (e) {}

/* migrazione: vecchie impostazioni singole -> elenco modelli AI (identica all'originale) */
(function migrate() {
  if (!Array.isArray(settings.aiProfiles)) settings.aiProfiles = [];
  if (!settings.aiProfiles.length) {
    let oa = null, cl = null;
    if (settings.aiKey) {
      const gem = /generativelanguage/.test(settings.aiUrl || "");
      oa = { id: uid(), name: gem ? "Gemini" : "Modello AI", kind: "openai", url: settings.aiUrl || "https://api.openai.com/v1", key: settings.aiKey, model: settings.aiModel || "gpt-4o-mini", rpm: gem ? 6 : 30 };
      settings.aiProfiles.push(oa);
    }
    if (settings.clKey) {
      cl = { id: uid(), name: "Claude", kind: "claude", url: "", key: settings.clKey, model: settings.clModel || "claude-haiku-4-5-20251001", rpm: 40 };
      settings.aiProfiles.push(cl);
    }
    settings.aiActive = (settings.trProvider === "claude" && cl) ? cl.id : (oa ? oa.id : (cl ? cl.id : ""));
  }
  if (settings.trProvider === "openai" || settings.trProvider === "claude") settings.trProvider = "ai";
})();

export function saveSettings() {
  try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch (e) {}
}

export function aiProfile() {
  const l = settings.aiProfiles || [];
  return l.filter(x => x.id === settings.aiActive)[0] || l[0] || null;
}

export function aiChain() {
  const l = settings.aiProfiles || [];
  const a = aiProfile();
  if (!a) return [];
  const out = [a];
  if (settings.aiFallback !== false) l.forEach(x => { if (x !== a) out.push(x); });
  return out.filter(x => !x._dead);
}
