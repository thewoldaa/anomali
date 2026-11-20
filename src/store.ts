/**
 * Lapisan database. Semua state (indeks tebakan + memori user) hidup di
 * satu file SQLite: data/brain.db
 */
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = path.join(ROOT, "data");
export const INTENTS_DIR = path.join(DATA_DIR, "intents");
export const CORPUS_PATH = path.join(DATA_DIR, "corpus.jsonl");
export const CORPUS_META_PATH = path.join(DATA_DIR, "corpus.meta.json");
export const DB_PATH = path.join(DATA_DIR, "brain.db");

export const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

-- satu baris per intent (topik obrolan)
CREATE TABLE IF NOT EXISTS intent (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  slug                 TEXT NOT NULL UNIQUE,
  label                TEXT NOT NULL,
  priority             REAL NOT NULL DEFAULT 0,
  tones                TEXT NOT NULL,          -- JSON array
  guess                TEXT,                   -- kalimat "kayaknya kamu..."
  needs_name           INTEGER NOT NULL DEFAULT 0,
  responses_no_memory  TEXT                    -- JSON object, dipakai saat nama belum diketahui
);

-- trigger asli (belum divariasikan). Dipakai untuk pengenalan persis.
CREATE TABLE IF NOT EXISTS base_trigger (
  text      TEXT NOT NULL,
  intent_id INTEGER NOT NULL,
  PRIMARY KEY (text, intent_id)
) WITHOUT ROWID;

-- inverted index: n-gram -> intent. Ini "otak" dari mesin tebakan.
CREATE TABLE IF NOT EXISTS trig (
  ngram     TEXT NOT NULL,
  intent_id INTEGER NOT NULL,
  hits      INTEGER NOT NULL,
  PRIMARY KEY (ngram, intent_id)
) WITHOUT ROWID;

-- document frequency tiap n-gram, dipakai untuk idf
CREATE TABLE IF NOT EXISTS df (
  ngram TEXT PRIMARY KEY,
  n     INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS response (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  intent_id INTEGER NOT NULL,
  tone      TEXT NOT NULL,
  text      TEXT NOT NULL,
  UNIQUE (intent_id, tone, text)
);
CREATE INDEX IF NOT EXISTS idx_response ON response (intent_id, tone);

-- kosakata: dipakai untuk memastikan sebuah kata BUKAN nama orang
CREATE TABLE IF NOT EXISTS vocab (
  token TEXT PRIMARY KEY
) WITHOUT ROWID;

-- memori permanen per user. key 'name' = nama user, disimpan selamanya.
CREATE TABLE IF NOT EXISTS fact (
  user_id    TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  source     TEXT NOT NULL,
  confidence REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  role        TEXT NOT NULL,
  text        TEXT NOT NULL,
  intent_slug TEXT,
  tone        TEXT,
  confidence  REAL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history ON history (user_id, id);

-- suasana hati yang bertahan antar proses
CREATE TABLE IF NOT EXISTS mood (
  user_id    TEXT PRIMARY KEY,
  mood       TEXT NOT NULL,
  intensity  REAL NOT NULL,
  reason     TEXT,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

-- respons terakhir per user, supaya bot tidak mengulang kalimat yang sama
CREATE TABLE IF NOT EXISTS recent_response (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  intent_id  INTEGER NOT NULL,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recent ON recent_response (user_id, intent_id);
`;

export class Store {
  db: DatabaseSync;
  private cache: Map<string, any>;

  constructor(file: string = DB_PATH) {
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.cache = new Map();
  }

  /** Statement yang sudah di-prepare dan di-cache. */
  st(sql: string): any {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  get(sql: string, ...params: any[]): any {
    return this.st(sql).get(...params);
  }

  all(sql: string, ...params: any[]): any[] {
    return this.st(sql).all(...params);
  }

  run(sql: string, ...params: any[]): any {
    return this.st(sql).run(...params);
  }

  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      /* sudah tertutup */
    }
  }
}

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}
