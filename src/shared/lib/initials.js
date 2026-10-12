/** Two-letter initials: first letters of the first two words, or the first two characters of a single word. */
export const getInitials = (name = '') => {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const letters = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2);
  return letters.toUpperCase();
};
