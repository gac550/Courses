# Courses

Catálogo verificable y autoactualizable de cursos gratuitos de universidades y
organismos de primer nivel, empaquetado como aplicación de escritorio portable.

> Los precios, modalidades de acceso, disponibilidad y políticas de certificación
> pueden cambiar. Revisar siempre la fuente oficial antes de pagar o utilizar una
> credencial profesionalmente.

## Propósito y alcance

Reúne cursos **de acceso gratuito** en tres dominios: IA técnica, IA aplicada al
negocio, y dirección de proyectos y PMO. El acceso gratuito es el criterio de
entrada; la credencial es un dato adicional, no un requisito.

Cada registro se verifica contra la fuente oficial de la institución. Lo que no
puede verificarse queda como `null` y el curso como `PENDIENTE`.

## Uso

Doble clic en `Abrir.command` (macOS) o `Abrir.bat` (Windows). En la primera
ejecución se instalan las dependencias y se compila; después abre directamente.

Para desarrollo, con recarga en caliente:

```bash
npm run dev
```

## Metodología

```filetree
  Pipeline/
    discover/    # detecta URLs nuevas y desaparecidas
    crawl/       # recorre fuentes autorizadas con profundidad controlada
    extract/     # JSON-LD, Schema.org, OpenGraph y metadatos
    verify/      # contrasta contra fuente oficial
    diff/        # altas, bajas y cambios sensibles
    validate/    # esquema, coherencia y duplicados
```

Se ejecuta con `npm run update`, o desde el botón **Actualizar catálogo** de la
aplicación.

El crawler respeta una pausa de 1,2 s por host, de modo que **la primera pasada
tarda varios minutos**. Es deliberado: un crawler agresivo está prohibido.

### Memoria incremental

`data/discovery/memory.json` recuerda cada URL vista. Las páginas conocidas y
estables no se revisitan antes de 14 días, así que **la segunda pasada es mucho
más rápida** y el presupuesto se gasta en descubrir, no en repetir.

```bash
npm run update                    # incremental (recomendado)
COURSES_FULL_CRAWL=1 npm run crawl  # fuerza revisitar todo
```

### Cursos retirados

Una URL que falla **tres veces consecutivas** se da por retirada, y su curso pasa
a `NO_DISPONIBLE`.

**Ningún curso se borra jamás.** Conserva todos sus datos y recibe una nota
`[DEPRECADO fecha]` con el motivo. Si vuelve a responder, se restaura como
`REVERIFICAR` para que una persona lo confirme.

Un fallo aislado de red no depreca nada.

**Los candidatos descubiertos automáticamente ingresan siempre como
`PENDIENTE`**, nunca como `VERIFICADO`: el crawler detecta indicios, no
evidencia. La promoción a `VERIFICADO` exige revisión humana contra la fuente
oficial.

## Política de veracidad

Prohibido inventar cursos, URLs, precios, duraciones, credenciales o políticas de
acceso. Cuando un dato no puede verificarse:

- se usa `null`, nunca un string vacío ni un valor plausible;
- el registro se marca como `PENDIENTE`;
- toda inferencia se identifica con el prefijo `[INFERENCIA]`.

## Credenciales

«Curso gratuito» **no** implica «certificado gratuito». El catálogo distingue:

| Tipo | Significado |
|---|---|
| `certificado gratuito` | Contenido y certificado sin costo |
| `badge gratuito` | Insignia digital verificable sin costo |
| `declaracion de logro` | Constancia de participación sin costo |
| `certificado pagado verificable` | Contenido gratis, certificado con costo y verificable |
| `certificado pagado` | Contenido gratis, certificado con costo |
| `null` | Material abierto sin credencial |

## Verificación

Estados: `VERIFICADO`, `PENDIENTE`, `REVERIFICAR`, `NO_DISPONIBLE` y
`MANUAL_REVIEW_REQUIRED`.

Un registro `VERIFICADO` con más de 90 días desde `last_verified` deriva a
`REVERIFICAR` sin que sus datos se alteren.

## Arquitectura

| Componente | Decisión |
|---|---|
| Framework | Electron 43.3.0 (Node 24.18.1 · Chromium 150) |
| Empaquetado | electron-builder 26.15.3 |
| Bundler | electron-vite 5.0.0 |
| Base de datos | `node:sqlite` + FTS5 — integrado, sin dependencias nativas |
| Dependencias runtime | **Cero** |

`data/courses.json` es la única fuente de verdad, versionada en Git.
`data/courses.db` es un artefacto derivado y regenerable.

La aplicación resuelve todas sus rutas relativas al ejecutable: mover la carpeta
a otro disco o equipo no rompe nada.

## Comandos

```bash
npm run dev          # app con recarga en caliente
npm run update       # pipeline incremental completo
npm run crawl        # solo recorrido de fuentes
npm run extract      # solo extracción de metadatos
npm run verify       # solo contraste contra evidencia
npm run discover     # solo descubrimiento incremental
npm run diff         # reporte de cambios
npm run validate     # validación del catálogo
npm run stats        # composición del catálogo
npm run check-links  # verificación de enlaces
npm run build-db     # reconstruye la base desde el JSON
npm test             # batería de tests
```

## Agregar una institución

Editar `config/sources.json`:

```json
{
  "id": "identificador-corto",
  "institution": "Nombre oficial",
  "country": "US",
  "domains": ["dominio.edu"],
  "seed_urls": ["https://dominio.edu/courses"],
  "max_depth": 3,
  "enabled": true,
  "adapter": "generic"
}
```

Las `seed_urls` deben verificarse antes de agregarse: nunca se rellenan a ciegas.

## Agregar un curso

Editar `data/courses.json` respetando `data/schema.json`. Requisitos mínimos:
`id`, `title`, `institution`, `domain`, `url_official`, `verification_status` y
`source_of_truth`.

Para declararlo `VERIFICADO` hace falta respaldo de fuente oficial para título,
institución, URL, modalidad de acceso, estado y credencial. Después, ejecutar
`npm run validate`.

## Crawler

Controlado, auditable y respetuoso. Respeta `robots.txt`, límites de
concurrencia y pausas por host. **Prohibido** el bypass de CAPTCHA, la evasión de
anti-bot y la rotación de proxies. Cuando un sitio impide el acceso
automatizado, se registra `MANUAL_REVIEW_REQUIRED`.

Límites por defecto en `config/crawler.json`: concurrencia global 5, por host 2,
timeout 15 s, profundidad 3.

## Automatización

GitHub se usa como respaldo y organización del código. No hay GitHub Pages: la
aplicación se ejecuta localmente.
