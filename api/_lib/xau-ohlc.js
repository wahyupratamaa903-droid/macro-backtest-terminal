const FOUR_HOURS_MS = 4 * 3600 * 1000;

function formatWIB(ms) {
  const wib = new Date(ms + 7 * 3600 * 1000);
  const y = wib.getUTCFullYear();
  const m = String(wib.getUTCMonth() + 1).padStart(2, '0');
  const d = String(wib.getUTCDate()).padStart(2, '0');
  const hh = String(wib.getUTCHours()).padStart(2, '0');
  const mm = String(wib.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm} WIB`;
}

// Sumber utama H4: Binance PAXGUSDT (Spot Gold 1:1 dalam USD, tersedia native 4h)
async function fetchBinanceGoldH4(startMs, endMs) {
  const candles = [];
  let cursor = startMs;
  let guard = 0;

  while (cursor < endMs && guard < 25) {
    guard += 1;
    const url = `https://api.binance.com/api/v3/klines?symbol=PAXGUSDT&interval=4h&startTime=${cursor}&endTime=${endMs}&limit=1000`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!resp.ok) break;
    const rows = await resp.json();
    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const r of rows) {
      const openTime = Number(r[0]);
      const closeTime = openTime + FOUR_HOURS_MS;
      candles.push({
        openTime,
        closeTime,
        openWIB: formatWIB(openTime),
        closeWIB: formatWIB(closeTime),
        open: parseFloat(r[1]),
        high: parseFloat(r[2]),
        low: parseFloat(r[3]),
        close: parseFloat(r[4]),
        timeframe: 'H4',
        feed: 'PAXG/USD H4'
      });
    }

    const lastOpen = Number(rows[rows.length - 1][0]);
    if (lastOpen <= cursor) break;
    cursor = lastOpen + FOUR_HOURS_MS;
  }

  return candles;
}

// Sumber cadangan untuk tahun lama (< 2020): Yahoo Finance GC=F (Gold Futures)
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
    const closeTime = openTime + 24 * 3600 * 1000;
    candles.push({
      openTime,
      closeTime,
      openWIB: formatWIB(openTime),
      closeWIB: formatWIB(closeTime),
      open: Number(o.toFixed(2)),
      high: Number(h.toFixed(2)),
      low: Number(l.toFixed(2)),
      close: Number(c.toFixed(2)),
      timeframe: 'D1-Fallback',
      feed: 'GC=F Daily Fallback'
    });
  }
  return candles;
}

export async function fetchXauCandles(startYear, endYear) {
  const startMs = Date.UTC(startYear, 0, 1, 0, 0, 0) - 7 * 3600 * 1000;
  const endMs = Math.min(
    Date.now(),
    Date.UTC(endYear + 1, 0, 15, 23, 59, 59)
  );

  // Jika rentang mencakup 2020 ke atas, gunakan native H4 PAXG/USD
  let candles = [];
  if (endYear >= 2020) {
    const h4Start = Math.max(startMs, Date.UTC(2019, 8, 1));
    candles = await fetchBinanceGoldH4(h4Start, endMs);
  }

  // Untuk tahun sebelum 2020 (atau jika H4 kosong), gabungkan fallback historis
  if (startYear < 2020 || candles.length === 0) {
    const fallbackEnd = candles.length > 0 ? candles[0].openTime : endMs;
    const olderCandles = await fetchYahooGoldFallback(startMs, fallbackEnd);
    candles = [...olderCandles, ...candles];
  }

  candles.sort((a, b) => a.openTime - b.openTime);
  return candles;
}
