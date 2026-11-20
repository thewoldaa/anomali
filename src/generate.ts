/**
 * generate.ts — menghasilkan korpus latih ("2 juta tebakan") secara
 * kombinatorial dari seed intent.
 *
 * Satu baris korpus = satu contoh: kalimat user -> intent + nada + respons.
 * Baris-barisnya sengaja banyak yang mirip; compiler akan menyaringnya menjadi
 * indeks n-gram yang kecil dan cepat (lihat compile.ts).
 *
 * Pakai:
 *   node src/generate.ts                 # 2.000.000 baris
 *   node src/generate.ts --rows 20000    # tes cepat
 *   node src/generate.ts --rows 5000000  # lebih banyak
 */
import fs from "node:fs";
import path from "node:path";
import { CORPUS_PATH, CORPUS_META_PATH } from "./store.ts";
import { loadSeeds } from "./seeds.ts";
import type { IntentSeed } from "./types.ts";

// ---------------------------------------------------------------- argumen
const args = process.argv.slice(2);
function argNum(flag: string, fallback: number): number {
  const i = args.indexOf(flag);
  if (i === -1) return fallback;
  const v = Number(args[i + 1]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}
const TARGET = argNum("--rows", 10_000_000);
const SEED = argNum("--seed", 1337);

// ---------------------------------------------------------------- varian
const PRONOUN_STYLES: Array<(s: string) => string> = [
  (s) => s,
  (s) => s.replace(/\baku\b/g, "gue").replace(/\bkamu\b/g, "lo").replace(/\bsaya\b/g, "gue"),
  (s) => s.replace(/\baku\b/g, "saya").replace(/\bkamu\b/g, "kamu").replace(/\baku\b/g, "saya"),
  (s) => s.replace(/\baku\b/g, "gw").replace(/\bkamu\b/g, "elu").replace(/\bsaya\b/g, "gw"),
];

const SLANG_STYLES: Array<(s: string) => string> = [
  (s) => s,
  (s) =>
    s
      .replace(/\btidak\b/g, "gak")
      .replace(/\bsudah\b/g, "udah")
      .replace(/\bbanget\b/g, "bgt")
      .replace(/\bbagaimana\b/g, "gimana")
      .replace(/\bkenapa\b/g, "knp")
      .replace(/\bmakasih\b/g, "mksh"),
];

const BASE_PREFIXES = [
  "", "eh ", "hmm ", "btw ", "jujur ", "sebenernya ", "sayang ", "beb ",
  "woy ", "sumpah ", "kamu tau gak ", "aku mau bilang ",
];

/** Prefix gabungan yang tetap terasa alami kalau ruang varian perlu diperluas. */
const EXTRA_PREFIXES = [
  "eh jujur ", "eh btw ", "hmm btw ", "eh iya ", "iya eh ",
  "jujur deh ", "sumpah deh ", "sebenernya sih ", "kak eh ", "duh ",
];

// akhiran conversation filler. Semuanya dinormalisasi jadi kosong, jadi
// variasinya sengaja tidak menambah indeks — hanya merepresentasikan chat asli.
const BASE_SUFFIXES = ["", " sih", " dong", " deh", " ya", " nih"];

const PS = PRONOUN_STYLES.length;
const SL = SLANG_STYLES.length;

// ---------------------------------------------------------------- seed
type Core = { slug: string; tone: string; out: string; trigger: string };

function buildCores(seeds: IntentSeed[]): Core[] {
  const cores: Core[] = [];
  for (const it of seeds) {
    if (!it.triggers || it.triggers.length === 0) continue;
    for (const [tone, outs] of Object.entries(it.responses)) {
      for (const out of outs) {
        for (const trigger of it.triggers) {
          cores.push({ slug: it.slug, tone, out, trigger });
        }
      }
    }
  }
  return cores;
}

/** Tambah prefix HANYA kalau ruang varian belum cukup besar. */
function buildPrefixes(minPerCore: number, coreCount: number): string[] {
  const prefixes = [...BASE_PREFIXES];
  const enough = (): boolean => prefixes.length * BASE_SUFFIXES.length * PS * SL * coreCount >= minPerCore;

  for (const p of EXTRA_PREFIXES) {
    if (enough()) return prefixes;
    prefixes.push(p);
  }
  if (enough()) return prefixes;

  outer: for (const a of BASE_PREFIXES) {
    for (const b of BASE_PREFIXES) {
      if (!a || !b) continue;
      prefixes.push(a + b);
      if (enough()) break outer;
    }
  }
  return prefixes;
}

function gcd(a: number, b: number): number {
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

// ---------------------------------------------------------------- main
const seeds = loadSeeds();
const cores = buildCores(seeds);
if (cores.length === 0) throw new Error("Tidak ada core (cek triggers/responses di data/intents).");

let prefixes = buildPrefixes(TARGET, cores.length);
const suffixes = BASE_SUFFIXES;
const P = prefixes.length;
const S = suffixes.length;
const perCore = P * S * PS * SL;
const total = cores.length * perCore;
const rows = Math.min(TARGET, total);

console.log(`seed intent      : ${seeds.length}`);
console.log(`core (intent×nada×respons×trigger): ${cores.length}`);
console.log(`variasi per core : ${perCore}  (prefix ${P} × suffix ${S} × ganti-kata ${PS} × slang ${SL})`);
console.log(`total kombinasi  : ${total.toLocaleString("id-ID")}`);
console.log(`baris ditulis    : ${rows.toLocaleString("id-ID")}`);

// permutasi deterministik supaya sampel menyebar merata, tidak menumpuk
let stride = 100003;
while (gcd(stride, total) !== 1) stride++;
const offset = (SEED * 7919) % total;

const out = fs.createWriteStream(CORPUS_PATH, { encoding: "utf8" });
let buffer: string[] = [];

function flush(): void {
  if (buffer.length === 0) return;
  out.write(buffer.join("\n") + "\n");
  buffer = [];
}

const started = Date.now();

for (let k = 0; k < rows; k++) {
  const g = (offset + k * stride) % total;
  const core = cores[Math.floor(g / perCore)];
  let local = g % perCore;

  const p = local % P;
  local = Math.floor(local / P);
  const s = local % S;
  local = Math.floor(local / S);
  const ps = local % PS;
  local = Math.floor(local / PS);
  const sl = local % SL;

  let phrase = PRONOUN_STYLES[ps](core.trigger);
  phrase = SLANG_STYLES[sl](phrase);
  const input = `${prefixes[p]}${phrase}${suffixes[s]}`.replace(/\s+/g, " ").trim();

  buffer.push(JSON.stringify({ in: input, i: core.slug, t: core.tone, o: core.out }));
  if (buffer.length >= 4000) flush();

  if ((k + 1) % 250_000 === 0) {
    const secs = (Date.now() - started) / 1000;
    process.stderr.write(`  ${(k + 1).toLocaleString("id-ID")} baris  (${secs.toFixed(1)}s)\n`);
  }
}

flush();
await new Promise<void>((resolve, reject) => {
  out.on("error", reject);
  out.end(() => resolve());
});

const secs = (Date.now() - started) / 1000;
const bytes = fs.statSync(CORPUS_PATH).size;

fs.writeFileSync(
  CORPUS_META_PATH,
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      rows,
      combinations: total,
      seeds: seeds.length,
      cores: cores.length,
      variants_per_core: perCore,
      seed: SEED,
      bytes,
    },
    null,
    2,
  ),
);

console.log(`\nselesai: ${rows.toLocaleString("id-ID")} baris dalam ${secs.toFixed(1)}s`);
console.log(`file    : ${path.relative(process.cwd(), CORPUS_PATH)}  (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
console.log(`lanjut  : npm run build`);
