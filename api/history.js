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

    // Tarik TradingView (per 2 bulan) & FXStreet secara paralel untuk kelengkapan 100% NFP, CPI y/y, dan Fed Funds Rate
    const [tvSettled, fxsSettled] = await Promise.allSettled([
      Promise.all(years.map(y => fetchTradingViewYear(y))),
      Promise.all(years.map(y => fetchFxStreetYear(y)))
    ]);

    const tvEvents = tvSettled.status === 'fulfilled' ? tvSettled.value.flat() : [];
    const fxsEvents = fxsSettled.status === 'fulfilled' ? fxsSettled.value.flat() : [];

    // Gabungkan: utamakan TradingView, lengkapi jika ada yang kosong dari FXStreet
    const combined = [...tvEvents, ...fxsEvents];
    if (combined.length === 0) {
      throw new Error('Tidak ada data yang berhasil ditarik dari TradingView maupun FXStreet');
    }

    const coreSet = new Set(['NFP', 'CPI', 'BUNGA']);
    let filtered = combined.filter(ev => {
      if (indicator === 'ALL') return coreSet.has(ev.code);
      return ev.code === indicator;
    });

    // Deduplikasi berdasarkan (Tahun + Bulan + Kode Berita) agar tidak ganda antara TV dan FXStreet
    const seen = new Set();
    filtered = filtered.filter(ev => {
      const key = `${ev.year}-${String(ev.monthIndex).padStart(2, '0')}_${ev.code}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Urutkan rapi secara kronologis: Tahun -> Bulan (Januari s.d. Desember) -> Tanggal -> Jam WIB
    filtered.sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      if (a.monthIndex !== b.monthIndex) return a.monthIndex - b.monthIndex;
      if (a.day !== b.day) return a.day - b.day;
      return (a.timeWIB || '').localeCompare(b.timeWIB || '');
    });

    const usedSource = tvEvents.length > 0 && fxsEvents.length > 0
      ? 'TradingView + FXStreet Economic Calendar API'
      : tvEvents.length > 0
        ? 'TradingView Economic Calendar API'
        : 'FXStreet Economic Calendar API';

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
