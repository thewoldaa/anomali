/**
 * engine.ts — mesin tebakan + suasana.
 *
 * Alur:
 *   1. memori nama
 *   2. suasana: sinyal pesan + inersia + waktu  -> manja/dingin/jail/hangat
 *   3. normalisasi & skor n-gram (TF-IDF)
 *   4. pilih nada dari suasana + intent
 *   5. pilih respons (hindari pengulangan lintas sesi)
 *   6. isi slot + jejak berpikir
 */
import { Store, DB_PATH } from "./store.ts";
import { normalize, ngramsOf } from "./normalize.ts";
import { correctTokens } from "./fuzzy.ts";
import { skipNgram, STOP_TOKENS } from "./stopwords.ts";
import { extractName, saveFact, getFact, loadVocab, listFacts, clearFacts } from "./memory.ts";
import { loadPersona, SIMILARITY, toneLabel, TONES } from "./persona.ts";
import type { Persona, ToneKey } from "./persona.ts";
import { moodSignalsFromTokens, nextMood, loadMood, saveMood, clearMood } from "./mood.ts";
import type { MoodState } from "./mood.ts";

export type IntentMeta = {
  id: number;
  slug: string;
  label: string;
  priority: number;
  tones: string[];
  guess: string | null;
  needsName: boolean;
  responsesNoMemory: Record<string, string[]> | null;
};

export type Think = {
  mode: "yakin" | "menebak" | "bingung";
  lines: string[];
};

export type Reply = {
  text: string;
  think: Think;
  intentSlug: string;
  intentLabel: string;
  tone: string;
  toneLabel: string;
  confidence: number;
  name: string | null;
  savedName: string | null;
  mood: { key: string; label: string; intensity: number; reason: string };
  moodChanged: boolean;
};

const LEN_BOOST = [0, 1.0, 1.6, 2.2];
const MIN_MATCH = 0.12;
const CONFIDENT = 0.35;
const DEFAULT_IDF = 8.0;
const RECENT_KEEP = 60;
const RECENT_AVOID = 18;

/** Intent yang jawabannya harus spesifik; jangan dicampur kalimat generik. */
const NO_GENERIC = new Set([
  "tanya-nama-user",
  "perkenalan-nama",
  "privasi",
  "lupakan",
  "minta-tebak",
  "tes-manusia",
  "fallback-nggakpaham",
  "ack-iya",
  "ack-tawa",
  "status",
  "serius",
  "cuek",
]);

function timeOfDay(): string {
  const h = new Date().getHours();
  if (h >= 4 && h < 11) return "pagi";
  if (h >= 11 && h < 15) return "siang";
  if (h >= 15 && h < 18) return "sore";
  return "malam";
}

function formatAge(ts: number): string {
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days <= 0) return "hari ini";
  if (days === 1) return "kemarin";
  return `${days} hari lalu`;
}

export class Engine {
  store: Store;
  userId: string;
  vocab: Set<string>;
  persona: Persona;
  byId: Map<number, IntentMeta>;
  bySlug: Map<string, IntentMeta>;
  ngramCount: number;
  lastIntent: string | null;
  lastTone: string | null;
  mood: MoodState | null;
  forcedMood: ToneKey | null;

  constructor(store: Store, userId: string) {
    this.store = store;
    this.userId = userId;
    this.vocab = loadVocab(store);
    this.persona = loadPersona();
    this.byId = new Map();
    this.bySlug = new Map();
    this.lastIntent = null;
    this.lastTone = null;
    this.mood = loadMood(store, userId);
    this.forcedMood = null;

    const rows = store.all(`SELECT * FROM intent ORDER BY id`);
    for (const r of rows) {
      const meta: IntentMeta = {
        id: Number(r.id),
        slug: String(r.slug),
        label: String(r.label),
        priority: Number(r.priority ?? 0),
        tones: JSON.parse(String(r.tones)),
        guess: r.guess ? String(r.guess) : null,
        needsName: Number(r.needs_name) === 1,
        responsesNoMemory: r.responses_no_memory ? JSON.parse(String(r.responses_no_memory)) : null,
      };
      this.byId.set(meta.id, meta);
      this.bySlug.set(meta.slug, meta);
    }

    const meta = store.get(`SELECT value FROM meta WHERE key = 'ngram_count'`);
    this.ngramCount = meta ? Number(meta.value) : 1;
  }

