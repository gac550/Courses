/**
 * Capa de base de datos: SQLite con FTS5 vía node:sqlite.
 *
 * node:sqlite es nativo del runtime de Node 24 que embebe Electron 43, de modo
 * que no hay dependencias nativas que recompilar ni electron-rebuild.
 *
 * La base es un artefacto DERIVADO de data/courses.json. Si falta o se corrompe,
 * se reconstruye por completo. Ningún dato vive únicamente aquí.
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';

export const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS courses (
  id                    TEXT PRIMARY KEY,
  title                 TEXT NOT NULL,
  institution           TEXT NOT NULL,
  institution_country   TEXT,
  provider_type         TEXT,          -- institucion | proveedor-ia
  platform              TEXT,
  course_code           TEXT,
  domain                TEXT NOT NULL,
  topics                TEXT,          -- JSON array
  level                 TEXT,
  language              TEXT,          -- JSON array
  subtitles             TEXT,          -- JSON array
  duration_weeks        REAL,
  hours_per_week        REAL,
  pace                  TEXT,
  cost_access           TEXT,
  credential_type       TEXT,
  credential_free       INTEGER,       -- 0/1/NULL
  credential_price_usd  REAL,
  credential_issuer     TEXT,
  credential_verifiable INTEGER,
  url_official          TEXT,
  url_credential_info   TEXT,
  url_syllabus          TEXT,
  prerequisites         TEXT,
  relevance_ppp_infra   INTEGER,
  verification_status   TEXT,
  last_verified         TEXT,          -- ISO YYYY-MM-DD
  source_of_truth       TEXT,
  notes                 TEXT,
  status                TEXT,
  enrollment_open       INTEGER,
  start_date            TEXT,
  end_date              TEXT,
  access_mode           TEXT,
  discovered_at         TEXT,
  updated_at            TEXT,
  content_hash          TEXT
);

CREATE INDEX IF NOT EXISTS idx_courses_domain      ON courses(domain);
CREATE INDEX IF NOT EXISTS idx_courses_provider    ON courses(provider_type);
CREATE INDEX IF NOT EXISTS idx_courses_institution ON courses(institution);
CREATE INDEX IF NOT EXISTS idx_courses_credential  ON courses(credential_type);
CREATE INDEX IF NOT EXISTS idx_courses_status      ON courses(verification_status);
CREATE INDEX IF NOT EXISTS idx_courses_relevance   ON courses(relevance_ppp_infra);

-- Índice invertido con ranking BM25 sobre los cuatro campos buscables.
-- Tabla external-content: el contenido canónico vive en 'courses'.
CREATE VIRTUAL TABLE IF NOT EXISTS courses_fts USING fts5(
  title,
  institution,
  topics,
  course_code,
  content='courses',
  content_rowid='rowid',
  tokenize='porter unicode61 remove_diacritics 2'
);
`;

// Los tres triggers mantienen el índice sincronizado con la tabla canónica.
const TRIGGERS = `
CREATE TRIGGER IF NOT EXISTS courses_ai AFTER INSERT ON courses BEGIN
  INSERT INTO courses_fts(rowid, title, institution, topics, course_code)
  VALUES (new.rowid, new.title, new.institution, new.topics, new.course_code);
END;

CREATE TRIGGER IF NOT EXISTS courses_ad AFTER DELETE ON courses BEGIN
  INSERT INTO courses_fts(courses_fts, rowid, title, institution, topics, course_code)
  VALUES ('delete', old.rowid, old.title, old.institution, old.topics, old.course_code);
END;

CREATE TRIGGER IF NOT EXISTS courses_au AFTER UPDATE ON courses BEGIN
  INSERT INTO courses_fts(courses_fts, rowid, title, institution, topics, course_code)
  VALUES ('delete', old.rowid, old.title, old.institution, old.topics, old.course_code);
  INSERT INTO courses_fts(rowid, title, institution, topics, course_code)
  VALUES (new.rowid, new.title, new.institution, new.topics, new.course_code);
END;
`;

const COLUMNS = [
  'id', 'title', 'institution', 'institution_country', 'provider_type', 'platform', 'course_code',
  'domain', 'topics', 'level', 'language', 'subtitles', 'duration_weeks',
  'hours_per_week', 'pace', 'cost_access', 'credential_type', 'credential_free',
  'credential_price_usd', 'credential_issuer', 'credential_verifiable',
  'url_official', 'url_credential_info', 'url_syllabus', 'prerequisites',
  'relevance_ppp_infra', 'verification_status', 'last_verified',
  'source_of_truth', 'notes', 'status', 'enrollment_open', 'start_date',
  'end_date', 'access_mode', 'discovered_at', 'updated_at', 'content_hash',
];

const JSON_FIELDS = new Set(['topics', 'language', 'subtitles']);
const BOOL_FIELDS = new Set(['credential_free', 'credential_verifiable', 'enrollment_open']);

export function open(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  db.exec(TRIGGERS);
  db.exec(
    `INSERT INTO meta(key, value) VALUES ('schema_version', '${SCHEMA_VERSION}')
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  return db;
}

/** Reconstruye la base completa desde el JSON. Idempotente. */
export function rebuildFrom(db, coursesJsonPath) {
  if (!existsSync(coursesJsonPath)) {
    throw new Error(`No existe la fuente de verdad: ${coursesJsonPath}`);
  }

  const raw = JSON.parse(readFileSync(coursesJsonPath, 'utf8'));
  const courses = Array.isArray(raw) ? raw : (raw.courses ?? []);

  const placeholders = COLUMNS.map(() => '?').join(', ');
  const insert = db.prepare(
    `INSERT INTO courses (${COLUMNS.join(', ')}) VALUES (${placeholders})`,
  );

  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM courses');
    for (const course of courses) insert.run(...COLUMNS.map((c) => toSql(course[c], c)));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  // El índice external-content se reconstruye tras un DELETE masivo.
  db.exec(`INSERT INTO courses_fts(courses_fts) VALUES ('rebuild')`);

  return courses.length;
}

function toSql(value, column) {
  if (value === undefined || value === null) return null;
  if (JSON_FIELDS.has(column)) return JSON.stringify(value);
  if (BOOL_FIELDS.has(column)) return value ? 1 : 0;
  return value;
}

export function fromSql(row) {
  if (!row) return null;
  const out = { ...row };
  for (const field of JSON_FIELDS) {
    if (typeof out[field] === 'string') {
      try {
        out[field] = JSON.parse(out[field]);
      } catch {
        out[field] = null;
      }
    }
  }
  for (const field of BOOL_FIELDS) {
    if (out[field] !== null && out[field] !== undefined) out[field] = Boolean(out[field]);
  }
  return out;
}

export function countCourses(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM courses').get().n;
}
