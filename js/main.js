import { toast } from './core/utils.js';
import { initNewsArchive } from './modules/news-archive.js';
import { initPriceBacktest } from './modules/price-backtest.js';
import { initAIAnalyst } from './modules/ai-analyst.js';
import { downloadCSV } from './core/csv.js';

function initTabs() {
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${target}`));
      document.querySelectorAll('.nav-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === target));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initNewsArchive();
  initPriceBacktest();
  initAIAnalyst();

  const keyInp = document.getElementById('set-openrouter-key');
  if (keyInp) keyInp.value = localStorage.getItem('gd_openrouter_key') || '';
  document.getElementById('btn-save-settings')?.addEventListener('click', () => {
    if (keyInp) localStorage.setItem('gd_openrouter_key', keyInp.value.trim());
    toast('🔑 Pengaturan API Key tersimpan!', 'success');
  });

  document.getElementById('btn-download-template-csv')?.addEventListener('click', () => {
    const headers = ['TAHUN', 'BULAN', 'TANGGAL', 'DATA', 'SEBELUMNYA', 'RAMALAN', 'SEBENARNYA'];
    const sample = [
      [2022, 'Januari', 7, 'NFP', '210K', '400K', '199K'],
      [2022, 'Januari', 12, 'CPI', '6.8%', '7.0%', '7.0%'],
      [2022, 'Januari', 26, 'BUNGA', '0.25%', '0.25%', '0.25%']
    ];
    downloadCSV('template-news-backtest.csv', headers, sample);
    toast('📥 Template CSV berhasil diunduh!', 'success');
  });
});
