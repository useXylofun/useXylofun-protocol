const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });

export function fmtUsd(n) {
  if (!Number.isFinite(n)) return '—';
  return `$${compact.format(n)}`;
}
export function fmtPrice(p) {
  if (!Number.isFinite(p) || p <= 0) return '—';
  if (p >= 1000) return `$${p.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  const d = p >= 1 ? 2 : Math.min(12, 3 - Math.floor(Math.log10(p)));
  return `$${p.toFixed(d)}`;
}
export function fmtChange(c) {
  if (!Number.isFinite(c)) return '—';
  return `${c >= 0 ? '▲' : '▼'} ${Math.abs(c).toFixed(2)}%`;
}
