import { toWibParts, formatCalValue, classifyEventCode } from './classifier.js';

async function fetchTradingViewWindow(fromISO, toISO, targetYear) {
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

  if (!res.ok) return [];
  const json = await res.json();
  const rows = json?.result || [];
  const normalized = [];

  for (const r of rows) {
    const wib = toWibParts(r.date);
    if (!wib || wib.year !== targetYear) continue;

    const matched = classifyEventCode(r.title, r.indicator, r.period);
    if (!matched) continue;

    const prevStr = formatCalValue(r.previous, r.unit, r.scale, matched.code);
    const fcstStr = r.forecast !== null && r.forecast !== undefined ? formatCalValue(r.forecast, r.unit, r.scale, matched.code) : null;
    const actStr = formatCalValue(r.actual, r.unit, r.scale, matched.code);

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
      source: 'TradingView Economic Calendar'
    });
  }
  return normalized;
}

export async function fetchTradingViewYear(year) {
  const windows = [
    [`${year - 1}-12-31T00:00:00.000Z`, `${year}-03-01T00:00:00.000Z`],
    [`${year}-03-01T00:00:00.000Z`, `${year}-05-01T00:00:00.000Z`],
    [`${year}-05-01T00:00:00.000Z`, `${year}-07-01T00:00:00.000Z`],
    [`${year}-07-01T00:00:00.000Z`, `${year}-09-01T00:00:00.000Z`],
    [`${year}-09-01T00:00:00.000Z`, `${year}-11-01T00:00:00.000Z`],
    [`${year}-11-01T00:00:00.000Z`, `${year + 1}-01-02T00:00:00.000Z`]
  ];

  const settled = await Promise.allSettled(windows.map(([f, t]) => fetchTradingViewWindow(f, t, year)));
  return settled.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
}
