const NAMA_BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

function toWibParts(utcIso) {
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

function formatCalValue(val, unit = '', scale = '') {
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

function classifyEventCode(titleRaw) {
  const t = (titleRaw || '').toLowerCase().trim();

  if ((t.includes('non-farm') || t.includes('non farm') || t.includes('nonfarm')) &&
      (t.includes('payroll') || t.includes('employment change')) &&
      !t.includes('adp') && !t.includes('private')) {
    return 'NFP';
  }

  if ((t.includes('fed interest rate') || t.includes('federal funds rate') || t.includes('fomc rate') || t === 'interest rate decision') &&
      !t.includes('projection') && !t.includes('longer run')) {
    return 'BUNGA';
  }

  if ((t === 'cpi' || t.startsWith('cpi ') || t.includes('consumer price index')) &&
      !t.includes('core') && !t.includes('ex food') && !t.includes('nsa') && !t.includes('index s.a')) {
    if (t.includes('y/y') || t.includes('yoy') || t.includes('year')) return 'CPI_YOY';
    if (t.includes('m/m') || t.includes('mom') || t.includes('month')) return 'CPI';
  }

  if (t.includes('unemployment rate') && !t.includes('claims')) {
    return 'UNRATE';
  }

  if (t.includes('retail sales') && !t.includes('core') && !t.includes('ex ') && !t.includes('control') &&
      (t.includes('m/m') || t.includes('mom'))) {
    return 'RETAIL';
  }

  if ((t.includes('gdp') || t.includes('gross domestic product')) &&
      (t.includes('q/q') || t.includes('qoq') || t.includes('annualized')) &&
      !t.includes('price index') && !t.includes('deflator')) {
    return 'GDP';
  }

  return 'OTHER';
}

// Sumber 1: TradingView Economic Calendar API (Data Asli + Actual, Forecast, Previous)
async function fetchTradingViewYear(year) {
  const fromISO = `${year - 1}-12-31T00:00:00.000Z`;
  const toISO = `${year + 1}-01-02T23:59:59.000Z`;
  const url = `https://economic-calendar.tradingview.com/events?from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}&countries=US`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Origin': 'https://www.tradingview.com',
      'Referer': 'https://www.tradingview.com/'
    },
    signal: AbortSignal.timeout(7000)
  });

  if (!res.ok) throw new Error(`TradingView Calendar HTTP ${res.status}`);
  const json = await res.json();
  const rows = json?.result || [];
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`TradingView mengembalikan 0 data untuk tahun ${year}`);
  }

  const normalized = [];
  for (const r of rows) {
    const wib = toWibParts(r.date);
    if (!wib || wib.year !== year) continue;

    const title = (r.title || r.indicator || '').trim();
    const code = classifyEventCode(title);
    const prevStr = formatCalValue(r.previous, r.unit, r.scale);
    const fcstStr = r.forecast !== null && r.forecast !== undefined ? formatCalValue(r.forecast, r.unit, r.scale) : null;
    const actStr = formatCalValue(r.actual, r.unit, r.scale);

    normalized.push({
      id: `TV_${r.id || `${code}_${wib.dateISO}_${wib.timeWIB}`}`,
      dateISO: wib.dateISO,
      timeWIB: wib.timeWIB,
      year: wib.year,
      monthIndex: wib.monthIndex,
      monthName: wib.monthName,
      day: wib.day,
      currency: r.currency || 'USD',
      importance: r.importance ?? 0,
      code,
      event: title,
      previous: prevStr,
      previousNum: r.previous != null ? Number(r.previous) : null,
      forecast: fcstStr,
      forecastNum: r.forecast != null ? Number(r.forecast) : null,
      actual: actStr,
      actualNum: r.actual != null ? Number(r.actual) : null,
      unit: r.unit || '',
      source: r.source ? `TradingView (${r.source})` : 'TradingView Economic Calendar'
    });
  }
  return normalized;
}

