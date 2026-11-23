/** Rand amounts the way the site and invoices show them: R1,790 / R809.10. */
export function formatRand(cents: number): string {
  const negative = cents < 0;
  const [whole, fraction] = (Math.abs(cents) / 100).toFixed(2).split('.') as [string, string];
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}R${grouped}${fraction === '00' ? '' : `.${fraction}`}`;
}

/** Whole numbers with comma thousands: 1,000. */
export function formatNumber(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

