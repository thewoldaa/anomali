/**
 * fuzzy.ts — koreksi typo ringan untuk kata yang tidak dikenal.
 *
 * Contoh: "kaabr" -> "kabar" (transposisi), "kmu" -> "kamu",
 * "mkn" -> "makan", "ketmu" -> "ketemu".
 *
 * Hanya dilakukan kalau kandidatnya TUNGGAL. Kalau ambigu, kata dibiarkan
 * apa adanya — lebih baik tidak menebak daripada menebak salah.
 */
import { KNOWN_WORDS } from "./normalize.ts";

export type Correction = { from: string; to: string };

/** Damerau-Levenshtein (optimal string alignment) dengan batas dini. */
export function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev2: number[] | null = null;
  let prev: number[] = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = new Array(b.length + 1);
    cur[0] = i;
    let rowMin = i;

    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);

      // transposisi dua huruf bersebelahan
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, (prev2 ? prev2[j - 2] : 0) + 1);
      }

      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }

    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }

  return prev[b.length];
}

/** Huruf berulang berlebih: "kaaangen" -> "kaangen" untuk keperluan pencarian. */
function squeeze(word: string): string {
  return word.replace(/(.)\1{2,}/g, "$1$1");
}

/**
 * Lipat ejaan yang sering tertukar di bahasa Indonesia:
 * ph/f -> p, v -> p, z -> j, oe -> u, dj -> j, tj -> c, y di akhir -> i.
 * Dipakai hanya untuk mencari kandidat, bukan untuk menampilkan hasil.
 */
export function fold(word: string): string {
  return word
    .toLowerCase()
    .replace(/ph/g, "f")
    .replace(/f/g, "p")
    .replace(/v/g, "p")
    .replace(/z/g, "j")
    .replace(/oe/g, "u")
    .replace(/dj/g, "j")
    .replace(/tj/g, "c")
    .replace(/y$/, "i")
    .replace(/(.)\1+/g, "$1");
}

export function correctTokens(tokens: string[], vocab: Set<string>): { tokens: string[]; fixes: Correction[] } {
  const out: string[] = [];
  const fixes: Correction[] = [];

  for (const token of tokens) {
    // sudah dikenal, kata umum yang sah, angka, atau terlalu pendek -> jangan disentuh
    if (vocab.has(token) || KNOWN_WORDS.has(token) || token.length < 3 || /^\d+$/.test(token)) {
      out.push(token);
      continue;
    }

    const target = squeeze(token);
    const foldedTarget = fold(target);
    // jarak 1 saja: cukup untuk transposisi/hilang satu huruf, tanpa melompat jauh
    const max = 1;

    let best = max + 1;
    const candidates: string[] = [];

    for (const word of vocab) {
      const foldedWord = fold(word);
      // wajib diawali huruf yang sama; mengurangi koreksi liar
      if (foldedWord[0] !== foldedTarget[0]) continue;
      if (Math.abs(word.length - target.length) > max) continue;
      const d = Math.min(
        distance(target, word, max),
        distance(foldedTarget, foldedWord, max),
      );
      if (d < best) {
        best = d;
        candidates.length = 0;
        candidates.push(word);
      } else if (d === best && d <= max) {
        candidates.push(word);
      }
    }

    if (best <= max && candidates.length === 1) {
      out.push(candidates[0]);
      fixes.push({ from: token, to: candidates[0] });
    } else {
      out.push(token);
    }
  }

  return { tokens: out, fixes };
}
