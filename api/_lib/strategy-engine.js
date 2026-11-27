function parseNumericValue(raw) {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim();
  if (!str || str === '-' || str.toLowerCase() === 'nan' || str.toLowerCase() === 'null') {
    return null;
  }
  const hasK = /k$/i.test(str);
  const hasM = /m$/i.test(str);
  const cleaned = str.replace(/[%$,kKmM\s]/g, '');
  const num = parseFloat(cleaned);
  if (Number.isNaN(num)) return null;
  return { raw: str, value: num, hasK, hasM };
}

export function evaluateRawNewsSignal(event, compareMode = 'PREVIOUS') {
  const baseRaw = compareMode === 'FORECAST' && event.forecast !== null && event.forecast !== undefined && String(event.forecast).trim() !== ''
    ? event.forecast
    : event.previous;

  const base = parseNumericValue(baseRaw);
  const act = parseNumericValue(event.actual);

  if (!base || !act) {
    return {
      newsDirection: 'UNKNOWN',
      rawGoldBias: 'FLAT',
      baseNum: null,
      actNum: null,
      usedBaseLabel: compareMode === 'FORECAST' ? 'Forecast' : 'Previous'
    };
  }

  let bVal = base.value;
  let aVal = act.value;

  if (base.hasK !== act.hasK) {
    if (base.hasK && Math.abs(aVal) >= 1000) bVal *= 1000;
    if (act.hasK && Math.abs(bVal) >= 1000) aVal *= 1000;
  }
  if (base.hasM !== act.hasM) {
    if (base.hasM && Math.abs(aVal) >= 1000000) bVal *= 1000000;
    if (act.hasM && Math.abs(bVal) >= 1000000) aVal *= 1000000;
  }

  const diff = aVal - bVal;
  if (Math.abs(diff) < 1e-9) {
    return {
      newsDirection: 'TETAP',
      rawGoldBias: 'FLAT',
      baseNum: bVal,
      actNum: aVal,
      usedBaseLabel: compareMode === 'FORECAST' ? 'Forecast' : 'Previous'
    };
  }

  // NFP / CPI / SUKU BUNGA MENGUAT -> GOLD MELEMAH (SELL)
  // NFP / CPI / SUKU BUNGA MELEMAH -> GOLD MENGUAT (BUY)
  if (diff > 0) {
    return {
      newsDirection: 'MENGUAT',
      rawGoldBias: 'SELL',
      baseNum: bVal,
      actNum: aVal,
      usedBaseLabel: compareMode === 'FORECAST' ? 'Forecast' : 'Previous'
    };
  }

  return {
    newsDirection: 'MELEMAH',
    rawGoldBias: 'BUY',
    baseNum: bVal,
    actNum: aVal,
    usedBaseLabel: compareMode === 'FORECAST' ? 'Forecast' : 'Previous'
  };
}

