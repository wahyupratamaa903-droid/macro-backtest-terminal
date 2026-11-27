const FOUR_HOURS_MS = 4 * 3600 * 1000;
const ONE_HOUR_MS = 3600 * 1000;

function formatWIB(ms) {
  const wib = new Date(ms + 7 * 3600 * 1000);
  const y = wib.getUTCFullYear();
  const m = String(wib.getUTCMonth() + 1).padStart(2, '0');
  const d = String(wib.getUTCDate()).padStart(2, '0');
  const hh = String(wib.getUTCHours()).padStart(2, '0');
  const mm = String(wib.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm} WIB`;
}

// Tarik 1h lalu agregasi ke H4 mengikuti pergantian sesi broker NY Close (00:00, 04:00, 08:00, 12:00, 16:00, 20:00 WIB)
async function fetchBrokerAlignedGoldH4(startMs, endMs) {
  const hourly = [];
  let cursor = startMs;
  let guard = 0;

  while (cursor < endMs && guard < 65) {
    guard += 1;
    const url = `https://api.binance.com/api/v3/klines?symbol=PAXGUSDT&interval=1h&startTime=${cursor}&endTime=${endMs}&limit=1000`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!resp.ok) break;
    const rows = await resp.json();
    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const r of rows) {
      hourly.push({
        openTime: Number(r[0]),
        open: parseFloat(r[1]),
        high: parseFloat(r[2]),
        low: parseFloat(r[3]),
        close: parseFloat(r[4])
      });
    }

    const lastOpen = Number(rows[rows.length - 1][0]);
    if (lastOpen <= cursor) break;
    cursor = lastOpen + ONE_HOUR_MS;
  }

  if (hourly.length === 0) return [];

  // Kelompokkan setiap 4 jam berdasarkan jam WIB (00, 04, 08, 12, 16, 20 WIB)
  const buckets = new Map();
  for (const h of hourly) {
    const wibMs = h.openTime + 7 * ONE_HOUR_MS;
    const bucketWibStart = Math.floor(wibMs / FOUR_HOURS_MS) * FOUR_HOURS_MS;
    const bucketUtcStart = bucketWibStart - 7 * ONE_HOUR_MS;

    if (!buckets.has(bucketUtcStart)) {
      buckets.set(bucketUtcStart, {
        openTime: bucketUtcStart,
        closeTime: bucketUtcStart + FOUR_HOURS_MS,
        timeWibSec: Math.floor(bucketWibStart / 1000),
        openWIB: formatWIB(bucketUtcStart),
        closeWIB: formatWIB(bucketUtcStart + FOUR_HOURS_MS),
        open: h.open,
        high: h.high,
        low: h.low,
        close: h.close,
        timeframe: 'H4',
        isNativeH4: true
      });
    } else {
      const b = buckets.get(bucketUtcStart);
      if (h.high > b.high) b.high = h.high;
      if (h.low < b.low) b.low = h.low;
      b.close = h.close;
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.openTime - b.openTime);
}

// Fallback historis 2015 - Agu 2019 (Yahoo GC=F Daily)
async function fetchYahooGoldFallback(startMs, endMs) {
  const period1 = Math.floor(startMs / 1000);
  const period2 = Math.floor(endMs / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/GC=F?period1=${period1}&period2=${period2}&interval=1d`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(7000)
  });
  if (!resp.ok) return [];
  const data = await resp.json();
  const result = data?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const candles = [];

  for (let i = 0; i < timestamps.length; i++) {
    const o = quote.open?.[i];
    const h = quote.high?.[i];
    const l = quote.low?.[i];
    const c = quote.close?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    const openTime = timestamps[i] * 1000;
    const closeTime = openTime + 24 * ONE_HOUR_MS;
    candles.push({
      openTime,
      closeTime,
      timeWibSec: Math.floor((openTime + 7 * ONE_HOUR_MS) / 1000),
      openWIB: formatWIB(openTime),
      closeWIB: formatWIB(closeTime),
      open: Number(o.toFixed(2)),
      high: Number(h.toFixed(2)),
      low: Number(l.toFixed(2)),
      close: Number(c.toFixed(2)),
      timeframe: 'D1-Fallback',
      isNativeH4: false
    });
  }
  return candles;
}

export async function fetchXauCandles(startYear, endYear) {
  const startMs = Date.UTC(startYear, 0, 1, 0, 0, 0) - 7 * ONE_HOUR_MS;
  const endMs = Math.min(Date.now(), Date.UTC(endYear + 1, 0, 15, 23, 59, 59));

  let candles = [];
  if (endYear >= 2020) {
    const h4Start = Math.max(startMs, Date.UTC(2019, 8, 1));
    candles = await fetchBrokerAlignedGoldH4(h4Start, endMs);
  }

  if (startYear < 2020 || candles.length === 0) {
    const fallbackEnd = candles.length > 0 ? candles[0].openTime : endMs;
    const olderCandles = await fetchYahooGoldFallback(startMs, fallbackEnd);
    candles = [...olderCandles, ...candles];
  }

  candles.sort((a, b) => a.openTime - b.openTime);
  return candles;
}