  static open(userId: string): Engine {
    const store = new Store(DB_PATH);
    try {
      store.get(`SELECT value FROM meta WHERE key = 'built_at'`);
    } catch {
      store.close();
      throw new Error("Database belum dibangun. Jalankan: npm run gen && npm run build");
    }
    const exists = store.get(`SELECT COUNT(*) AS n FROM df`);
    if (!exists || Number(exists.n) === 0) {
      store.close();
      throw new Error("Indeks kosong. Jalankan: npm run gen && npm run build");
    }
    return new Engine(store, userId);
  }

  // -------------------------------------------------------------- publik

  moodLabel(): string {
    return this.mood ? toneLabel(this.persona, this.mood.mood) : "—";
  }

  setForcedMood(tone: ToneKey | null): void {
    this.forcedMood = tone;
  }

  reply(input: string): Reply {
    const raw = String(input ?? "").trim();
    const now = Date.now();
    const prevMood = this.mood;

    // 1. memori
    const extracted = extractName(raw, this.vocab);
    let savedName: string | null = null;
    if (extracted) {
      saveFact(this.store, this.userId, extracted.key, extracted.value, extracted.source, extracted.confidence);
      if (extracted.key === "name") savedName = extracted.value;
    }

    const nameFact = getFact(this.store, this.userId, "name");
    const name = nameFact?.value ?? null;
    const petFact = getFact(this.store, this.userId, "pet");
    const pet = petFact?.value ?? null;

    // 2. normalisasi + koreksi typo (frasa dulu, lalu per kata)
    const norm = normalize(raw);
    const corrected = correctTokens(norm.tokens, this.vocab);
    const tokens = corrected.tokens;
    const ngrams = ngramsOf(tokens);
    const allFixes = [...norm.phraseFixes, ...corrected.fixes];
    // teks yang banyak salah ketik sedikit diturunkan keyakinannya
    const fixPenalty = allFixes.length
      ? Math.max(0.72, 1 - 0.22 * (allFixes.length / Math.max(1, tokens.length)))
      : 1;

    // 3. suasana
    const sig = moodSignalsFromTokens(tokens);
    const forced = this.forcedMood;
    const mood = nextMood(this.mood, sig.signals, sig.hits, this.persona, forced, now);
    this.forcedMood = null;
    this.mood = mood;
    saveMood(this.store, this.userId, mood);
    const moodChanged = Boolean(prevMood && prevMood.mood !== mood.mood);

    // 4. skor
    const weights = new Map<number, number>();
    const hitBonus = new Map<number, number>();
    const matched: { g: string; idf: number; boost: number; w: number }[] = [];
    const seen = new Set<string>();
    let totalW = 0;

    for (const g of ngrams) {
      if (seen.has(g)) continue;
      seen.add(g);
      if (skipNgram(g)) continue;

      const len = g.split(" ").length;
      const boost = LEN_BOOST[len] ?? 1;
      const dfRow = this.store.get(`SELECT n FROM df WHERE ngram = ?`, g);
      const idf = dfRow ? Math.log((this.ngramCount + 1) / (Number(dfRow.n) + 1)) + 1 : DEFAULT_IDF;
      const w = idf * boost;
      totalW += w;

      const rows = this.store.all(`SELECT intent_id, hits FROM trig WHERE ngram = ?`, g);
      if (rows.length) matched.push({ g, idf, boost, w });

      for (const r of rows) {
        const iid = Number(r.intent_id);
        weights.set(iid, (weights.get(iid) ?? 0) + w);
        hitBonus.set(iid, (hitBonus.get(iid) ?? 0) + Math.log1p(Number(r.hits)));
      }
    }
    if (totalW === 0) totalW = 1;

    const exactIds = new Set<number>();
    for (const r of this.store.all(`SELECT intent_id FROM base_trigger WHERE text = ?`, tokens.join(" "))) {
      exactIds.add(Number(r.intent_id));
    }

    type Cand = { id: number; meta: IntentMeta; conf: number; hit: number; exact: boolean };
    const cand = new Map<number, Cand>();

    const consider = (id: number): void => {
      const meta = this.byId.get(id);
      if (!meta || cand.has(id)) return;
      let conf = Math.min(1, (weights.get(id) ?? 0) / totalW) * fixPenalty;
      conf += Math.min(0.05, meta.priority * 0.001);
      if (this.lastIntent && meta.slug === this.lastIntent) conf += 0.02;
      const exact = exactIds.has(id);
      if (exact) conf = Math.max(conf, 0.9);
      cand.set(id, { id, meta, conf: Math.min(1, conf), hit: hitBonus.get(id) ?? 0, exact });
    };
    for (const id of weights.keys()) consider(id);
    for (const id of exactIds) consider(id);

    let ranked = [...cand.values()].sort(
      (a, b) => Number(b.exact) - Number(a.exact) || b.conf + 0.002 * b.hit - (a.conf + 0.002 * a.hit),
    );

    if (savedName) {
      const perkenalan = this.bySlug.get("perkenalan-nama");
      if (perkenalan) {
        const existing = ranked.find((r) => r.id === perkenalan.id);
        if (existing) existing.conf = 1;
        ranked = [
          existing ?? { id: perkenalan.id, meta: perkenalan, conf: 1, hit: 0, exact: true },
          ...ranked.filter((r) => r.id !== perkenalan.id),
        ];
      }
    }

    // fallback + mode
    const fallback = this.bySlug.get("fallback-nggakpaham");
    let chosen = ranked[0];
    let mode: Think["mode"];

    // bukti dianggap cukup kalau kata bermakna di pesan tertangkap,
    // atau ada frasa yang cocok, atau keyakinannya tinggi
    const contentTokens = tokens.filter((t) => !STOP_TOKENS.has(t));
    const matchedContent = new Set<string>();
    for (const m of matched) {
      for (const t of m.g.split(" ")) {
        if (!STOP_TOKENS.has(t)) matchedContent.add(t);
      }
    }
    const coverage = contentTokens.length ? matchedContent.size / contentTokens.length : 0;
    const weak = Boolean(chosen) && !chosen.exact && coverage < 0.5 && chosen.conf < 0.25;

    if (!chosen || chosen.conf < MIN_MATCH || weak) {
      if (!fallback) throw new Error("intent fallback-nggakpaham tidak ada di data/intents");
      chosen = { id: fallback.id, meta: fallback, conf: 0, hit: 0, exact: false };
      mode = "bingung";
    } else if (chosen.conf < CONFIDENT) {
      mode = "menebak";
    } else {
      mode = "yakin";
    }

    // kalau dua kandidat hampir seri, jangan sok yakin
    if (mode === "yakin" && !chosen.exact && ranked[1] && chosen.conf - ranked[1].conf < 0.06) {
      mode = "menebak";
    }

    // 4. nada dari suasana
    const isWarm = this.persona.warmIntents.includes(chosen.meta.slug);
    const tone = this.pickTone(chosen.meta, mood.mood, isWarm, Boolean(forced));

    // 5. respons
    let text = this.pickResponse(chosen.meta, tone.tone, name);
    text = this.render(text, name, pet);
    if (mode === "menebak" && chosen.meta.guess) {
      text = `${this.render(chosen.meta.guess, name, pet)} ${text}`;
    }

    // 6. jejak
    const lines: string[] = [];
    lines.push(
      mode === "yakin"
        ? "aku nangkep maksud kamu."
        : mode === "menebak"
          ? "aku nebak-nebak dulu ya..."
          : "aku belum yakin ini soal apa.",
    );
    lines.push(`token   : ${norm.tokens.slice(0, 10).join(" ") || "(kosong)"}`);
    if (allFixes.length) {
      lines.push(`koreksi : ${allFixes.map((f) => `${f.from}→${f.to}`).join(" · ")}`);
    }
    if (matched.length) {
      const top = [...matched].sort((a, b) => b.idf * b.boost - a.idf * a.boost).slice(0, 3);
      lines.push(`sinyal  : ${top.map((m) => `"${m.g}" ${(m.idf * m.boost).toFixed(1)}`).join(" · ")}`);
    }
    lines.push(
      `kandidat: ${
        ranked
          .slice(0, 3)
          .map((r) => `${r.meta.slug} ${r.conf.toFixed(2)}`)
          .join(" · ") || "—"
      }`,
    );
    lines.push(
      `suasana : ${this.label(mood.mood)} · ${mood.intensity.toFixed(2)}${mood.reason ? ` (${mood.reason})` : ""}`,
    );
    if (moodChanged && prevMood) {
      lines.push(`berubah : ${this.label(prevMood.mood)} → ${this.label(mood.mood)}`);
    }
    lines.push(`nada    : ${this.label(tone.tone)}${tone.reason ? ` (${tone.reason})` : ""}`);
    if (name) lines.push(`memori  : nama=${name}${nameFact ? ` · tersimpan ${formatAge(nameFact.updated_at)}` : ""}`);
    if (savedName) lines.push(`baru    : nama "${savedName}" disimpan permanen`);

    // riwayat
    this.store.run(
      `INSERT INTO history (user_id, role, text, intent_slug, tone, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      this.userId,
      "user",
      raw,
      chosen.meta.slug,
      tone.tone,
      chosen.conf,
      now,
    );
    this.store.run(
      `INSERT INTO history (user_id, role, text, intent_slug, tone, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      this.userId,
      "bot",
      text,
      chosen.meta.slug,
      tone.tone,
      chosen.conf,
      now,
    );

    this.lastIntent = chosen.meta.slug;
    this.lastTone = tone.tone;

    return {
      text,
      think: { mode, lines },
      intentSlug: chosen.meta.slug,
      intentLabel: chosen.meta.label,
      tone: tone.tone,
      toneLabel: this.label(tone.tone),
      confidence: chosen.conf,
      name,
      savedName,
      mood: {
        key: mood.mood,
        label: this.label(mood.mood),
        intensity: mood.intensity,
        reason: mood.reason,
      },
      moodChanged,
    };
  }

  profile(): {
    facts: { key: string; value: string; updated_at: number }[];
    turns: number;
    mood: { key: string; label: string; intensity: number; reason: string } | null;
  } {
    const facts = listFacts(this.store, this.userId);
    const row = this.store.get(`SELECT COUNT(*) AS n FROM history WHERE user_id = ? AND role = 'user'`, this.userId);
    return {
      facts,
      turns: row ? Number(row.n) : 0,
      mood: this.mood
        ? {
            key: this.mood.mood,
            label: this.label(this.mood.mood),
            intensity: this.mood.intensity,
            reason: this.mood.reason,
          }
        : null,
    };
  }

  reset(): number {
    const removed = clearFacts(this.store, this.userId);
    clearMood(this.store, this.userId);
    this.store.run(`DELETE FROM recent_response WHERE user_id = ?`, this.userId);
    this.mood = null;
    this.forcedMood = null;
    this.lastIntent = null;
    this.lastTone = null;
    return removed;
  }

  // -------------------------------------------------------------- internal

  private label(tone: string): string {
    return toneLabel(this.persona, tone);
  }

  private pickTone(
    meta: IntentMeta,
    mood: ToneKey,
    isWarm: boolean,
    strict: boolean,
  ): { tone: ToneKey; reason: string } {
    const available = (meta.tones as ToneKey[]).filter((t) => TONES.includes(t));
    if (available.length === 0) return { tone: "hangat", reason: "" };

    let pool = available;
    let reason = `suasana ${this.label(mood)}`;

    // intent yang butuh kelembutan tidak boleh didinginkan
    if (isWarm) {
      const soft = available.filter((t) => t === "hangat" || t === "manja");
      if (soft.length) {
        pool = soft;
        reason = "kamu sedang butuh ditemani";
      }
    }

    const sim = SIMILARITY[mood];
    let best = pool[0];
    let bestScore = -Infinity;
    for (const tone of pool) {
      const proximity = tone === mood ? (strict ? 50 : 6) : 1;
      const base = (sim[tone] ?? 0.1) * proximity;
      const score = base * (0.85 + Math.random() * 0.3);
      if (score > bestScore) {
        bestScore = score;
        best = tone;
      }
    }

    if (!isWarm && best !== mood) {
      reason = `suasana ${this.label(mood)}, tapi ${this.label(best)} lebih pas di sini`;
    }
    if (strict && best === mood) reason = "kamu yang minta";

    return { tone: best, reason };
  }

  private pickResponse(meta: IntentMeta, tone: ToneKey, name: string | null): string {
    const recent = new Set(
      this.store
        .all(
          `SELECT text FROM recent_response WHERE user_id = ? AND intent_id = ? ORDER BY id DESC LIMIT ?`,
          this.userId,
          meta.id,
          RECENT_AVOID,
        )
        .map((r: any) => String(r.text)),
    );

    let pool: string[] = [];

    if (!name && meta.responsesNoMemory) {
      const nm = meta.responsesNoMemory;
      const arr = (nm[tone] as string[] | undefined) ?? (Object.values(nm)[0] as string[] | undefined) ?? [];
      pool = [...arr];
    }

    if (pool.length === 0) {
      pool = this.store
        .all(`SELECT text FROM response WHERE intent_id = ? AND tone = ?`, meta.id, tone)
        .map((r: any) => String(r.text));
    }

    if (pool.length === 0) {
      pool = this.store
        .all(`SELECT text FROM response WHERE intent_id = ?`, meta.id)
        .map((r: any) => String(r.text));
    }

    if (pool.length === 0) pool = this.persona.fallback[tone] ?? ["hmm..."];

    // nada dingin yang stoknya tipis ditambah kalimat pendek netral.
    // Kalimat generik jail sengaja TIDAK dipakai: sering tidak nyambung.
    if (tone === "dingin" && pool.length < 5 && !NO_GENERIC.has(meta.slug)) {
      pool = [...new Set([...pool, ...(this.persona.fallback[tone] ?? [])])];
    }

    let fresh = pool.filter((t) => !recent.has(t));
    if (fresh.length === 0) fresh = pool;

    const choice = fresh[Math.floor(Math.random() * fresh.length)];

    this.store.run(
      `INSERT INTO recent_response (user_id, intent_id, text, created_at) VALUES (?, ?, ?, ?)`,
      this.userId,
      meta.id,
      choice,
      Date.now(),
    );
    this.store.run(
      `DELETE FROM recent_response WHERE user_id = ? AND id NOT IN (
         SELECT id FROM recent_response WHERE user_id = ? ORDER BY id DESC LIMIT ?
       )`,
      this.userId,
      this.userId,
      RECENT_KEEP,
    );

    return choice;
  }

  private render(text: string, name: string | null, pet: string | null): string {
    let out = text;
    if (name) {
      out = out.replace(/\{nama\}/g, name);
    } else {
      out = out.replace(/,\s*\{nama\}/g, "").replace(/\{nama\},\s*/g, "").replace(/\{nama\}/g, "kamu");
    }
    out = out.replace(/\{panggilan\}/g, pet ?? "kamu");
    out = out.replace(/\{waktu\}/g, timeOfDay());
    return out
      .replace(/\s+/g, " ")
      .replace(/\s+([,.!?])/g, "$1")
      .trim();
  }
}
