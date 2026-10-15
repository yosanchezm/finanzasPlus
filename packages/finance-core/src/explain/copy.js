import { ValidationError } from '../errors.js';
import { fnv1a } from './hash.js';
import { EXPLAIN_TOPICS } from './topics.js';

// Reviewed legal and educational copy and its release gate (design G8).
//
//   EXPLAIN_COPY[key] = { text, sources: [{ label, url? }], reviewedOn: 'YYYY-MM-DD' | null, reviewedHash: string | null }
//
// An entry is reviewed when it has text, at least one source, a `reviewedOn` date and a `reviewedHash`
// equal to `copyHash(entry)`, so any edit after the review un-reviews it. A key that a topic lists in
// `topicCopyKeys` but that is missing here counts as unreviewed. A topic is released only when all of its keys
// are reviewed; an unreleased topic is answered with "en revision". The owner review fills this object in.
// Pure and Node 16 safe.

const SUPERFINANCIERA = { label: 'Superintendencia Financiera de Colombia: certificación del IBC', url: 'https://www.superfinanciera.gov.co/publicaciones/19130' };
const CCO_884 = { label: 'Código de Comercio, art. 884 (tope: tasa de usura)' };
const CC_1653 = { label: 'Código Civil, art. 1653 (imputación del pago)' };
const CARD_CONTRACT = { label: 'Contrato y extracto de tu tarjeta de crédito' };

