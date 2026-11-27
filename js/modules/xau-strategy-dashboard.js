let latestTrades = [];
let loadedCandles = [];
let chartInstance = null;
let candleSeries = null;
let positionBoxPrimitive = null;
let activePriceLines = [];

// Kotak Posisi Long/Short ala TradingView (TP Hijau & SL Merah)
class TradingViewPositionBox {
  constructor() {
    this._box = null;
    this._series = null;
    this._chart = null;
    this._requestUpdate = null;
  }

  attached({ chart, series, requestUpdate }) {
    this._chart = chart;
    this._series = series;
    this._requestUpdate = requestUpdate;
  }

  detached() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }

  setBox(boxData) {
    this._box = boxData;
    if (this._requestUpdate) this._requestUpdate();
  }

  paneViews() {
    return [
      {
        zOrder: () => 'bottom',
        renderer: () => ({
          draw: (target) => {
            if (!this._box || !this._series || !this._chart) return;
            target.useBitmapCoordinateSpace((scope) => {
              const ctx = scope.context;
              const hRatio = scope.horizontalPixelRatio;
              const vRatio = scope.verticalPixelRatio;
              const timeScale = this._chart.timeScale();

              const x1Raw = timeScale.timeToCoordinate(this._box.startTime);
              const x2Raw = timeScale.timeToCoordinate(this._box.endTime);
              const yEntryRaw = this._series.priceToCoordinate(this._box.entry);
              const yTpRaw = this._series.priceToCoordinate(this._box.tp);
              const ySlRaw = this._series.priceToCoordinate(this._box.sl);

              if (yEntryRaw === null || yTpRaw === null || ySlRaw === null) return;

              const x1 = x1Raw !== null ? x1Raw * hRatio : 24 * hRatio;
              const minBoxWidth = 85 * hRatio;
              const x2 = x2Raw !== null
                ? Math.max(x1 + minBoxWidth, x2Raw * hRatio)
                : x1 + 150 * hRatio;
              const boxWidth = x2 - x1;

              const yEntry = yEntryRaw * vRatio;
              const yTp = yTpRaw * vRatio;
              const ySl = ySlRaw * vRatio;

              ctx.save();

              // 1. KOTAK HIJAU = ZONA TAKE PROFIT (TP)
              const tpTop = Math.min(yEntry, yTp);
              const tpHeight = Math.max(6 * vRatio, Math.abs(yTp - yEntry));
              ctx.fillStyle = 'rgba(46, 204, 113, 0.28)';
              ctx.fillRect(x1, tpTop, boxWidth, tpHeight);
              ctx.strokeStyle = '#2ecc71';
              ctx.lineWidth = 1.5 * hRatio;
              ctx.strokeRect(x1, tpTop, boxWidth, tpHeight);

              // 2. KOTAK MERAH = ZONA STOP LOSS (SL)
              const slTop = Math.min(yEntry, ySl);
              const slHeight = Math.max(6 * vRatio, Math.abs(ySl - yEntry));
              ctx.fillStyle = 'rgba(231, 76, 60, 0.28)';
              ctx.fillRect(x1, slTop, boxWidth, slHeight);
              ctx.strokeStyle = '#e74c3c';
              ctx.lineWidth = 1.5 * hRatio;
              ctx.strokeRect(x1, slTop, boxWidth, slHeight);

              // 3. GARIS ENTRY (Biru Terang)
              ctx.strokeStyle = '#38bdf8';
              ctx.lineWidth = 2 * hRatio;
              ctx.beginPath();
              ctx.moveTo(x1, yEntry);
              ctx.lineTo(x1 + boxWidth, yEntry);
              ctx.stroke();

              // 4. Label di dalam Kotak TP & SL
              const fontSize = Math.round(11 * vRatio);
              ctx.font = `bold ${fontSize}px -apple-system, sans-serif`;
              const padX = 6 * hRatio;

              if (tpHeight > fontSize + 4 * vRatio) {
                ctx.fillStyle = '#55efc4';
                const tpLabelY = this._box.bias === 'BUY'
                  ? tpTop + fontSize + 3 * vRatio
                  : tpTop + tpHeight - 5 * vRatio;
                ctx.fillText(`TP ${this._box.tp.toFixed(2)}`, x1 + padX, tpLabelY);
              }

              if (slHeight > fontSize + 4 * vRatio) {
                ctx.fillStyle = '#ff7675';
                const slLabelY = this._box.bias === 'BUY'
                  ? slTop + slHeight - 5 * vRatio
                  : slTop + fontSize + 3 * vRatio;
                ctx.fillText(`SL ${this._box.sl.toFixed(2)}`, x1 + padX, slLabelY);
              }

              ctx.restore();
            });
          }
        })
      }
    ];
  }
}

