import { fetchFxStreetYear } from './_lib/fxstreet.js';
import { fetchTradingViewYear } from './_lib/tradingview.js';
import { applyMonthlyStrategyRules } from './_lib/strategy-engine.js';
import { fetchXauCandles } from './_lib/xau-ohlc.js';

function parseEventUtcMs(ev) {
  const datePart = ev.dateISO || `${ev.year}-${String(ev.monthIndex).padStart(2, '0')}-${String(ev.day).padStart(2, '0')}`;
  const timePart = (ev.timeWIB || '19:30').slice(0, 5);
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  if (!y || !m || !d) return null;
  return Date.UTC(y, m - 1, d, (hh || 0) - 7, mm || 0, 0);
}

function simulateTwoStepPullbackTrade(event, candles, { tpPips, slPips, pipSize, maxWaitCandles }) {
  const newsUtcMs = parseEventUtcMs(event);
  if (!newsUtcMs || candles.length === 0) {
    return {
      ...event,
      newsCandleTimeSec: null,
      impulseCloseWIB: '-',
      entryCandleTimeSec: null,
      exitCandleTimeSec: null,
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

  const newsCandleIdx = candles.findIndex(c => c.closeTime > newsUtcMs);
  if (newsCandleIdx === -1) {
    return {
      ...event,
      newsCandleTimeSec: null,
      impulseCloseWIB: '-',
      entryCandleTimeSec: null,
      exitCandleTimeSec: null,
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

  const newsCandle = candles[newsCandleIdx];
  const searchLimit = Math.min(candles.length, newsCandleIdx + 1 + maxWaitCandles);

  // TAHAP 1: Tunggu penutupan candle H4 searah tren news (Bullish/Hijau untuk BUY, Bearish/Merah untuk SELL)
  let impulseCandleIdx = -1;
  for (let i = newsCandleIdx; i < searchLimit; i++) {
    const c = candles[i];
    if (event.effectiveBias === 'BUY' && c.close > c.open) {
      impulseCandleIdx = i;
      break;
    }
    if (event.effectiveBias === 'SELL' && c.close < c.open) {
      impulseCandleIdx = i;
      break;
    }
  }

  if (impulseCandleIdx === -1) {
    return {
      ...event,
      newsCandleTimeSec: newsCandle.timeWibSec,
      impulseCloseWIB: '-',
      entryCandleTimeSec: null,
      exitCandleTimeSec: null,
      tradeStatus: 'NO_IMPULSE_CONFIRM',
      pullbackCloseWIB: '-',
      entryPrice: null,
      tpPrice: null,
      slPrice: null,
      exitWIB: '-',
      outcome: 'SKIPPED',
      pipsResult: 0
    };
  }

  // TAHAP 2: Tunggu 1 candle H4 pullback (berlawanan arah) tutup penuh
  let entryCandleIdx = -1;
  const pullbackLimit = Math.min(candles.length, impulseCandleIdx + 1 + maxWaitCandles);

  for (let j = impulseCandleIdx + 1; j < pullbackLimit; j++) {
    const c = candles[j];
    if (event.effectiveBias === 'BUY' && c.close < c.open) {
      entryCandleIdx = j;
      break;
    }
    if (event.effectiveBias === 'SELL' && c.close > c.open) {
      entryCandleIdx = j;
      break;
    }
  }

  if (entryCandleIdx === -1) {
    return {
      ...event,
      newsCandleTimeSec: newsCandle.timeWibSec,
      impulseCloseWIB: candles[impulseCandleIdx].closeWIB,
      entryCandleTimeSec: null,
      exitCandleTimeSec: null,
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

  const impulseCandle = candles[impulseCandleIdx];
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

  let outcome = 'OPEN';
  let pipsResult = 0;
  let exitWIB = 'Masih Berjalan';
  let exitCandleTimeSec = candles[Math.min(candles.length - 1, entryCandleIdx + 15)].timeWibSec;

  for (let k = entryCandleIdx + 1; k < candles.length; k++) {
    const bar = candles[k];
    if (event.effectiveBias === 'BUY') {
      if (bar.low <= slPrice) {
        outcome = 'LOSS';
        pipsResult = -slPips;
        exitWIB = bar.closeWIB;
        exitCandleTimeSec = bar.timeWibSec;
        break;
      }
      if (bar.high >= tpPrice) {
        outcome = 'WIN';
        pipsResult = tpPips;
        exitWIB = bar.closeWIB;
        exitCandleTimeSec = bar.timeWibSec;
        break;
      }
    } else {
      if (bar.high >= slPrice) {
        outcome = 'LOSS';
        pipsResult = -slPips;
        exitWIB = bar.closeWIB;
        exitCandleTimeSec = bar.timeWibSec;
        break;
      }
      if (bar.low <= tpPrice) {
        outcome = 'WIN';
        pipsResult = tpPips;
        exitWIB = bar.closeWIB;
        exitCandleTimeSec = bar.timeWibSec;
        break;
      }
    }
  }

  return {
    ...event,
    newsCandleTimeSec: newsCandle.timeWibSec,
    newsCandleSessionWIB: newsCandle.openWIB,
    impulseCloseWIB: impulseCandle.closeWIB,
    entryCandleTimeSec: entryCandle.timeWibSec,
    exitCandleTimeSec,
    tradeStatus: 'EXECUTED',
    candleTF: 'H4',
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

  const startYear = Math.max(2015, parseInt(req.query.startYear || '2020', 10));
  const endYear = Math.min(2026, parseInt(req.query.endYear || '2026', 10));
  const indicatorFilter = (req.query.indicator || 'ALL').toString().toUpperCase();
  const compareMode = (req.query.compareMode || 'PREVIOUS').toString().toUpperCase() === 'FORECAST' ? 'FORECAST' : 'PREVIOUS';
  const tpPips = Math.max(50, parseInt(req.query.tpPips || '400', 10));
  const slPips = Math.max(25, parseInt(req.query.slPips || '200', 10));
  const maxWaitCandles = Math.max(2, Math.min(36, parseInt(req.query.maxWait || '18', 10)));
  const initialPrevTrend = (req.query.initialTrend || 'BUY').toString().toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
  const pipSize = 0.1;

  try {
    const years = [];
    const fetchStart = Math.max(2015, startYear - 1);
    for (let y = fetchStart; y <= endYear; y++) years.push(y);

    const [fxsSettled, tvSettled, candles] = await Promise.all([
      Promise.allSettled(years.map(y => fetchFxStreetYear(y))),
      Promise.allSettled(years.map(y => fetchTradingViewYear(y))),
      fetchXauCandles(startYear, endYear)
    ]);

    const fxsEvents = fxsSettled.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
    const tvEvents = tvSettled.filter(r => r.status === 'fulfilled').flatMap(r => r.value);

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

    const ruledEvents = applyMonthlyStrategyRules(coreEvents, initialPrevTrend, compareMode);

    const targetEvents = ruledEvents.filter(ev => {
      if (ev.year < startYear || ev.year > endYear) return false;
      if (indicatorFilter !== 'ALL' && ev.code !== indicatorFilter) return false;
      return true;
    });

    const trades = targetEvents.map(ev =>
      simulateTwoStepPullbackTrade(ev, candles, { tpPips, slPips, pipSize, maxWaitCandles })
    );

    const closedTrades = trades.filter(t => t.outcome === 'WIN' || t.outcome === 'LOSS');
    const wins = closedTrades.filter(t => t.outcome === 'WIN').length;
    const losses = closedTrades.filter(t => t.outcome === 'LOSS').length;
    const netPips = closedTrades.reduce((acc, t) => acc + t.pipsResult, 0);
    const winRate = closedTrades.length > 0 ? Number(((wins / closedTrades.length) * 100).toFixed(1)) : 0;
    const overrideCount = trades.filter(t => t.ruleApplied === 'OVERRIDE_2_OF_3').length;
    const fallbackCount = trades.filter(t => t.ruleApplied.includes('FALLBACK_PREV_MONTH')).length;
    const activeFeed = candles.length > 0 ? candles[candles.length - 1].feed : 'Tidak tersedia';

    const chartCandles = candles.map(c => ({
      time: c.timeWibSec,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close
    }));

    return res.status(200).json({
      ok: true,
      timezone: 'Asia/Jakarta (WIB / UTC+7)',
      activeFeed,
      totalH4Candles: candles.length,
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
      chartCandles,
      trades
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
