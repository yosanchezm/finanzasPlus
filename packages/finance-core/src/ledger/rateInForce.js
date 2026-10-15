/**
 * The rate a debt has in force on the date of its projection. A loan's projection already applies its stored rate changes,
 * so its terms hold the answer. A card's projection keeps the original terms, but its revolving tranche carries the rate
 * after the active (non-voided, already effective) `rate_change` events the card projector replayed, so that is read
 * instead of folding the events again.
 * @param {object} projection `project(debt, events, asOf)`.
 * @returns {object} The rate in force.
 */
export function rateInForce(projection) {
  if (!projection.card) return projection.terms.rate;
  return projection.tranches.find((tranche) => tranche.type === 'revolving')?.rate ?? projection.terms.rate;
}