function initInteractiveChart() {
  const container = document.getElementById('macroCandleChart');
  if (!container || typeof LightweightCharts === 'undefined') return;

  container.innerHTML = '';
  chartInstance = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: 390,
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
      borderColor: '#233044',
      scaleMargins: { top: 0.14, bottom: 0.14 }
    },
    timeScale: {
      borderColor: '#233044',
      timeVisible: true,
      secondsVisible: false,
      barSpacing: 9
    }
  });

  candleSeries = chartInstance.addCandlestickSeries({
    upColor: '#2ecc71',
    downColor: '#e74c3c',
    borderVisible: false,
    wickUpColor: '#2ecc71',
    wickDownColor: '#e74c3c'
  });

  positionBoxPrimitive = new TradingViewPositionBox();
  candleSeries.attachPrimitive(positionBoxPrimitive);

  window.addEventListener('resize', () => {
    if (chartInstance && container.clientWidth > 0) {
      chartInstance.applyOptions({ width: container.clientWidth });
    }
  });
}

function snapToNearestCandleTime(targetSec) {
  if (!loadedCandles.length || !targetSec) return targetSec;
  let best = loadedCandles[0].time;
  let minDiff = Math.abs(best - targetSec);
  for (let i = 1; i < loadedCandles.length; i++) {
    const diff = Math.abs(loadedCandles[i].time - targetSec);
    if (diff < minDiff) {
      minDiff = diff;
      best = loadedCandles[i].time;
    }
  }
  return best;
}

function renderChartData(candles, trades) {
  if (!chartInstance) initInteractiveChart();
  if (!candleSeries || !candles || !candles.length) return;

  const uniqueMap = new Map();
  for (const c of candles) {
    uniqueMap.set(c.time, c);
  }
  loadedCandles = Array.from(uniqueMap.values()).sort((a, b) => a.time - b.time);
  candleSeries.setData(loadedCandles);

  const minTime = loadedCandles[0].time;
  const maxTime = loadedCandles[loadedCandles.length - 1].time;

  const rawMarkers = [];
  for (const t of trades) {
    if (t.newsCandleTimeSec && t.newsCandleTimeSec >= minTime && t.newsCandleTimeSec <= maxTime) {
      const snappedNews = snapToNearestCandleTime(t.newsCandleTimeSec);
      const isBuy = t.effectiveBias === 'BUY';
      rawMarkers.push({
        time: snappedNews,
        position: isBuy ? 'belowBar' : 'aboveBar',
        color: isBuy ? '#2ecc71' : '#e74c3c',
        shape: isBuy ? 'arrowUp' : 'arrowDown',
        text: `${t.code} ${t.timeWIB || ''} (${t.effectiveBias})`
      });
    }
    if (t.entryCandleTimeSec && t.entryCandleTimeSec >= minTime && t.entryCandleTimeSec <= maxTime) {
      const snappedEntry = snapToNearestCandleTime(t.entryCandleTimeSec);
      rawMarkers.push({
        time: snappedEntry,
        position: t.effectiveBias === 'BUY' ? 'belowBar' : 'aboveBar',
        color: '#38bdf8',
        shape: 'circle',
        text: `ENTRY ${t.effectiveBias}`
      });
    }
  }

  rawMarkers.sort((a, b) => a.time - b.time);
  candleSeries.setMarkers(rawMarkers);

  const firstExecutedIdx = trades.findIndex(t => t.entryPrice !== null);
  if (firstExecutedIdx !== -1) {
    focusTradeOnChart(firstExecutedIdx, false);
  } else {
    chartInstance.timeScale().fitContent();
  }
}

