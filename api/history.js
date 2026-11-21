const NAMA_BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

const EN_MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};

// Jadwal keputusan FOMC resmi Federal Reserve (2015–2026)
const VERIFIED_FOMC_DATES = {
  2015: ['2015-01-28', '2015-03-18', '2015-04-29', '2015-06-17', '2015-07-29', '2015-09-17', '2015-10-28', '2015-12-16'],
  2016: ['2016-01-27', '2016-03-16', '2016-04-27', '2016-06-15', '2016-07-27', '2016-09-21', '2016-11-02', '2016-12-14'],
  2017: ['2017-02-01', '2017-03-15', '2017-05-03', '2017-06-14', '2017-07-26', '2017-09-20', '2017-11-01', '2017-12-13'],
  2018: ['2018-01-31', '2018-03-21', '2018-05-02', '2018-06-13', '2018-08-01', '2018-09-26', '2018-11-08', '2018-12-19'],
  2019: ['2019-01-30', '2019-03-20', '2019-05-01', '2019-06-19', '2019-07-31', '2019-09-18', '2019-10-30', '2019-12-11'],
  2020: ['2020-01-29', '2020-03-03', '2020-03-15', '2020-04-29', '2020-06-10', '2020-07-29', '2020-09-16', '2020-11-05', '2020-12-16'],
  2021: ['2021-01-27', '2021-03-17', '2021-04-28', '2021-06-16', '2021-07-28', '2021-09-22', '2021-11-03', '2021-12-15'],
  2022: ['2022-01-26', '2022-03-16', '2022-05-04', '2022-06-15', '2022-07-27', '2022-09-21', '2022-11-02', '2022-12-14'],
  2023: ['2023-02-01', '2023-03-22', '2023-05-03', '2023-06-14', '2023-07-26', '2023-09-20', '2023-11-01', '2023-12-13'],
  2024: ['2024-01-31', '2024-03-20', '2024-05-01', '2024-06-12', '2024-07-31', '2024-09-18', '2024-11-07', '2024-12-18'],
  2025: ['2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18', '2025-07-30', '2025-09-17', '2025-10-29', '2025-12-10'],
  2026: ['2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09']
};