export function applyMonthlyStrategyRules(sortedEvents, initialPrevTrend = 'BUY', compareMode = 'PREVIOUS') {
  const monthGroups = new Map();
  for (const ev of sortedEvents) {
    const ymKey = `${ev.year}-${String(ev.monthIndex).padStart(2, '0')}`;
    if (!monthGroups.has(ymKey)) monthGroups.set(ymKey, []);
    monthGroups.get(ymKey).push(ev);
  }

  let prevMonthDominantTrend = initialPrevTrend;
  const enrichedEvents = [];

  for (const [ymKey, events] of monthGroups.entries()) {
    let buyVotes = 0;
    let sellVotes = 0;
    const prevMonthUsedForThisMonth = prevMonthDominantTrend;

    events.forEach((ev, idx) => {
      const evalRes = evaluateRawNewsSignal(ev, compareMode);

      if (evalRes.rawGoldBias === 'BUY') buyVotes += 1;
      if (evalRes.rawGoldBias === 'SELL') sellVotes += 1;

      let effectiveBias = null;
      let ruleApplied = 'NORMAL';
      let ruleDetail = '';

      if (buyVotes >= 2) {
        effectiveBias = 'BUY';
        if (evalRes.rawGoldBias === 'SELL') {
          ruleApplied = 'OVERRIDE_2_OF_3';
          ruleDetail = `Pantangan 2/3 aktif (BUY ${buyVotes}-${sellVotes}): sinyal SELL dikalahkan tren BUY bulanan`;
        } else if (evalRes.rawGoldBias === 'FLAT') {
          ruleApplied = 'MAJORITY_2_OF_3';
          ruleDetail = `Data TETAP, mengikuti mayoritas 2/3 bulan berjalan (BUY ${buyVotes}-${sellVotes})`;
        } else {
          ruleApplied = 'CONFIRMED_2_OF_3';
          ruleDetail = `Mayoritas 2/3 bulan berjalan terkonfirmasi BUY (${buyVotes}-${sellVotes})`;
        }
      } else if (sellVotes >= 2) {
        effectiveBias = 'SELL';
        if (evalRes.rawGoldBias === 'BUY') {
          ruleApplied = 'OVERRIDE_2_OF_3';
          ruleDetail = `Pantangan 2/3 aktif (SELL ${sellVotes}-${buyVotes}): sinyal BUY dikalahkan tren SELL bulanan`;
        } else if (evalRes.rawGoldBias === 'FLAT') {
          ruleApplied = 'MAJORITY_2_OF_3';
          ruleDetail = `Data TETAP, mengikuti mayoritas 2/3 bulan berjalan (SELL ${sellVotes}-${buyVotes})`;
        } else {
          ruleApplied = 'CONFIRMED_2_OF_3';
          ruleDetail = `Mayoritas 2/3 bulan berjalan terkonfirmasi SELL (${sellVotes}-${buyVotes})`;
        }
      } else {
        if (evalRes.rawGoldBias === 'BUY' || evalRes.rawGoldBias === 'SELL') {
          effectiveBias = evalRes.rawGoldBias;
          ruleApplied = idx === 0 ? 'FIRST_NEWS_SIGNAL' : 'SINGLE_NEWS_SIGNAL';
          ruleDetail = `Sinyal news vs ${evalRes.usedBaseLabel} (${evalRes.newsDirection} -> Gold ${effectiveBias}), skor ${buyVotes}B-${sellVotes}S`;
        } else {
          if (buyVotes === 0 && sellVotes === 0) {
            effectiveBias = prevMonthUsedForThisMonth;
            ruleApplied = 'FALLBACK_PREV_MONTH';
            ruleDetail = `Data TETAP di awal bulan: ambil tren terbanyak bulan lalu (${prevMonthUsedForThisMonth})`;
          } else if (buyVotes > sellVotes) {
            effectiveBias = 'BUY';
            ruleApplied = 'HOLD_CURRENT_LEAD';
            ruleDetail = `Data TETAP, ikuti keunggulan sementara bulan ini (BUY ${buyVotes}-${sellVotes})`;
          } else if (sellVotes > buyVotes) {
            effectiveBias = 'SELL';
            ruleApplied = 'HOLD_CURRENT_LEAD';
            ruleDetail = `Data TETAP, ikuti keunggulan sementara bulan ini (SELL ${sellVotes}-${buyVotes})`;
          } else {
            effectiveBias = prevMonthUsedForThisMonth;
            ruleApplied = 'TIE_FALLBACK_PREV_MONTH';
            ruleDetail = `Skor seri (${buyVotes}-${sellVotes}) & data TETAP: ambil tren terbanyak bulan lalu (${prevMonthUsedForThisMonth})`;
          }
        }
      }

      enrichedEvents.push({
        ...ev,
        ymKey,
        orderInMonth: idx + 1,
        totalInMonth: events.length,
        newsDirection: evalRes.newsDirection,
        rawGoldBias: evalRes.rawGoldBias,
        effectiveBias,
        ruleApplied,
        ruleDetail,
        monthScore: `${buyVotes}B - ${sellVotes}S`,
        prevMonthRef: prevMonthUsedForThisMonth
      });
    });

    if (buyVotes > sellVotes) {
      prevMonthDominantTrend = 'BUY';
    } else if (sellVotes > buyVotes) {
      prevMonthDominantTrend = 'SELL';
    }
  }

  return enrichedEvents;
}
