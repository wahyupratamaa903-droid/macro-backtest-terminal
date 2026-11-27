let latestTrades = [];
let chartInstance = null;
let candleSeries = null;
let activePriceLines = [];

function initInteractiveChart() {
  const container = document.getElementById('macroCandleChart');
  if (!container || typeof LightweightCharts === 'undefined') return;

  container.innerHTML = '';
  chartInstance = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: 360,
    layout: {
      background: { color: '#0d131f' },
      textColor: '#cbd5e1'
    },
    grid: {
      vertLines: { color: '#1b2538' },
      horzLines: { color: '#1b2538' }
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal
    },
    rightPriceScale: {
      borderColor: '#233044'
    },
    timeScale: {
      borderColor: '#233044',
      timeVisible: true,
      secondsVisible: false
    }
  });

  candleSeries = chartInstance.addCandlestickSeries({
    upColor: '#2ecc71',
    downColor: '#e74c3c',
    borderVisible: false,
    wickUpColor: '#2ecc71',
    wickDownColor: '#e74c3c'
  });

  window.addEventListener('resize', () => {
    if (chartInstance && container.clientWidth > 0) {
      chartInstance.applyOptions({ width: container.clientWidth });
    }
  });
}

function renderChartData(candles, trades) {
  if (!chartInstance) initInteractiveChart();
  if (!candleSeries || !candles || !candles.length) return;

  // Pastikan timestamp unik dan terurut menaik
  const uniqueMap = new Map();
  for (const c of candles) {
    uniqueMap.set(c.time, c);
  }
  const cleanCandles = Array.from(uniqueMap.values()).sort((a, b) => a.time - b.time);
  candleSeries.setData(cleanCandles);

  const minTime = cleanCandles[0].time;
  const maxTime = cleanCandles[cleanCandles.length - 1].time;

  // Buat marker rilis berita & titik entry langsung di atas chart
  const rawMarkers = [];
  for (const t of trades) {
    if (t.newsCandleTimeSec && t.newsCandleTimeSec >= minTime && t.newsCandleTimeSec <= maxTime) {
      const isBuy = t.effectiveBias === 'BUY';
      rawMarkers.push({
        time: t.newsCandleTimeSec,
        position: isBuy ? 'belowBar' : 'aboveBar',
        color: isBuy ? '#2ecc71' : '#e74c3c',
        shape: isBuy ? 'arrowUp' : 'arrowDown',
        text: `${t.code} (${t.effectiveBias})`
      });
    }
  }

  rawMarkers.sort((a, b) => a.time - b.time);
  candleSeries.setMarkers(rawMarkers);
  chartInstance.timeScale().fitContent();
}

