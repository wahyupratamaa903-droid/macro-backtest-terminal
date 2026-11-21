// Modul Khusus Klasifikasi Nama Berita, Konversi Jam WIB & Format Angka
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
  const t = `${titleRaw || ''} ${indicatorRaw || ''}`.toLowerCase().trim();

  // 1. Non-Farm Payrolls (NFP)
  if ((t.includes('non-farm') || t.includes('non farm') || t.includes('nonfarm')) &&
      (t.includes('payroll') || t.includes('employment change')) &&
      !t.includes('adp') && !t.includes('private')) {
    return 'NFP';
  }

  // 2. Suku Bunga The Fed (Fed Interest Rate Decision / Federal Funds Rate)
  if ((t.includes('interest rate') || t.includes('fed funds rate') || t.includes('federal funds rate') || t.includes('fomc rate') || t.includes('rate decision')) &&
      !t.includes('projection') && !t.includes('longer run') && !t.includes('mortgage') &&
      !t.includes('prime') && !t.includes('deposit') && !t.includes('30-year') && !t.includes('10-year')) {
    return 'BUNGA';
  }

  // 3. CPI / Inflation Rate (TradingView memakai nama "Inflation Rate MoM" & "Inflation Rate YoY")
  const isCpiFamily = /\bcpi\b/.test(t) || t.includes('consumer price index') || t.includes('inflation rate');
  if (isCpiFamily && !t.includes('core') && !t.includes('ex food') && !t.includes('nsa') && !t.includes('index s.a') && !t.includes('expectation')) {
    if (t.includes('y/y') || t.includes('yoy') || t.includes('year')) return 'CPI_YOY';
    if (t.includes('m/m') || t.includes('mom') || t.includes('month')) return 'CPI';
  }

  // 4. Unemployment Rate
  if (t.includes('unemployment rate') && !t.includes('claims')) {
    return 'UNRATE';
  }

  // 5. Retail Sales m/m
  if (t.includes('retail sales') && !t.includes('core') && !t.includes('ex ') && !t.includes('control') &&
      (t.includes('m/m') || t.includes('mom'))) {
    return 'RETAIL';
  }

  // 6. GDP q/q
  if ((t.includes('gdp') || t.includes('gross domestic product')) &&
      (t.includes('q/q') || t.includes('qoq') || t.includes('growth rate') || t.includes('annualized')) &&
      !t.includes('price index') && !t.includes('deflator')) {
    return 'GDP';
  }

  return 'OTHER';
}
