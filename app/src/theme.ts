/** Shared dark palette, matching the web dashboard. */
export const theme = {
  bg: '#0b0e14',
  panel: '#141925',
  panel2: '#1b2233',
  text: '#e6e9ef',
  muted: '#8b93a7',
  green: '#2ecc71',
  red: '#ff5c5c',
  accent: '#5b8cff',
  border: '#232b3d',
  yellow: '#f1c40f',
};

export const fmtMoney = (n: number | null | undefined): string =>
  n == null || Number.isNaN(n)
    ? '—'
    : '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const pnlColor = (n: number): string => (n > 0 ? theme.green : n < 0 ? theme.red : theme.muted);
