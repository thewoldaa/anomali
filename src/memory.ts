/**
 * Ekstraksi & penyimpanan fakta user.
 *
 * Aturan main: nama yang user sebut secara eksplisit ("namaku X") berkonfidensi
 * tinggi dan disimpan permanen. Nama tidak pernah dihapus kecuali user minta
 * (/lupakan) atau menyebut nama baru secara eksplisit.
 */
import type { Store } from "./store.ts";
import { SLANG } from "./normalize.ts";

export type Extracted = {
  key: string;
  value: string;
  source: string;
  confidence: number;
};

const PET_NAMES = new Set([
  "sayang", "beb", "bebeb", "cinta", "ayang", "cayang", "sayangku", "manis",
  "darling", "honey", "dear", "bubub", "bub", "pacar", "pacarku", "bebs",
]);

/** Kata yang tidak mungkin jadi nama. */
const STOP = new Set([
  "aku", "kamu", "saya", "dia", "kami", "kita", "mereka", "anda",
  "adalah", "itu", "ini", "yang", "dan", "atau", "tapi", "juga", "saja",
  "tidak", "sudah", "belum", "mau", "ingin", "pengen", "bisa", "akan",
  "lagi", "sih", "deh", "dong", "nih", "kok", "ya", "yah", "kan", "lah",
  "banget", "sekali", "pasti", "mungkin", "harus", "sedang", "masih",
  "siapa", "apa", "kenapa", "bagaimana", "kapan", "dimana", "kemana",
  "capek", "sedih", "senang", "marah", "kesel", "kangen", "rindu", "sayang",
  "baik", "buruk", "bagus", "jelek", "manis", "lucu", "ganteng", "cantik",
  "makan", "minum", "tidur", "kerja", "kuliah", "sekolah", "main", "pergi",
  "pagi", "siang", "sore", "malam", "hari", "besok", "kemarin", "sekarang",
  "bot", "robot", "manusia", "ai", "kamu", "aku", "orang", "teman",
  "namaku", "nama", "panggil", "panggilan", "kenal", "kenalan",
]);

const NAME_RE = [
  // namaku X / nama saya X / nama gue X
  {
    re: /\bnama\s*(?:ku|saya|gue|gw|aku)\s*(?:itu|tuh|adalah|ialah)?\s+([a-zA-Z][\w.-]{1,19})/i,
    confidence: 0.97,
  },
  // nama: X
  {
    re: /\bnama\s*(?:itu|tuh|adalah|ialah)?\s*:\s*([a-zA-Z][\w.-]{1,19})/i,
    confidence: 0.95,
  },
  // panggil aku X / panggil aja X
  {
    re: /\bpanggil(?:an)?\s+(?:aku|saya|gue|gw)\s+(?:aja\s+|saja\s+)?([a-zA-Z][\w.-]{1,19})/i,
    confidence: 0.95,
  },
  // my name is X / call me X
  {
    re: /\b(?:my\s+name\s+is|call\s+me)\s+([a-zA-Z][\w.-]{1,19})/i,
    confidence: 0.95,
  },
  // i'm X
  {
    re: /\bi\s*am\s+([a-zA-Z][\w.-]{1,19})/i,
    confidence: 0.6,
  },
];

/** Pola lemah: "aku X" di akhir kalimat pendek. Butuh validasi ketat. */
const WEAK_RE = /\b(?:aku|gue|gw|saya|sy)\s+(?:itu\s+|tuh\s+|adalah\s+|bernama\s+|namanya\s+)?([a-zA-Z][\w.-]{1,19})\s*[.!?]*\s*$/i;

/**
 * @param strict dipakai untuk pola lemah ("aku X"): tolak semua kata yang
 *               sudah dikenal sebagai kosakata intent, karena kemungkinan
 *               besar itu bukan nama.
 */