function isValidISO(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function fmtISO(d) {
  return d.toISOString().slice(0, 10);
}

function addDaysISO(isoDate, days) {
  if (!isValidISO(isoDate)) return isoDate;
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return fmtISO(d);
}

function getBlsNfpFallback(year, month1) {
  const firstDay = new Date(Date.UTC(year, month1 - 1, 1));
  const diff = (5 - firstDay.getUTCDay() + 7) % 7;
  const fri = new Date(Date.UTC(year, month1 - 1, 1 + diff));
  const dayNum = fri.getUTCDate();
  if (month1 === 1 && (dayNum === 1 || dayNum === 2)) fri.setUTCDate(dayNum + 7);
  if (month1 === 7 && (dayNum === 3 || dayNum === 4)) fri.setUTCDate(dayNum - 1);
  return fmtISO(fri);
}

function getBlsCpiFallback(year, month1) {
  const d = new Date(Date.UTC(year, month1 - 1, 15));
  const dow = d.getUTCDay();
  if (dow === 0) d.setUTCDate(17);
  else if (dow === 1) d.setUTCDate(16);
  else if (dow === 6) d.setUTCDate(14);
  return fmtISO(d);
}

// Tarik tanggal rilis resmi per tahun dari halaman Kalender FRED (rid=50 NFP, rid=10 CPI, rid=9 Retail)
async function fetchFredReleaseCalendar(rid, year) {
  const byMonth = {};
  try {
    const url = `https://fred.stlouisfed.org/releases/calendar?rid=${rid}&y=${year}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(3500)
    });
    if (!res.ok) return byMonth;
    const html = await res.text();

    // 1. Cari pola ISO YYYY-MM-DD yang valid untuk tahun tersebut
    const isoRe = new RegExp(`\\b(${year})-(\\d{2})-(\\d{2})\\b`, 'g');
    let m;
    while ((m = isoRe.exec(html)) !== null) {
      const candidate = `${m[1]}-${m[2]}-${m[3]}`;
      if (isValidISO(candidate)) {
        const mo = parseInt(m[2], 10);
        if (!byMonth[mo]) byMonth[mo] = candidate;
      }
    }

    // 2. Cari pola teks tanggal Inggris ("January 16, 2015" atau "Jan 16, 2015")
    const plain = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const txtRe = new RegExp(`\\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\s+(\\d{1,2}),\\s+(${year})\\b`, 'gi');
    while ((m = txtRe.exec(plain)) !== null) {
      const mo = EN_MONTHS[m[1].toLowerCase()];
      const dy = parseInt(m[2], 10);
      if (mo && dy >= 1 && dy <= 31) {
        const candidate = `${year}-${String(mo).padStart(2, '0')}-${String(dy).padStart(2, '0')}`;
        if (isValidISO(candidate) && !byMonth[mo]) {
          byMonth[mo] = candidate;
        }
      }
    }
  } catch (e) {}
  return byMonth;
}

async function fetchFredSeries(seriesId) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MacroBacktest/1.0)' },
    signal: AbortSignal.timeout(6000)
  });
  if (!res.ok) throw new Error(`FRED ${seriesId} HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const [date, valStr] = lines[i].split(',');
    const val = parseFloat((valStr || '').trim());
    if (date && !isNaN(val)) rows.push({ date: date.trim(), val });
  }
  return rows;
}

async function fetchAlfredVintages(seriesId, vintageDates) {
  if (!vintageDates.length || vintageDates.length > 72) return null;
  try {
    const url = `https://alfred.stlouisfed.org/graph/alfredgraph.csv?id=${encodeURIComponent(seriesId)}&vintage_date=${vintageDates.join(',')}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MacroBacktest/1.0)' },
      signal: AbortSignal.timeout(3500)
    });
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return null;

    const headers = lines[0].split(',').map(h => h.trim());
    const mapByVintage = {};
    for (let c = 1; c < headers.length; c++) {
      const m = headers[c].match(/(\d{8})$/);
      if (m) {
        const vIso = `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}`;
        mapByVintage[vIso] = {};
      }
    }

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const obsDate = (cols[0] || '').trim();
      if (!obsDate) continue;
      for (let c = 1; c < headers.length; c++) {
        const m = headers[c].match(/(\d{8})$/);
        if (!m) continue;
        const vIso = `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}`;
        const v = parseFloat((cols[c] || '').trim());
        if (!isNaN(v)) mapByVintage[vIso][obsDate] = v;
      }
    }
    return mapByVintage;
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');

  const startYear = Math.max(2009, parseInt(req.query.startYear || '2015', 10));
  const endYear = Math.min(2030, parseInt(req.query.endYear || '2020', 10));
  const indicator = (req.query.indicator || 'ALL').toString().toUpperCase();

  try {
    const years = [];
    for (let y = startYear; y <= endYear; y++) years.push(y);

    const needed = new Set(indicator === 'ALL' ? ['NFP', 'CPI', 'BUNGA'] : [indicator]);
    const needCpiSeries = needed.has('CPI') || needed.has('CPI_YOY');

    const [payems, cpi, rateRows, unrate, retail, calNfpArr, calCpiArr, calRetailArr] = await Promise.all([
      needed.has('NFP') ? fetchFredSeries('PAYEMS') : Promise.resolve(null),
      needCpiSeries ? fetchFredSeries('CPIAUCSL') : Promise.resolve(null),
      needed.has('BUNGA') ? fetchFredSeries('DFEDTARU') : Promise.resolve(null),
      needed.has('UNRATE') ? fetchFredSeries('UNRATE') : Promise.resolve(null),
      needed.has('RETAIL') ? fetchFredSeries('RSAFS') : Promise.resolve(null),
      (needed.has('NFP') || needed.has('UNRATE')) ? Promise.all(years.map(y => fetchFredReleaseCalendar(50, y).then(m => [y, m]))) : Promise.resolve([]),
      needCpiSeries ? Promise.all(years.map(y => fetchFredReleaseCalendar(10, y).then(m => [y, m]))) : Promise.resolve([]),
      needed.has('RETAIL') ? Promise.all(years.map(y => fetchFredReleaseCalendar(9, y).then(m => [y, m]))) : Promise.resolve([])
    ]);

    const calNfp = Object.fromEntries(calNfpArr);
    const calCpi = Object.fromEntries(calCpiArr);
    const calRetail = Object.fromEntries(calRetailArr);

    let alfredNfp = null;
    if (payems && years.length <= 6) {
      const targetVintages = [];
      for (const y of years) {
        for (let mo = 1; mo <= 12; mo++) {
          const relIso = calNfp[y]?.[mo] || getBlsNfpFallback(y, mo);
          targetVintages.push(addDaysISO(relIso, 2));
        }
      }
      alfredNfp = await fetchAlfredVintages('PAYEMS', targetVintages);
    }

    const allEvents = [];

    function processMonthlySeries(rows, code, label, unit, calMap, fallbackFn, mode) {
      if (!rows) return;
      for (let i = 0; i < rows.length; i++) {
        const [obsY, obsM] = rows[i].date.split('-').map(Number);
        let relY = obsY;
        let relM = obsM + 1;
        if (relM > 12) { relY += 1; relM = 1; }
        if (relY < startYear || relY > endYear) continue;

        const relIso = calMap[relY]?.[relM] || fallbackFn(relY, relM);
        if (!isValidISO(relIso)) continue;
        const vintageIso = addDaysISO(relIso, 2);

        let actNum = null;
        let prevNum = null;

        if (mode === 'NFP_INITIAL' && alfredNfp && alfredNfp[vintageIso]) {
          const vSeries = alfredNfp[vintageIso];
          const d0 = rows[i].date;
          const d1 = rows[i - 1]?.date;
          const d2 = rows[i - 2]?.date;
          if (vSeries[d0] != null && vSeries[d1] != null && vSeries[d2] != null) {
            actNum = Math.round(vSeries[d0] - vSeries[d1]);
            prevNum = Math.round(vSeries[d1] - vSeries[d2]);
          }
        }

        if (actNum === null || prevNum === null) {
          if (mode === 'NFP_INITIAL' || mode === 'MOM_DIFF') {
            if (i < 2) continue;
            actNum = Math.round(rows[i].val - rows[i - 1].val);
            prevNum = Math.round(rows[i - 1].val - rows[i - 2].val);
          } else if (mode === 'YOY_PCT') {
            if (i < 13) continue;
            actNum = ((rows[i].val - rows[i - 12].val) / rows[i - 12].val) * 100;
            prevNum = ((rows[i - 1].val - rows[i - 13].val) / rows[i - 13].val) * 100;
          } else if (mode === 'MOM_PCT') {
            if (i < 2) continue;
            actNum = ((rows[i].val - rows[i - 1].val) / rows[i - 1].val) * 100;
            prevNum = ((rows[i - 1].val - rows[i - 2].val) / rows[i - 2].val) * 100;
          } else {
            if (i < 1) continue;
            actNum = rows[i].val;
            prevNum = rows[i - 1].val;
          }
        }

        const [ry, rm, rd] = relIso.split('-').map(Number);
        const fmt = (v) => unit === 'K' ? `${Math.round(v)}K` : `${v.toFixed(1)}%`;

        allEvents.push({
          id: `${code}_${relIso}`,
          dateISO: relIso,
          year: ry,
          monthIndex: rm,
          monthName: NAMA_BULAN[rm - 1],
          day: rd,
          currency: 'USD',
          code,
          event: label,
          previous: fmt(prevNum),
          previousNum: Number(prevNum.toFixed(2)),
          forecast: null,
          forecastNum: null,
          actual: fmt(actNum),
          actualNum: Number(actNum.toFixed(2)),
          unit,
          source: 'BLS / Federal Reserve Official Calendar'
        });
      }
    }

    processMonthlySeries(payems, 'NFP', 'Non-Farm Employment Change (NFP)', 'K', calNfp, getBlsNfpFallback, 'NFP_INITIAL');
    if (needed.has('CPI')) {
      processMonthlySeries(cpi, 'CPI', 'CPI m/m (Forex Factory)', '%', calCpi, getBlsCpiFallback, 'MOM_PCT');
    }
    if (needed.has('CPI_YOY')) {
      processMonthlySeries(cpi, 'CPI_YOY', 'CPI y/y (Inflasi Tahunan)', '%', calCpi, getBlsCpiFallback, 'YOY_PCT');
    }
    processMonthlySeries(unrate, 'UNRATE', 'Unemployment Rate', '%', calNfp, getBlsNfpFallback, 'DIRECT');
    processMonthlySeries(retail, 'RETAIL', 'Retail Sales m/m', '%', calRetail, getBlsCpiFallback, 'MOM_PCT');

    // Proses Suku Bunga The Fed (FOMC) dari kalender keputusan resmi Federal Reserve
    if (rateRows) {
      const rateByDate = Object.fromEntries(rateRows.map(r => [r.date, r.val]));
      const getRateAt = (iso) => {
        for (let back = 0; back <= 7; back++) {
          const check = addDaysISO(iso, -back);
          if (rateByDate[check] != null) return rateByDate[check];
        }
        return null;
      };

      for (const y of years) {
        const fomcList = VERIFIED_FOMC_DATES[y] || [
          `${y}-01-28`, `${y}-03-18`, `${y}-04-29`, `${y}-06-17`,
          `${y}-07-29`, `${y}-09-16`, `${y}-10-28`, `${y}-12-16`
        ];
        for (const fomcIso of fomcList) {
          if (!isValidISO(fomcIso)) continue;
          const prevRate = getRateAt(fomcIso);
          const actRate = getRateAt(addDaysISO(fomcIso, 2)) ?? prevRate;
          if (prevRate == null || actRate == null) continue;

          const [fy, fm, fd] = fomcIso.split('-').map(Number);
          allEvents.push({
            id: `BUNGA_${fomcIso}`,
            dateISO: fomcIso,
            year: fy,
            monthIndex: fm,
            monthName: NAMA_BULAN[fm - 1],
            day: fd,
            currency: 'USD',
            code: 'BUNGA',
            event: 'Federal Funds Rate (FOMC)',
            previous: `${prevRate.toFixed(2)}%`,
            previousNum: prevRate,
            forecast: null,
            forecastNum: null,
            actual: `${actRate.toFixed(2)}%`,
            actualNum: actRate,
            unit: '%',
            source: 'Federal Reserve FOMC Calendar'
          });
        }
      }
    }

    allEvents.sort((a, b) => a.dateISO.localeCompare(b.dateISO));

    return res.status(200).json({
      ok: true,
      source: 'Federal Reserve (ALFRED/FRED) + Official BLS/FOMC Release Calendar',
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
