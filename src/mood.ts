/**
 * mood.ts — suasana hati yang bertahan antar pesan.
 *
 * Tiga bahan:
 *   1. suasana sebelumnya (inersia) — supaya tidak flip-flop tiap pesan
 *   2. sinyal dari pesan user        — sayang -> manja, ketus -> dingin, jail -> jail
 *   3. waktu                         — lama tidak chat memicu dingin, lalu memudar
 *
 * Hasilnya disimpan di tabel mood dan dipakai untuk memilih nada jawaban.
 */
import type { Store } from "./store.ts";
import { normalize } from "./normalize.ts";
import { TONES } from "./persona.ts";
import type { Persona, ToneKey } from "./persona.ts";

export type MoodState = {
  mood: ToneKey;
  intensity: number;
  reason: string;
  updated_at: number;
};

type Signals = Record<ToneKey, number>;

/** Kata yang kuat menggeser suasana. */
const STRONG: Record<ToneKey, string[]> = {
  manja: [
    "kangen", "rindu", "sayang", "cinta", "beb", "ayang", "peluk", "cium",
    "temenin", "manja", "kangen kamu", "sayang kamu", "jangan pergi", "peluk aku",
  ],
  dingin: [
    "terserah", "ya sudah", "biasa saja", "tidak apa", "jangan ganggu",
    "males", "sibuk", "bodo amat", "jangan chat", "diem aja",
  ],
  nakal: [
    "wkwk", "hehe", "haha", "gombal", "nakal", "jail", "goda", "baper",
    "salting", "jahat", "iseng", "tebak", "coba tebak", "berani",
  ],
  hangat: [
    "sedih", "nangis", "capek", "lelah", "kesepian", "sendirian", "stres",
    "pusing", "curhat", "takut", "maaf", "makasih", "semangat", "kecewa",
  ],
};

/** Kata yang lemah (filler / sapaan pendek). */
const WEAK: Record<ToneKey, string[]> = {
  manja: ["pengen", "plis", "please", "dong"],
  dingin: ["oh", "iya", "oke", "hmm", "bentar"],
  nakal: ["lucu", "ketawa"],
  hangat: ["baik", "hebat", "tolong"],
};

export function moodSignals(raw: string): { signals: Signals; hits: Record<ToneKey, string[]> } {
  return moodSignalsFromTokens(normalize(raw).tokens);
}

export function moodSignalsFromTokens(tokens: string[]): { signals: Signals; hits: Record<ToneKey, string[]> } {
  const padded = ` ${tokens.join(" ")} `;

  const signals: Signals = { hangat: 0, manja: 0, dingin: 0, nakal: 0 };
  const hits: Record<ToneKey, string[]> = { hangat: [], manja: [], dingin: [], nakal: [] };

  for (const tone of TONES) {
    for (const word of STRONG[tone]) {
      if (padded.includes(` ${word} `)) {
        signals[tone] += 0.8;
        hits[tone].push(word);
      }
    }
    for (const word of WEAK[tone]) {
      if (padded.includes(` ${word} `)) {
        signals[tone] += 0.2;
        hits[tone].push(word);
      }
    }
    signals[tone] = Math.min(1.4, signals[tone]);
  }

  return { signals, hits };
}

export function nextMood(
  prev: MoodState | null,
  signals: Signals,
  hits: Record<ToneKey, string[]>,
  persona: Persona,
  forced: ToneKey | null,
  now: number = Date.now(),
): MoodState {
  const score: Signals = { ...persona.baseline };
  let reason = "";

  if (prev) {
    const hours = Math.max(0, (now - prev.updated_at) / 3_600_000);
    const keep = hours >= persona.moodForgetHours ? 0 : persona.inertia * (1 - hours / persona.moodForgetHours);
    score[prev.mood] += keep;

    if (prev.mood !== "dingin" && hours >= 2 && hours < 48) {
      score.dingin += 0.22;
      reason = "kamu lama tidak chat";
    }
  }

  for (const tone of TONES) {
    score[tone] += signals[tone];
  }

  // kata pemicu terkuat jadi alasan (pakai kata yang benar-benar cocok)
  let topTone: ToneKey | null = null;
  let topSignal = 0;
  for (const tone of TONES) {
    if (signals[tone] > topSignal) {
      topSignal = signals[tone];
      topTone = tone;
    }
  }
  if (topTone && topSignal >= 0.8 && hits[topTone]?.length) {
    reason = `kata "${hits[topTone][0]}"`;
  }

  // sedikit ketidakpastian supaya tidak monoton
  for (const tone of TONES) score[tone] += Math.random() * persona.moodJitter;

  if (forced) {
    score[forced] += 5;
    reason = "kamu yang minta";
  }

  let best: ToneKey = "hangat";
  let bestScore = -Infinity;
  for (const tone of TONES) {
    if (score[tone] > bestScore) {
      bestScore = score[tone];
      best = tone;
    }
  }

  const sorted = TONES.map((t) => score[t]).sort((a, b) => b - a);
  const intensity = Math.max(0, Math.min(1, (sorted[0] - sorted[1]) / 2));

  return { mood: best, intensity, reason, updated_at: now };
}

export function loadMood(store: Store, userId: string): MoodState | null {
  const row = store.get(`SELECT mood, intensity, reason, updated_at FROM mood WHERE user_id = ?`, userId);
  if (!row) return null;
  const mood = String(row.mood) as ToneKey;
  if (!TONES.includes(mood)) return null;
  return {
    mood,
    intensity: Number(row.intensity),
    reason: row.reason ? String(row.reason) : "",
    updated_at: Number(row.updated_at),
  };
}

export function saveMood(store: Store, userId: string, state: MoodState): void {
  store.run(
    `INSERT INTO mood (user_id, mood, intensity, reason, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       mood = excluded.mood,
       intensity = excluded.intensity,
       reason = excluded.reason,
       updated_at = excluded.updated_at`,
    userId,
    state.mood,
    state.intensity,
    state.reason,
    state.updated_at,
  );
}

export function clearMood(store: Store, userId: string): void {
  store.run(`DELETE FROM mood WHERE user_id = ?`, userId);
}
