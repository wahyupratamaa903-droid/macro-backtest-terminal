import { STATE, saveForecastValue, saveImportedEvents, emitEvent } from '../core/state.js';
import { BULAN_LIST, esc, toast } from '../core/utils.js';
import { parseImportedCSV, downloadCSV } from '../core/csv.js';

function getBadgeClass(code) {
  if (code === 'NFP') return 'tag-nfp';
  if (code === 'CPI') return 'tag-cpi';
  if (code === 'BUNGA') return 'tag-bunga';
  return 'tag-other';
}

export function applyNewsFilters() {
  const mergedMap = new Map();
  STATE.rawEvents.forEach(ev => mergedMap.set(ev.id, { ...ev }));
  STATE.importedEvents.forEach(ev => {
    if (ev.year >= STATE.startYear && ev.year <= STATE.endYear) {
      if (STATE.indicator === 'ALL' || ev.code === STATE.indicator) {
        mergedMap.set(ev.id, { ...ev });
      }
    }
  });

  let list = Array.from(mergedMap.values());
  if (STATE.monthFilter > 0) list = list.filter(ev => ev.monthIndex === STATE.monthFilter);

  if (STATE.directionFilter === 'HIGHER') {
    list = list.filter(ev => ev.actualNum != null && ev.previousNum != null && ev.actualNum > ev.previousNum);
  } else if (STATE.directionFilter === 'LOWER') {
    list = list.filter(ev => ev.actualNum != null && ev.previousNum != null && ev.actualNum < ev.previousNum);
  } else if (STATE.directionFilter === 'SAME') {
    list = list.filter(ev => ev.actualNum != null && ev.previousNum != null && ev.actualNum === ev.previousNum);
  }

  list.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  STATE.filteredEvents = list;
  renderArchiveTable();
  emitEvent('archive:updated', list);
}

