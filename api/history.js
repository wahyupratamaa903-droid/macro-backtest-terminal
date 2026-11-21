const NAMA_BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

function getFirstFriday(year, monthIndex0) {
  const d = new Date(Date.UTC(year, monthIndex0, 1));
  const day = d.getUTCDay();
  const diff = (5 - day + 7) % 7;
  d.setUTCDate(1 + diff);
  return d;
}

function getReleaseBusinessDay(year, monthIndex0, targetDay) {
  const d = new Date(Date.UTC(year, monthIndex0, targetDay));
  const dow = d.getUTCDay();
  if (dow === 0) d.setUTCDate(targetDay + 1);
  if (dow === 6) d.setUTCDate(targetDay - 1);
  return d;
}

function prevBusinessDay(dateObj) {
  const d = new Date(dateObj.getTime());
  d.setUTCDate(d.getUTCDate() - 1);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() - 2);
  if (d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

function fmtISO(d) {
  return d.toISOString().slice(0, 10);
}

async function fetchFredCSV(seriesId) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MacroBacktestTerminal/1.0)' }
  });
  if (!res.ok) throw new Error(`FRED ${seriesId} HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 2) continue;
    const date = parts[0].trim();
    const val = parseFloat(parts[1].trim());
    if (date && !isNaN(val)) rows.push({ date, val });
  }
  return rows;
}

function buildMonthlyEvents(rows, indicatorCode, label, unit, releaseType, calcMode) {
  const events = [];
  for (let i = 0; i < rows.length; i++) {
    let actualNum = null;
    let prevNum = null;

    if (calcMode === 'MOM_DIFF') {
      if (i < 2) continue;
      actualNum = Math.round(rows[i].val - rows[i - 1].val);
      prevNum = Math.round(rows[i - 1].val - rows[i - 2].val);
    } else if (calcMode === 'YOY_PCT') {
      if (i < 13) continue;
      actualNum = ((rows[i].val - rows[i - 12].val) / rows[i - 12].val) * 100;
      prevNum = ((rows[i - 1].val - rows[i - 13].val) / rows[i - 13].val) * 100;
    } else if (calcMode === 'MOM_PCT') {
      if (i < 2) continue;
      actualNum = ((rows[i].val - rows[i - 1].val) / rows[i - 1].val) * 100;
      prevNum = ((rows[i - 1].val - rows[i - 2].val) / rows[i - 2].val) * 100;
    } else {
      if (i < 1) continue;
      actualNum = rows[i].val;
      prevNum = rows[i - 1].val;
    }

    const [obsY, obsM] = rows[i].date.split('-').map(Number);
    let relY = obsY;
    let relM0 = obsM;
    if (relM0 >= 12) {
      relY += 1;
      relM0 = 0;
    }

    const relDate = releaseType === 'FIRST_FRIDAY'
      ? getFirstFriday(relY, relM0)
      : getReleaseBusinessDay(relY, relM0, releaseType === 'CPI_DAY' ? 12 : 15);

    const decimals = unit === 'K' ? 0 : 1;
    const fmtVal = (v) => unit === 'K' ? `${Math.round(v)}K` : `${v.toFixed(decimals)}%`;

    events.push({
      id: `${indicatorCode}_${fmtISO(relDate)}`,
      dateISO: fmtISO(relDate),
      year: relDate.getUTCFullYear(),
      monthIndex: relDate.getUTCMonth() + 1,
      monthName: NAMA_BULAN[relDate.getUTCMonth()],
      day: relDate.getUTCDate(),
      currency: 'USD',
      code: indicatorCode,
      event: label,
      previous: fmtVal(prevNum),
      previousNum: Number(prevNum.toFixed(2)),
      forecast: null,
      forecastNum: null,
      actual: fmtVal(actualNum),
      actualNum: Number(actualNum.toFixed(2)),
      unit,
      source: 'Federal Reserve (FRED)'
    });
  }
  return events;
}

function buildFomcEvents(dfedtaruRows) {
  const events = [];
  const seenMonth = new Set();

  for (let i = 1; i < dfedtaruRows.length; i++) {
    const cur = dfedtaruRows[i];
    const prev = dfedtaruRows[i - 1];
    if (cur.val !== prev.val) {
      const effDate = new Date(cur.date + 'T00:00:00Z');
      const fomcDate = prevBusinessDay(effDate);
      const ymKey = `${fomcDate.getUTCFullYear()}-${fomcDate.getUTCMonth()}`;
      seenMonth.add(ymKey);

      events.push({
        id: `BUNGA_${fmtISO(fomcDate)}`,
        dateISO: fmtISO(fomcDate),
        year: fomcDate.getUTCFullYear(),
        monthIndex: fomcDate.getUTCMonth() + 1,
        monthName: NAMA_BULAN[fomcDate.getUTCMonth()],
        day: fomcDate.getUTCDate(),
        currency: 'USD',
        code: 'BUNGA',
        event: 'Suku Bunga The Fed (FOMC)',
        previous: `${prev.val.toFixed(2)}%`,
        previousNum: prev.val,
        forecast: null,
        forecastNum: null,
        actual: `${cur.val.toFixed(2)}%`,
        actualNum: cur.val,
        unit: '%',
        source: 'Federal Reserve (DFEDTARU)'
      });
    }
  }

  const FOMC_MONTHS = [0, 2, 4, 5, 6, 8, 10, 11];
  const byMonthRate = {};
  for (const r of dfedtaruRows) {
    const [y, m] = r.date.split('-').map(Number);
    byMonthRate[`${y}-${m - 1}`] = r.val;
  }

  const years = Array.from(new Set(dfedtaruRows.map(r => Number(r.date.slice(0, 4)))));
  for (const y of years) {
    for (const m0 of FOMC_MONTHS) {
      const ymKey = `${y}-${m0}`;
      if (seenMonth.has(ymKey)) continue;
      const rate = byMonthRate[ymKey];
      if (rate == null) continue;
      const d = getReleaseBusinessDay(y, m0, m0 === 0 || m0 === 6 ? 26 : 18);
      events.push({
        id: `BUNGA_${fmtISO(d)}`,
        dateISO: fmtISO(d),
        year: y,
        monthIndex: m0 + 1,
        monthName: NAMA_BULAN[m0],
        day: d.getUTCDate(),
        currency: 'USD',
        code: 'BUNGA',
        event: 'Suku Bunga The Fed (FOMC)',
        previous: `${rate.toFixed(2)}%`,
        previousNum: rate,
        forecast: null,
        forecastNum: null,
        actual: `${rate.toFixed(2)}%`,
        actualNum: rate,
        unit: '%',
        source: 'Federal Reserve (DFEDTARU)'
      });
    }
  }
  return events;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

  const startYear = Math.max(2009, parseInt(req.query.startYear || '2015', 10));
  const endYear = Math.min(2030, parseInt(req.query.endYear || '2020', 10));
  const indicator = (req.query.indicator || 'ALL').toString().toUpperCase();
  const monthFilter = parseInt(req.query.month || '0', 10);

  try {
    const needed = new Set(indicator === 'ALL' ? ['NFP', 'CPI', 'BUNGA'] : [indicator]);
    const tasks = {};
    if (needed.has('NFP')) tasks.payems = fetchFredCSV('PAYEMS');
    if (needed.has('CPI')) tasks.cpi = fetchFredCSV('CPIAUCSL');
    if (needed.has('BUNGA')) tasks.rate = fetchFredCSV('DFEDTARU');
    if (needed.has('UNRATE')) tasks.unrate = fetchFredCSV('UNRATE');
    if (needed.has('RETAIL')) tasks.retail = fetchFredCSV('RSAFS');

    const keys = Object.keys(tasks);
    const settled = await Promise.all(Object.values(tasks));
    const rawMap = {};
    keys.forEach((k, idx) => { rawMap[k] = settled[idx]; });

    let allEvents = [];
    if (rawMap.payems) allEvents.push(...buildMonthlyEvents(rawMap.payems, 'NFP', 'NFP (Non-Farm Payroll)', 'K', 'FIRST_FRIDAY', 'MOM_DIFF'));
    if (rawMap.cpi) allEvents.push(...buildMonthlyEvents(rawMap.cpi, 'CPI', 'CPI YoY (Inflasi AS)', '%', 'CPI_DAY', 'YOY_PCT'));
    if (rawMap.rate) allEvents.push(...buildFomcEvents(rawMap.rate));
    if (rawMap.unrate) allEvents.push(...buildMonthlyEvents(rawMap.unrate, 'UNRATE', 'Tingkat Pengangguran AS', '%', 'FIRST_FRIDAY', 'DIRECT'));
    if (rawMap.retail) allEvents.push(...buildMonthlyEvents(rawMap.retail, 'RETAIL', 'Retail Sales MoM AS', '%', 'RETAIL_DAY', 'MOM_PCT'));

    allEvents = allEvents.filter(ev => {
      if (ev.year < startYear || ev.year > endYear) return false;
      if (monthFilter > 0 && ev.monthIndex !== monthFilter) return false;
      return true;
    });

    allEvents.sort((a, b) => a.dateISO.localeCompare(b.dateISO));

    return res.status(200).json({
      ok: true,
      source: 'Federal Reserve Bank of St. Louis (FRED Official Database)',
      startYear,
      endYear,
      indicator,
      count: allEvents.length,
      events: allEvents
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
