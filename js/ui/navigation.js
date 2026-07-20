// One-shot suppression of arrow-key navigation, used when focus jumps
// between a docked text line and the grid (the same keydown would otherwise
// be handled twice).

let suppressed = false;

export const suppressNextArrowKeyNavigation = () => {
  suppressed = true;
  setTimeout(() => {
    suppressed = false;
  }, 0);
};

export const consumeArrowSuppression = () => {
  const wasSuppressed = suppressed;
  suppressed = false;
  return wasSuppressed;
};
