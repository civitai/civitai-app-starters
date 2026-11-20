/**
 * `13100` reads as `13.1k`, matching civitai.com's own `abbreviateNumber` so a
 * count on a card and the same count on the site never disagree.
 */
export function abbreviateCount(value: number, decimals = 1): string {
  if (!value) return '0';

  const suffixes = ['', 'k', 'm', 'b', 't'];
  let index = 0;
  let magnitude = Math.abs(value);
  while (magnitude >= 1000 && index < suffixes.length - 1) {
    magnitude /= 1000;
    index += 1;
  }

  const factor = 10 ** decimals;
  const rounded = Math.round(magnitude * factor) / factor;
  return `${value < 0 ? '-' : ''}${rounded}${suffixes[index]}`;
}
