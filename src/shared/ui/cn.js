/** Joins truthy class names. */
export const cn = (...classes) => classes.filter(Boolean).join(' ');

/** Focus ring for controls on light surfaces. */
export const focusRing = 'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/** Focus ring for controls on the dark sidebar. */
export const focusRingDark = 'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-mint';
