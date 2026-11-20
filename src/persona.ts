/**
 * persona.ts — konfigurasi kepribadian.
 *
 * Semua yang menentukan "rasa" bot ada di data/persona.json:
 * bobot suasana dasar, seberapa lengket suasana sebelumnya, dan bank
 * kalimat cadangan per nada.
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./store.ts";

export type ToneKey = "hangat" | "manja" | "dingin" | "nakal";

export const TONES: ToneKey[] = ["hangat", "manja", "dingin", "nakal"];

export type Persona = {
  name: string;
  baseline: Record<ToneKey, number>;
  inertia: number;
  moodForgetHours: number;
  moodJitter: number;
  labels: Record<ToneKey, string>;
  warmIntents: string[];
  fallback: Record<ToneKey, string[]>;
};

export const DEFAULTS: Persona = {
  name: "anomali",
  baseline: { hangat: 0.3, manja: 0.28, dingin: 0.14, nakal: 0.28 },
  inertia: 0.55,
  moodForgetHours: 12,
  moodJitter: 0.07,
  labels: { hangat: "hangat", manja: "manja", dingin: "dingin", nakal: "jail" },
  warmIntents: ["sedih", "kesepian", "stres", "capek", "kecewa", "temenin", "semangat", "minta-maaf"],
  fallback: {
    hangat: ["iya, aku dengerin.", "hmm, terus gimana?", "oke, cerita aja."],
    manja: ["iyaa... sini cerita lagi.", "aku kangen kamu, tau.", "sini, deket."],
    dingin: ["oh.", "ya udah.", "terserah kamu."],
    nakal: ["hmm, berani juga.", "wkwk. lanjut.", "buktiin dong."],
  },
};

/** Seberapa mirip dua nada. Dipakai saat suasana tidak tersedia di intent. */
export const SIMILARITY: Record<ToneKey, Record<ToneKey, number>> = {
  hangat: { hangat: 1, manja: 0.55, nakal: 0.3, dingin: 0.15 },
  manja: { manja: 1, hangat: 0.6, nakal: 0.35, dingin: 0.1 },
  dingin: { dingin: 1, hangat: 0.35, nakal: 0.25, manja: 0.1 },
  nakal: { nakal: 1, manja: 0.5, hangat: 0.4, dingin: 0.2 },
};

export function loadPersona(): Persona {
  const file = path.join(ROOT, "data", "persona.json");
  if (!fs.existsSync(file)) return DEFAULTS;

  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<Persona>;
    return {
      name: raw.name ?? DEFAULTS.name,
      baseline: { ...DEFAULTS.baseline, ...(raw.baseline ?? {}) },
      inertia: raw.inertia ?? DEFAULTS.inertia,
      moodForgetHours: raw.moodForgetHours ?? DEFAULTS.moodForgetHours,
      moodJitter: raw.moodJitter ?? DEFAULTS.moodJitter,
      labels: { ...DEFAULTS.labels, ...(raw.labels ?? {}) },
      warmIntents: raw.warmIntents ?? DEFAULTS.warmIntents,
      fallback: { ...DEFAULTS.fallback, ...(raw.fallback ?? {}) },
    };
  } catch {
    return DEFAULTS;
  }
}

export function toneLabel(persona: Persona, tone: string): string {
  return persona.labels[tone as ToneKey] ?? tone;
}
