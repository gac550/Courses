# CLAUDE.md — Reglas permanentes del repositorio `Courses`

Catálogo verificable y autoactualizable de cursos gratuitos de universidades y
organismos de primer nivel, empaquetado como aplicación de escritorio portable.

## 1. Regla suprema: prohibido inventar

Ningún dato del catálogo se completa con valores plausibles. **Nunca** inventar
cursos, nombres, códigos, URLs, precios, profesores, duraciones, fechas,
prerrequisitos, credenciales ni políticas de acceso.

Cuando un dato no pueda verificarse contra fuente oficial:

- usar `null` (nunca string vacío);
- registrar la incertidumbre;
- marcar el registro como `PENDIENTE`.

Toda inferencia se marca explícitamente con el prefijo `[INFERENCIA]` y **jamás**
se convierte en dato estructurado confirmado.

## 2. Single Source of Truth

`data/courses.json` es la única fuente de verdad del catálogo. Está versionado en
Git: legible, diffeable y auditable en cada commit.

`data/courses.db` es un **artefacto derivado y regenerable** (SQLite + FTS5). No
se versiona (está en `.gitignore`). Se reconstruye con `npm run build-db`. Ningún
dato vive únicamente en la base de datos.

## 3. Arquitectura

| Componente | Decisión |
|---|---|
| Framework | Electron 43.3.0 (Node 24.18.1 · Chromium 150) |
| Empaquetado | electron-builder 26.15.3 |
| Bundler | electron-vite 5.0.0 |
| Base de datos | `node:sqlite` + FTS5 — integrado, sin dependencias nativas |
| Dependencias runtime | **Cero.** `fetch` y `node:sqlite` son nativos de Node 24 |

Estructura: `config/` (fuentes y parámetros), `data/` (catálogo), `scripts/`
(pipeline), `src/main` + `src/preload` + `src/renderer` (app), `tests/`,
`reports/`.

No introducir base de datos externa, servidor, Docker ni framework frontend sin
necesidad demostrada. Preferir Node.js nativo y librerías pequeñas.

## 4. Portabilidad

La aplicación resuelve **todas** sus rutas relativas al ejecutable. Nunca escribe
en `~/Library/Application Support` ni en `%APPDATA%`: `userData` se redirige a la
carpeta local. Mover la carpeta a otro disco o equipo no debe romper nada.

Si falta `data/courses.db`, la app la reconstruye desde `data/courses.json`.

## 4.0 Lanzadores

`Courses.command` (macOS) y `Courses.bat` (Windows) están en la raíz: doble clic
para abrir la aplicación. Instalan dependencias en la primera ejecución,
recompilan solo si el código fuente cambió y abren la ventana. Resuelven todas
las rutas respecto de su propia ubicación, de modo que mover la carpeta completa
no rompe nada.

## 4.1 Desarrollo con recarga en caliente

`npm run dev` levanta la app con recarga automática: el renderer se actualiza al
guardar sin perder el estado, y el proceso principal se reinicia solo al cambiar
`src/main`. No hace falta cerrar y reabrir la aplicación.

Además, la app vigila `data/courses.json` en todo momento (también empaquetada):
si el archivo cambia — por el pipeline, por una edición manual o por un `git
pull` —, la base se regenera y la ventana se refresca sola.

## 4.2 Tema y tokens de diseño

Tema **claro por defecto**, con oscuro y automático disponibles desde el selector
de la cabecera. La elección viaja en la query string (`?theme=dark`): sin
`localStorage`, cookies ni almacenamiento persistente.

Los colores viven en tres niveles dentro de `src/renderer/styles.css`:

1. **Primitivos** (`--c-*`): la paleta cruda. Nunca se usan en componentes.
2. **Semánticos** (`--bg`, `--text`, `--free`, `--shadow-overlay`): describen la
   función, no el color. Es lo único que consumen los componentes.
3. **Temas**: reasignan los semánticos según `data-theme` en el elemento raíz.

**Regla dura: ningún componente escribe un color literal.** Si hace falta un
color nuevo, se agrega un primitivo y se expone como semántico. Cada tema define
también `color-scheme`, para que los controles nativos acompañen.

