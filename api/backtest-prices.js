const SYMBOL_MAP = {
  'XAU/USD': { yahoo: 'GC=F', pipSize: 0.1, decimals: 2 },
  'XAG/USD': { yahoo: 'SI=F', pipSize: 0.01, decimals: 3 },
  'EUR/USD': { yahoo: 'EURUSD=X', pipSize: 0.0001, decimals: 4 },
  'GBP/USD': { yahoo: 'GBPUSD=X', pipSize: 0.0001, decimals: 4 },
  'USD/JPY': { yahoo: 'USDJPY=X', pipSize: 0.01, decimals: 2 },
  'AUD/USD': { yahoo: 'AUDUSD=X', pipSize: 0.0001, decimals: 4 },
  'USD/CAD': { yahoo: 'USDCAD=X', pipSize: 0.0001, decimals: 4 },
  'USD/CHF': { yahoo: 'USDCHF=X', pipSize: 0.0001, decimals: 4 },
  'DXY':     { yahoo: 'DX-Y.NYB', pipSize: 0.01, decimals: 2 },
  'BTC/USD': { yahoo: 'BTC-USD', pipSize: 1, decimals: 0 },
  'US500':   { yahoo: '^GSPC', pipSize: 0.1, decimals: 1 }
};

function resolveSymbol(pair) {
  const clean = (pair || 'XAU/USD').trim().toUpperCase();
  if (SYMBOL_MAP[clean]) return SYMBOL_MAP[clean];
  const noSlash = clean.replace('/', '');
  const isJpy = noSlash.endsWith('JPY');
  const isFx = /^[A-Z]{6}$/.test(noSlash) && !noSlash.startsWith('BTC');
  return {
    yahoo: isFx ? `${noSlash}=X` : clean,
    pipSize: isJpy ? 0.01 : isFx ? 0.0001 : 0.1,
    decimals: isJpy ? 2 : isFx ? 4 : 2
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

  const pair = (req.query.pair || 'XAU/USD').toString().toUpperCase();
  const startYear = Math.max(2005, parseInt(req.query.startYear || '2015', 10));
  const endYear = Math.min(2030, parseInt(req.query.endYear || '2026', 10));

  const meta = resolveSymbol(pair);
  const p1 = Math.floor(Date.UTC(startYear - 1, 11, 20) / 1000);
  const p2 = Math.floor(Date.UTC(endYear + 1, 0, 10) / 1000);

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(meta.yahoo)}?period1=${p1}&period2=${p2}&interval=1d`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (!response.ok) throw new Error(`Yahoo Finance HTTP ${response.status}`);

    const json = await response.json();
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error(`Data historis untuk ${pair} (${meta.yahoo}) tidak ditemukan`);

    const timestamps = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};
    const candlesByDate = {};

    for (let i = 0; i < timestamps.length; i++) {
      const o = quote.open?.[i];
      const h = quote.high?.[i];
      const l = quote.low?.[i];
      const c = quote.close?.[i];
      if (o == null || c == null) continue;

      const iso = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
      candlesByDate[iso] = {
        date: iso,
        o: Number(o.toFixed(meta.decimals + 1)),
        h: Number((h ?? c).toFixed(meta.decimals + 1)),
        l: Number((l ?? c).toFixed(meta.decimals + 1)),
        c: Number(c.toFixed(meta.decimals + 1))
      };
    }

    return res.status(200).json({
      ok: true,
      pair,
      yahooSymbol: meta.yahoo,
      pipSize: meta.pipSize,
      decimals: meta.decimals,
      source: `Yahoo Finance Daily OHLC (${meta.yahoo})`,
      totalDays: Object.keys(candlesByDate).length,
      candlesByDate
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
