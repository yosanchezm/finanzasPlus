// Debt selector (NDA-3): finds the debt a message talks about, ignoring case and
// accents. Pure and Node 16 safe.

export const MAX_CANDIDATES = 6;

/** NFD, no combining marks, lowercase, single spaces. */
export function fold(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Words people use for each kind of debt (already folded).
const KIND_SYNONYMS = {
  consumer: ['consumo', 'libre inversion', 'personal'],
  vehicle: ['vehiculo', 'carro', 'auto', 'moto', 'coche'],
  mortgage: ['hipoteca', 'hipotecario', 'vivienda', 'casa', 'apartamento'],
  libranza: ['libranza', 'nomina'],
  leasing: ['leasing'],
  family: ['familiar', 'familia'],
  informal: ['informal', 'amigo'],
  card: ['tarjeta', 'tc', 'visa', 'mastercard'],
};

const MIN_PARTIAL_LENGTH = 3;

const overlaps = (field, ref) => field.length >= MIN_PARTIAL_LENGTH && (field.includes(ref) || ref.includes(field));

const hasWord = (ref, word) => ` ${ref} `.includes(` ${word} `);

const TIERS = [
  (debt, ref) => fold(debt.name) === ref,
  (debt, ref) => overlaps(fold(debt.name), ref) || overlaps(fold(debt.lender), ref),
  (debt, ref) => (KIND_SYNONYMS[debt.kind] || []).some((word) => hasWord(ref, word)),
];

const pick = (list) => (list.length === 1 ? { match: list[0] } : { candidates: list.slice(0, MAX_CANDIDATES) });

/**
 * @param {object[]} debts `debts` rows.
 * @param {string} reference What the user called the debt ("vehiculo", "el banco").
 * @returns {{ match: object } | { candidates: object[] } | { none: true }}
 *   Priority: exact name, then name or lender containing the words, then kind synonyms.
 *   With no match and exactly one active debt, that debt is the answer.
 */
export function findDebt(debts, reference) {
  const active = debts.filter((debt) => debt.status === 'active');
  const ref = fold(reference);
  if (ref !== '') {
    for (const tier of TIERS) {
      const found = active.filter((debt) => tier(debt, ref));
      if (found.length > 0) return pick(found);
    }
  }
  return active.length === 1 ? { match: active[0] } : { none: true };
}