// Neutral, informational Spanish. The owner approved the exact text and sources of every entry on 2026-10-15 (gate G.1),
// and `reviewedHash` signs them: editing a text or a source un-reviews its entry until it is approved again. The Ley 546 and Ley 1555 texts claim only what the app does: they name
// the law, say what it is about, and say that its scope for the user's debt is not verified here.
export const EXPLAIN_COPY = {
  'legal.usury_ibc': {
    text:
      'El interés bancario corriente (IBC) es la tasa promedio que cobran los bancos en cada modalidad de crédito; la Superintendencia Financiera de Colombia lo certifica periódicamente. ' +
      'La tasa de usura es el tope legal para los intereses y equivale a 1,5 veces el IBC certificado (Código de Comercio, art. 884). ' +
      'Cobrar por encima de ese tope tiene consecuencias para el acreedor según la ley. ' +
      'El tope cambia con cada certificación y depende de la modalidad del crédito (por ejemplo, consumo y ordinario).',
    sources: [SUPERFINANCIERA, { label: 'Código de Comercio, art. 884 (Ley 510 de 1999, art. 111)' }],
    reviewedOn: '2026-10-15',
    reviewedHash: '040ea126',
  },
  'legal.mora': {
    text:
      'La mora es el interés que se cobra cuando una cuota no se paga a tiempo. En esta app se calcula sobre el capital vencido de la cuota y por los días de atraso, nunca sobre intereses, cargos ni impuestos. ' +
      'La tasa de mora no puede superar la tasa de usura vigente (Código de Comercio, art. 884). ' +
      'La ley también limita cobrar intereses sobre intereses, lo que se conoce como anatocismo (Código de Comercio, art. 886); por eso la mora no se suma al capital para generar más intereses. ' +
      'Al pagar, el valor se aplica primero a los intereses y después al capital (Código Civil, art. 1653). ' +
      'Si tu banco calcula la mora de otra forma, manda el extracto del banco.',
    sources: [CCO_884, { label: 'Código de Comercio, art. 886 (anatocismo)' }, CC_1653],
    reviewedOn: '2026-10-15',
    reviewedHash: 'ad6483e0',
  },
  'legal.gmf': {
    text:
      'El GMF (gravamen a los movimientos financieros, conocido como 4x1000) es un impuesto que se causa sobre ciertas transacciones financieras, con una tarifa de 0,4 % del valor de la operación. ' +
      'Lo retiene tu entidad financiera, no esta app. Existen operaciones y cuentas exentas; confirma con tu banco si aplica en tu caso. ' +
      'El ejemplo de esta respuesta es ilustrativo.',
    sources: [{ label: 'Estatuto Tributario, arts. 870 a 881 (GMF)' }],
    reviewedOn: '2026-10-15',
    reviewedHash: 'efad0356',
  },
  'rate_conventions.sample': {
    text:
      'Una misma tasa se puede expresar de varias formas. La E.A. (efectiva anual) es lo que de verdad cuesta el crédito durante el año y es la mejor para comparar. ' +
      'La N.A.M.V. (nominal anual, mes vencido) se reparte en 12 meses para sacar la tasa mensual (M.V.); como ese interés se acumula mes a mes, la E.A. resultante es mayor que la nominal. ' +
      'Por eso una tasa nominal de 25 % y una efectiva de 25 % no cuestan lo mismo.',
    sources: [{ label: 'Matemática financiera: equivalencia de tasas de interés' }],
    reviewedOn: '2026-10-15',
    reviewedHash: '6b3fbe7a',
  },
  'usury_ibc.sample': {
    text:
      'La usura es el tope que la ley pone a los intereses de un crédito. Si la tasa de tu deuda está por debajo del tope, cumple el límite; si lo supera, conviene revisar el contrato con la entidad o consultar a la Superintendencia Financiera. ' +
      'El tope se publica cada mes por modalidad, y esta guía solo muestra el que tiene registrado.',
    sources: [SUPERFINANCIERA, CCO_884],
    reviewedOn: '2026-10-15',
    reviewedHash: '71876bfa',
  },
  'mora.sample': {
    text:
      'La mora es un interés adicional por pagar tarde. Empieza a contar después de la fecha de vencimiento de la cuota y crece por cada día de atraso, pero solo sobre el capital que quedó vencido. ' +
      'Pagar la cuota detiene la mora, y la mora no cambia el valor de las cuotas futuras.',
    sources: [CCO_884],
    reviewedOn: '2026-10-15',
    reviewedHash: '357538a3',
  },
  'payment_allocation.sample': {
    text:
      'Cuando pagas, el dinero se reparte en un orden fijo: primero los cargos e impuestos de la cuota, luego la mora, después los intereses y al final el capital. ' +
      'Por eso un pago parcial puede no reducir el capital: primero cubre los conceptos anteriores. Si pagas más de lo que debe la cuota, el sobrante se aplica a las cuotas siguientes.',
    sources: [CC_1653],
    reviewedOn: '2026-10-15',
    reviewedHash: '83f39b1b',
  },
  'charges.sample': {
    text:
      'Además de los intereses, una deuda puede traer cargos: seguros, comisiones o cuotas de manejo, e impuestos como el IVA. Los cargos se suman a la cuota y no reducen el capital. ' +
      'Un impuesto puede calcularse sobre otro cargo (por ejemplo, el IVA sobre una comisión); en la app queda ligado a ese cargo y se quita con él. Revisa en tu contrato cuáles aplican.',
    sources: [{ label: 'Contrato y extracto de tu entidad financiera' }],
    reviewedOn: '2026-10-15',
    reviewedHash: '40ee2411',
  },
  'card_statement.sample': {
    text:
      'El extracto es el resumen que tu entidad genera en la fecha de corte: reúne las compras, las cuotas de las compras diferidas, los intereses, la cuota de manejo y los impuestos del periodo. Tienes hasta la fecha límite de pago para pagarlo. ' +
      'El pago mínimo es lo menos que debes pagar en esa fecha para no quedar en mora; cada entidad define cómo lo calcula. El pago total cubre todo el extracto.',
    sources: [CARD_CONTRACT],
    reviewedOn: '2026-10-15',
    reviewedHash: 'f37f76ba',
  },
  'card_interest_drop.sample': {
    text:
      'En una tarjeta, los intereses de las compras corrientes se cobran sobre el saldo que quedó sin pagar después de la fecha límite de pago. Si pagas el extracto completo hasta esa fecha, esa parte no genera intereses en el siguiente corte. ' +
      'Si solo pagas el mínimo, el resto sigue generando intereses y el siguiente extracto los cobra. Por eso los intereses pueden bajar de un extracto al siguiente aunque la tasa no haya cambiado: depende de cuánto pagaste y cuándo.',
    sources: [CARD_CONTRACT, { label: 'Método de cálculo de la app para tarjetas (aproximado)' }],
    reviewedOn: '2026-10-15',
    reviewedHash: '76b64279',
  },
  'legal.ley546': {
    text:
      'La Ley 546 de 1999 es la ley marco de la financiación de vivienda en Colombia. Los créditos de vivienda tienen reglas propias, por ejemplo sobre las tasas de interés y la mora, que pueden ser distintas de las de un crédito de consumo. ' +
      'Por eso el tope de usura de vivienda se registra a mano en la app y las reglas de mora de vivienda no se aplican. ' +
      'Esta guía solo explica el marco general: no hace ningún cálculo con las reglas de esa ley. Para tu caso, revisa el contrato y confirma con tu entidad.',
    sources: [{ label: 'Ley 546 de 1999 (normas en materia de vivienda y su financiación)' }],
    reviewedOn: '2026-10-15',
    reviewedHash: '485c1226',
  },
  'legal.ley1555': {
    text:
      'La Ley 1555 de 2012 trata del prepago de los créditos: abonar a la deuda por adelantado, total o parcialmente, sin penalidad, y escoger si el abono reduce el plazo (menos cuotas) o reduce el valor de la cuota. ' +
      'Esta guía toma como referencia un tope de 880 salarios mínimos mensuales, pero el alcance exacto de la ley para tu crédito (tipo de crédito, monto y fecha de desembolso) no está verificado, así que no se debe dar por cierto. ' +
      'Los créditos de vivienda tienen además sus propias reglas (Ley 546 de 1999). Revisa tu contrato y confirma con tu entidad antes de abonar.',
    sources: [{ label: 'Ley 1555 de 2012 (prepago de créditos sin penalidad)' }, { label: 'Ley 546 de 1999 (normas en materia de vivienda y su financiación)' }],
    reviewedOn: '2026-10-15',
    reviewedHash: '7622032e',
  },
  'restructure_whatif.sample': {
    text:
      'Reestructurar o refinanciar una deuda es acordar con la entidad nuevas condiciones: plazo, tasa o cuota. Lo que está vencido (capital, intereses, cargos, impuestos y mora) normalmente se suma al saldo, y la deuda nueva arranca con ese valor. ' +
      'Eso puede aliviar la cuota, pero los intereses se cobran sobre un saldo mayor y el costo total suele subir. Si la entidad perdona la mora, el saldo nuevo es menor. ' +
      'Lo que aplica en tu caso lo define el acuerdo con tu entidad; este cálculo es solo una simulación de la app.',
    sources: [{ label: 'Acuerdo de reestructuración con tu entidad financiera' }, { label: 'Método de cálculo de la app para saldos vencidos' }],
    reviewedOn: '2026-10-15',
    reviewedHash: '0a138083',
  },
  'prepayment.sample': {
    text:
      'Un abono extra es un pago adicional a la cuota que se aplica a la deuda por adelantado. Puedes usarlo para reducir el plazo (la cuota se mantiene y terminas antes) o para reducir la cuota (el plazo se mantiene y pagas menos cada mes). ' +
      'Reducir el plazo suele ahorrar más intereses; reducir la cuota alivia el flujo mensual. ' +
      'Antes de abonar, pide a tu entidad la confirmación por escrito de cómo aplicará el abono y si cobra alguna penalización.',
    sources: [{ label: 'Contrato de tu crédito y condiciones de prepago de tu entidad' }, { label: 'Método de cálculo de la app para abonos extra (aproximado)' }],
    reviewedOn: '2026-10-15',
    reviewedHash: 'a8bc8a6e',
  },
};

