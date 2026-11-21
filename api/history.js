const NAMA_BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

function fmtISO(d) {
  return d.toISOString().slice(0, 10);
}

function addDaysISO(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00Z');
  if (isNaN(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() + days);
  return fmtISO(d);
}

function prevBusinessDayISO(isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z');
  if (isNaN(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() - 1);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() - 2);
  if (d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return fmtISO(d);
}

// Jadwal rilis resmi BLS NFP (Jumat ke-1, atau Jumat ke-2 jika 1 Jan jatuh Kamis/Jumat)
function getBlsNfpDate(year, month1) {
  const firstDay = new Date(Date.UTC(year, month1 - 1, 1));
  const diff = (5 - firstDay.getUTCDay() + 7) % 7;
  const fri = new Date(Date.UTC(year, month1 - 1, 1 + diff));
  const dayNum = fri.getUTCDate();

  if (month1 === 1 && (dayNum === 1 || dayNum === 2)) {
    fri.setUTCDate(dayNum + 7);
  }
  if (month1 === 7 && (dayNum === 3 || dayNum === 4)) {
    fri.setUTCDate(dayNum - 1);
  }
  return fmtISO(fri);
}

// Jadwal rilis resmi BLS CPI (pertengahan bulan, tidak pernah Senin/Sabtu/Minggu)
function getBlsCpiDate(year, month1) {
  const d = new Date(Date.UTC(year, month1 - 1, 13));
  const dow = d.getUTCDay();
  if (dow === 0) d.setUTCDate(15);
  else if (dow === 1) d.setUTCDate(14);
  else if (dow === 6) d.setUTCDate(15);
  return fmtISO(d);
}

// 8 Jadwal Rapat FOMC Resmi per tahun (Jan, Mar, Mei, Jun, Jul, Sep, Nov, Des)
function getScheduledFomcDates(year) {
  const specs = [
    [1, 25], [3, 15], [5, 1], [6, 14],
    [7, 25], [9, 16], [11, 1], [12, 13]
  ];
  return specs.map(([mo, startD]) => {
    const d = new Date(Date.UTC(year, mo - 1, startD));
    const diff = (3 - d.getUTCDay() + 7) % 7; // Rabu = 3
    d.setUTCDate(startD + diff);
    return fmtISO(d);
  });
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

async function fetchAlfredInitialNfp(vintageDates) {
  if (!vintageDates.length || vintageDates.length > 72) return null;
  try {
    const url = `https://alfred.stlouisfed.org/graph/alfredgraph.csv?id=PAYEMS&vintage_date=${vintageDates.join(',')}`;
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

    const [payems, cpi, rateRows, unrate, retail] = await Promise.all([
      needed.has('NFP') ? fetchFredSeries('PAYEMS') : Promise.resolve(null),
      needCpiSeries ? fetchFredSeries('CPIAUCSL') : Promise.resolve(null),
      needed.has('BUNGA') ? fetchFredSeries('DFEDTARU') : Promise.resolve(null),
      needed.has('UNRATE') ? fetchFredSeries('UNRATE') : Promise.resolve(null),
      needed.has('RETAIL') ? fetchFredSeries('RSAFS') : Promise.resolve(null)
    ]);

    let alfredNfp = null;
    if (payems && years.length <= 6) {
      const targetVintages = [];
      for (const y of years) {
        for (let mo = 1; mo <= 12; mo++) {
          targetVintages.push(addDaysISO(getBlsNfpDate(y, mo), 2));
        }
      }
      alfredNfp = await fetchAlfredInitialNfp(targetVintages);
    }

    const allEvents = [];

    function processMonthlySeries(rows, code, label, unit, dateFn, mode) {
      if (!rows) return;
      for (let i = 0; i < rows.length; i++) {
        const [obsY, obsM] = rows[i].date.split('-').map(Number);
        let relY = obsY;
        let relM = obsM + 1;
        if (relM > 12) { relY += 1; relM = 1; }
        if (relY < startYear || relY > endYear) continue;

        const relIso = dateFn(relY, relM);
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
          source: 'Federal Reserve (ALFRED / FRED Official)'
        });
      }
    }

    processMonthlySeries(payems, 'NFP', 'Non-Farm Employment Change (NFP)', 'K', getBlsNfpDate, 'NFP_INITIAL');
    if (needed.has('CPI')) {
      processMonthlySeries(cpi, 'CPI', 'CPI m/m (Forex Factory)', '%', getBlsCpiDate, 'MOM_PCT');
    }
    if (needed.has('CPI_YOY')) {
      processMonthlySeries(cpi, 'CPI_YOY', 'CPI y/y (Inflasi Tahunan)', '%', getBlsCpiDate, 'YOY_PCT');
    }
    processMonthlySeries(unrate, 'UNRATE', 'Unemployment Rate', '%', getBlsNfpDate, 'DIRECT');
    processMonthlySeries(retail, 'RETAIL', 'Retail Sales m/m', '%', getBlsCpiDate, 'MOM_PCT');

    // Proses Suku Bunga The Fed (FOMC)
    if (rateRows) {
      const rateByDate = Object.fromEntries(rateRows.map(r => [r.date, r.val]));
      const getRateAt = (iso) => {
        for (let back = 0; back <= 7; back++) {
          const check = addDaysISO(iso, -back);
          if (rateByDate[check] != null) return rateByDate[check];
        }
        return null;
      };

      const fomcDateSet = new Set();
      for (const y of years) {
        getScheduledFomcDates(y).forEach(d => fomcDateSet.add(d));
      }

      // Tambahkan tanggal perubahan suku bunga aktual (jika ada rapat darurat seperti Maret 2020)
      for (let i = 1; i < rateRows.length; i++) {
        if (rateRows[i].val !== rateRows[i - 1].val) {
          const decisionIso = prevBusinessDayISO(rateRows[i].date);
          const dy = Number(decisionIso.slice(0, 4));
          if (dy >= startYear && dy <= endYear) {
            // Hindari duplikat jika sudah ada jadwal FOMC dalam rentang ±5 hari
            const nearExists = Array.from(fomcDateSet).some(existing => {
              const diffDays = Math.abs((new Date(existing) - new Date(decisionIso)) / 86400000);
              return diffDays <= 5;
            });
            if (!nearExists) fomcDateSet.add(decisionIso);
          }
        }
      }

      for (const fomcIso of Array.from(fomcDateSet).sort()) {
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
          source: 'Federal Reserve (DFEDTARU)'
        });
      }
    }

    allEvents.sort((a, b) => a.dateISO.localeCompare(b.dateISO));

    return res.status(200).json({
      ok: true,
      source: 'Federal Reserve (ALFRED/FRED) + Official BLS/FOMC Schedule',
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
