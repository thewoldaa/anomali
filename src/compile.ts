/**
 * compile.ts — mengubah korpus JSONL besar menjadi indeks SQLite kecil.
 *
 * Ide intinya: 2 juta baris itu 90% duplikat permukaan ("eh kangen kamu",
 * "kangen kamu sih", dst). Kita normalisasi, dedupe, lalu simpan hanya
 * n-gram yang benar-benar membedakan intent. Hasilnya database puluhan MB
 * yang bisa menjawab dalam hitungan milidetik.
 */
import fs from "node:fs";
import readline from "node:readline";
import { Store, DB_PATH, CORPUS_PATH, SCHEMA } from "./store.ts";
import { normalize } from "./normalize.ts";
import { skipNgram } from "./stopwords.ts";
import { loadSeeds } from "./seeds.ts";

// ---------------------------------------------------------------- seed

if (!fs.existsSync(CORPUS_PATH)) {
  console.error("Korpus belum ada. Jalankan dulu:  npm run gen");
  process.exit(1);
}

const started = Date.now();
const seeds = loadSeeds();

// ---------------------------------------------------------------- db baru
for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
  try {
    fs.unlinkSync(f);
  } catch {
    /* memang belum ada */
  }
}
const store = new Store(DB_PATH);
store.db.exec(SCHEMA);

console.log(`seed intent: ${seeds.length}`);

// ---------------------------------------------------------------- intent + respons
const slugToId = new Map<string, number>();

store.tx(() => {
  for (const it of seeds) {
    const tones = Object.keys(it.responses);
    const allTexts = Object.values(it.responses).flat();
    const needsName = allTexts.some((t) => t.includes("{nama}")) ? 1 : 0;

    const info = store.run(
      `INSERT INTO intent (slug, label, priority, tones, guess, needs_name, responses_no_memory)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      it.slug,
      it.label ?? it.slug,
      it.priority ?? 0,
      JSON.stringify(tones),
      it.guess ?? null,
      needsName,
      it.responses_no_memory ? JSON.stringify(it.responses_no_memory) : null,
    );
    const id = Number(info.lastInsertRowid);
    slugToId.set(it.slug, id);

    for (const [tone, arr] of Object.entries(it.responses)) {
      for (const text of arr) {
        store.run(`INSERT OR IGNORE INTO response (intent_id, tone, text) VALUES (?, ?, ?)`, id, tone, text);
      }
    }

    for (const t of it.triggers ?? []) {
      const base = normalize(t).text;
      if (base) store.run(`INSERT OR IGNORE INTO base_trigger (text, intent_id) VALUES (?, ?)`, base, id);
    }
  }
});

// ---------------------------------------------------------------- hitung trigram
const counts = new Map<string, number>(); // "ngram\u0000intentId" -> jumlah

function bump(text: string, intentId: number): void {
  const norm = normalize(text);
  if (norm.ngrams.length === 0) return;
  const uniq = new Set(norm.ngrams);
  for (const g of uniq) {
    if (skipNgram(g)) continue;
    const key = `${g}\u0000${intentId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
}

// trigger dasar selalu ikut, apa pun hasil sampling korpus
for (const it of seeds) {
  const id = slugToId.get(it.slug);
  if (id === undefined) continue;
  for (const t of it.triggers ?? []) bump(t, id);
}

// ---------------------------------------------------------------- baca korpus
const rl = readline.createInterface({
  input: fs.createReadStream(CORPUS_PATH, { encoding: "utf8" }),
  crlfDelay: Infinity,
});

// teks ternormalisasi -> himpunan intent. Inilah dedupe-nya.
const uniqueTexts = new Map<string, Set<number>>();
let lines = 0;
let skipped = 0;

for await (const line of rl) {
  if (!line) continue;
  lines++;

  let row: { in?: string; i?: string };
  try {
    row = JSON.parse(line);
  } catch {
    skipped++;
    continue;
  }
  if (!row.in || !row.i) continue;

  const id = slugToId.get(row.i);
  if (id === undefined) continue;

  const norm = normalize(row.in);
  if (norm.tokens.length === 0) continue;

  let set = uniqueTexts.get(norm.text);
  if (!set) {
    set = new Set();
    uniqueTexts.set(norm.text, set);
  }
  set.add(id);

  if (lines % 500_000 === 0) {
    process.stderr.write(`  baca ${lines.toLocaleString("id-ID")} baris → ${uniqueTexts.size.toLocaleString("id-ID")} unik\n`);
  }
}

console.log(`korpus    : ${lines.toLocaleString("id-ID")} baris`);
console.log(`unik      : ${uniqueTexts.size.toLocaleString("id-ID")} kalimat ternormalisasi`);
if (skipped) console.log(`dilewati  : ${skipped} baris JSON rusak`);

// ---------------------------------------------------------------- masukkan indeks
for (const [text, ids] of uniqueTexts) {
  const tokens = text.split(" ");
  const ngrams: string[] = [];
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i + n <= tokens.length; i++) ngrams.push(tokens.slice(i, i + n).join(" "));
  }
  for (const id of ids) {
    for (const g of ngrams) {
      if (skipNgram(g)) continue;
      const key = `${g}\u0000${id}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
}

store.tx(() => {
  for (const [key, hits] of counts) {
    const sep = key.lastIndexOf("\u0000");
    const ngram = key.slice(0, sep);
    const intentId = Number(key.slice(sep + 1));
    store.run(`INSERT OR REPLACE INTO trig (ngram, intent_id, hits) VALUES (?, ?, ?)`, ngram, intentId, hits);
  }
});

store.db.exec(`INSERT OR REPLACE INTO df (ngram, n) SELECT ngram, COUNT(*) FROM trig GROUP BY ngram`);
store.db.exec(`INSERT OR REPLACE INTO vocab (token) SELECT ngram FROM df WHERE instr(ngram, ' ') = 0`);

// ---------------------------------------------------------------- statistik
const ngramCount = Number(store.get(`SELECT COUNT(*) AS n FROM df`).n);
const trigCount = Number(store.get(`SELECT COUNT(*) AS n FROM trig`).n);
const vocabCount = Number(store.get(`SELECT COUNT(*) AS n FROM vocab`).n);
const respCount = Number(store.get(`SELECT COUNT(*) AS n FROM response`).n);

const setMeta = (k: string, v: string): void => {
  store.run(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, k, v);
};
setMeta("ngram_count", String(ngramCount));
setMeta("trig_rows", String(trigCount));
setMeta("vocab_size", String(vocabCount));
setMeta("response_rows", String(respCount));
setMeta("corpus_rows", String(lines));
setMeta("unique_texts", String(uniqueTexts.size));
setMeta("built_at", new Date().toISOString());

store.db.exec("PRAGMA optimize");
store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");

const dbBytes = fs.statSync(DB_PATH).size;
const secs = (Date.now() - started) / 1000;

console.log(`\nindeks n-gram : ${ngramCount.toLocaleString("id-ID")}`);
console.log(`pasangan trig : ${trigCount.toLocaleString("id-ID")}`);
console.log(`kosakata      : ${vocabCount.toLocaleString("id-ID")}`);
console.log(`respons unik  : ${respCount.toLocaleString("id-ID")}`);
console.log(`database      : ${(dbBytes / 1024 / 1024).toFixed(1)} MB (data/brain.db)`);
console.log(`waktu build   : ${secs.toFixed(1)}s`);
console.log(`\nlanjut: npm run chat   atau   npm run web`);
