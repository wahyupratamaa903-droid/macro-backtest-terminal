// Endpoint Utama /api/history (Hanya bertugas menggabungkan provider & menyaring filter)
import { fetchTradingViewYear } from './_lib/tradingview.js';
import { fetchFxStreetYear } from './_lib/fxstreet.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');

  const startYear = Math.max(2008, parseInt(req.query.startYear || '2015', 10));
  const endYear = Math.min(2030, parseInt(req.query.endYear || '2020', 10));
  const indicator = (req.query.indicator || 'ALL').toString().toUpperCase();

  try {
    const years = [];
    for (let y = startYear; y <= endYear; y++) years.push(y);

    let usedSource = 'TradingView Economic Calendar API (Live & Historical Feed)';
    let rawEvents = [];

    try {
      const perYear = await Promise.all(years.map(y => fetchTradingViewYear(y)));
      rawEvents = perYear.flat();
    } catch (tvErr) {
      usedSource = 'FXStreet Economic Calendar API';
      const perYear = await Promise.all(years.map(y => fetchFxStreetYear(y)));
      rawEvents = perYear.flat();
    }

    const coreSet = new Set(['NFP', 'CPI', 'BUNGA']);
    let filtered = rawEvents.filter(ev => {
      if (indicator === 'ALL_HIGH') return ev.importance >= 1;
      if (indicator === 'ALL') return coreSet.has(ev.code);
      return ev.code === indicator;
    });

    // Deduplikasi berdasarkan tanggal & kode berita agar tidak ganda
    const seen = new Set();
    filtered = filtered.filter(ev => {
      const key = `${ev.dateISO}_${ev.code}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    filtered.sort((a, b) => `${a.dateISO} ${a.timeWIB}`.localeCompare(`${b.dateISO} ${b.timeWIB}`));

    return res.status(200).json({
      ok: true,
      source: usedSource,
      timezone: 'Asia/Jakarta (WIB / UTC+7)',
      startYear,
      endYear,
      indicator,
      count: filtered.length,
      events: filtered
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
