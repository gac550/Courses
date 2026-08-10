/**
 * Frontera de confianza IPC.
 *
 * Toda entrada del renderer se trata como si viniera de un cliente no
 * confiable: se valida tipo, rango y pertenencia a listas cerradas antes de
 * tocar la base. Las consultas SQL usan siempre parámetros ligados, nunca
 * interpolación de strings.
 */

import { ipcMain, shell } from 'electron';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { fromSql } from './db.mjs';
import { runPipeline } from './pipeline.mjs';
import { portableRoot as root } from './paths.mjs';

const DOMAINS = new Set([
  'ai-tecnica', 'ai-negocio', 'pmo', 'finanzas', 'gerencia', 'derecho', 'sostenibilidad', 'datos', 'salud', 'ciencias', 'humanidades',
]);
const PROVIDER_TYPES = new Set(['institucion', 'proveedor-ia']);
const VERIFICATION = new Set([
  'VERIFICADO', 'PENDIENTE', 'REVERIFICAR', 'NO_DISPONIBLE', 'MANUAL_REVIEW_REQUIRED',
]);

// Lista cerrada: impide inyección por nombre de columna en ORDER BY.
const SORTS = {
  recomendado: 'credential_rank ASC, verified_rank ASC, relevance_ppp_infra DESC, institution ASC, title ASC, id ASC',
  acreditabilidad: 'credential_rank ASC, verified_rank ASC, title ASC',
  relevancia: 'relevance_ppp_infra DESC, credential_rank ASC, title ASC',
  institucion: 'institution ASC, title ASC',
  duracion: 'duration_weeks IS NULL, duration_weeks ASC, title ASC',
  verificacion: 'last_verified IS NULL, last_verified DESC, title ASC',
};

const MAX_LIMIT = 2000;

// Réplica en SQL del ordenamiento canónico de scripts/lib/sort.mjs.
const RANK_SQL = `
  CASE
    WHEN credential_type = 'certificado gratuito'            THEN 0
    WHEN credential_type = 'badge gratuito'                  THEN 1
    WHEN credential_type = 'declaracion de logro'            THEN 2
    WHEN credential_type = 'certificado pagado verificable'  THEN 3
    WHEN credential_type = 'certificado pagado'              THEN 4
    WHEN credential_type IS NULL                             THEN 6
    ELSE 5
  END AS credential_rank,
  CASE WHEN verification_status = 'VERIFICADO' THEN 0 ELSE 1 END AS verified_rank
`;

