# anomali

Bot obrolan romantis berbahasa Indonesia dengan **mesin tebakan n-gram**, **memori nama permanen**,
**suasana yang berubah-ubah** (manja / dingin / jail), dan **tahan typo** (`kaabr`, `kmu`, `mkn`).

Bukan LLM. Semua jawaban dipilih dari indeks kata yang bisa diaudit, dan setiap balasan menyertakan
jejak "kenapa aku menebak itu".

```
kamu [hangat] > namaku craftkal
anomali       > salam kenal, craftkal. aku catat ya, gak bakal aku lupa.

kamu [hangat] > aku kangen kamu
anomali       > rindu kamu itu kayak hujan: dateng gak bisa ditahan.

kamu [manja]  > terserah kamu deh
anomali       > terserah kamu.
                 · suasana berubah jadi dingin

(restart proses)

suasana sekarang: dingin · kata "terserah"
kamu [dingin] > namaku siapa
anomali       > craftkal. kenapa?
```

## Jalan cepat

```bash
npm run gen        # 5.000.000 baris korpus -> data/corpus.jsonl
npm run build      # kompres korpus jadi indeks -> data/brain.db
npm run chat       # obrolan di terminal
npm run web        # chat di browser -> http://127.0.0.1:7777
npm run audit      # cek cakupan nada tiap intent
npm run stats      # ringkasan database
npm run probe -- "hai sayang apa kaabr"   # uji cepat satu/beberapa kalimat
npm run test       # regression test intent (30 kasus)
```

Butuh Node.js ≥ 22.5 (diuji di Node 24). **Nol dependency** — pakai `node:sqlite` bawaan dan
TypeScript yang dijalankan langsung tanpa compile step.

## Angka nyata

| Tahap | Hasil |
|---|---|
| Korpus | **10.000.000 baris** · 966 MB |
| Generate | ~15 detik |
| Compile | ~107 detik |
| Kalimat unik setelah normalisasi | **43.992** (99,6% duplikat permukaan) |
| Indeks n-gram | 17.546 |
| Pasangan n-gram → intent | 28.635 |
| Intent | 91 |
| Respons unik | 835 |
| Kosakata | 421 |
| Ukuran `brain.db` | **1,3 MB** |
| Waktu jawab | orde milidetik |

Inti pelajarannya: 10 juta baris JSON tidak perlu dimuat ke RAM. 99,6% isinya variasi permukaan
yang sama ("eh kangen kamu", "kangen kamu sih", "gw kangen lu"). Normalisasi + dedupe
memampatkannya jadi indeks 1,3 MB.

## Suasana (persona)

Suasana dihitung dari tiga bahan dan **disimpan permanen per user**:

```
suasana sebelumnya ──(inersia)──┐
kata di pesan user ─(sinyal)────┼──> manja / dingin / jail / hangat
lama tidak chat ────(waktu)─────┘
```

- **manja** — dipicu *kangen, rindu, sayang, peluk, temenin*
- **dingin** — dipicu *terserah, ya udah, sibuk, jangan ganggu*; juga muncul kalau lama tidak chat
- **jail** — dipicu *wkwk, gombal, nakal, jahil, tebak*
- **hangat** — dipicu *sedih, capek, kesepian, curiga, maaf* (netral dan lembut)

Suasana memudar setelah 12 jam, jadi besok pagi bot tidak marah-marah lagi tanpa alasan.
Intent yang membuat user rentan (`sedih`, `kesepian`, `stres`, `capek`, `kecewa`, `temenin`,
`semangat`, `minta-maaf`) **tidak boleh** dijawab dengan nada dingin — kelembutan menang.

Semua bisa diatur di `data/persona.json`: bobot dasar, inersia, jam memudar, label nada, dan bank
kalimat cadangan.

## Cara kerja

```
pesan user
   │
   ├─ [memori]      "namaku X" → tabel fact (permanen)
   ├─ [normalisasi] lowercase → buang filler → kamus slang → token
   ├─ [koreksi]     typo/singkatan → kata terdekat (hanya kalau kandidat tunggal)
   ├─ [suasana]     sinyal + inersia + waktu → manja/dingin/jail/hangat
   ├─ [cari]        n-gram 1..3 kata → inverted index
   ├─ [skor]        TF-IDF; keyakinan = bobot cocok / total bobot pesan
   ├─ [cocok persis] pesan == trigger asli → keyakinan ≥ 0.90
   ├─ [nada]        suasana × nada yang tersedia di intent
   ├─ [respons]     pilih kalimat, hindari 18 kalimat terakhir per intent
   └─ [jejak]       token, koreksi, sinyal, kandidat, suasana, nada, memori
```

## Koreksi typo

Tiga lapis, semuanya berjalan **sebelum** teks dihitung:

1. **Koreksi frasa** — `data/fixes.json`. Contoh `"apa ka bar" → "apa kabar"`. Untuk salah tulis
   yang terpecah jadi beberapa kata.
2. **Kamus singkatan** — `data/slang.json`. `kmu→kamu`, `mkn→makan`, `tdr→tidur`,
   `pngen→pengen`, `jgn→jangan`, `bgt→banget`, `blm→belum`, dan ratusan lainnya.
