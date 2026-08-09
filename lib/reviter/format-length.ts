/**
 * Architectural feet-and-inches formatting for decimal model feet.
 *
 * Revit users read elevations and cuts as 12′-3 1/16″, not 12.26′. Fractions
 * are rounded to the requested denominator and GCD-reduced the way dimension
 * text is lettered on a drawing; whole-foot values keep the explicit 0″
 * (4′-0″), which is the drafting convention.
 */

function greatestCommonDivisor(a: number, b: number): number {
  let x = a; let y = b;
  while (y) { [x, y] = [y, x % y]; }
  return x;
}

export function formatFeetInches(feet: number, denominator: 2 | 4 | 8 | 16 = 16): string {
  if (!Number.isFinite(feet)) return "—";
  const sign = feet < 0 ? "-" : "";
  const units = Math.round(Math.abs(feet) * 12 * denominator);
  const wholeInches = Math.floor(units / denominator);
  const wholeFeet = Math.floor(wholeInches / 12);
  const inches = wholeInches - wholeFeet * 12;
  let numerator = units - wholeInches * denominator;
  let reducedDenominator: number = denominator;
  if (numerator) {
    const divisor = greatestCommonDivisor(numerator, reducedDenominator);
    numerator /= divisor;
    reducedDenominator /= divisor;
  }
  const fraction = numerator ? ` ${numerator}/${reducedDenominator}` : "";
  return `${sign}${wholeFeet}′-${inches}${fraction}″`;
}
