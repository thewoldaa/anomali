/**
 * eval.ts — benchmark intent dengan data di data/eval.jsonl.
 *   npm run eval
 *
 * Berbeda dari test.ts (smoke test kecil), eval ini sengaja lebih luas dan
 * dipakai untuk mengukur kemajuan tiap putaran latihan.
 */
import fs from "node:fs";
import path from "node:path";
import { Engine } from "./engine.ts";
import { ROOT } from "./store.ts";

type Case = { in: string; expect: string };

const arg = process.argv[2];
const file = arg ? path.resolve(arg) : path.join(ROOT, "data", "eval.jsonl");
const cases: Case[] = fs
  .readFileSync(file, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Case);

const engine = Engine.open("eval");
let pass = 0;
let confPass = 0;
let confFail = 0;
let overconfident = 0;

type Fail = { input: string; expect: string; got: string; conf: number; text: string; top: string };
const fails: Fail[] = [];
const confusion = new Map<string, Map<string, number>>();

for (const c of cases) {
  engine.reset();
  const r = engine.reply(c.in);

  if (r.intentSlug === c.expect) {
    pass++;
    confPass += r.confidence;
  } else {
    confFail += r.confidence;
    if (r.confidence >= 0.6) overconfident++;
    const top = r.think.lines.find((l) => l.startsWith("kandidat")) ?? "";
    fails.push({ input: c.in, expect: c.expect, got: r.intentSlug, conf: r.confidence, text: r.text, top: top.replace("kandidat: ", "") });
    if (!confusion.has(c.expect)) confusion.set(c.expect, new Map());
    const row = confusion.get(c.expect)!;
    row.set(r.intentSlug, (row.get(r.intentSlug) ?? 0) + 1);
  }
}

engine.reset();
engine.store.close();

const n = cases.length;
const acc = (pass / n) * 100;
const avgPass = pass ? confPass / pass : 0;
const avgFail = fails.length ? confFail / fails.length : 0;

console.log(`akurasi        : ${pass}/${n} (${acc.toFixed(1)}%)`);
console.log(`berkas         : ${path.basename(file)}`);
console.log(`keyakinan benar: ${avgPass.toFixed(2)}`);
console.log(`keyakinan salah: ${avgFail.toFixed(2)}`);
console.log(`salah tapi yakin (>=0.60): ${overconfident}`);

if (fails.length) {
  console.log(`\nkegagalan (urut keyakinan):`);
  for (const f of [...fails].sort((a, b) => b.conf - a.conf).slice(0, 25)) {
    console.log(`  ${f.conf.toFixed(2)}  "${f.input}"  harap=${f.expect} dapat=${f.got}`);
    console.log(`        ${f.text}`);
    console.log(`        ${f.top}`);
  }

  console.log(`\nkelompok salah:`);
  for (const [expect, row] of [...confusion.entries()].sort((a, b) => {
    const sa = [...a[1].values()].reduce((x, y) => x + y, 0);
    const sb = [...b[1].values()].reduce((x, y) => x + y, 0);
    return sb - sa;
  })) {
    const detail = [...row.entries()].map(([got, c]) => `${got}×${c}`).join(", ");
    console.log(`  ${expect} → ${detail}`);
  }
}

process.exit(pass === n ? 0 : 1);