function str(value, max = 200) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function int(value, min, max) {
  if (!Number.isInteger(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

/** Escapa la sintaxis de consulta FTS5 y la reduce a prefijos seguros. */
function ftsQuery(raw) {
  const cleaned = raw.replace(/["*(){}:^-]/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned
    .split(/\s+/)
    .slice(0, 8)
    .map((token) => `"${token}"*`)
    .join(' AND ');
}

function buildQuery(filters) {
  const where = [];
  const params = [];

  // Un valor de lista cerrada que no pertenece a ella no puede ampliar el
  // resultado: se traduce en una condición imposible, nunca en «sin filtro».
  const domain = str(filters.domain, 40);
  if (domain) {
    if (DOMAINS.has(domain)) {
      where.push('domain = ?');
      params.push(domain);
    } else {
      where.push('1 = 0');
    }
  }

  const providerType = str(filters.providerType, 40);
  if (providerType) {
    if (PROVIDER_TYPES.has(providerType)) {
      where.push('provider_type = ?');
      params.push(providerType);
    } else {
      where.push('1 = 0');
    }
  }

  const institution = str(filters.institution, 160);
  if (institution) {
    where.push('institution = ?');
    params.push(institution);
  }

  const country = str(filters.country, 8);
  if (country) {
    where.push('institution_country = ?');
    params.push(country);
  }

  const platform = str(filters.platform, 80);
  if (platform) {
    where.push('platform = ?');
    params.push(platform);
  }

  const level = str(filters.level, 40);
  if (level) {
    where.push('level = ?');
    params.push(level);
  }

  const credentialType = str(filters.credentialType, 60);
  if (credentialType) {
    where.push('credential_type = ?');
    params.push(credentialType);
  }

  const verification = str(filters.verificationStatus, 40);
  if (verification) {
    if (VERIFICATION.has(verification)) {
      where.push('verification_status = ?');
      params.push(verification);
    } else {
      where.push('1 = 0');
    }
  }

  if (filters.credentialFree === true) where.push('credential_free = 1');
  if (filters.credentialVerifiable === true) where.push('credential_verifiable = 1');

  const minRelevance = int(filters.minRelevance, 0, 3);
  if (minRelevance !== null) {
    where.push('relevance_ppp_infra >= ?');
    params.push(minRelevance);
  }

  const language = str(filters.language, 10);
  if (language) {
    where.push('language LIKE ?');
    params.push(`%"${language}"%`);
  }

  return { where, params };
}

export function registerIpc({ getDb, setDb, getWindow }) {
  ipcMain.handle('courses:query', (_event, rawFilters = {}) => {
    const db = getDb();
    if (!db) return { rows: [], total: 0 };

    const filters = (rawFilters && typeof rawFilters === 'object') ? rawFilters : {};
    const { where, params } = buildQuery(filters);

    const search = str(filters.search, 200);
    const match = search ? ftsQuery(search) : null;

    const sortKey = str(filters.sort, 40);
    const orderBy = SORTS[sortKey] ?? SORTS.recomendado;

    const limit = int(filters.limit, 1, MAX_LIMIT) ?? MAX_LIMIT;

    const from = match
      ? 'courses JOIN courses_fts ON courses_fts.rowid = courses.rowid'
      : 'courses';

    const clauses = [...where];
    const values = [...params];

    if (match) {
      clauses.push('courses_fts MATCH ?');
      values.push(match);
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const rows = db
      .prepare(`SELECT courses.*, ${RANK_SQL} FROM ${from} ${whereSql} ORDER BY ${orderBy} LIMIT ?`)
      .all(...values, limit)
      .map(fromSql);

    const total = db
      .prepare(`SELECT COUNT(*) AS n FROM ${from} ${whereSql}`)
      .get(...values).n;

    return { rows, total };
  });

  /**
   * Proveedores registrados que hoy no ofrecen formación propia.
   *
   * Se exponen a la interfaz para que su ausencia del catálogo sea explicable:
   * sin esto, un proveedor conocido simplemente no aparece y parece un olvido.
   */
  ipcMain.handle('sources:unavailable', () => {
    const db = getDb();

    try {
      const path = join(root(), 'config', 'sources.json');
      if (!existsSync(path) || !db) return [];

      const conCursos = new Set(
        db.prepare('SELECT DISTINCT institution FROM courses').all().map((r) => r.institution),
      );

      // Solo las que de verdad no aportan cursos. Una fuente deshabilitada por
      // anti-bot pero cuyos cursos se verificaron a mano sí está representada.
      return JSON.parse(readFileSync(path, 'utf8'))
        .filter((s) => s.enabled === false && s.institution && !conCursos.has(s.institution))
        .map((s) => ({ institution: s.institution, reason: s.notes ?? null }));
    } catch {
      return [];
    }
  });

  ipcMain.handle('courses:facets', () => {
    const db = getDb();
    if (!db) return {};

    const distinct = (column) =>
      db.prepare(
        `SELECT ${column} AS value, COUNT(*) AS n FROM courses
         WHERE ${column} IS NOT NULL GROUP BY ${column} ORDER BY n DESC, value ASC`,
      ).all();

    return {
      providerType: distinct('provider_type'),
      domain: distinct('domain'),
      institution: distinct('institution'),
      country: distinct('institution_country'),
      platform: distinct('platform'),
      level: distinct('level'),
      credentialType: distinct('credential_type'),
      verificationStatus: distinct('verification_status'),
    };
  });

  ipcMain.handle('courses:stats', () => {
    const db = getDb();
    if (!db) return {};

    const scalar = (sql) => db.prepare(sql).get().n;
    return {
      total: scalar('SELECT COUNT(*) AS n FROM courses'),
      freeCertificate: scalar(
        `SELECT COUNT(*) AS n FROM courses WHERE credential_free = 1 AND credential_type = 'certificado gratuito'`,
      ),
      freeBadge: scalar(
        `SELECT COUNT(*) AS n FROM courses WHERE credential_free = 1 AND credential_type = 'badge gratuito'`,
      ),
      paidCertificate: scalar(
        `SELECT COUNT(*) AS n FROM courses WHERE credential_free = 0`,
      ),
      noCredential: scalar('SELECT COUNT(*) AS n FROM courses WHERE credential_type IS NULL'),
      institutions: scalar('SELECT COUNT(DISTINCT institution) AS n FROM courses'),
      fromInstitutions: scalar(`SELECT COUNT(*) AS n FROM courses WHERE provider_type = 'institucion'`),
      fromAiProviders: scalar(`SELECT COUNT(*) AS n FROM courses WHERE provider_type = 'proveedor-ia'`),
      verified: scalar(`SELECT COUNT(*) AS n FROM courses WHERE verification_status = 'VERIFICADO'`),
      needsReverify: scalar(
        `SELECT COUNT(*) AS n FROM courses
         WHERE last_verified IS NULL OR julianday('now') - julianday(last_verified) > 90`,
      ),
    };
  });

  ipcMain.handle('app:openExternal', async (_event, url) => {
    const value = str(url, 2000);
    if (!value || !/^https:\/\//i.test(value)) return false;
    await shell.openExternal(value);
    return true;
  });

  // Botón «Actualizar catálogo»: ejecuta el pipeline y transmite progreso.
  ipcMain.handle('pipeline:run', async (_event, rawOptions = {}) => {
    const options = (rawOptions && typeof rawOptions === 'object') ? rawOptions : {};
    const window = getWindow();
    const emit = (payload) => {
      if (window && !window.isDestroyed()) window.webContents.send('pipeline:progress', payload);
    };
    return runPipeline({ getDb, setDb, emit, options });
  });
}