function focusTradeOnChart(index) {
  const t = latestTrades[index];
  if (!t || !chartInstance || !candleSeries) return;

  // Hapus garis TP/SL/Entry sebelumnya
  for (const line of activePriceLines) {
    try { candleSeries.removePriceLine(line); } catch (_) {}
  }
  activePriceLines = [];

  if (t.entryPrice !== null) {
    activePriceLines.push(
      candleSeries.createPriceLine({
        price: t.entryPrice,
        color: '#3498db',
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: `ENTRY ${t.effectiveBias}`
      }),
      candleSeries.createPriceLine({
        price: t.tpPrice,
        color: '#2ecc71',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'TP'
      }),
      candleSeries.createPriceLine({
        price: t.slPrice,
        color: '#e74c3c',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'SL'
      })
    );
  }

  const centerSec = t.entryCandleTimeSec || t.newsCandleTimeSec;
  if (centerSec) {
    chartInstance.timeScale().setVisibleRange({
      from: centerSec - 18 * 4 * 3600,
      to: centerSec + 28 * 4 * 3600
    });
  }

  const infoEl = document.getElementById('chartFocusInfo');
  if (infoEl) {
    infoEl.textContent = `Fokus Chart: ${t.dateISO} ${t.timeWIB} WIB | ${t.code} (Prev: ${t.previous} -> Act: ${t.actual}) | Eksekusi: ${t.effectiveBias} @ ${t.entryPrice ?? '-'} | Hasil: ${t.outcome}`;
  }

  document.getElementById('chartSection')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function badgeRule(ruleApplied) {
  if (ruleApplied === 'OVERRIDE_2_OF_3') return '<span class="badge badge-warn">PANTANGAN 2/3 (KALAH)</span>';
  if (ruleApplied.includes('FALLBACK_PREV_MONTH')) return '<span class="badge badge-info">TETAP -> BULAN LALU</span>';
  if (ruleApplied.includes('2_OF_3')) return '<span class="badge badge-ok">MAYORITAS 2/3</span>';
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
    const outcomeClass = t.outcome === 'WIN' ? 'text-green' : t.outcome === 'LOSS' ? 'text-red' : 'text-muted';
    const pipsText = t.outcome === 'WIN' || t.outcome === 'LOSS' ? `${t.pipsResult > 0 ? '+' : ''}${t.pipsResult}` : '-';

    return `
      <tr class="clickable-row" data-idx="${idx}" title="Klik untuk melihat posisi news ini di chart">
        <td>${idx + 1}</td>
        <td><strong>${t.dateISO}</strong><br><small>${t.timeWIB || '-'} WIB</small></td>
        <td><span class="code-pill">${t.code}</span><br><small>Ke-${t.orderInMonth}/${t.totalInMonth}</small></td>
        <td>Prev: <strong>${t.previous ?? '-'}</strong><br>Fcst: <strong>${t.forecast ?? '-'}</strong><br>Act: <strong>${t.actual ?? '-'}</strong></td>
        <td>${t.newsDirection}<br><small>Mentah: ${t.rawGoldBias}</small></td>
        <td>${badgeRule(t.ruleApplied)}<br><small>${t.ruleDetail}</small></td>
        <td class="${biasClass}"><strong>${t.effectiveBias}</strong></td>
        <td>${t.pullbackCloseWIB}<br><small>${t.candleTF || ''}</small></td>
        <td>${t.entryPrice !== null ? t.entryPrice.toFixed(2) : '-'}</td>
        <td>${t.tpPrice !== null ? t.tpPrice.toFixed(2) : '-'}</td>
        <td>${t.slPrice !== null ? t.slPrice.toFixed(2) : '-'}</td>
        <td class="${outcomeClass}"><strong>${t.outcome}</strong><br><small>${pipsText} pips</small></td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.clickable-row').forEach(row => {
    row.addEventListener('click', () => {
      const idx = Number(row.getAttribute('data-idx'));
      focusTradeOnChart(idx);
    });
  });
}

async function runStrategyBacktest() {
  const startYear = document.getElementById('startYear').value;
  const endYear = document.getElementById('endYear').value;
  const indicator = document.getElementById('indicatorFilter').value;
  const compareMode = document.getElementById('compareMode').value;
  const tpPips = document.getElementById('tpPips').value;
  const slPips = document.getElementById('slPips').value;
  const maxWait = document.getElementById('maxWait').value;
  const initialTrend = document.getElementById('initialTrend').value;

  const btn = document.getElementById('btnRunBacktest');
  const statusEl = document.getElementById('statusBanner');

  btn.disabled = true;
  btn.textContent = 'Memuat Chart & Simulasi...';
  statusEl.textContent = 'Menarik kalender FXStreet + TradingView & menyelaraskan candle H4 XAUUSD...';

  try {
    const params = new URLSearchParams({
      startYear,
      endYear,
      indicator,
      compareMode,
      tpPips,
      slPips,
      maxWait,
      initialTrend
    });

    const resp = await fetch(`/api/xau-strategy?${params.toString()}`);
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || 'Gagal menjalankan simulasi');

    latestTrades = data.trades || [];
    renderSummary(data.summary);
    renderTable(latestTrades);
    renderChartData(data.chartCandles || [], latestTrades);

    const warnNote = data.hasDailyFallback
      ? ' ⚠️ Catatan: Tahun < 2020 memakai candle D1-Fallback karena feed H4 gratis tersedia mulai Sep 2019 (pilih 2020–2026 untuk 100% H4 presisi).'
      : ' ✅ 100% Candle H4 Terkalibrasi (Sesi NY Close WIB).';

    statusEl.textContent = `Selesai: ${data.summary.totalSignals} rilis berita (${startYear}–${endYear}) | Klik baris tabel mana pun untuk zoom ke chart.${warnNote}`;
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Jalankan Simulasi XAUUSD';
  }
}

function setupChartTabs() {
  const btnBacktestChart = document.getElementById('tabBacktestChart');
  const btnLiveTv = document.getElementById('tabLiveTvChart');
  const paneBacktest = document.getElementById('paneBacktestChart');
  const paneLiveTv = document.getElementById('paneLiveTvChart');

  if (!btnBacktestChart || !btnLiveTv) return;

  btnBacktestChart.addEventListener('click', () => {
    btnBacktestChart.classList.add('active');
    btnLiveTv.classList.remove('active');
    paneBacktest.style.display = 'block';
    paneLiveTv.style.display = 'none';
  });

  btnLiveTv.addEventListener('click', () => {
    btnLiveTv.classList.add('active');
    btnBacktestChart.classList.remove('active');
    paneBacktest.style.display = 'none';
    paneLiveTv.style.display = 'block';
  });
}

function exportStrategyCsv() {
  if (!latestTrades.length) return;
  const headers = [
    'NO', 'TANGGAL_ISO', 'JAM_WIB', 'INDIKATOR', 'URUTAN_BULAN',
    'SEBELUMNYA', 'RAMALAN', 'SEBENARNYA', 'STATUS_NEWS', 'SINYAL_MENTAH',
    'ATURAN_BULANAN', 'ARAH_EKSEKUSI', 'WAKTU_CLOSE_PULLBACK_H4',
    'ENTRY_PRICE', 'TP_PRICE', 'SL_PRICE', 'HASIL', 'NET_PIPS'
  ];

  const rows = latestTrades.map((t, i) => [
    i + 1, t.dateISO, t.timeWIB, t.code, `${t.orderInMonth}/${t.totalInMonth}`,
    t.previous, t.forecast, t.actual, t.newsDirection, t.rawGoldBias,
    t.ruleApplied, t.effectiveBias, t.pullbackCloseWIB,
    t.entryPrice ?? '', t.tpPrice ?? '', t.slPrice ?? '', t.outcome, t.pipsResult
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
  initInteractiveChart();
  setupChartTabs();
  document.getElementById('btnRunBacktest').addEventListener('click', runStrategyBacktest);
  document.getElementById('btnExportCsv').addEventListener('click', exportStrategyCsv);
  runStrategyBacktest();
});