function acceptable(word: string, vocab: Set<string>, strict: boolean): boolean {
  if (!word) return false;
  if (word.length < 2 || word.length > 20) return false;
  if (!/^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(word)) return false;
  const lower = word.toLowerCase();
  if (STOP.has(lower)) return false;
  if (PET_NAMES.has(lower)) return false;
  if (SLANG[lower] !== undefined) return false; // "gak", "gw", "lu", ...
  if (strict && vocab.has(lower)) return false;
  if (/^\d+$/.test(lower)) return false;
  return true;
}

/**
 * Perbaiki penanda perkenalan yang sering salah ketik sebelum regex dijalankan.
 */
const MARKER_FIXES: Array<[RegExp, string]> = [
  [/\bnamak+u\b/gi, "namaku"],
  [/\bnamakuh\b/gi, "namaku"],
  [/\bnmaku\b/gi, "namaku"],
  [/\bnama\s+aq\b/gi, "nama aku"],
  [/\bpanggil\s+aq\b/gi, "panggil aku"],
];

function fixMarkers(raw: string): string {
  let text = raw;
  for (const [re, rep] of MARKER_FIXES) text = text.replace(re, rep);
  return text;
}

/**
 * Ambil nama/panggilan dari pesan mentah.
 * @param raw pesan asli (bukan hasil normalisasi, karena butuh huruf besar)
 */
export function extractName(raw: string, vocab: Set<string>): Extracted | null {
  const text = fixMarkers(raw.trim());
  if (!text) return null;

  for (const { re, confidence } of NAME_RE) {
    const m = text.match(re);
    if (m && m[1]) {
      const word = m[1];
      if (PET_NAMES.has(word.toLowerCase())) {
        return { key: "pet", value: word.toLowerCase(), source: "user_stated", confidence: 0.9 };
      }
      if (acceptable(word, vocab, false)) {
        return { key: "name", value: word, source: "user_stated", confidence };
      }
    }
  }

  // pola lemah hanya kalau kalimatnya sangat pendek (<= 4 kata) dan tidak
  // mengandung tanda tanya
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 4 && !text.includes("?")) {
    const m = text.match(WEAK_RE);
    if (m && m[1] && acceptable(m[1], vocab, true)) {
      return { key: "name", value: m[1], source: "user_inferred", confidence: 0.55 };
    }
  }

  return null;
}

export function saveFact(
  store: Store,
  userId: string,
  key: string,
  value: string,
  source: string,
  confidence: number,
): void {
  store.run(
    `INSERT INTO fact (user_id, key, value, source, confidence, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, key) DO UPDATE SET
       value = excluded.value,
       source = excluded.source,
       confidence = excluded.confidence,
       updated_at = excluded.updated_at
     WHERE excluded.confidence >= fact.confidence OR fact.source <> 'user_stated'`,
    userId,
    key,
    value,
    source,
    confidence,
    Date.now(),
  );
}

export function getFact(store: Store, userId: string, key: string): { value: string; updated_at: number } | null {
  const row = store.get(
    `SELECT value, updated_at FROM fact WHERE user_id = ? AND key = ?`,
    userId,
    key,
  );
  return row ? { value: String(row.value), updated_at: Number(row.updated_at) } : null;
}

export function listFacts(store: Store, userId: string): { key: string; value: string; updated_at: number }[] {
  return store
    .all(`SELECT key, value, updated_at FROM fact WHERE user_id = ? ORDER BY updated_at DESC`, userId)
    .map((r: any) => ({ key: String(r.key), value: String(r.value), updated_at: Number(r.updated_at) }));
}

export function clearFacts(store: Store, userId: string): number {
  const a = store.run(`DELETE FROM fact WHERE user_id = ?`, userId).changes;
  store.run(`DELETE FROM history WHERE user_id = ?`, userId);
  return Number(a);
}

export function loadVocab(store: Store): Set<string> {
  const rows = store.all(`SELECT token FROM vocab`);
  const set = new Set<string>();
  for (const r of rows) set.add(String(r.token));
  return set;
}
