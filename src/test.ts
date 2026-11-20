/**
 * test.ts — regression test intent.
 *   npm run test
 *
 * Setiap kalimat punya intent yang diharapkan. Kalau ada perubahan data yang
 * merusak pemahaman, test ini akan gagal.
 */
import { Engine } from "./engine.ts";

type Case = { input: string; expect: string; contains?: string };

const cases: Case[] = [
  { input: "hai sayang apa kaabr", expect: "kabar" },
  { input: "apa kabr", expect: "kabar" },
  { input: "apa ka bar", expect: "kabar" },
  { input: "apa ka bar sayang", expect: "kabar" },
  { input: "apa kabar sayang", expect: "kabar" },
  { input: "ak kangen kmu bgt", expect: "rindu" },
  { input: "kangen bgt sm kmu", expect: "rindu" },
  { input: "rindu berat", expect: "rindu" },
  { input: "aku kangen", expect: "rindu" },
  { input: "kmu udah mkn blm", expect: "perhatian" },
  { input: "kmu udh mkn blm", expect: "perhatian" },
  { input: "kmu udh mkn?", expect: "perhatian" },
  { input: "aku pngen tdr", expect: "mau-tidur" },
  { input: "aku pgen tdr", expect: "mau-tidur" },
  { input: "aku mau tdr dlu", expect: "mau-tidur" },
  { input: "aku gak bisa tidur", expect: "begadang" },
  { input: "namakku budi", expect: "perkenalan-nama" },
  { input: "namaku siapa", expect: "tanya-nama-user", contains: "budi" },
  { input: "besok kita ketmu yuk", expect: "ketemu" },
  { input: "kita jadian yuk", expect: "jadian" },
  { input: "kamu sayang aku gak", expect: "sayang-balik" },
  { input: "jgn cuek dong", expect: "cuek" },
  { input: "kmu kok dingin", expect: "cuek" },
  { input: "aku gabut", expect: "bosan" },
  { input: "aku bosen bgt", expect: "bosan" },
  { input: "wkwk kamu jail", expect: "nakal" },
  { input: "km siapa sih", expect: "tanya-identitas" },
  { input: "aku sedih bgt", expect: "sedih" },
  { input: "kmrn aku cape banget", expect: "capek" },
  { input: "kmrn aku cape", expect: "capek" },
  { input: "makasih ya sayang", expect: "terima-kasih" },
  { input: "kmu ganteng bgt", expect: "pujian-user" },
  { input: "aku pngen ngopi", expect: "kopi" },
  { input: "aku laper bgt", expect: "makanan" },
  { input: "ak mau peluk kmu", expect: "peluk" },
];

const engine = Engine.open("test");
engine.reset();

let pass = 0;
const failures: string[] = [];

for (const c of cases) {
  const r = engine.reply(c.input);
  const intentOk = r.intentSlug === c.expect;
  const textOk = c.contains ? r.text.toLowerCase().includes(c.contains.toLowerCase()) : true;

  if (intentOk && textOk) {
    pass++;
    console.log(`  ok   "${c.input}" → ${r.intentSlug}`);
  } else {
    const candidates = r.think.lines.find((l) => l.startsWith("kandidat")) ?? "";
    failures.push(`${c.input}\n      harap: ${c.expect}${c.contains ? ` (mengandung "${c.contains}")` : ""}\n      dapat: ${r.intentSlug} · ${r.text}\n      ${candidates.trim()}`);
    console.log(`  GAGAL "${c.input}" → ${r.intentSlug} (harap ${c.expect})`);
  }
}

engine.reset();
engine.store.close();

console.log("");
console.log(`${pass}/${cases.length} lulus`);
if (failures.length) {
  console.log("\ngagal:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