El `backgroundColor` de la `BrowserWindow` espeja `--c-white` y `--c-ink-900`
para evitar el destello blanco al abrir en oscuro: al cambiar esos primitivos,
actualizar también `src/main/index.mjs`.

## 5. Seguridad (innegociable)

En toda `BrowserWindow`:

- `contextIsolation: true`
- `sandbox: true`
- `nodeIntegration: false`
- `webSecurity: true`

El IPC es la frontera de confianza: validar **toda** entrada del renderer como si
viniera de un cliente no confiable. Esto es crítico porque la app muestra
contenido derivado de páginas crawleadas.

Enlaces externos siempre con `target="_blank"` y `rel="noopener noreferrer"`, y
abiertos en el navegador del sistema, nunca en una ventana de la app.

Mantener Electron actualizado: la CVE-2026-70601 afectó a versiones anteriores a
la 42.

## 6. Política de fuentes

Fuente primaria admisible: dominio oficial de la institución, plataforma
enlazada oficialmente por ella, página oficial del curso u organismo emisor de la
credencial.

Blogs, Reddit, rankings, directorios y agregadores sirven **solo para
descubrimiento**; nunca como `source_of_truth`.

## 7. Crawler

Controlado, auditable y respetuoso. Allowlist de dominios en
`config/sources.json`; parámetros en `config/crawler.json`.

Respetar `robots.txt`, rate limits y códigos HTTP. **Prohibido**: bypass de
CAPTCHA, evasión de anti-bot, rotación de proxies para eludir restricciones y
crawling agresivo. Si un sitio impide el crawling automatizado, registrar
`MANUAL_REVIEW_REQUIRED`.

Límites por defecto: concurrencia global 5, por host 2, timeout 15 s, profundidad
3. Centralizados en configuración, nunca hardcodeados.

## 8. Credenciales

Nunca interpretar «free course» como «free certificate». Diferenciar acceso
gratuito, auditoría gratuita, certificado gratuito, certificado pagado, badge y
declaración de logro. Cuando el acceso sea gratuito pero el certificado pagado,
declararlo explícitamente en `notes`.

## 9. Precios

Volátiles. Siempre con fuente verificable, en USD, con fecha de verificación.
`null` si no es verificable. **Nunca** inferir un precio desde un curso similar.

## 10. Verificación

Estados: `VERIFICADO`, `PENDIENTE`, `REVERIFICAR`, `NO_DISPONIBLE`,
`MANUAL_REVIEW_REQUIRED`.

`VERIFICADO` exige respaldo de fuente oficial para título, institución, URL,
modalidad de acceso, estado y credencial. Si `last_verified` supera 90 días, el
estado derivado pasa a `REVERIFICAR` — **sin alterar los datos**.

## 11. Ordenamiento canónico

Centralizado exclusivamente en `scripts/lib/sort.mjs`. No duplicar la lógica.
Determinístico y estable. Prioridad: certificado gratuito > badge gratuito
verificable > declaración de logro > certificado pagado verificable > certificado
pagado > sin credencial. Desempates: `VERIFICADO`, `relevance_ppp_infra` desc,
institución, título, `id`.

## 12. Tests

`node --test`. No afirmar que los tests pasan sin haberlos ejecutado realmente.
Cobertura mínima: ordenamiento, normalización, deduplicación, antigüedad,
clasificación de credenciales, parsing de precios, manejo de `null`, validación
de URLs y generación de IDs estables.

## 13. Git

Rama `main`. Commits atómicos con Conventional Commits (`feat`, `fix`, `data`,
`docs`, `refactor`, `test`, `chore`, `ci`).

**Prohibido `force push`.** Prohibido borrar trabajo existente. GitHub se usa solo
como respaldo y organización del código: no hay GitHub Pages.

Borrado recuperable: mover a `_trash/` en lugar de `rm`.

## 14. Antes de modificar

Diagnosticar siempre el estado real (archivos, git, datos) antes de editar. No
asumir; verificar con herramientas.

## 15. Idioma

Español neutro de Latinoamérica (es-419), UTF-8. Prohibido el voseo y el
imperativo: usar infinitivo o impersonal («configurar» / «se configura», nunca
«configurá» / «configura»).