3. **Koreksi jarak edit** — `src/fuzzy.ts`, Damerau-Levenshtein (transposisi dihitung satu
   langkah) + pelipatan ejaan (`ph/f→p`, `v→p`, `z→j`, `oe→u`, `dj→j`, `tj→c`). Hanya dipakai
   kalau kata tidak dikenal dan kandidatnya **tunggal**. Huruf berulang berlebih diringkas dulu,
   dan kata panjang wajib diawali huruf yang sama.

Kalau teks banyak typo, keyakinan diturunkan sedikit (`fixPenalty`), dan kalau dua kandidat
hampir seri, mode berubah dari *yakin* ke *menebak* — bot tidak sok tahu.

Contoh: `kaabr→kabar`, `ketmu→ketemu`, `kmuu→kamu`, `namakku→namaku` (penanda diperbaiki sebelum
ekstraksi nama). Kalau ambigu, kata dibiarkan — lebih baik tidak menebak daripada salah tebak.

> Mengubah `slang.json` atau `fixes.json` berarti mengubah normalisasi, jadi **jalankan
> `npm run gen && npm run build`** setelahnya. Koreksi fuzzy berjalan saat query, tidak perlu rebuild.

## Melatih bot

Tiga alat yang dipakai untuk mengajar:

```bash
npm run probe -- "kalimat uji"     # lihat intent, suasana, nada, balasan, kandidat
npm run test                       # 30 kasus dengan intent yang diharapkan
npm run audit                      # intent mana yang nadanya masih bolong
```

Alur menambah kemampuan:

1. temukan kalimat yang salah lewat `probe`;
2. kalau masalahnya kosakata → tambah singkatan ke `SLANG` (`src/normalize.ts`);
3. kalau masalahnya frasa → tambah `triggers` lewat file patch (`12-trigger-extra.json`);
4. kalau masalahnya jawaban kurang pas → tambah `responses` per nada;
5. `npm run gen && npm run build`, lalu `npm run test` untuk memastikan tidak ada regresi.

Test suite ada di `src/test.ts`. Tambahkan kasus baru setiap kali menemukan kesalahan —
itu yang membuat latihan ini menumpuk, bukan hilang.

Tidak ada neural net, tidak ada sampling probabilitas dari model. Setiap keputusan bisa dihitung
ulang dari database.

## Struktur

```
data/
  persona.json        # suasana: bobot, inersia, kalimat cadangan
  slang.json          # kamus singkatan (bisa diedit tanpa sentuh kode)
  fixes.json          # koreksi frasa sebelum dihitung
  intents/*.json      # 91 intent + patch nada/trigger
  corpus.sample.jsonl # 2.000 baris contoh (ikut di repo)
  corpus.jsonl        # 10 juta baris hasil generate (tidak ikut repo)
  brain.db            # indeks + memori + suasana (turunan)
src/
  normalize.ts        # kamus slang + tokenizer + n-gram
  fuzzy.ts            # koreksi typo (Damerau-Levenshtein)
  memory.ts           # ekstraksi nama & fakta
  mood.ts             # transisi suasana
  persona.ts          # konfigurasi persona
  seeds.ts            # loader intent + penggabung patch
  generate.ts         # seed → korpus kombinatorial
  compile.ts          # korpus → SQLite (dedupe + TF-IDF)
  engine.ts           # skoring, suasana, nada, render, jejak
  cli.ts              # antarmuka terminal
  server.ts           # server web lokal
  audit.ts            # cek cakupan nada
  probe.ts            # uji cepat beberapa kalimat
  stats.ts            # ringkasan database
public/index.html     # UI chat
```

## Menambah obrolan

Buat file baru di `data/intents/`, lalu `npm run gen && npm run build`.

```json
[
  {
    "slug": "rindu",
    "label": "rindu",
    "guess": "kayaknya kamu lagi kangen ya?",
    "triggers": ["kangen", "rindu", "kangen kamu", "pengen ketemu"],
    "responses": {
      "hangat": ["aku juga kangen, {nama}. tiap hari."],
      "manja":  ["kangen banget gak sih... aku pengen peluk kamu lama-lama."],
      "dingin": ["oh, kangen ya.", "hmm. terus?"],
      "nakal":  ["kangen? baru sadar ya. aku dari kemarin."]
    },
    "responses_no_memory": {
      "hangat": ["kamu belum pernah kasih tau nama kamu. coba bilang 'namaku ...'"]
    }
  }
]
```

### Menambah nada tanpa mengubah intent lama

Entri **tanpa `label`** dianggap patch dan digabung ke intent dengan `slug` yang sama:

```json
[{ "slug": "rindu", "responses": { "dingin": ["oh. terus?"] } }]
```

Itulah isi `09-persona.json` dan `10-extra.json` — ratusan kalimat dingin/jail yang ditambahkan
di atas seed asli.

