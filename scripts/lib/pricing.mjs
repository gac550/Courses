/**
 * Detección de acceso de pago en una página de curso.
 *
 * El filtro de entrada del catálogo es el acceso gratuito al contenido: un
 * curso cuyo contenido cuesta dinero no pertenece, aunque su institución sea
 * de primer nivel.
 *
 * Distinguir tres cosas que la página suele mezclar:
 *   - contenido gratuito, certificado gratuito      → entra
 *   - contenido gratuito, certificado de pago       → entra (el acceso es libre)
 *   - contenido de pago                             → NO entra
 */

/** Precio del acceso al curso, en USD. `null` si no se declara ninguno. */
export function extractPrice(text) {
  if (typeof text !== 'string') return null;

  // «Price: Free» declara el acceso como gratuito: el precio es cero, y
  // cualquier cifra posterior corresponde al certificado, no al contenido.
  if (/\bprice\s*:?\s*free/i.test(text)) return 0;

  // «Price: $4,200» y variantes. Se descartan cifras de otras monedas.
  const patterns = [
    /\bprice\s*:?\s*(?:us)?\$\s*([\d,]+(?:\.\d{2})?)/i,
    /\bcost\s*:?\s*(?:us)?\$\s*([\d,]+(?:\.\d{2})?)/i,
    /\btuition\s*:?\s*(?:us)?\$\s*([\d,]+(?:\.\d{2})?)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const value = Number.parseFloat(match[1].replace(/,/g, ''));
    if (Number.isFinite(value)) return value;
  }

  return null;
}

/** Indicios de que el contenido puede cursarse sin pagar. */
export function mentionsFreeAccess(text) {
  if (typeof text !== 'string') return false;

  return /\bfree\*?\b/i.test(text)
    || /\baudit (this course )?for free\b/i.test(text)
    || /\bgratis\b/i.test(text)
    || /\bacceso (libre|gratuito)\b/i.test(text)
    || /\bsin costo\b/i.test(text)
    || /\bprice\s*:?\s*free/i.test(text);
}

/**
 * Clasifica el acceso al contenido de un curso.
 *
 * Devuelve uno de:
 *   'gratis'          — el contenido es accesible sin pagar
 *   'pagado'          — hay que pagar para acceder al contenido
 *   null              — la evidencia no alcanza para decidir
 *
 * Ante evidencia contradictoria (precio alto + mención de gratuidad) devuelve
 * null: el caso va a revisión humana en vez de resolverse adivinando.
 */
export function classifyAccess(text) {
  const price = extractPrice(text);
  const free = mentionsFreeAccess(text);

  // Un precio de acceso declarado manda: el curso cuesta dinero.
  if (price !== null && price > 0) {
    // Salvo que la página ofrezca además una vía gratuita explícita, en cuyo
    // caso el precio corresponde al certificado, no al contenido.
    return free ? null : 'pagado';
  }

  if (price === 0 || free) return 'gratis';

  return null;
}

/** Un curso pertenece al catálogo solo si su contenido no es de pago. */
export function isPaidAccess(text) {
  return classifyAccess(text) === 'pagado';
}
