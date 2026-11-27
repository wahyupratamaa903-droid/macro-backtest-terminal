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

// Tarik satu blok Dukascopy XAU/USD 4HOUR: format array [timestamp, open, high, low, close]
async function fetchDukascopyChunk(chunkStartMs, chunkEndMs) {
  const url = `https://freeserv.dukascopy.com/2.0/index.php?path=chart%2Fjson3&splits=true&stocks=true&time_direction=P&jsonp=_cb&last_update=${chunkEndMs}&offer_side=B&instrument=XAU%2FUSD&interval=4HOUR&limit=2000`;
  try {
    const resp = await fetch(url, {
      headers: {
        'Referer': 'https://freeserv.dukascopy.com/',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36'
      },
      signal: AbortSignal.timeout(7000)
    });
    if (!resp.ok) return [];
    const text = await resp.text();
    const match = text.match(/_cb\(([\s\S]*)\);?\s*$/);
    if (!match) return [];
    const rows = JSON.parse(match[1]);
    if (!Array.isArray(rows) || rows.length === 0) return [];

    const bars = [];
    for (const r of rows) {
      const openTime = Number(r[0]);
      if (openTime < chunkStartMs || openTime > chunkEndMs) continue;

      const o = Number(r[1]);
      const h = Number(r[2]);
      const l = Number(r[3]);
      const c = Number(r[4]);
      if ([o, h, l, c].some(v => Number.isNaN(v) || v <= 0)) continue;

      // Abaikan bar kosong saat pasar Forex tutup (Sabtu)
      const utcDay = new Date(openTime).getUTCDay();
      if (utcDay === 6) continue;

      const high = Math.max(o, h, l, c);
      const low = Math.min(o, h, l, c);
      const closeTime = openTime + FOUR_HOURS_MS;

      bars.push({
        openTime,
        closeTime,
        timeWibSec: Math.floor((openTime + 7 * ONE_HOUR_MS) / 1000),
        openWIB: formatWIB(openTime),
        closeWIB: formatWIB(closeTime),
        open: Number(o.toFixed(2)),
        high: Number(high.toFixed(2)),
        low: Number(low.toFixed(2)),
        close: Number(c.toFixed(2)),
        timeframe: 'H4',
        feed: 'Dukascopy Spot XAU/USD H4'
      });
    }
    return bars;
  } catch (_) {
    return [];
  }
}

async function fetchDukascopyParallel(startMs, endMs) {
  const windowMs = 420 * 24 * ONE_HOUR_MS;
  const windows = [];
  for (let t = startMs; t < endMs; t += windowMs) {
    windows.push({
      start: t,
      end: Math.min(endMs, t + windowMs + FOUR_HOURS_MS)
    });
  }

  const results = await Promise.allSettled(
    windows.map(w => fetchDukascopyChunk(w.start, w.end))
  );

  const map = new Map();
  for (const res of results) {
    if (res.status !== 'fulfilled') continue;
    for (const bar of res.value) {
      map.set(bar.openTime, bar);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.openTime - b.openTime);
}

async function fetchBinanceVisionWeekdayFallback(startMs, endMs) {
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
      return rows
        .filter(r => {
          const d = new Date(Number(r[0])).getUTCDay();
          return d !== 6 && d !== 0;
        })
        .map(r => {
          const openTime = Number(r[0]);
          const closeTime = openTime + FOUR_HOURS_MS;
          return {
            openTime,
            closeTime,
            timeWibSec: Math.floor((openTime + 7 * ONE_HOUR_MS) / 1000),
            openWIB: formatWIB(openTime),
            closeWIB: formatWIB(closeTime),
            open: Number(parseFloat(r[1]).toFixed(2)),
            high: Number(parseFloat(r[2]).toFixed(2)),
            low: Number(parseFloat(r[3]).toFixed(2)),
            close: Number(parseFloat(r[4]).toFixed(2)),
            timeframe: 'H4',
            feed: 'Spot Gold H4 Backup'
          };
        });
    })
  );

  return results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .sort((a, b) => a.openTime - b.openTime);
}

export async function fetchXauCandles(startYear, endYear) {
  const startMs = Date.UTC(startYear, 0, 1, 0, 0, 0) - 15 * 24 * ONE_HOUR_MS;
  const endMs = Math.min(Date.now(), Date.UTC(endYear + 1, 0, 15, 23, 59, 59));

  const dukaBars = await fetchDukascopyParallel(startMs, endMs);
  if (dukaBars.length > 0) {
    return dukaBars;
  }

  return await fetchBinanceVisionWeekdayFallback(startMs, endMs);
}