- `{nama}` diisi nama dari memori; kalau belum ada, kalimatnya dirapikan otomatis.
- `guess` dipakai saat keyakinan sedang (mode *menebak*).
- `responses_no_memory` dipakai khusus saat nama belum diketahui.
- Nada yang tersedia = kunci di `responses`. Minimal satu; empat lebih baik.

Volume korpus bisa diatur:

```bash
npm run gen -- --rows 1000000
npm run gen -- --rows 10000000 --seed 42
```

> Menambah baris korpus **tidak** menambah kepintaran setelah titik tertentu — yang menambah
> kepintaran adalah menambah intent/trigger. Korpus besar berguna untuk menguji kompresi.

## Memori

Tersimpan di tabel `fact`, per `user_id`:

| key | contoh | aturan |
|---|---|---|
| `name` | `craftkal` | tidak pernah ditimpa kecuali user menyebut nama baru secara eksplisit |
| `pet` | `sayang` | dari "panggil aku sayang" |

Ekstraksi nama memakai pola eksplisit (`namaku X`, `nama saya X`, `panggil aku X`, `my name is X`)
dan pola lemah (`aku X`) yang divalidasi ketat terhadap kosakata intent dan kamus slang — jadi
"aku gak tau" atau "aku kangen kamu" tidak akan disalahartikan sebagai nama.

Suasana juga tersimpan di tabel `mood`, sehingga tetap terasa saat kamu buka chat lagi.

> **Perhatian:** `npm run build` membangun ulang `brain.db` dari nol — memori user, riwayat, dan
> suasana ikut terhapus. Backup `data/brain.db` dulu kalau sudah ada yang mau disimpan.

Hapus ingatan:

- CLI: `/lupakan` lalu `/lupakan ya`
- Web: tombol **lupakan** di header

## Perintah CLI

| Perintah | Fungsi |
|---|---|
| `/think` | tampilkan/sembunyikan jejak tebakan |
| `/mood` | lihat suasana, intensitas, alasan |
| `/mood manja\|dingin\|jail\|hangat` | paksa suasana untuk pesan berikutnya |
| `/mood auto` | kembalikan ke otomatis |
| `/nama` | lihat fakta yang tersimpan |
| `/lupakan` | hapus semua ingatan (konfirmasi `/lupakan ya`) |
| `/statistik` | ukuran indeks & memori |
| `/keluar` | keluar |

## Opsi

```bash
npm run chat -- --user craftkal      # identitas memori
npm run chat -- --think              # jejak tebakan langsung tampil
npm run web  -- --port 8080
npm run web  -- --host 0.0.0.0       # bisa dibuka dari HP di wifi yang sama
```

## Batasan yang perlu jujur

- **Bukan model bahasa.** Kosakatanya terbatas pada `data/intents`. Kalimat asing akan jatuh ke
  mode *bingung* atau ditebak kasar.
- **Suasana bukan emosi sungguhan.** Ia state deterministik + sedikit acak, bukan pemahaman.
- **Konteks pendek.** Yang diingat antar pesan hanya intent terakhir, nada terakhir, dan suasana.
- **Bahasa Indonesia** (plus sedikit Inggris), kamus slang terbatas.
- Kontennya romantis dan menggoda, **tidak eksplisit**.
- Semua data lokal. Server default hanya `127.0.0.1`, tanpa telemetri.

## Troubleshooting

| Gejala | Sebab / solusi |
|---|---|
| `Database belum dibangun` | jalankan `npm run gen && npm run build` |
| `SQLite is an experimental feature` | warning Node; `npm run` sudah mematikannya |
| Web tidak bisa dibuka dari HP | pakai `--host 0.0.0.0`, izinkan Node di firewall Windows |
| Jawaban terasa berulang | tambah variasi di `responses`, jalankan `npm run audit`, lalu `npm run build` |
| Typo masih tidak dikenali | tambahkan singkatannya ke `SLANG` (perlu rebuild) atau percayakan ke koreksi fuzzy |
| Koreksi typo terasa terlalu agresif | persempit aturan `max` di `src/fuzzy.ts` (mis. wajib huruf awal sama) |
| Bot terlalu sering dingin | turunkan `baseline.dingin` atau `inertia` di `data/persona.json` |
| Nama salah tertangkap | tambahkan kata itu ke `STOP` di `src/memory.ts` |

## Open source & data

Lisensi **MIT**. Semua *sumber* data ikut di repo: `data/intents/`, `data/persona.json`,
`data/slang.json`, `data/fixes.json`.

Korpus 10 juta baris (±966 MB) **tidak** ikut di repo: GitHub menolak file di atas 100 MB.
Korpus itu turunan deterministik — hasilkan ulang dengan `npm run gen` (seed tetap, hasil sama).
`data/corpus.sample.jsonl` berisi 2.000 baris contoh untuk melihat formatnya.

Kalau kamu mau mengarsipkan korpus penuh, unggah sebagai **asset di GitHub Release**
(batas 2 GB per file), bukan sebagai commit.

---

`anomali` — 10 juta tebakan, 1,3 MB otak, satu nama yang tidak pernah lupa, dan suasana yang
kadang manja, kadang dingin, kadang jail.
