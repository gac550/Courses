import test from 'node:test';
import assert from 'node:assert/strict';

import { extractPrice, mentionsFreeAccess, classifyAccess, isPaidAccess } from '../scripts/lib/pricing.mjs';

test('se extrae el precio de acceso declarado', () => {
  assert.equal(extractPrice('Price: $4,200'), 4200);
  assert.equal(extractPrice('Cost: $199.00'), 199);
  assert.equal(extractPrice('Tuition: US$2,750'), 2750);
});

test('sin precio declarado devuelve null', () => {
  assert.equal(extractPrice('Este curso dura 6 semanas'), null);
  assert.equal(extractPrice(''), null);
  assert.equal(extractPrice(null), null);
});

test('se reconocen las menciones de acceso gratuito', () => {
  assert.equal(mentionsFreeAccess('Price: Free*'), true);
  assert.equal(mentionsFreeAccess('Audit this course for free'), true);
  assert.equal(mentionsFreeAccess('Acceso gratuito al contenido'), true);
  assert.equal(mentionsFreeAccess('Curso de pago sin alternativa'), false);
});

test('un precio de acceso sin vía gratuita marca el curso como pagado', () => {
  assert.equal(classifyAccess('Price: $4,200. Enroll now.'), 'pagado');
  assert.equal(isPaidAccess('Price: $4,200'), true);
});

test('contenido gratuito con certificado pagado es acceso gratuito', () => {
  // El caso de Harvard en edX: audit gratis, certificado 219 USD. El precio
  // del certificado no convierte el curso en uno de pago.
  const texto = 'Price: Free*. Audit this course for free. Add a Verified Certificate for $219';
  assert.equal(classifyAccess(texto), 'gratis');
  assert.equal(isPaidAccess(texto), false, 'no se descarta un curso de acceso libre');
});

test('un precio alto junto a una mención de gratuidad va a revisión humana', () => {
  // Sin un «Price: Free» explícito, la evidencia es contradictoria.
  const texto = 'Price: $4,200. Some scholarships are free for eligible applicants.';
  assert.equal(classifyAccess(texto), null);
  assert.equal(isPaidAccess(texto), false, 'la duda nunca descarta por sí sola');
});

test('un precio de cero es acceso gratuito', () => {
  assert.equal(classifyAccess('Price: $0'), 'gratis');
});

test('sin evidencia no se decide', () => {
  assert.equal(classifyAccess('Curso de seis semanas sobre liderazgo'), null);
  assert.equal(isPaidAccess('Curso de seis semanas'), false, 'la duda no descarta');
});

test('otras monedas no se interpretan como precio en USD', () => {
  assert.equal(extractPrice('Price: €4200'), null);
  assert.equal(extractPrice('Precio: CLP 90.000'), null);
});
