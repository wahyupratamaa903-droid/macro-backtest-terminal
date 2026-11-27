import { fetchFxStreetYear } from './_lib/fxstreet.js';
import { fetchTradingViewYear } from './_lib/tradingview.js';
import { applyMonthlyStrategyRules } from './_lib/strategy-engine.js';
import { fetchXauCandles } from './_lib/xau-ohlc.js';

function parseEventUtcMs(ev) {
  // Tanggal ISO (YYYY-MM-DD) + JAM_WIB (HH:mm) -> konversi ke UTC ms
  const datePart = ev.dateISO || `${ev.year}-${String(ev.monthIndex).padStart(2, '0')}-${String(ev.day).padStart(2, '0')}`;
  const timePart = (ev.timeWIB || '19:30').slice(0, 5);
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  if (!y || !m || !d) return null;
  return Date.UTC(y, m - 1, d, (hh || 0) - 7, mm || 0, 0);
}

function simulatePullbackTrade(event, candles, { tpPips, slPips, pipSize }) {
  const newsUtcMs = parseEventUtcMs(event);
  if (!newsUtcMs || candles.length === 0) {
    return {
      ...event,
      tradeStatus: 'NO_PRICE_DATA',
      pullbackCloseWIB: '-',
      entryPrice: null,
      tpPrice: null,
      slPrice: null,
      exitWIB: '-',
      outcome: 'NO_DATA',
      pipsResult: 0
    };
  }

  // Cari candle yang berjalan saat news rilis, lalu cari candle H4 berikutnya yang TUTUP berlawanan arah (pullback)
  let startIdx = candles.findIndex(c => c.closeTime > newsUtcMs);
  if (startIdx === -1) {
    return {
      ...event,
      tradeStatus: 'NO_FUTURE_CANDLE',
      pullbackCloseWIB: '-',
      entryPrice: null,
      tpPrice: null,
      slPrice: null,
      exitWIB: '-',
      outcome: 'NO_DATA',
      pipsResult: 0
    };
  }

  // Mulai pengecekan pullback setelah candle rilis berita menutup (maksimal tunggu 18 candle H4 / ~3 hari)
  let entryCandleIdx = -1;
  const searchLimit = Math.min(candles.length, startIdx + 18);

  for (let i = startIdx + 1; i < searchLimit; i++) {
    const c = candles[i];
    const isRed = c.close < c.open;   // Candle pelemahan (merah)
    const isGreen = c.close > c.open; // Candle penguatan (hijau)

    if (event.effectiveBias === 'BUY' && isRed) {
      entryCandleIdx = i;
      break;
    }
    if (event.effectiveBias === 'SELL' && isGreen) {
      entryCandleIdx = i;
      break;
    }
  }

  if (entryCandleIdx === -1) {
    return {
      ...event,
      tradeStatus: 'NO_PULLBACK_CLOSE',
      pullbackCloseWIB: '-',
      entryPrice: null,
      tpPrice: null,
      slPrice: null,
      exitWIB: '-',
      outcome: 'SKIPPED',
      pipsResult: 0
    };
  }

  const entryCandle = candles[entryCandleIdx];
  const entryPrice = Number(entryCandle.close.toFixed(2));
  const tpDistance = tpPips * pipSize;
  const slDistance = slPips * pipSize;

  const tpPrice = event.effectiveBias === 'BUY'
    ? Number((entryPrice + tpDistance).toFixed(2))
    : Number((entryPrice - tpDistance).toFixed(2));

  const slPrice = event.effectiveBias === 'BUY'
    ? Number((entryPrice - slDistance).toFixed(2))
    : Number((entryPrice + slDistance).toFixed(2));

  // Simulasikan pergerakan harga setelah candle pullback H4 ditutup
  let outcome = 'OPEN';
  let pipsResult = 0;
  let exitWIB = 'Masih Berjalan';

  for (let j = entryCandleIdx + 1; j < candles.length; j++) {
    const bar = candles[j];
    if (event.effectiveBias === 'BUY') {
      const hitSL = bar.low <= slPrice;
      const hitTP = bar.high >= tpPrice;
      if (hitSL && hitTP) {
        outcome = 'LOSS';
        pipsResult = -slPips;
        exitWIB = bar.closeWIB;
        break;
      }
      if (hitSL) {
        outcome = 'LOSS';
        pipsResult = -slPips;
        exitWIB = bar.closeWIB;
        break;
      }
      if (hitTP) {
        outcome = 'WIN';
        pipsResult = tpPips;
        exitWIB = bar.closeWIB;
        break;
      }
    } else {
      const hitSL = bar.high >= slPrice;
      const hitTP = bar.low <= tpPrice;
      if (hitSL && hitTP) {
        outcome = 'LOSS';
        pipsResult = -slPips;
        exitWIB = bar.closeWIB;
        break;
      }
      if (hitSL) {
        outcome = 'LOSS';
        pipsResult = -slPips;
        exitWIB = bar.closeWIB;
        break;
      }
      if (hitTP) {
        outcome = 'WIN';
        pipsResult = tpPips;
        exitWIB = bar.closeWIB;
        break;
      }
    }
  }

  return {
    ...event,
    tradeStatus: 'EXECUTED',
    candleTF: entryCandle.timeframe,
    pullbackCloseWIB: entryCandle.closeWIB,
    entryPrice,
    tpPrice,
    slPrice,
    exitWIB,
    outcome,
    pipsResult
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');

  const startYear = Math.max(2015, parseInt(req.query.startYear || '2021', 10));
  const endYear = Math.min(2026, parseInt(req.query.endYear || '2026', 10));
  const indicatorFilter = (req.query.indicator || 'ALL').toString().toUpperCase();
  const tpPips = Math.max(50, parseInt(req.query.tpPips || '400', 10));
  const slPips = Math.max(25, parseInt(req.query.slPips || '200', 10));
  const initialPrevTrend = (req.query.initialTrend || 'BUY').toString().toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
  const pipSize = 0.1; // XAUUSD: 1 pip = $0.10 (400 pips = $40.00, 200 pips = $20.00)

  try {
    const years = [];
    // Tarik 1 tahun sebelumnya jika memungkinkan agar bulan Januari punya referensi tren bulan Desember lalu
    const fetchStart = Math.max(2015, startYear - 1);
    for (let y = fetchStart; y <= endYear; y++) years.push(y);

    const [fxsSettled, tvSettled, candles] = await Promise.all([
      Promise.allSettled(years.map(y => fetchFxStreetYear(y))),
      Promise.allSettled(years.map(y => fetchTradingViewYear(y))),
      fetchXauCandles(startYear, endYear)
    ]);

    const fxsEvents = fxsSettled
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value);
    const tvEvents = tvSettled
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value);

    const combined = [...fxsEvents, ...tvEvents];
    const coreSet = new Set(['NFP', 'CPI', 'BUNGA']);
    const seen = new Set();

    const coreEvents = combined
      .filter(ev => coreSet.has(ev.code))
      .filter(ev => {
        const key = `${ev.year}-${String(ev.monthIndex).padStart(2, '0')}_${ev.code}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => {
        if (a.year !== b.year) return a.year - b.year;
        if (a.monthIndex !== b.monthIndex) return a.monthIndex - b.monthIndex;
        if (a.day !== b.day) return a.day - b.day;
        return (a.timeWIB || '').localeCompare(b.timeWIB || '');
      });

    // Hitung aturan 2-dari-3 bulanan & fallback bulan lalu pada seluruh rangkaian kronologis
    const ruledEvents = applyMonthlyStrategyRules(coreEvents, initialPrevTrend);

    // Filter ke rentang tahun yang diminta user & jalankan simulasi candle pullback H4
    const targetEvents = ruledEvents.filter(ev => {
      if (ev.year < startYear || ev.year > endYear) return false;
      if (indicatorFilter !== 'ALL' && ev.code !== indicatorFilter) return false;
      return true;
    });

    const trades = targetEvents.map(ev =>
      simulatePullbackTrade(ev, candles, { tpPips, slPips, pipSize })
    );

    const closedTrades = trades.filter(t => t.outcome === 'WIN' || t.outcome === 'LOSS');
    const wins = closedTrades.filter(t => t.outcome === 'WIN').length;
    const losses = closedTrades.filter(t => t.outcome === 'LOSS').length;
    const netPips = closedTrades.reduce((acc, t) => acc + t.pipsResult, 0);
    const winRate = closedTrades.length > 0 ? Number(((wins / closedTrades.length) * 100).toFixed(1)) : 0;
    const overrideCount = trades.filter(t => t.ruleApplied === 'OVERRIDE_2_OF_3').length;
    const fallbackCount = trades.filter(t => t.ruleApplied.includes('FALLBACK_PREV_MONTH')).length;

    return res.status(200).json({
      ok: true,
      strategy: 'Pure Macro USD (NFP, CPI, FOMC) + H4 Pullback Candle Close (1:2 RR)',
      timezone: 'Asia/Jakarta (WIB / UTC+7)',
      params: { startYear, endYear, indicatorFilter, tpPips, slPips, pipSize, initialPrevTrend },
      summary: {
        totalSignals: trades.length,
        executedTrades: closedTrades.length,
        wins,
        losses,
        winRate,
        netPips,
        overrideCount,
        fallbackCount
      },
      trades
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
