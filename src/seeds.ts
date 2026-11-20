/**
 * seeds.ts — memuat semua intent dari data/intents/*.json dan menggabungkan
 * patch kepribadian (file yang hanya berisi tambahan per slug).
 */
import fs from "node:fs";
import path from "node:path";
import { INTENTS_DIR } from "./store.ts";
import type { IntentPatch, IntentSeed } from "./types.ts";

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

export function loadSeeds(): IntentSeed[] {
  const files = fs
    .readdirSync(INTENTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  const seeds = new Map<string, IntentSeed>();
  const order: string[] = [];
  const patches: IntentPatch[] = [];

  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(INTENTS_DIR, file), "utf8"));
    } catch (err) {
      throw new Error(`JSON rusak di ${file}: ${(err as Error).message}`);
    }
    if (!Array.isArray(parsed)) throw new Error(`${file} harus berisi array`);

    for (const raw of parsed as any[]) {
      if (!raw || typeof raw.slug !== "string") throw new Error(`entri tanpa slug di ${file}`);

      // intent utuh punya label + triggers. Entri tanpa label dianggap patch
      // (boleh berisi triggers tambahan untuk intent yang sudah ada).
      const isFullSeed = Array.isArray(raw.triggers) && typeof raw.label === "string";

      if (isFullSeed) {
        if (seeds.has(raw.slug)) throw new Error(`slug duplikat: ${raw.slug} (${file})`);
        seeds.set(raw.slug, {
          slug: raw.slug,
          label: raw.label ?? raw.slug,
          priority: raw.priority,
          guess: raw.guess,
          triggers: [...raw.triggers],
          responses: Object.fromEntries(
            Object.entries(raw.responses ?? {}).map(([tone, arr]) => [tone, [...(arr as string[])]]),
          ),
          responses_no_memory: raw.responses_no_memory
            ? Object.fromEntries(
                Object.entries(raw.responses_no_memory).map(([tone, arr]) => [tone, [...(arr as string[])]]),
              )
            : undefined,
        });
        order.push(raw.slug);
      } else {
        patches.push(raw as IntentPatch);
      }
    }
  }

  for (const patch of patches) {
    const seed = seeds.get(patch.slug);
    if (!seed) throw new Error(`patch merujuk slug yang tidak ada: ${patch.slug}`);

    if (patch.triggers) seed.triggers = dedupe([...seed.triggers, ...patch.triggers]);
    if (patch.guess) seed.guess = patch.guess;

    for (const [tone, arr] of Object.entries(patch.responses ?? {})) {
      seed.responses[tone] = dedupe([...(seed.responses[tone] ?? []), ...arr]);
    }
    for (const [tone, arr] of Object.entries(patch.responses_no_memory ?? {})) {
      const current = seed.responses_no_memory ?? {};
      current[tone] = dedupe([...(current[tone] ?? []), ...arr]);
      seed.responses_no_memory = current;
    }
  }

  return order.map((slug) => seeds.get(slug)!);
}
