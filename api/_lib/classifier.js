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

export function formatCalValue(val, unit = '', scale = '') {
  if (val === null || val === undefined || val === '') return '-';
  if (typeof val === 'string') return val;
  const num = Number(val);
  if (isNaN(num)) return String(val);

  const u = (unit || '').trim();
  const sc = (scale || '').trim().toUpperCase();

  if (u === '%') {
    const s = num.toFixed(2).replace(/\.00$/, '.0').replace(/(\.\d)0$/, '$1');
    return `${s}%`;
  }
  if (sc === 'K' || u.toUpperCase() === 'K') {
    const kVal = Math.abs(num) >= 10000 ? Math.round(num / 1000) : Math.round(num);
    return `${kVal}K`;
  }
  if (sc === 'M' || u.toUpperCase() === 'M') {
    return `${num.toFixed(2).replace(/\.00$/, '')}M`;
  }
  if (sc === 'B' || u.toUpperCase() === 'B') {
    return `${num.toFixed(2).replace(/\.00$/, '')}B`;
  }
  return `${num}${u}`;
}

export function classifyEventCode(titleRaw, indicatorRaw = '') {
  const title = (titleRaw || '').trim();
  const ind = (indicatorRaw || '').trim();
  const t = `${title} ${ind}`.toLowerCase();

  // 1. NFP : Non-Farm Employment Change
  const isNfpName = (t.includes('non-farm') || t.includes('non farm') || t.includes('nonfarm')) &&
                    (t.includes('payroll') || t.includes('employment change'));
  const nfpExclude = ['adp', 'private', 'manufacturing', 'government', 'revision', 'preliminary'];
  if (isNfpName && !nfpExclude.some(ex => t.includes(ex))) {
    return { code: 'NFP', display: 'Non-Farm Employment Change' };
  }

  // 2. CPI : CPI y/y (Ketat hanya CPI YoY, bukan m/m dan bukan Core)
  const isCpiFamily = /\bcpi\b/.test(t) || t.includes('consumer price index') || t.includes('inflation rate');
  const isYoy = t.includes('y/y') || t.includes('yoy') || t.includes('(yoy)') || t.includes('year over year');
  const cpiExclude = ['core', 'ex food', 'ex-food', 'nsa', 'non-seasonally', 'index s.a', 'expectation', 'median', 'trimmed', 'm/m', 'mom', 'q/q', 'qoq'];
  if (isCpiFamily && isYoy && !cpiExclude.some(ex => t.includes(ex))) {
    return { code: 'CPI', display: 'CPI y/y' };
  }

  // Opsional CPI m/m (hanya jika diminta khusus)
  const isMom = t.includes('m/m') || t.includes('mom') || t.includes('(mom)');
  if (isCpiFamily && isMom && !['core', 'ex food', 'ex-food', 'nsa', 'expectation', 'y/y', 'yoy'].some(ex => t.includes(ex))) {
    return { code: 'CPI_MOM', display: 'CPI m/m' };
  }

  // 3. SUKU BUNGA : Fed Funds Rate
  const isRateName =
    t.includes('fed interest rate decision') ||
    t.includes('federal funds rate') ||
    t.includes('fed funds rate') ||
    t.includes('fomc interest rate decision') ||
    title.toLowerCase() === 'interest rate decision' ||
    (ind.toLowerCase() === 'interest rate' && title.toLowerCase().includes('decision'));
  const rateExclude = ['projection', 'longer run', '1st yr', '2nd yr', '3rd yr', 'current', 'statement', 'minutes', 'speech', 'speaks', 'mortgage', 'prime', 'deposit', 'bill', 'note', 'bond', 'effective', 'sofr'];
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
