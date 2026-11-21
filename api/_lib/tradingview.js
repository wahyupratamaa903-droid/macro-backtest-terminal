import { toWibParts, formatCalValue, classifyEventCode } from './classifier.js';

export async function fetchTradingViewYear(year) {
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

    const matched = classifyEventCode(r.title, r.indicator);
    if (!matched) continue;

    const prevStr = formatCalValue(r.previous, r.unit, r.scale);
    const fcstStr = r.forecast !== null && r.forecast !== undefined ? formatCalValue(r.forecast, r.unit, r.scale) : null;
    const actStr = formatCalValue(r.actual, r.unit, r.scale);

    normalized.push({
      id: `TV_${r.id || `${matched.code}_${wib.dateISO}_${wib.timeWIB}`}`,
      dateISO: wib.dateISO,
      timeWIB: wib.timeWIB,
      year: wib.year,
      monthIndex: wib.monthIndex,
      monthName: wib.monthName,
      day: wib.day,
      currency: r.currency || 'USD',
      importance: r.importance ?? 0,
      code: matched.code,
      event: matched.display,
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
