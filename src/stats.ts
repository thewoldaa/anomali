import fs from "node:fs";
import { Store, DB_PATH, CORPUS_PATH, CORPUS_META_PATH } from "./store.ts";

const store = new Store(DB_PATH);
const meta: Record<string, string> = {};
for (const r of store.all(`SELECT key, value FROM meta`)) meta[String(r.key)] = String(r.value);

const counts: Record<string, number> = {};
for (const t of ["intent", "trig", "df", "vocab", "response", "fact", "history"]) {
  const row = store.get(`SELECT COUNT(*) AS n FROM ${t}`);
  counts[t] = Number(row.n);
}

console.log(JSON.stringify({ meta, counts }, null, 2));

const dbMb = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size / 1024 / 1024 : 0;
const corpusMb = fs.existsSync(CORPUS_PATH) ? fs.statSync(CORPUS_PATH).size / 1024 / 1024 : 0;
let corpusRows = "belum digenerate";
if (fs.existsSync(CORPUS_META_PATH)) {
  try {
    corpusRows = JSON.parse(fs.readFileSync(CORPUS_META_PATH, "utf8")).rows;
  } catch {
    /* biarkan */
  }
}

console.log(`\ndatabase : ${dbMb.toFixed(1)} MB`);
console.log(`korpus   : ${corpusMb.toFixed(1)} MB, ${corpusRows} baris`);

store.close();
