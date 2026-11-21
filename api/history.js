const NAMA_BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

const EN_MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
};

function fmtISO(d) {
  return d.toISOString().slice(0, 10);
}

function addDaysISO(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return fmtISO(d);
}

// Aturan cadangan resmi BLS jika halaman kalender HTML tidak merespons
function getBlsNfpFallback(year, month1) {
  const d = new Date(Date.UTC(year, month1 - 1, 1));
  const diff = (5 - d.getUTCDay() + 7) % 7;
  const firstFri = new Date(Date.UTC(year, month1 - 1, 1 + diff));
  const dayNum = firstFri.getUTCDate();

  // Jika 1 Jan jatuh Jumat (day=1) atau Kamis (day=2), BLS mengundur rilis ke Jumat ke-2
  if (month1 === 1 && (dayNum === 1 || dayNum === 2)) {
    firstFri.setUTCDate(dayNum + 7);
  }
  // Jika 4 Juli jatuh Sabtu (libur Jumat 3 Juli) atau Jumat (libur 4 Juli), maju ke Kamis
  if (month1 === 7 && (dayNum === 3 || dayNum === 4)) {
    firstFri.setUTCDate(dayNum - 1);
  }
  return fmtISO(firstFri);
}

function getBlsCpiFallback(year, month1) {
  const d = new Date(Date.UTC(year, month1 - 1, 13));
  const dow = d.getUTCDay();
  if (dow === 0) d.setUTCDate(15); // Minggu -> Selasa
  else if (dow === 1) d.setUTCDate(14); // Senin -> Selasa
  else if (dow === 5) d.setUTCDate(12); // Jumat -> Kamis
  else if (dow === 6) d.setUTCDate(11); // Sabtu -> Kamis
  return fmtISO(d);
}

// 1. Tarik tanggal rilis resmi per tahun dari Kalender FRED (rid=50 NFP, rid=10 CPI, rid=9 Retail)
async function fetchFredReleaseCalendar(rid, year) {
  const byMonth = {};
  try {
    const url = `https://fred.stlouisfed.org/releases/calendar?rid=${rid}&y=${year}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (!res.ok) return byMonth;
    const html = await res.text();
    const plain = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    // Cocokkan format ISO YYYY-MM-DD
    const isoRe = new RegExp(`\\b(${year})-(\\d{2})-(\\d{2})\\b`, 'g');
    let m;
    while ((m = isoRe.exec(plain)) !== null) {
      const mo = parseInt(m[2], 10);
      if (mo >= 1 && mo <= 12 && !byMonth[mo]) {
        byMonth[mo] = `${m[1]}-${m[2]}-${m[3]}`;
      }
    }

    // Cocokkan format teks Inggris: "January 9, 2015"
    const txtRe = new RegExp(`\\b(January|February|March|April|May|June|July|August|September|October|November|December)\\s+(\\d{1,2}),\\s+(${year})\\b`, 'gi');
    while ((m = txtRe.exec(plain)) !== null) {
      const mo = EN_MONTHS[m[1].toLowerCase()];
      const dy = String(parseInt(m[2], 10)).padStart(2, '0');
      if (mo && !byMonth[mo]) {
        byMonth[mo] = `${year}-${String(mo).padStart(2, '0')}-${dy}`;
      }
    }
  } catch (e) {}
  return byMonth;
}

// 2. Tarik tanggal keputusan FOMC resmi dari Federal Reserve
async function fetchOfficialFomcDates(year) {
  const dates = [];
  const urls = year <= 2020
    ? [`https://www.federalreserve.gov/monetarypolicy/fomchistorical${year}.htm`]
    : ['https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      if (!res.ok) continue;
      const html = await res.text();
      const plain = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

      // Pola pertemuan 2 hari: "January 27-28" atau lintas bulan "April 30-May 1"
      const sameMonthRe = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\s*[-–]\s*(\d{1,2})\b/gi;
      const crossMonthRe = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s*[-–]\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\b/gi;

      // Untuk fomccalendars.htm yang memuat banyak tahun, batasi blok teks di sekitar tahun target
      let scopeText = plain;
      if (url.includes('fomccalendars')) {
        const idx = plain.indexOf(`${year} FOMC Meetings`);
        if (idx !== -1) scopeText = plain.slice(idx, idx + 3500);
      }

      const found = new Set();
      let m;
      while ((m = sameMonthRe.exec(scopeText)) !== null) {
        const mo = EN_MONTHS[m[1].toLowerCase()];
        const d2 = parseInt(m[3], 10);
        if (mo && d2 >= 1 && d2 <= 31) {
          found.add(`${year}-${String(mo).padStart(2, '0')}-${String(d2).padStart(2, '0')}`);
        }
      }
      while ((m = crossMonthRe.exec(scopeText)) !== null) {
        const mo2 = EN_MONTHS[m[2].toLowerCase()];
        const d2 = parseInt(m[3], 10);
        if (mo2 && d2 >= 1 && d2 <= 31) {
          found.add(`${year}-${String(mo2).padStart(2, '0')}-${String(d2).padStart(2, '0')}`);
        }
      }

      if (found.size >= 6) {
        return Array.from(found).sort();
      }
    } catch (e) {}
  }

  // Cadangan 8 jadwal FOMC tahunan standar jika federalreserve.gov lambat
  const stdDays = [[1, 28], [3, 18], [4, 29], [6, 17], [7, 29], [9, 17], [10, 28], [12, 16]];
  return stdDays.map(([mo, dy]) => {
    const d = new Date(Date.UTC(year, mo - 1, dy));
    if (d.getUTCDay() === 0) d.setUTCDate(dy + 1);
    if (d.getUTCDay() === 6) d.setUTCDate(dy - 1);
    return fmtISO(d);
  });
}

