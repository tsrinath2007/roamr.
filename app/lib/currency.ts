/**
 * Display-only currency helpers.
 *
 * All real PayPal Sandbox amounts and balances stay in USD and are stored as
 * integer USD cents to prevent floating-point rounding bugs. INR output is an
 * approximate display conversion only.
 */

export const USD_TO_INR = 84; // Approximate fixed demo rate (1 USD ≈ ₹84)

export function usdToCents(usd?: number | null): number {
  const num = Number(usd || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100);
}

export function centsToUsd(cents?: number | null): number {
  const safe = Math.round(Number(cents || 0));
  if (!Number.isFinite(safe)) return 0;
  return safe / 100;
}

export function usdToInr(usd?: number | null): number {
  const safe = Number(usd || 0);
  if (!Number.isFinite(safe)) return 0;
  return Math.round(safe * USD_TO_INR);
}

export function inrToUsd(inr?: number | null): number {
  const safe = Number(inr || 0);
  if (!Number.isFinite(safe) || safe <= 0) return 0;
  return Number((safe / USD_TO_INR).toFixed(2));
}

export function inrToCents(inr?: number | null): number {
  const safe = Number(inr || 0);
  if (!Number.isFinite(safe) || safe <= 0) return 0;
  return Math.round((safe / USD_TO_INR) * 100);
}

export function centsToInrApprox(cents?: number | null): number {
  return Math.round(centsToUsd(cents) * USD_TO_INR);
}

export function formatUsdCents(cents?: number | null): string {
  const safe = Math.round(Number(cents || 0));
  const absUsd = (Math.abs(safe) / 100).toFixed(2);
  return safe < 0 ? `-$${absUsd}` : `$${absUsd}`;
}

export function formatInrApprox(cents?: number | null): string {
  const safe = Math.round(Number(cents || 0));
  const absInr = Math.abs(centsToInrApprox(safe)).toLocaleString('en-IN');
  return safe < 0 ? `-≈ ₹${absInr}` : `≈ ₹${absInr}`;
}

export function formatMoney(
  cents?: number | null,
  options: { showInr?: boolean } = {}
): string {
  const usdText = formatUsdCents(cents);
  if (!options.showInr) {
    return usdText;
  }
  return `${usdText} (${formatInrApprox(cents)})`;
}
