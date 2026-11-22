export const NAMA_BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

export function toWibParts(utcIso) {
  const d = new Date(utcIso);
  if (isNaN(d.getTime())) return null;
  const wib = new Date(d.getTime() + 7 * 3600 * 1000);
  const year = wib.getUTCFullYear();
  const monthIndex = wib.getUTCMonth() + 1;
  const day = wib.getUTCDate();
  const hh = String(wib.getUTCHours()).padStart(2, '0');
  const mm = String(wib.getUTCMinutes()).padStart(2, '0');
  const dateISO = `${year}-${String(monthIndex).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return {
    year,
    monthIndex,
    monthName: NAMA_BULAN[monthIndex - 1],
    day,
    timeWIB: `${hh}:${mm}`,
    dateISO
  };
}

export function formatCalValue(val, unit = '', scale = '', code = '') {
  if (val === null || val === undefined || val === '') return '-';
  const rawStr = String(val).trim();
  const u = (unit || '').trim();
  const sc = (scale || '').trim().toUpperCase();

  const numMatch = rawStr.match(/^([+-]?\d+(?:\.\d+)?)/);
  let num = numMatch ? parseFloat(numMatch[1]) : null;

  const isPct = u === '%' || rawStr.endsWith('%') || ['CPI', 'CPI_MOM', 'BUNGA', 'UNRATE', 'RETAIL', 'GDP'].includes(code);
  if (isPct && num !== null) {
    if (code === 'BUNGA') {
      let s = num.toFixed(2).replace(/0$/, '');
      if (s.endsWith('.')) s += '0';
      return `${s}%`;
    }
    if (Math.abs(num) < 0.05) num = 0;
    return `${num.toFixed(1)}%`;
  }

  if ((sc === 'K' || u.toUpperCase() === 'K' || rawStr.toUpperCase().endsWith('K') || code === 'NFP') && num !== null) {
    const kVal = Math.abs(num) >= 10000 ? Math.round(num / 1000) : Math.round(num);
    return `${kVal}K`;
  }

  if (sc === 'M' || u.toUpperCase() === 'M') {
    return num !== null ? `${num.toFixed(2).replace(/\.00$/, '')}M` : rawStr;
  }
  if (sc === 'B' || u.toUpperCase() === 'B') {
    return num !== null ? `${num.toFixed(2).replace(/\.00$/, '')}B` : rawStr;
  }

  return !u || rawStr.endsWith(u) ? rawStr : `${rawStr}${u}`;
}

export function classifyEventCode(titleRaw, indicatorRaw = '', periodRaw = '') {
  const title = (titleRaw || '').trim();
  const ind = (indicatorRaw || '').trim();
  const per = (periodRaw || '').trim();
  const t = `${title} ${ind} ${per}`.toLowerCase();

  // 1. NFP : Non-Farm Employment Change
  const isNfpName = (t.includes('non-farm') || t.includes('non farm') || t.includes('nonfarm')) &&
                    (t.includes('payroll') || t.includes('employment change'));
  const nfpExclude = ['adp', 'private', 'manufacturing', 'government', 'revision', 'preliminary'];
  if (isNfpName && !nfpExclude.some(ex => t.includes(ex))) {
    return { code: 'NFP', display: 'Non-Farm Employment Change' };
  }

  // 2. CPI : CPI y/y (Ketat hanya CPI YoY, bukan m/m dan bukan Core)
  const isCpiFamily = /\bcpi\b/.test(t) || t.includes('consumer price index') || t.includes('inflation rate');
  const isYoy = t.includes('y/y') || t.includes('yoy') || t.includes('(yoy)') || t.includes('year over year') || t.includes('annual');
  const isMom = t.includes('m/m') || t.includes('mom') || t.includes('(mom)') || t.includes('month over month');
  const cpiExclude = ['core', 'ex food', 'ex-food', 'nsa', 'non-seasonally', 'index s.a', 'expectation', 'median', 'trimmed', 'q/q', 'qoq', 'harmonised'];

  if (isCpiFamily && isYoy && !isMom && !cpiExclude.some(ex => t.includes(ex))) {
    return { code: 'CPI', display: 'CPI y/y' };
  }

  // Opsional CPI m/m (hanya jika diminta khusus)
  if (isCpiFamily && isMom && !isYoy && !cpiExclude.some(ex => t.includes(ex))) {
    return { code: 'CPI_MOM', display: 'CPI m/m' };
  }

  // 3. SUKU BUNGA : Fed Funds Rate
  const isRateName =
    t.includes('fed interest rate') ||
    t.includes('federal funds rate') ||
    t.includes('fed funds rate') ||
    t.includes('fomc interest rate') ||
    t.includes('fomc rate decision') ||
    ['interest rate decision', 'fed rate decision', 'interest rate'].includes(title.toLowerCase());
  const rateExclude = [
    'projection', 'longer run', '1st yr', '2nd yr', '3rd yr', 'current',
    'statement', 'minutes', 'speech', 'speaks', 'press conference',
    'mortgage', 'prime', 'deposit', 'bill', 'note', 'bond', 'effective', 'sofr', 'libor'
  ];
  if (isRateName && !rateExclude.some(ex => t.includes(ex))) {
    return { code: 'BUNGA', display: 'Fed Funds Rate' };
  }

  // Indikator sekunder (hanya muncul jika diminta khusus di dropdown)
  if (t.includes('unemployment rate') && !['claims', 'long term', 'u-6'].some(ex => t.includes(ex))) {
    return { code: 'UNRATE', display: 'Unemployment Rate' };
  }
  if (t.includes('retail sales') && isMom && !['core', 'ex ', 'control', 'y/y', 'yoy'].some(ex => t.includes(ex))) {
    return { code: 'RETAIL', display: 'Retail Sales m/m' };
  }
  if ((t.includes('gdp') || t.includes('gross domestic product')) &&
      (t.includes('q/q') || t.includes('qoq') || t.includes('growth rate')) &&
      !['price index', 'deflator', 'y/y', 'yoy'].some(ex => t.includes(ex))) {
    return { code: 'GDP', display: 'GDP q/q' };
  }

  return null;
}
