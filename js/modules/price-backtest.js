import { STATE, onEvent } from '../core/state.js';
import { esc, toast } from '../core/utils.js';
import { downloadCSV } from '../core/csv.js';

function findCandleForDate(candlesByDate, isoDate) {
  if (candlesByDate[isoDate]) return candlesByDate[isoDate];
  const base = new Date(isoDate + 'T00:00:00Z');
  for (let offset = 1; offset <= 3; offset++) {
    const d = new Date(base.getTime() + offset * 86400000).toISOString().slice(0, 10);
    if (candlesByDate[d]) return candlesByDate[d];
  }
  return null;
}

export async function runPriceBacktest() {
  const pairSel = document.getElementById('bt-pair-select');
  const customInp = document.getElementById('bt-custom-pair');
  const pair = (customInp?.value.trim() || pairSel?.value || 'XAU/USD').toUpperCase();
  STATE.backtestPair = pair;

  const events = STATE.filteredEvents;
  if (!events.length) {
    toast('⚠️ Data news kosong. Muat data di tab Arsip News terlebih dahulu.', 'warning');
    return;
  }

  const btn = document.getElementById('btn-run-backtest');
  const statusEl = document.getElementById('bt-status-text');
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = `Mengunduh histori OHLC harian ${pair} (${STATE.startYear}–${STATE.endYear}) dari Yahoo Finance...`;

  try {
    const params = new URLSearchParams({
      pair,
      startYear: String(STATE.startYear),
      endYear: String(STATE.endYear)
    });
    const res = await fetch(`/api/backtest-prices?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const priceData = await res.json();
    if (!priceData.ok) throw new Error(priceData.error || 'Gagal mengambil harga historis');

    const { candlesByDate, pipSize, decimals, source } = priceData;
    const results = [];

    for (const ev of events) {
      const candle = findCandleForDate(candlesByDate, ev.dateISO);
      if (!candle) {
        results.push({ ...ev, pair, matchedDate: null, open: null, high: null, low: null, close: null, netPips: null, rangePips: null, direction: 'NO DATA' });
        continue;
      }

      const netPips = Math.round((candle.c - candle.o) / pipSize);
      const rangePips = Math.round((candle.h - candle.l) / pipSize);
      const direction = netPips > 3 ? 'NAIK (BULL)' : netPips < -3 ? 'TURUN (BEAR)' : 'SIDEWAYS';

      results.push({
        ...ev, pair, matchedDate: candle.date,
        open: candle.o.toFixed(decimals),
        high: candle.h.toFixed(decimals),
        low: candle.l.toFixed(decimals),
        close: candle.c.toFixed(decimals),
        netPips, rangePips, direction
      });
    }

    STATE.backtestResults = results;
    if (statusEl) statusEl.textContent = `Sumber Harga: ${source} • 1 Pip = ${pipSize}`;
    renderBacktestUI();
    toast(`✅ Backtest ${pair} selesai (${results.filter(r => r.netPips !== null).length} tanggal cocok)!`, 'success');
  } catch (err) {
    if (statusEl) statusEl.textContent = `Error: ${err.message}`;
    toast(`⚠️ Gagal menjalankan backtest: ${err.message}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

export function renderBacktestUI() {
  const statsWrap = document.getElementById('bt-stats-cards');
  const tbody = document.getElementById('bt-tbody');
  if (!tbody || !statsWrap) return;

  const valid = STATE.backtestResults.filter(r => r.netPips !== null);
  if (!valid.length) {
    statsWrap.innerHTML = '';
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-slate-400">Pilih pair (misal <b>XAU/USD</b> atau <b>EUR/USD</b>) lalu klik <b>Jalankan Backtest Pips</b>.</td></tr>';
    return;
  }

  const bullCount = valid.filter(r => r.netPips > 3).length;
  const bearCount = valid.filter(r => r.netPips < -3).length;
  const avgNet = Math.round(valid.reduce((s, r) => s + r.netPips, 0) / valid.length);
  const avgRange = Math.round(valid.reduce((s, r) => s + r.rangePips, 0) / valid.length);
  const maxBull = Math.max(...valid.map(r => r.netPips));
  const maxBear = Math.min(...valid.map(r => r.netPips));

  statsWrap.innerHTML = `
    <div class="glass-card p-3 text-center">
      <p class="text-[8px] text-slate-400 uppercase">Total Kejadian</p>
      <p class="text-sm font-black text-sky-400">${valid.length} Event</p>
      <p class="text-[8px] text-slate-500">${esc(STATE.backtestPair)}</p>
    </div>
    <div class="glass-card p-3 text-center">
      <p class="text-[8px] text-slate-400 uppercase">Naik vs Turun</p>
      <p class="text-xs font-black text-emerald-400">${((bullCount / valid.length) * 100).toFixed(0)}% Naik <span class="text-red-400">/ ${((bearCount / valid.length) * 100).toFixed(0)}% Turun</span></p>
      <p class="text-[8px] text-slate-500">${bullCount} Bull • ${bearCount} Bear</p>
    </div>
    <div class="glass-card p-3 text-center">
      <p class="text-[8px] text-slate-400 uppercase">Rata-rata Range (H-L)</p>
      <p class="text-sm font-black text-amber-400">${avgRange} Pips</p>
      <p class="text-[8px] text-slate-500">Volatilitas Hari Rilis</p>
    </div>
    <div class="glass-card p-3 text-center">
      <p class="text-[8px] text-slate-400 uppercase">Rekor Lonjakan</p>
      <p class="text-xs font-black text-emerald-400">+${maxBull}p <span class="text-red-400">/ ${maxBear}p</span></p>
      <p class="text-[8px] text-slate-500">Avg Net: ${avgNet > 0 ? '+' : ''}${avgNet}p</p>
    </div>
  `;

  tbody.innerHTML = STATE.backtestResults.map(r => {
    const fcst = STATE.forecasts[r.id] ?? r.forecast ?? '-';
    const hasPx = r.netPips !== null;
    const up = hasPx && r.netPips >= 0;
    const netStr = hasPx ? `${r.netPips > 0 ? '+' : ''}${r.netPips} pips` : 'Libur/N/A';
    const rngStr = hasPx ? `${r.rangePips} pips` : '-';

    return `
      <tr>
        <td class="font-mono text-slate-300">${esc(r.dateISO)}</td>
        <td><span class="font-bold text-sky-400">${esc(r.code)}</span></td>
        <td class="font-mono text-[10px] text-slate-300">Prev: ${esc(r.previous)} | Fcst: ${esc(fcst)} | <b>Act: ${esc(r.actual)}</b></td>
        <td class="font-mono text-slate-400 text-right">${hasPx ? esc(r.open) : '-'}</td>
        <td class="font-mono text-slate-200 text-right">${hasPx ? esc(r.close) : '-'}</td>
        <td class="font-mono font-bold text-right ${!hasPx ? 'text-slate-500' : up ? 'text-emerald-400' : 'text-red-400'}">${netStr}</td>
        <td class="font-mono font-bold text-amber-400 text-right">${rngStr}</td>
      </tr>
    `;
  }).join('');
}

export function initPriceBacktest() {
  document.getElementById('btn-run-backtest')?.addEventListener('click', runPriceBacktest);

  document.getElementById('btn-export-backtest-csv')?.addEventListener('click', () => {
    if (!STATE.backtestResults.length) { toast('⚠️ Jalankan backtest dulu sebelum ekspor CSV', 'warning'); return; }
    const headers = [
      'TANGGAL', 'BULAN', 'TAHUN', 'INDIKATOR', 'SEBELUMNYA', 'RAMALAN', 'SEBENARNYA',
      'PAIR', 'OPEN', 'HIGH', 'LOW', 'CLOSE', 'NET_PIPS_OPEN_CLOSE', 'RANGE_PIPS_HIGH_LOW', 'ARAH_HARGA'
    ];
    const rows = STATE.backtestResults.map(r => [
      r.dateISO, r.monthName, r.year, r.code, r.previous,
      STATE.forecasts[r.id] ?? r.forecast ?? '', r.actual,
      r.pair, r.open ?? '', r.high ?? '', r.low ?? '', r.close ?? '',
      r.netPips ?? '', r.rangePips ?? '', r.direction
    ]);
    downloadCSV(`backtest-${STATE.backtestPair.replace('/', '')}-${STATE.startYear}-${STATE.endYear}.csv`, headers, rows);
    toast('📥 Hasil Backtest Pips berhasil diekspor ke CSV!', 'success');
  });

  onEvent('archive:updated', () => {
    if (STATE.backtestResults.length > 0) runPriceBacktest();
  });
}
