/**
 * probe.ts — alat uji cepat untuk melatih bot.
 *   npm run probe -- "hai sayang apa kaabr"
 *   npm run probe -- --keep "pesan 1" "pesan 2"   (tanpa reset suasana)
 */
import { Engine } from "./engine.ts";

const args = process.argv.slice(2);
const keep = args[0] === "--keep";
const messages = keep ? args.slice(1) : args;

if (messages.length === 0) {
  console.error('pakai: npm run probe -- "pesan"');
  process.exit(1);
}

const engine = Engine.open("probe");
if (!keep) engine.reset();

for (const message of messages) {
  const r = engine.reply(message);
  console.log(`\n"${message}"`);
  console.log(`  intent  : ${r.intentSlug} · ${r.confidence.toFixed(2)} · ${r.think.mode}`);
  console.log(`  suasana : ${r.mood.label}`);
  console.log(`  nada    : ${r.toneLabel}`);
  console.log(`  balasan : ${r.text}`);
  for (const line of r.think.lines) {
    if (line.startsWith("sinyal") || line.startsWith("kandidat") || line.startsWith("baru")) {
      console.log(`  ${line}`);
    }
  }
}

engine.store.close();
