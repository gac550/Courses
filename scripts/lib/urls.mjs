/**
 * Normalización y validación de URLs.
 *
 * La URL canónica es la base de la deduplicación (§17), así que la
 * normalización debe ser estable y conservadora: nunca descarta información que
 * pudiera distinguir dos cursos distintos.
 */

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'gclid', 'fbclid', 'mc_cid', 'mc_eid', 'ref', 'referrer', 'source',
]);

export function isValidHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'http:' || url.protocol === 'https:';
}

/**
 * URL canónica para comparación.
 *
 * Normaliza esquema, host y barra final; elimina fragmento y parámetros de
 * seguimiento; ordena los parámetros restantes.
 */
export function canonicalUrl(value) {
  if (!isValidHttpUrl(value)) return null;

  const url = new URL(value);

  url.protocol = 'https:';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.hash = '';
  url.port = '';

  for (const param of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(param.toLowerCase())) url.searchParams.delete(param);
  }
  url.searchParams.sort();

  // Barra final irrelevante salvo en la raíz.
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}

export function hostOf(value) {
  if (!isValidHttpUrl(value)) return null;
  return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
}

/** Verifica pertenencia a la allowlist, incluyendo subdominios. */
export function isAllowedHost(value, allowedDomains) {
  const host = hostOf(value);
  if (!host || !Array.isArray(allowedDomains)) return false;

  return allowedDomains.some((domain) => {
    const clean = String(domain).toLowerCase().replace(/^www\./, '');
    return host === clean || host.endsWith(`.${clean}`);
  });
}
