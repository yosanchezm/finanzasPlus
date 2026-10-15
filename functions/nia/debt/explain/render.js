// Spanish rendering of the explain facts (design G1, G6). S0 renders only what needs no reviewed copy: the
// "under review" answer and the "does not apply" answer. The per-topic templates, the splitter and the footer
// arrive with S1 to S3. Pure and Node 16 safe.

export const TOPIC_LABELS = Object.freeze({
  rate_conventions: 'Tasas: E.A., N.A.M.V. y M.V.',
  usury_ibc: 'Usura e IBC',
  mora: 'Intereses de mora',
  payment_allocation: 'A dónde va mi pago',
  charges: 'Cargos, seguros y GMF',
  card_statement: 'Extracto y pago mínimo',
  card_interest_drop: 'Por qué bajan los intereses',
  restructure_whatif: 'Reestructurar una deuda',
  prepayment: 'Abonos extra y prepago',
});

export const UNDER_REVIEW_TEXT = 'Este tema está en revisión. Todavía no puedo explicarlo; lo haré cuando esté revisado.';

// Keyed by the kind of the debt the user asked about: a loan was asked a card-only topic, and the other way round.
const NOT_APPLICABLE_TEXT = {
  loan: 'Ese tema aplica solo a tarjetas de crédito, y esa deuda es un préstamo.',
  card: 'Ese tema aplica solo a préstamos, y esa deuda es una tarjeta de crédito.',
};

/**
 * @param {object} facts `explainFacts(...)`.
 * @returns {{ parts: string[], followUps: string[] }} `parts` are the messages (each at most 1,200 characters once S1 adds the splitter).
 *   A status with no template yet falls back to the "under review" text, which is always safe: it shows no figure.
 */
export function renderExplain(facts) {
  if (facts.status === 'not_applicable') return { parts: [NOT_APPLICABLE_TEXT[facts.debt && facts.debt.kind] || UNDER_REVIEW_TEXT], followUps: [] };
  return { parts: [UNDER_REVIEW_TEXT], followUps: [] };
}