function focusTradeOnChart(index, shouldScroll = true) {
  const t = latestTrades[index];
  if (!t || !chartInstance || !candleSeries) return;

  for (const line of activePriceLines) {
    try { candleSeries.removePriceLine(line); } catch (_) {}
  }
  activePriceLines = [];

  if (t.entryPrice !== null && t.entryCandleTimeSec) {
    const startSec = snapToNearestCandleTime(t.entryCandleTimeSec);
    const rawEndSec = snapToNearestCandleTime(t.exitCandleTimeSec || t.entryCandleTimeSec);
    const endSec = Math.max(rawEndSec, startSec + 6 * 4 * 3600);

    if (positionBoxPrimitive) {
      positionBoxPrimitive.setBox({
        startTime: startSec,
        endTime: endSec,
        entry: t.entryPrice,
        tp: t.tpPrice,
        sl: t.slPrice,
        bias: t.effectiveBias,
        outcome: t.outcome
      });
    }

    activePriceLines.push(
      candleSeries.createPriceLine({
        price: t.tpPrice,
        color: '#2ecc71',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `TP (${t.effectiveBias})`
      }),
      candleSeries.createPriceLine({
        price: t.entryPrice,
        color: '#38bdf8',
        lineWidth: 1,
        lineStyle: 0,
        axisLabelVisible: true,
        title: `ENTRY ${t.effectiveBias}`
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
  } else if (positionBoxPrimitive) {
    positionBoxPrimitive.setBox(null);
  }

  const centerSec = snapToNearestCandleTime(t.entryCandleTimeSec || t.newsCandleTimeSec);
  if (centerSec && loadedCandles.length > 0) {
    const idx = loadedCandles.findIndex(c => c.time === centerSec);
    if (idx !== -1) {
      const fromIdx = Math.max(0, idx - 10);
      const toIdx = Math.min(loadedCandles.length - 1, idx + 24);
      chartInstance.timeScale().setVisibleRange({
        from: loadedCandles[fromIdx].time,
        to: loadedCandles[toIdx].time
      });
    }
  }

  const infoEl = document.getElementById('chartFocusInfo');
  if (infoEl) {
    infoEl.textContent = `Fokus Posisi: ${t.dateISO} ${t.timeWIB} WIB | ${t.code} -> ${t.effectiveBias} @ ${t.entryPrice ?? '-'} | TP: ${t.tpPrice ?? '-'} (Kotak Hijau) | SL: ${t.slPrice ?? '-'} (Kotak Merah) | Hasil: ${t.outcome}`;
  }

  if (shouldScroll) {
    document.getElementById('chartSection')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
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
      <tr class="clickable-row" data-idx="${idx}" title="Klik untuk menampilkan kotak TP hijau & SL merah posisi ini">
        <td>${idx + 1}</td>
        <td><strong>${t.dateISO}</strong><br><small>${t.timeWIB || '-'} WIB</small></td>
        <td><span class="code-pill">${t.code}</span><br><small>Ke-${t.orderInMonth}/${t.totalInMonth}</small></td>
        <td>Prev: <strong>${t.previous ?? '-'}</strong><br>Fcst: <strong>${t.forecast ?? '-'}</strong><br>Act: <strong>${t.actual ?? '-'}</strong></td>
        <td>${t.newsDirection}<br><small>Mentah: ${t.rawGoldBias}</small></td>
        <td>${badgeRule(t.ruleApplied)}<br><small>${t.ruleDetail}</small></td>
        <td class="${biasClass}"><strong>${t.effectiveBias}</strong></td>
        <td>
          <small>1. Impuls: ${t.impulseCloseWIB || '-'}</small><br>
          <strong>2. Pullback: ${t.pullbackCloseWIB}</strong><br>
          <small>TF: H4</small>
        </td>
        <td>${t.entryPrice !== null ? t.entryPrice.toFixed(2) : '-'}</td>
        <td class="text-green">${t.tpPrice !== null ? t.tpPrice.toFixed(2) : '-'}</td>
        <td class="text-red">${t.slPrice !== null ? t.slPrice.toFixed(2) : '-'}</td>
        <td class="${outcomeClass}"><strong>${t.outcome}</strong><br><small>${pipsText} pips</small></td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.clickable-row').forEach(row => {
    row.addEventListener('click', () => {
      const idx = Number(row.getAttribute('data-idx'));
      focusTradeOnChart(idx, true);
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
  btn.textContent = 'Memuat Chart H4...';
  statusEl.textContent = 'Menarik kalender FXStreet + TradingView & candle Spot XAU/USD H4 murni...';

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

    statusEl.textContent = `Selesai: ${data.summary.totalSignals} rilis berita (${startYear}–${endYear}) | Feed: ${data.activeFeed} (${data.totalH4Candles} candle H4 murni) | Klik baris tabel untuk memindahkan kotak posisi TP/SL di chart.`;
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
    'ATURAN_BULANAN', 'ARAH_EKSEKUSI', 'CLOSE_IMPULS_H4', 'CLOSE_PULLBACK_H4',
    'ENTRY_PRICE', 'TP_PRICE', 'SL_PRICE', 'HASIL', 'NET_PIPS'
  ];

  const rows = latestTrades.map((t, i) => [
    i + 1, t.dateISO, t.timeWIB, t.code, `${t.orderInMonth}/${t.totalInMonth}`,
    t.previous, t.forecast, t.actual, t.newsDirection, t.rawGoldBias,
    t.ruleApplied, t.effectiveBias, t.impulseCloseWIB, t.pullbackCloseWIB,
    t.entryPrice ?? '', t.tpPrice ?? '', t.slPrice ?? '', t.outcome, t.pipsResult
  ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));

  const csvContent = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `xauusd-macro-h4-position-box-backtest.csv`;
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
