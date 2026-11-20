/**
 * audit.ts — cek kesehatan data intent.
 *   npm run audit
 */
import { Store, DB_PATH } from "./store.ts";
import { loadSeeds } from "./seeds.ts";

const TONES = ["hangat", "manja", "dingin", "nakal"];
const seeds = loadSeeds();
const store = new Store(DB_PATH);

let flagged = 0;
const rows: { slug: string; hangat: number; manja: number; dingin: number; nakal: number; triggers: number }[] = [];

for (const s of seeds) {
  const counts: Record<string, number> = {};
  for (const t of TONES) counts[t] = (s.responses[t] ?? []).length;
  rows.push({ slug: s.slug, ...(counts as any), triggers: s.triggers.length });

  const issues: string[] = [];
  const missing = TONES.filter((t) => counts[t] === 0);
  if (missing.length) issues.push(`tanpa nada: ${missing.join(", ")}`);
  if (s.slug !== "fallback-nggakpaham" && s.triggers.length === 0) issues.push("tanpa trigger");
  const total = TONES.reduce((a, t) => a + counts[t], 0);
  if (total < 8) issues.push(`respons sedikit (${total})`);

  if (issues.length) {
    flagged++;
    console.log(`  ${s.slug.padEnd(18)} ${issues.join(" · ")}`);
  }
}

const totalResponses = seeds.reduce(
  (a, s) => a + Object.values(s.responses).flat().length,
  0,
);

console.log("");
console.log(`intent        : ${seeds.length}`);
console.log(`respons total : ${totalResponses}`);
console.log(`respons unik  : ${Number(store.get(`SELECT COUNT(*) AS n FROM response`).n)}`);
console.log(`trigger       : ${seeds.reduce((a, s) => a + s.triggers.length, 0)}`);
console.log(`perlu dicek   : ${flagged}`);

// tabel ringkas
const pad = (n: number): string => String(n).padStart(2);
console.log("\n" + "intent".padEnd(18) + TONES.map((t) => t.padStart(7)).join("") + "  trig");
for (const r of rows) {
  console.log(
    r.slug.padEnd(18) + TONES.map((t) => pad((r as any)[t]).padStart(7)).join("") + `  ${pad(r.triggers)}`,
  );
}

store.close();
