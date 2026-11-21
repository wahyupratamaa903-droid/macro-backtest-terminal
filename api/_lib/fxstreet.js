import { toWibParts, formatCalValue, classifyEventCode } from './classifier.js';

export async function fetchFxStreetYear(year) {
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

    const matched = classifyEventCode(r.name, '');
    if (!matched) continue;

    const unit = r.unit || '';
    const prevStr = formatCalValue(r.previous, unit, '');
    const fcstStr = r.consensus !== null && r.consensus !== undefined ? formatCalValue(r.consensus, unit, '') : null;
    const actStr = formatCalValue(r.actual, unit, '');

    normalized.push({
      id: `FXS_${r.id || `${matched.code}_${wib.dateISO}_${wib.timeWIB}`}`,
      dateISO: wib.dateISO,
      timeWIB: wib.timeWIB,
      year: wib.year,
      monthIndex: wib.monthIndex,
      monthName: wib.monthName,
      day: wib.day,
      currency: r.currencyCode || 'USD',
      importance: r.volatility === 'HIGH' ? 1 : 0,
      code: matched.code,
      event: matched.display,
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
