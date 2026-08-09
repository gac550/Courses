/**
 * Ejecución del pipeline desde la aplicación (botón «Actualizar catálogo»).
 *
 * Los mismos scripts .mjs que corren por terminal se ejecutan aquí en un proceso
 * hijo aislado, usando el Node que embebe Electron (ELECTRON_RUN_AS_NODE). Así
 * la lógica no se duplica y el pipeline sigue siendo auditable fuera de la app.
 *
 * Al terminar, la base se reconstruye desde el JSON actualizado: el catálogo
 * publicado nunca deja de derivarse de la fuente de verdad.
 */

import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { portableRoot, coursesJsonPath, coursesDbPath } from './paths.mjs';
import { open, rebuildFrom, countCourses } from './db.mjs';

// Lista cerrada de pasos ejecutables: el renderer no elige rutas arbitrarias.
const STEPS = {
  discover: 'discover.mjs',
  crawl: 'crawl.mjs',
  extract: 'extract.mjs',
  verify: 'verify.mjs',
  update: 'update.mjs',
  validate: 'validate.mjs',
  'check-links': 'check-links.mjs',
};

const DEFAULT_SEQUENCE = ['update', 'validate'];
const STEP_TIMEOUT_MS = 20 * 60 * 1000;

let running = false;

function scriptPath(file) {
  return join(portableRoot(), 'scripts', file);
}

function runStep(step, emit) {
  return new Promise((resolve) => {
    const file = scriptPath(STEPS[step]);

    if (!existsSync(file)) {
      emit({ step, level: 'warn', message: `Paso omitido: falta ${STEPS[step]}` });
      resolve({ step, skipped: true, code: null });
      return;
    }

    emit({ step, level: 'info', message: `Ejecutando ${step}…`, phase: 'start' });

    const child = fork(file, [], {
      cwd: portableRoot(),
      silent: true,
      // Ejecuta el binario de Electron como Node puro, sin abrir otra ventana.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', COURSES_ROOT: portableRoot() },
    });

    const timer = setTimeout(() => {
      emit({ step, level: 'error', message: `Tiempo agotado en ${step}` });
      child.kill('SIGTERM');
    }, STEP_TIMEOUT_MS);

    const relay = (level) => (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.trim()) emit({ step, level, message: line });
      }
    };

    child.stdout?.on('data', relay('info'));
    child.stderr?.on('data', relay('error'));

    child.on('error', (error) => {
      clearTimeout(timer);
      emit({ step, level: 'error', message: error.message });
      resolve({ step, skipped: false, code: -1 });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      emit({
        step,
        level: code === 0 ? 'info' : 'error',
        message: code === 0 ? `${step} completado` : `${step} finalizó con código ${code}`,
        phase: 'end',
      });
      resolve({ step, skipped: false, code });
    });
  });
}

export async function runPipeline({ getDb, setDb, emit, options = {} }) {
  if (running) {
    return { ok: false, error: 'Ya hay una actualización en curso.' };
  }
  running = true;

  const requested = Array.isArray(options.steps) ? options.steps : DEFAULT_SEQUENCE;
  const sequence = requested.filter((step) => Object.hasOwn(STEPS, step));

  if (sequence.length === 0) {
    running = false;
    return { ok: false, error: 'No se indicó ningún paso válido.' };
  }

  const results = [];

  try {
    emit({ level: 'info', message: 'Iniciando actualización del catálogo', phase: 'begin' });

    for (const step of sequence) {
      const result = await runStep(step, emit);
      results.push(result);

      if (!result.skipped && result.code !== 0) {
        emit({ level: 'error', message: `Actualización detenida en ${step}`, phase: 'abort' });
        return { ok: false, results, error: `El paso ${step} falló.` };
      }
    }

    // La base se regenera desde la fuente de verdad ya actualizada.
    let total = null;
    if (existsSync(coursesJsonPath())) {
      emit({ level: 'info', message: 'Reconstruyendo base de datos…' });
      try {
        getDb()?.close();
      } catch {
        // Se reabre a continuación de todas formas.
      }
      const db = open(coursesDbPath());
      rebuildFrom(db, coursesJsonPath());
      total = countCourses(db);
      setDb(db);
      emit({ level: 'info', message: `Base reconstruida: ${total} cursos.` });
    }

    emit({ level: 'info', message: 'Actualización completada', phase: 'done' });
    return { ok: true, results, total };
  } catch (error) {
    emit({ level: 'error', message: error.message, phase: 'abort' });
    return { ok: false, results, error: error.message };
  } finally {
    running = false;
  }
}
