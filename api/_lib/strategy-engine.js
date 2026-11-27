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

export function evaluateRawNewsSignal(event) {
  const prev = parseNumericValue(event.previous);
  const act = parseNumericValue(event.actual);

  if (!prev || !act) {
    return {
      newsDirection: 'UNKNOWN',
      rawGoldBias: 'FLAT',
      prevNum: null,
      actNum: null
    };
  }

  let pVal = prev.value;
  let aVal = act.value;

  // Normalisasi skala jika salah satu memakai akhiran K/M dan lainnya angka penuh
  if (prev.hasK !== act.hasK) {
    if (prev.hasK && Math.abs(aVal) >= 1000) pVal *= 1000;
    if (act.hasK && Math.abs(pVal) >= 1000) aVal *= 1000;
  }
  if (prev.hasM !== act.hasM) {
    if (prev.hasM && Math.abs(aVal) >= 1000000) pVal *= 1000000;
    if (act.hasM && Math.abs(pVal) >= 1000000) aVal *= 1000000;
  }

  const diff = aVal - pVal;
  if (Math.abs(diff) < 1e-9) {
    return {
      newsDirection: 'TETAP',
      rawGoldBias: 'FLAT',
      prevNum: pVal,
      actNum: aVal
    };
  }

  // NFP / CPI / SUKU BUNGA MENGUAT -> GOLD MELEMAH (SELL)
  // NFP / CPI / SUKU BUNGA MELEMAH -> GOLD MENGUAT (BUY)
  if (diff > 0) {
    return {
      newsDirection: 'MENGUAT',
      rawGoldBias: 'SELL',
      prevNum: pVal,
      actNum: aVal
    };
  }

  return {
    newsDirection: 'MELEMAH',
    rawGoldBias: 'BUY',
    prevNum: pVal,
    actNum: aVal
  };
}

export function applyMonthlyStrategyRules(sortedEvents, initialPrevTrend = 'BUY') {
  // Kelompokkan event per (Tahun-Bulan) secara kronologis
  const monthGroups = new Map();
  for (const ev of sortedEvents) {
    const ymKey = `${ev.year}-${String(ev.monthIndex).padStart(2, '0')}`;
    if (!monthGroups.has(ymKey)) monthGroups.set(ymKey, []);
    monthGroups.get(ymKey).push(ev);
  }

  let prevMonthDominantTrend = initialPrevTrend; // 'BUY' atau 'SELL'
  const enrichedEvents = [];

  for (const [ymKey, events] of monthGroups.entries()) {
    let buyVotes = 0;
    let sellVotes = 0;
    const prevMonthUsedForThisMonth = prevMonthDominantTrend;

    events.forEach((ev, idx) => {
      const evalRes = evaluateRawNewsSignal(ev);

      if (evalRes.rawGoldBias === 'BUY') buyVotes += 1;
      if (evalRes.rawGoldBias === 'SELL') sellVotes += 1;

      let effectiveBias = null;
      let ruleApplied = 'NORMAL';
      let ruleDetail = '';

      // 1. Cek Aturan Pantangan 2-dari-3 (Mayoritas Bulanan Terkunci)
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
        // 2. Belum ada yang mencapai 2 suara
        if (evalRes.rawGoldBias === 'BUY' || evalRes.rawGoldBias === 'SELL') {
          effectiveBias = evalRes.rawGoldBias;
          ruleApplied = idx === 0 ? 'FIRST_NEWS_SIGNAL' : 'SINGLE_NEWS_SIGNAL';
          ruleDetail = `Sinyal langsung news (${evalRes.newsDirection} -> Gold ${effectiveBias}), skor bulan ${buyVotes}B-${sellVotes}S`;
        } else {
          // Data TETAP (Actual === Previous)
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
            ruleDetail = `Skor bulan seri (${buyVotes}-${sellVotes}) & data TETAP: ambil tren terbanyak bulan lalu (${prevMonthUsedForThisMonth})`;
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

    // Tentukan tren terbanyak bulan ini sebagai referensi bulan berikutnya
    if (buyVotes > sellVotes) {
      prevMonthDominantTrend = 'BUY';
    } else if (sellVotes > buyVotes) {
      prevMonthDominantTrend = 'SELL';
    }
    // Jika seri 1-1 atau 0-0, pertahankan prevMonthDominantTrend sebelumnya
  }

  return enrichedEvents;
}
