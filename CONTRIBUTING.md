# Contribuir a Courses

## Regla suprema: prohibido inventar

Ningún dato se completa con valores plausibles. Nunca inventar cursos, nombres,
códigos, URLs, precios, profesores, duraciones, fechas, prerrequisitos,
credenciales ni políticas de acceso.

Cuando un dato no puede verificarse contra fuente oficial:

- usar `null`, nunca un string vacío;
- registrar la incertidumbre en `notes`;
- marcar el registro como `PENDIENTE`.

Toda inferencia se identifica con el prefijo `[INFERENCIA]` y jamás se convierte
en dato estructurado confirmado.

## Evidencia requerida

`source_of_truth` es obligatorio y debe apuntar a una fuente primaria:

1. dominio oficial de la institución;
2. plataforma enlazada oficialmente por ella;
3. página oficial del curso;
4. organismo emisor de la credencial.

Blogs, Reddit, rankings, directorios y agregadores sirven **solo para
descubrimiento**. Nunca como `source_of_truth`.

Una plataforma externa es fuente primaria únicamente cuando puede verificarse la
relación oficial entre la institución y el curso.

## Política de credenciales

«Free course» **no** significa «free certificate». Antes de completar
`credential_type`, verificar en la fuente oficial:

- si el acceso al contenido es gratuito;
- si existe auditoría gratuita;
- si el certificado es gratuito o pagado;
- si es badge, declaración de logro o certificado;
- si es verificable.

Cuando el acceso sea gratuito pero el certificado pagado, declararlo
explícitamente en `notes`.

Coherencias que el validador exige:

- `credential_free: true` es incompatible con `credential_price_usd > 0`;
- `credential_type: "certificado gratuito"` es incompatible con
  `credential_free: false`.

## Política de precios

Los precios son volátiles. Todo precio debe:

- provenir de una fuente verificable;
- expresarse en USD;
- acompañarse de `last_verified`;
- quedar como `null` si no es verificable;
- **nunca** inferirse desde un curso similar.

No se realizan conversiones monetarias dentro del dataset.

## Proceso de incorporación

1. Verificar el curso contra la fuente oficial.
2. Agregar el registro a `data/courses.json` respetando `data/schema.json`.
3. Ejecutar `npm run validate`: debe terminar con 0 errores.
4. Ejecutar `npm test`.
5. Confirmar con un commit atómico.

Un curso descubierto por el crawler entra como `PENDIENTE`. Para promoverlo a
`VERIFICADO` hace falta respaldo de fuente oficial para título, institución, URL,
modalidad de acceso, estado y credencial.

## Relevancia profesional

`relevance_ppp_infra` es una **evaluación editorial**, no un hecho de la
institución. Escala:

| Valor | Significado |
|---|---|
| `0` | Prácticamente irrelevante |
| `1` | Utilidad marginal |
| `2` | Utilidad profesional clara |
| `3` | Utilidad directa y alta |

Toda puntuación mayor que 0 exige una justificación breve en `notes`.

## Crawler

Prohibido: bypass de CAPTCHA, evasión de anti-bot, rotación de proxies para
eludir restricciones y crawling agresivo. Si un sitio impide el acceso
automatizado, registrar `MANUAL_REVIEW_REQUIRED` y documentarlo.

Los límites viven en `config/crawler.json`, nunca hardcodeados.

## Convenciones de commits

Conventional Commits en rama `main`:

| Tipo | Uso |
|---|---|
| `feat` | Funcionalidad nueva |
| `fix` | Corrección de un defecto |
| `data` | Cambios en el catálogo |
| `docs` | Documentación |
| `refactor` | Reestructuración sin cambio de comportamiento |
| `test` | Tests |
| `chore` | Mantenimiento |
| `ci` | Automatización |

Commits atómicos: no mezclar trabajo no relacionado. **Prohibido `force push`.**

## Testing

`node --test`. No afirmar que los tests pasan sin haberlos ejecutado realmente.

Cobertura mínima: ordenamiento, normalización, deduplicación, antigüedad,
clasificación de credenciales, parsing de precios, manejo de `null`, validación
de URLs, generación de IDs estables, `robots.txt` y extracción de metadatos.

## Idioma

Español neutro de Latinoamérica (es-419), UTF-8. Prohibido el voseo y el
imperativo: usar infinitivo o impersonal.
