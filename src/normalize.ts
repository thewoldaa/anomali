/**
 * Normalisasi teks Indonesia + pemecahan n-gram.
 *
 * Tiga lapis, semuanya dijalankan SEBELUM teks dihitung:
 *   1. koreksi frasa  (data/fixes.json)
 *   2. kamus singkatan (data/slang.json) + buang filler
 *   3. koreksi typo per kata (src/fuzzy.ts, dipanggil engine)
 *
 * Baik korpus latih maupun input user melewati jalur yang sama.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "data", file), "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Kamus slang/singkatan -> bentuk baku. Nilai "" berarti token dibuang. */
export const SLANG: Record<string, string> = loadJson<Record<string, string>>("slang.json", {});

/** Kata umum yang sah; tidak boleh "dikoreksi" oleh fuzzy. */
const COMMON_WORDS: string[] = loadJson<string[]>("words.json", []);

export const KNOWN_WORDS: Set<string> = new Set([
  ...Object.keys(SLANG),
  ...Object.values(SLANG).filter((v) => Boolean(v)),
  ...COMMON_WORDS,
]);

type FixData = { phrases?: Record<string, string> };

const PHRASES: Record<string, string> = loadJson<FixData>("fixes.json", {}).phrases ?? {};
const PHRASE_KEYS = Object.keys(PHRASES).sort((a, b) => b.length - a.length);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type Fix = { from: string; to: string };

/** Koreksi frasa yang sering salah ketik, contoh: "apa ka bar" -> "apa kabar". */
export function applyPhraseFixes(raw: string): { text: string; fixes: Fix[] } {
  let text = raw;
  const fixes: Fix[] = [];

  for (const key of PHRASE_KEYS) {
    const re = new RegExp(`\\b${escapeRegExp(key)}\\b`, "gi");
    if (!re.test(text)) continue;
    re.lastIndex = 0;
    text = text.replace(re, PHRASES[key]);
    fixes.push({ from: key, to: PHRASES[key] });
  }

  return { text, fixes };
}

const MAX_TOKENS = 40;

export type Normalized = {
  raw: string;
  text: string;
  tokens: string[];
  ngrams: string[];
  phraseFixes: Fix[];
};

/**
 * @param text input mentah dari user / korpus
 */
export function normalize(text: string): Normalized {
  const raw = String(text ?? "").trim();
  const fixed = applyPhraseFixes(raw);

  const cleaned = fixed.text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const parts = cleaned.split(" ").filter(Boolean);
  const tokens: string[] = [];

  for (const p of parts) {
    if (tokens.length >= MAX_TOKENS) break;
    const mapped = SLANG[p];
    if (mapped === "") continue;
    const token = mapped ?? p;
    if (token) tokens.push(token);
  }

  return { raw, text: tokens.join(" "), tokens, ngrams: ngramsOf(tokens), phraseFixes: fixed.fixes };
}

/** Bangun n-gram 1..3 kata dari daftar token. */
export function ngramsOf(tokens: string[]): string[] {
  const ngrams: string[] = [];
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i + n <= tokens.length; i++) {
      ngrams.push(tokens.slice(i, i + n).join(" "));
    }
  }
  return ngrams;
}

/** Buang token duplikat, urutan dipertahankan. */
export function uniqueStrings(items: string[]): string[] {
  return [...new Set(items)];
}
