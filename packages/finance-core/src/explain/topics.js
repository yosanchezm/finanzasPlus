// The closed catalogue of debt explanations (debt-explanations spec). A request for any other
// topic is rejected with the valid topics; nothing is rendered. Pure and Node 16 safe.

export const EXPLAIN_TOPICS = Object.freeze([
  'rate_conventions',
  'usury_ibc',
  'mora',
  'payment_allocation',
  'charges',
  'card_statement',
  'card_interest_drop',
  'restructure_whatif',
  'prepayment',
]);

/** Topics that only fit one kind of debt; the others fit both and work without a debt. */
export const TOPIC_KINDS = Object.freeze({
  card_statement: 'card',
  card_interest_drop: 'card',
  restructure_whatif: 'loan',
  prepayment: 'loan',
});
