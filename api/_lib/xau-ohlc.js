const FOUR_HOURS_MS = 4 * 3600 * 1000;
const ONE_HOUR_MS = 3600 * 1000;

function formatWIB(ms) {
  const wib = new Date(ms + 7 * ONE_HOUR_MS);
  const y = wib.getUTCFullYear();
  const m = String(wib.getUTCMonth() + 1).padStart(2, '0');
  const d = String(wib.getUTCDate()).padStart(2, '0');
  const hh = String(wib.getUTCHours()).padStart(2, '0');
  const mm = String(wib.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm} WIB`;
}

function normalizeToWibH4(openTimeMs, open, high, low, close, feedName) {
  const wibMs = openTimeMs + 7 * ONE_HOUR_MS;
  const bucketWibStart = Math.floor(wibMs / FOUR_HOURS_MS) * FOUR_HOURS_MS;
  const bucketUtcStart = bucketWibStart - 7 * ONE_HOUR_MS;

  return {
    openTime: bucketUtcStart,
    closeTime: bucketUtcStart + FOUR_HOURS_MS,
    timeWibSec: Math.floor(bucketWibStart / 1000),
    openWIB: formatWIB(bucketUtcStart),
    closeWIB: formatWIB(bucketUtcStart + FOUR_HOURS_MS),
    open: Number(open.toFixed(2)),
    high: Number(high.toFixed(2)),
    low: Number(low.toFixed(2)),
    close: Number(close.toFixed(2)),
    timeframe: 'H4',
    feed: feedName
  };
}

// Sumber 1: Spot XAU/USD H4 Asli dari Dukascopy (Tersedia lengkap 2015 - 2026)
async function fetchDukascopyXauH4(startMs, endMs) {
  const rawBars = [];
  let cursor = endMs;
  let guard = 0;

  while (cursor > startMs && guard < 18) {
    guard += 1;
    const url = `https://freeserv.dukascopy.com/2.0/index.php?path=chart%2Fjson3&splits=true&stocks=true&time_direction=P&jsonp=_cb&last_update=${cursor}&offer_side=B&instrument=XAU%2FUSD&interval=4HOUR&limit=2000`;
    try {
      const resp = await fetch(url, {
        headers: {
          'Referer': 'https://freeserv.dukascopy.com/',
          'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36'
        },
        signal: AbortSignal.timeout(6500)
      });
      if (!resp.ok) break;
      const text = await resp.text();
      const match = text.match(/_cb\(([\s\S]*)\);?\s*$/);
      if (!match) break;
      const rows = JSON.parse(match[1]);
      if (!Array.isArray(rows) || rows.length === 0) break;

      let earliest = cursor;
      for (const r of rows) {
        const ts = Number(r[0]);
        if (ts < earliest) earliest = ts;
        if (ts < startMs || ts > endMs) continue;
        const o = Number(r[1]);
        const c = Number(r[2]);
        const l = Number(r[3]);
        const h = Number(r[4]);
        if ([o, h, l, c].some(v => Number.isNaN(v) || v <= 0)) continue;
        rawBars.push(
          normalizeToWibH4(
            ts,
            o,
            Math.max(o, c, l, h),
            Math.min(o, c, l, h),
            c,
            'Dukascopy XAU/USD H4'
          )
        );
      }

      if (earliest >= cursor) break;
      cursor = earliest - FOUR_HOURS_MS;
    } catch (_) {
      break;
    }
  }

  return rawBars;
}

// Sumber 2: Binance Vision Public CDN (Tidak diblokir IP Vercel, paralel cepat 2019 - 2026)
async function fetchBinanceVisionH4(startMs, endMs) {
  const effectiveStart = Math.max(startMs, Date.UTC(2019, 8, 1));
  if (effectiveStart >= endMs) return [];

  const stepMs = 1000 * FOUR_HOURS_MS;
  const chunks = [];
  for (let t = effectiveStart; t < endMs; t += stepMs) {
    chunks.push({ start: t, end: Math.min(endMs, t + stepMs - 1) });
  }

  const results = await Promise.allSettled(
    chunks.map(async ch => {
      const url = `https://data-api.binance.vision/api/v3/klines?symbol=PAXGUSDT&interval=4h&startTime=${ch.start}&endTime=${ch.end}&limit=1000`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(6500) });
      if (!resp.ok) return [];
      const rows = await resp.json();
      if (!Array.isArray(rows)) return [];
      return rows.map(r =>
        normalizeToWibH4(
          Number(r[0]),
          parseFloat(r[1]),
          parseFloat(r[2]),
          parseFloat(r[3]),
          parseFloat(r[4]),
          'Spot Gold H4'
        )
      );
    })
  );

  return results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);
}

// Sumber 3: Yahoo Finance 1H -> Agregasi H4 (Cadangan 730 hari terakhir)
async function fetchYahooIntradayH4(startMs, endMs) {
  const minYahoo1h = Date.now() - 720 * 24 * ONE_HOUR_MS;
  const effStart = Math.max(startMs, minYahoo1h);
  if (effStart >= endMs) return [];

  const period1 = Math.floor(effStart / 1000);
  const period2 = Math.floor(endMs / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/GC=F?period1=${period1}&period2=${period2}&interval=1h`;
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(6500)
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const result = data?.chart?.result?.[0];
    const timestamps = result?.timestamp || [];
    const quote = result?.indicators?.quote?.[0] || {};

    const buckets = new Map();
    for (let i = 0; i < timestamps.length; i++) {
      const o = quote.open?.[i];
      const h = quote.high?.[i];
      const l = quote.low?.[i];
      const c = quote.close?.[i];
      if (o == null || h == null || l == null || c == null) continue;
      const openTime = timestamps[i] * 1000;
      const bar = normalizeToWibH4(openTime, o, h, l, c, 'GC=F H4');
      if (!buckets.has(bar.openTime)) {
        buckets.set(bar.openTime, bar);
      } else {
        const existing = buckets.get(bar.openTime);
        if (bar.high > existing.high) existing.high = bar.high;
        if (bar.low < existing.low) existing.low = bar.low;
        existing.close = bar.close;
      }
    }
    return Array.from(buckets.values());
  } catch (_) {
    return [];
  }
}

export async function fetchXauCandles(startYear, endYear) {
  const startMs = Date.UTC(startYear, 0, 1, 0, 0, 0) - 7 * ONE_HOUR_MS;
  const endMs = Math.min(Date.now(), Date.UTC(endYear + 1, 0, 15, 23, 59, 59));

  // Tarik Dukascopy H4 (2015-2026) dan Binance Vision H4 (2019-2026) secara paralel
  const [dukaBars, binanceBars] = await Promise.all([
    fetchDukascopyXauH4(startMs, endMs),
    fetchBinanceVisionH4(startMs, endMs)
  ]);

  const mergedMap = new Map();
  // Masukkan Binance Vision terlebih dahulu, lalu timpa/lengkapi dengan Dukascopy XAU/USD H4
  for (const b of binanceBars) mergedMap.set(b.openTime, b);
  for (const d of dukaBars) mergedMap.set(d.openTime, d);

  if (mergedMap.size === 0) {
    const yahooBars = await fetchYahooIntradayH4(startMs, endMs);
    for (const y of yahooBars) mergedMap.set(y.openTime, y);
  }

  return Array.from(mergedMap.values()).sort((a, b) => a.openTime - b.openTime);
}
