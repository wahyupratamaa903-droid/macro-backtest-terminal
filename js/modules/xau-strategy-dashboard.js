let latestTrades = [];

function badgeRule(ruleApplied) {
  if (ruleApplied === 'OVERRIDE_2_OF_3') {
    return '<span class="badge badge-warn">PANTANGAN 2/3 (KALAH)</span>';
  }
  if (ruleApplied.includes('FALLBACK_PREV_MONTH')) {
    return '<span class="badge badge-info">TETAP -> BULAN LALU</span>';
  }
  if (ruleApplied.includes('2_OF_3')) {
    return '<span class="badge badge-ok">MAYORITAS 2/3</span>';
  }
  return '<span class="badge badge-neutral">SINYAL NORMAL</span>';
}

function renderSummary(summary) {
  document.getElementById('kpiTotalSignals').textContent = summary.totalSignals;
  document.getElementById('kpiWinRate').textContent = `${summary.winRate}%`;
  document.getElementById('kpiWinLoss').textContent = `${summary.wins}W / ${summary.losses}L`;

  const netEl = document.getElementById('kpiNetPips');
  netEl.textContent = `${summary.netPips >= 0 ? '+' : ''}${summary.netPips} pips`;
  netEl.className = `kpi-value ${summary.netPips >= 0 ? 'text-green' : 'text-red'}`;

  document.getElementById('kpiOverrides').textContent = summary.overrideCount;
  document.getElementById('kpiFallbacks').textContent = summary.fallbackCount;
}

function renderTable(trades) {
  const tbody = document.getElementById('strategyTableBody');
  if (!trades.length) {
    tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:24px;">Tidak ada data untuk filter ini.</td></tr>';
    return;
  }

  tbody.innerHTML = trades.map((t, idx) => {
    const biasClass = t.effectiveBias === 'BUY' ? 'text-green' : 'text-red';
    const outcomeClass = t.outcome === 'WIN'
      ? 'text-green'
      : t.outcome === 'LOSS'
        ? 'text-red'
        : 'text-muted';

    const pipsText = t.outcome === 'WIN' || t.outcome === 'LOSS'
      ? `${t.pipsResult > 0 ? '+' : ''}${t.pipsResult}`
      : '-';

    return `
      <tr>
        <td>${idx + 1}</td>
        <td><strong>${t.dateISO}</strong><br><small>${t.timeWIB || '-'} WIB</small></td>
        <td><span class="code-pill">${t.code}</span><br><small>Ke-${t.orderInMonth}/${t.totalInMonth}</small></td>
        <td>Prev: <strong>${t.previous ?? '-'}</strong><br>Act: <strong>${t.actual ?? '-'}</strong></td>
        <td>${t.newsDirection}<br><small>Mentah: ${t.rawGoldBias}</small></td>
        <td>${badgeRule(t.ruleApplied)}<br><small title="${t.ruleDetail}">${t.ruleDetail}</small></td>
        <td class="${biasClass}"><strong>${t.effectiveBias}</strong></td>
        <td>${t.pullbackCloseWIB}<br><small>${t.candleTF || ''}</small></td>
        <td>${t.entryPrice !== null ? t.entryPrice.toFixed(2) : '-'}</td>
        <td>${t.tpPrice !== null ? t.tpPrice.toFixed(2) : '-'}</td>
        <td>${t.slPrice !== null ? t.slPrice.toFixed(2) : '-'}</td>
        <td class="${outcomeClass}"><strong>${t.outcome}</strong><br><small>${pipsText} pips</small></td>
      </tr>
    `;
  }).join('');
}

async function runStrategyBacktest() {
  const startYear = document.getElementById('startYear').value;
  const endYear = document.getElementById('endYear').value;
  const indicator = document.getElementById('indicatorFilter').value;
  const tpPips = document.getElementById('tpPips').value;
  const slPips = document.getElementById('slPips').value;
  const initialTrend = document.getElementById('initialTrend').value;

  const btn = document.getElementById('btnRunBacktest');
  const statusEl = document.getElementById('statusBanner');

  btn.disabled = true;
  btn.textContent = 'Memproses Data & Candle H4...';
  statusEl.textContent = 'Menarik kalender FXStreet + TradingView & mencocokkan penutupan candle pullback H4...';

  try {
    const params = new URLSearchParams({
      startYear,
      endYear,
      indicator,
      tpPips,
      slPips,
      initialTrend
    });

    const resp = await fetch(`/api/xau-strategy?${params.toString()}`);
    const data = await resp.json();

    if (!data.ok) throw new Error(data.error || 'Gagal menjalankan simulasi');

    latestTrades = data.trades || [];
    renderSummary(data.summary);
    renderTable(latestTrades);
    statusEl.textContent = `Selesai: ${data.summary.totalSignals} rilis berita dianalisis (${startYear}–${endYear}) | Zona Waktu: ${data.timezone}`;
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Jalankan Simulasi XAUUSD';
  }
}

function exportStrategyCsv() {
  if (!latestTrades.length) return;
  const headers = [
    'NO', 'TANGGAL_ISO', 'JAM_WIB', 'INDIKATOR', 'URUTAN_BULAN',
    'SEBELUMNYA', 'SEBENARNYA', 'STATUS_NEWS', 'SINYAL_MENTAH',
    'ATURAN_BULANAN', 'ARAH_EKSEKUSI', 'WAKTU_CLOSE_PULLBACK_H4',
    'ENTRY_PRICE', 'TP_PRICE', 'SL_PRICE', 'HASIL', 'NET_PIPS'
  ];

  const rows = latestTrades.map((t, i) => [
    i + 1,
    t.dateISO,
    t.timeWIB,
    t.code,
    `${t.orderInMonth}/${t.totalInMonth}`,
    t.previous,
    t.actual,
    t.newsDirection,
    t.rawGoldBias,
    t.ruleApplied,
    t.effectiveBias,
    t.pullbackCloseWIB,
    t.entryPrice ?? '',
    t.tpPrice ?? '',
    t.slPrice ?? '',
    t.outcome,
    t.pipsResult
  ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));

  const csvContent = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `xauusd-macro-pullback-backtest.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnRunBacktest').addEventListener('click', runStrategyBacktest);
  document.getElementById('btnExportCsv').addEventListener('click', exportStrategyCsv);
  runStrategyBacktest();
});
