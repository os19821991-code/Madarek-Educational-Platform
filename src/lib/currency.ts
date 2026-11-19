export const CURRENCY_SYMBOL = 'د.ع';
export const CURRENCY_FULL_NAME = 'دينار عراقي';

export function formatIQD(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.round(amount) : 0;
  return `${safe.toLocaleString('en-US')} ${CURRENCY_SYMBOL}`;
}

export function formatIQDNumber(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.round(amount) : 0;
  return safe.toLocaleString('en-US');
}
