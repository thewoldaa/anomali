#!/usr/bin/env node
/**
 * CLI obrolan.
 *   npm run chat
 *   npm run chat -- --user craftkal
 *   npm run chat -- --think
 */
import readline from "node:readline";
import os from "node:os";
import fs from "node:fs";
import { Engine } from "./engine.ts";
import type { Reply } from "./engine.ts";
import { DB_PATH } from "./store.ts";

const args = process.argv.slice(2);
function argValue(flag: string): string | null {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

const userId = argValue("--user") ?? process.env.ANOMALI_USER ?? os.userInfo().username ?? "kamu";
let showThink = args.includes("--think");

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = paint("2");
const bold = paint("1");
const rose = paint("38;5;211");
const violet = paint("38;5;141");
const slate = paint("38;5;245");

if (!fs.existsSync(DB_PATH)) {
  console.error("Database belum ada. Jalankan dulu:\n  npm run gen\n  npm run build");
  process.exit(1);
}

let engine: Engine;
try {
  engine = Engine.open(userId);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const profileAtStart = engine.profile();
const nameAtStart = profileAtStart.facts.find((f) => f.key === "name")?.value ?? null;

console.log("");
console.log(rose("  anomali") + dim("  ·  mesin tebakan n-gram + memori + suasana"));
if (nameAtStart) {
  console.log(dim("  aku ingat kamu, ") + bold(nameAtStart) + dim(". nama itu tersimpan selamanya."));
} else {
  console.log(dim("  coba bilang ") + slate('"namaku ..."') + dim(" dan aku akan mengingatnya selamanya."));
}
if (profileAtStart.mood) {
  console.log(dim("  suasana sekarang: ") + violet(profileAtStart.mood.label) + dim(` · ${profileAtStart.mood.reason || "stabil"}`));
}
console.log(dim("  /bantuan untuk daftar perintah"));
console.log("");

function printThink(reply: Reply): void {
  const head = `${reply.intentSlug} · ${reply.think.mode} · ${reply.confidence.toFixed(2)}`;
  console.log(dim(`  ┌─ tebakan (${head})`));
  for (const line of reply.think.lines) console.log(dim(`  │ ${line}`));
  console.log(dim("  └─"));
}

function promptLabel(): string {
  const name = engine.profile().facts.find((f) => f.key === "name")?.value;
  return `${rose(name ?? "kamu")} ${dim(`[${engine.moodLabel()}]`)}${dim(" > ")}`;
}

function handle(line: string): boolean {
  const text = line.trim();
  if (!text) return true;

  if (text === "/keluar" || text === "/exit" || text === "/quit") return false;

  if (text === "/bantuan" || text === "/help") {
    console.log(dim("  perintah:"));
    console.log(dim("    /think      tampilkan/sembunyikan jejak tebakan"));
    console.log(dim("    /mood       lihat suasana · /mood manja|dingin|jail|hangat|auto"));
    console.log(dim("    /nama       lihat apa yang aku ingat tentang kamu"));
    console.log(dim("    /lupakan    hapus semua ingatan tentang kamu (butuh: /lupakan ya)"));
    console.log(dim("    /statistik  ukuran indeks & memori"));
    console.log(dim("    /keluar     keluar"));
    return true;
  }

  if (text === "/mood" || text.startsWith("/mood ")) {
    const arg = text.slice(5).trim();
    if (!arg) {
      const m = engine.mood;
      if (!m) console.log(dim("  belum ada suasana. kirim pesan dulu."));
      else {
        console.log(`  suasana  : ${violet(engine.moodLabel())}`);
        console.log(dim(`  intensitas: ${m.intensity.toFixed(2)}`));
        console.log(dim(`  alasan   : ${m.reason || "stabil"}`));
      }
      return true;
    }
    if (arg === "auto") {
      engine.setForcedMood(null);
      console.log(dim("  suasana kembali otomatis."));
      return true;
    }
    const map: Record<string, "hangat" | "manja" | "dingin" | "nakal"> = {
      hangat: "hangat",
      manja: "manja",
      dingin: "dingin",
      jail: "nakal",
      nakal: "nakal",
    };
    const tone = map[arg];
    if (!tone) {
      console.log(dim("  pilihan: manja · dingin · jail · hangat · auto"));
      return true;
    }
    engine.setForcedMood(tone);
    console.log(dim(`  pesan berikutnya: suasana ${arg}`));
    return true;
  }

  if (text === "/think") {
    showThink = !showThink;
    console.log(dim(`  jejak tebakan: ${showThink ? "tampil" : "sembunyi"}`));
    return true;
  }

  if (text === "/nama") {
    const { facts, turns } = engine.profile();
    if (!facts.length) {
      console.log(dim("  belum ada yang tersimpan. bilang 'namaku ...' dulu."));
    } else {
      for (const f of facts) {
        const when = new Date(f.updated_at).toLocaleString("id-ID");
        console.log(`  ${bold(f.key.padEnd(6))} ${f.value} ${dim(`· ${when}`)}`);
      }
    }
    console.log(dim(`  total pesan kamu: ${turns}`));
    return true;
  }

  if (text === "/lupakan") {
    console.log(dim("  yakin? semua ingatan dihapus permanen. ketik ") + slate("/lupakan ya") + dim(" untuk lanjut."));
    return true;
  }

  if (text === "/lupakan ya") {
    const n = engine.reset();
    console.log(dim(`  ${n} ingatan dihapus. kita mulai dari nol.`));
    return true;
  }

  if (text === "/statistik" || text === "/stats") {
    const s = engine.store;
    const q = (k: string): string => {
      const r = s.get(`SELECT value FROM meta WHERE key = ?`, k);
      return r ? Number(r.value).toLocaleString("id-ID") : "?";
    };
    console.log(dim(`  korpus     : ${q("corpus_rows")} baris`));
    console.log(dim(`  n-gram     : ${q("ngram_count")}`));
    console.log(dim(`  pasangan   : ${q("trig_rows")}`));
    console.log(dim(`  kosakata   : ${q("vocab_size")}`));
    console.log(dim(`  respons    : ${q("response_rows")}`));
    const bytes = fs.statSync(DB_PATH).size;
    console.log(dim(`  database   : ${(bytes / 1024 / 1024).toFixed(1)} MB`));
    return true;
  }

  const reply = engine.reply(text);
  if (showThink) printThink(reply);
  console.log(`  ${rose("anomali")} ${reply.text}`);
  if (reply.moodChanged) console.log(dim(`  · suasana berubah jadi ${reply.mood.label}`));
  console.log("");
  return true;
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: Boolean(process.stdin.isTTY),
});

let alive = true;
if (process.stdin.isTTY) {
  rl.setPrompt(promptLabel());
  rl.prompt();
}

for await (const line of rl) {
  if (!alive) break;
  alive = handle(line);
  if (!alive) {
    rl.close();
    break;
  }
  if (process.stdin.isTTY) {
    rl.setPrompt(promptLabel());
    rl.prompt();
  }
}

console.log(dim("\n  sampai jumpa.\n"));
engine.store.close();