// The legal constants each topic depends on (spec: GMF, usura/IBC, Ley 1555, Ley 546, mora), then one sample key
// per topic so the owner reviews the wording of every topic (design owner Q2).
const LEGAL_KEYS = Object.freeze({
  usury_ibc: ['legal.usury_ibc', 'legal.ley546'],
  mora: ['legal.mora'],
  charges: ['legal.gmf'],
  prepayment: ['legal.ley1555'],
});

/** Throws the typed `unknown_topic` error, carrying the valid topics in `topics`. */
export function assertTopic(topic) {
  if (!EXPLAIN_TOPICS.includes(topic)) {
    const error = new ValidationError('unknown_topic', `unknown topic "${topic}"; valid topics: ${EXPLAIN_TOPICS.join(', ')}`);
    error.topics = EXPLAIN_TOPICS;
    throw error;
  }
}

/**
 * The copy keys a topic needs: its legal constants, then its sample key (always last).
 * @param {string} topic
 * @returns {string[]}
 */
export function topicCopyKeys(topic) {
  assertTopic(topic);
  return [...(LEGAL_KEYS[topic] || []), `${topic}.sample`];
}

const sourceLine = (source) => `${source && source.label ? source.label : ''}|${source && source.url ? source.url : ''}`;

/**
 * The fingerprint the review signs: the text and the sources.
 * @param {{ text: string, sources: { label: string, url?: string }[] }} entry
 * @returns {string}
 */
export function copyHash(entry) {
  const sources = Array.isArray(entry && entry.sources) ? entry.sources : [];
  return fnv1a(`${entry && entry.text}\n${sources.map(sourceLine).join('\n')}`);
}

function isReviewed(entry) {
  return (
    Boolean(entry) &&
    typeof entry.text === 'string' &&
    entry.text !== '' &&
    Array.isArray(entry.sources) &&
    entry.sources.length > 0 &&
    typeof entry.reviewedOn === 'string' &&
    entry.reviewedOn !== '' &&
    entry.reviewedHash === copyHash(entry)
  );
}

/**
 * Splits every needed key (and every key present in `copy`) into reviewed and unreviewed.
 * @param {object} [copy]
 * @returns {{ reviewed: string[], unreviewed: string[] }}
 */
export function copyStatus(copy = EXPLAIN_COPY) {
  const keys = [];
  const seen = new Set();
  const add = (key) => {
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  };
  EXPLAIN_TOPICS.forEach((topic) => topicCopyKeys(topic).forEach(add));
  Object.keys(copy).forEach(add);
  return {
    reviewed: keys.filter((key) => isReviewed(copy[key])),
    unreviewed: keys.filter((key) => !isReviewed(copy[key])),
  };
}

/**
 * The topics whose keys are all reviewed, in catalogue order.
 * @param {object} [copy]
 * @returns {string[]}
 */
export function releasedTopics(copy = EXPLAIN_COPY) {
  const reviewed = new Set(copyStatus(copy).reviewed);
  return EXPLAIN_TOPICS.filter((topic) => topicCopyKeys(topic).every((key) => reviewed.has(key)));
}
