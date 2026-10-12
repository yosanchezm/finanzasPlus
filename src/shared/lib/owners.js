/** UI owner key ('you' | 'partner' | 'shared') of a stored ownerScope, relative to the signed-in member. */
export const relativeOwner = (ownerScope, currentOwnerScope) => {
  if (ownerScope === 'shared') return 'shared';
  return ownerScope === currentOwnerScope ? 'you' : 'partner';
};

const LABELS = { you: 'Tú', partner: 'Pareja', shared: 'Compartido' };

export const ownerLabel = (ownerScope, currentOwnerScope) => LABELS[relativeOwner(ownerScope, currentOwnerScope)];