// Sumber 2 (Cadangan Murni): FXStreet Economic Calendar API
async function fetchFxStreetYear(year) {
  const fromISO = `${year - 1}-12-31T00:00:00Z`;
  const toISO = `${year + 1}-01-02T23:59:59Z`;
  const url = `https://calendar-api.fxstreet.com/en/api/v1/eventDates/${encodeURIComponent(fromISO)}/${encodeURIComponent(toISO)}?&volatilities=HIGH&volatilities=MEDIUM&countries=US`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Origin': 'https://www.fxstreet.com',
      'Referer': 'https://www.fxstreet.com/'
    },
    signal: AbortSignal.timeout(7000)
  });

  if (!res.ok) throw new Error(`FXStreet Calendar HTTP ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`FXStreet mengembalikan 0 data untuk tahun ${year}`);
  }

  const normalized = [];
  for (const r of rows) {
    const wib = toWibParts(r.dateUtc);
    if (!wib || wib.year !== year) continue;

    const title = (r.name || '').trim();
    const code = classifyEventCode(title);
    const unit = r.unit || '';
    const prevStr = formatCalValue(r.previous, unit, '');
    const fcstStr = r.consensus !== null && r.consensus !== undefined ? formatCalValue(r.consensus, unit, '') : null;
    const actStr = formatCalValue(r.actual, unit, '');

    normalized.push({
      id: `FXS_${r.id || `${code}_${wib.dateISO}_${wib.timeWIB}`}`,
      dateISO: wib.dateISO,
      timeWIB: wib.timeWIB,
      year: wib.year,
      monthIndex: wib.monthIndex,
      monthName: wib.monthName,
      day: wib.day,
      currency: r.currencyCode || 'USD',
      importance: r.volatility === 'HIGH' ? 1 : 0,
      code,
      event: title,
      previous: prevStr,
      previousNum: r.previous != null ? Number(r.previous) : null,
      forecast: fcstStr,
      forecastNum: r.consensus != null ? Number(r.consensus) : null,
      actual: actStr,
      actualNum: r.actual != null ? Number(r.actual) : null,
      unit,
      source: 'FXStreet Institutional Calendar'
    });
  }
  return normalized;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');

  const startYear = Math.max(2008, parseInt(req.query.startYear || '2015', 10));
  const endYear = Math.min(2030, parseInt(req.query.endYear || '2020', 10));
  const indicator = (req.query.indicator || 'ALL').toString().toUpperCase();

  try {
    const years = [];
    for (let y = startYear; y <= endYear; y++) years.push(y);

    let usedSource = 'TradingView Economic Calendar API (Live & Historical Feed)';
    let rawEvents = [];

    try {
      const perYear = await Promise.all(years.map(y => fetchTradingViewYear(y)));
      rawEvents = perYear.flat();
    } catch (tvErr) {
      usedSource = 'FXStreet Economic Calendar API';
      const perYear = await Promise.all(years.map(y => fetchFxStreetYear(y)));
      rawEvents = perYear.flat();
    }

    const coreSet = new Set(['NFP', 'CPI', 'BUNGA']);
    let filtered = rawEvents.filter(ev => {
      if (indicator === 'ALL_HIGH') return ev.importance >= 1;
      if (indicator === 'ALL') return coreSet.has(ev.code);
      return ev.code === indicator;
    });

    const seen = new Set();
    filtered = filtered.filter(ev => {
      const key = `${ev.dateISO}_${ev.code}_${ev.event}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    filtered.sort((a, b) => `${a.dateISO} ${a.timeWIB}`.localeCompare(`${b.dateISO} ${b.timeWIB}`));

    return res.status(200).json({
      ok: true,
      source: usedSource,
      timezone: 'Asia/Jakarta (WIB / UTC+7)',
      startYear,
      endYear,
      indicator,
      count: filtered.length,
      events: filtered
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