export function renderArchiveTable() {
  const tbody = document.getElementById('archive-tbody');
  const countEl = document.getElementById('archive-count');
  if (!tbody) return;

  const list = STATE.filteredEvents;
  if (countEl) countEl.textContent = `${list.length} Rilis Berita (${STATE.startYear}–${STATE.endYear})`;

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-6 text-slate-400">Tidak ada data pada rentang filter ini. Klik <b>Tarik Data Historis</b>.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(ev => {
    const fcstVal = STATE.forecasts[ev.id] ?? ev.forecast ?? '';
    const diff = (ev.actualNum != null && ev.previousNum != null) ? (ev.actualNum - ev.previousNum) : null;
    let diffHtml = '<span class="text-slate-500">0</span>';
    let actColor = 'text-slate-100';
    if (diff !== null) {
      if (diff > 0) {
        diffHtml = `<span class="text-emerald-400 font-bold">▲ +${ev.unit === 'K' ? Math.round(diff) + 'K' : diff.toFixed(2) + '%'}</span>`;
        actColor = 'text-emerald-400';
      } else if (diff < 0) {
        diffHtml = `<span class="text-red-400 font-bold">▼ ${ev.unit === 'K' ? Math.round(diff) + 'K' : diff.toFixed(2) + '%'}</span>`;
        actColor = 'text-red-400';
      } else {
        diffHtml = `<span class="text-amber-400 font-bold">= Tetap</span>`;
        actColor = 'text-amber-400';
      }
    }

    return `
      <tr>
        <td class="font-mono text-slate-400">${ev.year}</td>
        <td class="font-semibold text-slate-200">${esc(ev.monthName)}</td>
        <td class="font-mono text-slate-300 text-center">${ev.day}</td>
        <td><span class="px-2 py-0.5 rounded text-[9px] font-bold ${getBadgeClass(ev.code)}">${esc(ev.code)}</span> <span class="text-slate-300 ml-1">${esc(ev.event)}</span></td>
        <td class="font-mono text-slate-300 text-right">${esc(ev.previous)}</td>
        <td class="text-right"><input type="text" data-fcst-id="${esc(ev.id)}" value="${esc(fcstVal)}" placeholder="Isi..." class="fcst-input"></td>
        <td class="font-mono font-bold ${actColor} text-right">${esc(ev.actual)}</td>
        <td class="font-mono text-[10px]">${diffHtml}</td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.fcst-input').forEach(inp => {
    inp.addEventListener('change', () => {
      saveForecastValue(inp.dataset.fcstId, inp.value);
      toast('💾 Nilai Ramalan tersimpan!', 'success');
    });
  });
}

export async function fetchHistoricalNews() {
  const btn = document.getElementById('btn-fetch-news');
  const statusEl = document.getElementById('archive-source-status');
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = 'Menarik arsip resmi dari Federal Reserve (FRED)...';

  try {
    const params = new URLSearchParams({
      startYear: String(STATE.startYear),
      endYear: String(STATE.endYear),
      indicator: STATE.indicator,
      month: '0'
    });

    const res = await fetch(`/api/history?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Gagal menarik data FRED');

    STATE.rawEvents = data.events || [];
    if (statusEl) statusEl.textContent = `Sumber Terverifikasi: ${data.source}`;
    applyNewsFilters();
    toast(`✅ Berhasil memuat ${STATE.rawEvents.length} data berita (${STATE.startYear}–${STATE.endYear})!`, 'success');
  } catch (err) {
    if (statusEl) statusEl.textContent = `Gagal terhubung ke server: ${err.message}`;
    toast('⚠️ Gagal menarik data historis, periksa koneksi.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

export function initNewsArchive() {
  const selStart = document.getElementById('flt-start-year');
  const selEnd = document.getElementById('flt-end-year');
  const selInd = document.getElementById('flt-indicator');
  const selMonth = document.getElementById('flt-month');
  const selDir = document.getElementById('flt-direction');

  if (selStart && selEnd) {
    let optsStart = '', optsEnd = '';
    for (let y = 2010; y <= 2026; y++) {
      optsStart += `<option value="${y}" ${y === STATE.startYear ? 'selected' : ''}>${y}</option>`;
      optsEnd += `<option value="${y}" ${y === STATE.endYear ? 'selected' : ''}>${y}</option>`;
    }
    selStart.innerHTML = optsStart;
    selEnd.innerHTML = optsEnd;
  }

  if (selMonth) {
    selMonth.innerHTML = '<option value="0">Semua Bulan</option>' +
      BULAN_LIST.map((b, i) => `<option value="${i + 1}">${b}</option>`).join('');
  }

  document.getElementById('btn-fetch-news')?.addEventListener('click', () => {
    STATE.startYear = parseInt(selStart.value, 10);
    STATE.endYear = parseInt(selEnd.value, 10);
    if (STATE.endYear < STATE.startYear) { STATE.endYear = STATE.startYear; selEnd.value = String(STATE.endYear); }
    STATE.indicator = selInd.value;
    fetchHistoricalNews();
  });

  document.querySelectorAll('[data-year-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-year-preset]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const [y1, y2] = btn.dataset.yearPreset.split('-').map(Number);
      STATE.startYear = y1; STATE.endYear = y2;
      if (selStart) selStart.value = String(y1);
      if (selEnd) selEnd.value = String(y2);
      fetchHistoricalNews();
    });
  });

  selMonth?.addEventListener('change', () => { STATE.monthFilter = parseInt(selMonth.value, 10); applyNewsFilters(); });
  selDir?.addEventListener('change', () => { STATE.directionFilter = selDir.value; applyNewsFilters(); });

  document.getElementById('btn-export-news-csv')?.addEventListener('click', () => {
    if (!STATE.filteredEvents.length) { toast('⚠️ Tidak ada data untuk diekspor', 'warning'); return; }
    const headers = ['TAHUN', 'BULAN', 'TANGGAL', 'TANGGAL_ISO', 'DATA', 'SEBELUMNYA', 'RAMALAN', 'SEBENARNYA', 'SUMBER'];
    const rows = STATE.filteredEvents.map(ev => [
      ev.year, ev.monthName, ev.day, ev.dateISO, ev.code, ev.previous,
      STATE.forecasts[ev.id] ?? ev.forecast ?? '', ev.actual, ev.source
    ]);
    downloadCSV(`arsip-news-usd-${STATE.startYear}-${STATE.endYear}.csv`, headers, rows);
    toast('📥 File CSV Arsip News berhasil diunduh!', 'success');
  });

  const fileInput = document.getElementById('input-import-csv');
  document.getElementById('btn-import-news-csv')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseImportedCSV(text, STATE.startYear);
    if (!parsed.length) { toast('⚠️ Format CSV tidak dikenali atau kosong', 'error'); return; }
    parsed.forEach(item => { if (item.forecast) saveForecastValue(item.id, item.forecast); });
    STATE.importedEvents = [...STATE.importedEvents, ...parsed];
    saveImportedEvents();
    applyNewsFilters();
    toast(`✅ ${parsed.length} baris dari CSV berhasil diimpor!`, 'success');
    fileInput.value = '';
  });

  fetchHistoricalNews();
}