// 3. Tarik data seri FRED (plus vintage ALFRED untuk angka rilis awal yang tidak terdistorsi revisi)
async function fetchFredSeries(seriesId) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
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

async function fetchAlfredVintageMap(seriesId, vintageDates) {
  if (!vintageDates.length) return null;
  try {
    const url = `https://alfred.stlouisfed.org/graph/alfredgraph.csv?id=${encodeURIComponent(seriesId)}&vintage_date=${vintageDates.join(',')}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
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

    // Tarik seri FRED + Kalender Rilis Resmi secara paralel
    const [payems, cpi, rateRows, unrate, retail, calNfpArr, calCpiArr, calRetailArr, fomcArr] = await Promise.all([
      needed.has('NFP') ? fetchFredSeries('PAYEMS') : Promise.resolve(null),
      needed.has('CPI') ? fetchFredSeries('CPIAUCSL') : Promise.resolve(null),
      needed.has('BUNGA') ? fetchFredSeries('DFEDTARU') : Promise.resolve(null),
      needed.has('UNRATE') ? fetchFredSeries('UNRATE') : Promise.resolve(null),
      needed.has('RETAIL') ? fetchFredSeries('RSAFS') : Promise.resolve(null),
      (needed.has('NFP') || needed.has('UNRATE')) ? Promise.all(years.map(y => fetchFredReleaseCalendar(50, y).then(m => [y, m]))) : Promise.resolve([]),
      needed.has('CPI') ? Promise.all(years.map(y => fetchFredReleaseCalendar(10, y).then(m => [y, m]))) : Promise.resolve([]),
      needed.has('RETAIL') ? Promise.all(years.map(y => fetchFredReleaseCalendar(9, y).then(m => [y, m]))) : Promise.resolve([]),
      needed.has('BUNGA') ? Promise.all(years.map(y => fetchOfficialFomcDates(y))) : Promise.resolve([])
    ]);

    const calNfp = Object.fromEntries(calNfpArr);
    const calCpi = Object.fromEntries(calCpiArr);
    const calRetail = Object.fromEntries(calRetailArr);

    // Ambil angka initial release ALFRED khusus NFP agar persis seperti angka saat rilis (tidak terdistorsi revisi bertahun-tahun)
    let alfredNfp = null;
    if (payems) {
      const targetVintages = [];
      for (const y of years) {
        for (let mo = 1; mo <= 12; mo++) {
          const relIso = calNfp[y]?.[mo] || getBlsNfpFallback(y, mo);
          targetVintages.push(addDaysISO(relIso, 3));
        }
      }
      // Ambil per kelompok 24 tanggal agar URL tetap ringkas
      alfredNfp = {};
      for (let i = 0; i < targetVintages.length; i += 24) {
        const chunk = await fetchAlfredVintageMap('PAYEMS', targetVintages.slice(i, i + 24));
        if (chunk) Object.assign(alfredNfp, chunk);
      }
    }

    const allEvents = [];

    function processMonthlySeries(rows, code, label, unit, calMap, fallbackFn, mode) {
      if (!rows) return;
      const byObsDate = Object.fromEntries(rows.map(r => [r.date, r.val]));

      for (let i = 0; i < rows.length; i++) {
        const [obsY, obsM] = rows[i].date.split('-').map(Number);
        let relY = obsY;
        let relM = obsM + 1;
        if (relM > 12) { relY += 1; relM = 1; }
        if (relY < startYear || relY > endYear) continue;

        const relIso = calMap[relY]?.[relM] || fallbackFn(relY, relM);
        const vintageIso = addDaysISO(relIso, 3);

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
          source: code === 'NFP' ? 'BLS / ALFRED Initial Release' : 'BLS / FRED Release Calendar'
        });
      }
    }

    processMonthlySeries(payems, 'NFP', 'NFP (Non-Farm Payroll)', 'K', calNfp, getBlsNfpFallback, 'NFP_INITIAL');
    processMonthlySeries(cpi, 'CPI', 'CPI YoY (Inflasi AS)', '%', calCpi, getBlsCpiFallback, 'YOY_PCT');
    processMonthlySeries(unrate, 'UNRATE', 'Tingkat Pengangguran AS', '%', calNfp, getBlsNfpFallback, 'DIRECT');
    processMonthlySeries(retail, 'RETAIL', 'Retail Sales MoM AS', '%', calRetail, getBlsCpiFallback, 'MOM_PCT');

    // Proses Suku Bunga FOMC berdasarkan tanggal rapat resmi Federal Reserve
    if (rateRows && fomcArr.length) {
      const rateByDate = Object.fromEntries(rateRows.map(r => [r.date, r.val]));
      const getRateAt = (iso) => {
        for (let back = 0; back <= 7; back++) {
          const check = addDaysISO(iso, -back);
          if (rateByDate[check] != null) return rateByDate[check];
        }
        return null;
      };

      for (const yearDates of fomcArr) {
        for (const fomcIso of yearDates) {
          const prevRate = getRateAt(addDaysISO(fomcIso, -1));
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
            event: 'Suku Bunga The Fed (FOMC)',
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
