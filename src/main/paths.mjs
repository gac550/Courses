/**
 * Resolución de rutas portables.
 *
 * Regla del repositorio: la app NUNCA escribe en ~/Library/Application Support
 * ni en %APPDATA%. Todo su estado vive junto al ejecutable, de modo que mover la
 * carpeta a otro disco o equipo no rompe nada.
 */

import { app } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Carpeta base portable: la que contiene al ejecutable.
 *
 * - En desarrollo: la raíz del repositorio.
 * - Empaquetado en macOS: la carpeta que contiene Courses.app, no su interior.
 *   Se sale del bundle (Courses.app/Contents/MacOS/Courses) para que los datos
 *   sobrevivan a una reinstalación y queden a la vista del usuario.
 * - Empaquetado en Windows: la carpeta que contiene Courses.exe.
 */
export function portableRoot() {
  if (!app.isPackaged) {
    // dist/main/index.js -> raíz del repositorio
    return resolve(app.getAppPath());
  }

  const exe = app.getPath('exe');

  if (process.platform === 'darwin') {
    // …/Courses.app/Contents/MacOS/Courses -> …/
    return resolve(dirname(exe), '..', '..', '..');
  }

  return dirname(exe);
}

const ROOT = null; // se resuelve de forma diferida: app.getPath exige app lista

let cachedRoot = ROOT;

function root() {
  if (cachedRoot === null) cachedRoot = portableRoot();
  return cachedRoot;
}

export function dataDir() {
  return ensureDir(join(root(), 'data'));
}

export function configDir() {
  return join(root(), 'config');
}

export function logsDir() {
  return ensureDir(join(root(), 'logs'));
}

export function reportsDir() {
  return ensureDir(join(root(), 'reports'));
}

/** Fuente de verdad del catálogo, versionada en Git. */
export function coursesJsonPath() {
  return join(dataDir(), 'courses.json');
}

/** Artefacto derivado y regenerable. Nunca es la única copia de un dato. */
export function coursesDbPath() {
  return join(dataDir(), 'courses.db');
}

/** Semilla incluida en el paquete, usada solo en el primer arranque. */
export function seedDir() {
  return join(process.resourcesPath ?? root(), 'seed');
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Redirige userData a la carpeta portable. Debe invocarse ANTES de que la app
 * esté lista, porque Electron fija la ruta al arrancar.
 */
export function redirectUserData() {
  const dir = join(portableRoot(), 'data', 'runtime');
  mkdirSync(dir, { recursive: true });
  app.setPath('userData', dir);
  app.setPath('sessionData', dir);
  return dir;
}
