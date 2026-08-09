/**
 * Ordenamiento canónico del catálogo.
 *
 * Esta es la ÚNICA implementación. No duplicar esta lógica en otros módulos.
 * La consulta SQL de src/main/ipc.mjs replica estos rangos: al cambiar aquí,
 * actualizar allá y verificar con los tests.
 *
 * El resultado es determinístico y estable: el desempate final por `id`
 * garantiza que dos ejecuciones sobre los mismos datos produzcan el mismo orden.
 */

/** Prioridad por acreditabilidad. Menor número = mayor prioridad. */
export const CREDENTIAL_RANK = {
  'certificado gratuito': 0,
  'badge gratuito': 1,
  'declaracion de logro': 2,
  'certificado pagado verificable': 3,
  'certificado pagado': 4,
};

const NO_CREDENTIAL_RANK = 6;
const UNKNOWN_CREDENTIAL_RANK = 5;

export function credentialRank(course) {
  const type = course?.credential_type;
  if (type === null || type === undefined) return NO_CREDENTIAL_RANK;
  const rank = CREDENTIAL_RANK[type];
  return rank === undefined ? UNKNOWN_CREDENTIAL_RANK : rank;
}

export function verifiedRank(course) {
  return course?.verification_status === 'VERIFICADO' ? 0 : 1;
}

/** Compara respetando es-419 y tratando null como último. */
function compareText(a, b) {
  const left = a ?? '';
  const right = b ?? '';
  if (left === right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.localeCompare(right, 'es');
}

function compareNumberDesc(a, b) {
  const left = typeof a === 'number' ? a : -Infinity;
  const right = typeof b === 'number' ? b : -Infinity;
  return right - left;
}

/**
 * Comparador canónico.
 *
 * Prioridad: acreditabilidad, verificación, relevancia (desc), institución,
 * título, id.
 */
export function compareCourses(a, b) {
  const byCredential = credentialRank(a) - credentialRank(b);
  if (byCredential !== 0) return byCredential;

  const byVerified = verifiedRank(a) - verifiedRank(b);
  if (byVerified !== 0) return byVerified;

  const byRelevance = compareNumberDesc(a?.relevance_ppp_infra, b?.relevance_ppp_infra);
  if (byRelevance !== 0) return byRelevance;

  const byInstitution = compareText(a?.institution, b?.institution);
  if (byInstitution !== 0) return byInstitution;

  const byTitle = compareText(a?.title, b?.title);
  if (byTitle !== 0) return byTitle;

  return compareText(a?.id, b?.id);
}

/** Devuelve una copia ordenada. No muta la entrada. */
export function sortCourses(courses) {
  return [...courses].sort(compareCourses);
}
