/**
 * Proceso principal de Electron.
 *
 * Seguridad (regla innegociable del repositorio): contextIsolation y sandbox
 * activos, nodeIntegration desactivado. El IPC es la frontera de confianza y
 * valida toda entrada del renderer. Esto es crítico porque la app muestra
 * contenido derivado de páginas crawleadas.
 */

import { app, BrowserWindow, shell } from 'electron';
import { existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { redirectUserData, portableRoot, coursesJsonPath, coursesDbPath, seedDir, dataDir } from './paths.mjs';
import { open, rebuildFrom, countCourses } from './db.mjs';
import { registerIpc } from './ipc.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Debe ejecutarse antes de 'ready': Electron fija userData al arrancar.
redirectUserData();

let db = null;
let mainWindow = null;

/**
 * Primer arranque: copia la semilla empaquetada a la carpeta portable para que
 * el catálogo quede editable y viaje con la aplicación.
 */
function ensureSeed() {
  const target = coursesJsonPath();
  if (existsSync(target)) return;

  const seed = join(seedDir(), 'courses.json');
  if (!existsSync(seed)) return;

  mkdirSync(dataDir(), { recursive: true });
  copyFileSync(seed, target);

  const seedConfig = join(seedDir(), 'config');
  const targetConfig = join(portableRoot(), 'config');
  if (existsSync(seedConfig) && !existsSync(targetConfig)) {
    mkdirSync(targetConfig, { recursive: true });
    for (const file of ['sources.json', 'crawler.json', 'topics.json']) {
      const from = join(seedConfig, file);
      if (existsSync(from)) copyFileSync(from, join(targetConfig, file));
    }
  }
}

/** Abre la base y la reconstruye desde el JSON si falta o está vacía. */
function initDatabase() {
  ensureSeed();
  db = open(coursesDbPath());

  if (countCourses(db) === 0 && existsSync(coursesJsonPath())) {
    rebuildFrom(db, coursesJsonPath());
  }
  return db;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 760,
    minHeight: 560,
    show: false,
    title: 'Courses',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Todo enlace externo se abre en el navegador del sistema, nunca en la app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Bloquea cualquier navegación fuera del contenido empaquetado.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const dev = process.env.ELECTRON_RENDERER_URL;
    if (dev && url.startsWith(dev)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
  }

  return mainWindow;
}

app.whenReady().then(() => {
  initDatabase();
  registerIpc({
    getDb: () => db,
    setDb: (next) => { db = next; },
    getWindow: () => mainWindow,
  });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  try {
    db?.close();
  } catch {
    // La base es un artefacto regenerable: un cierre fallido no pierde datos.
  }
});

// Impide que el renderer solicite permisos del sistema que la app no necesita.
app.on('web-contents-created', (_event, contents) => {
  contents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
});
