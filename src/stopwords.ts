/**
 * stopwords.ts — kata yang tidak membawa topik.
 *
 * Aturan: n-gram yang SEMUA tokennya stopword tidak diindeks dan tidak
 * dihitung saat query. Ini mencegah "aku" (muncul di hampir semua korpus)
 * dan pengulangan "hari" + "ini" + "hari ini" mengalahkan kata yang benar-
 * benar bermakna seperti "sedih".
 */
export const STOP_TOKENS = new Set([
  // kata ganti
  "aku", "kamu", "saya", "dia", "kami", "kita", "mereka", "anda",
  "gue", "gw", "gua", "gwe", "lo", "lu", "elo", "elu", "kau", "u", "km", "kmu",
  // penunjuk
  "ini", "itu",
  // sambung
  "dan", "atau", "tapi", "karena", "kalau", "jadi", "juga", "yang", "dengan", "dgn",
  // modal & bantu
  "mau", "ingin", "pengen", "pingin", "bisa", "akan", "harus", "sedang",
  "masih", "sudah", "belum", "tidak", "bukan", "pernah",
  // partikel
  "ya", "sih", "deh", "dong", "nih", "kok", "lah", "loh", "lho", "saja",
  "kan", "doang", "mah", "tuh", "pun", "kah",
  // intensitas
  "banget", "sangat", "sekali", "bgt",
  // waktu netral
  "lagi",
]);

/** Frasa generik yang tetap perlu dibuang walau punya satu kata isi. */
export const GENERIC_PHRASES = new Set([
  "aku minta",
  "minta tolong",
  "kamu tau",
  "tau gak",
]);

export function skipNgram(ngram: string): boolean {
  if (GENERIC_PHRASES.has(ngram)) return true;
  for (const token of ngram.split(" ")) {
    if (!STOP_TOKENS.has(token)) return false;
  }
  return true;
}
