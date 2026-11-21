import { STATE } from '../core/state.js';
import { esc, renderMarkdown, toast } from '../core/utils.js';

function getKey() {
  return localStorage.getItem('gd_openrouter_key') || '';
}

function buildDatasetPrompt(userQuestion) {
  const rows = (STATE.backtestResults.length ? STATE.backtestResults : STATE.filteredEvents).slice(-35);
  const summaryLines = rows.map(r => {
    const fcst = STATE.forecasts[r.id] ?? r.forecast ?? 'N/A';
    const pipsPart = r.netPips != null ? ` | Pair ${r.pair}: Open=${r.open}, Close=${r.close}, Net=${r.netPips}p, Range=${r.rangePips}p` : '';
    return `${r.dateISO} | ${r.code} | Prev=${r.previous} | Fcst=${fcst} | Act=${r.actual}${pipsPart}`;
  }).join('\n');

  return `Kamu adalah Quantitative Trading Researcher spesialis backtest berita fundamental (NFP, CPI, Suku Bunga FOMC).
Analisis dataset historis aktual berikut (${STATE.startYear}–${STATE.endYear}) secara objektif berdasarkan angka yang tertulis:

${summaryLines}

Pertanyaan Pengguna: ${userQuestion}

Berikan jawaban terstruktur dalam Bahasa Indonesia dengan **bold** dan poin-poin: pola korelasi antara rilis data dengan pergerakan pips, rata-rata volatilitas, serta aturan filter strategi yang disarankan.`;
}

export async function askBacktestAI(customPrompt = null) {
  const inp = document.getElementById('ai-bt-input');
  const q = (customPrompt ?? inp?.value ?? '').trim();
  if (!q) { toast('⚠️ Ketik pertanyaan strategi dulu', 'warning'); return; }

  const chatBox = document.getElementById('ai-bt-chat');
  if (!chatBox) return;

  chatBox.insertAdjacentHTML('beforeend', `
    <div class="bg-sky-500/10 border border-sky-500/25 rounded-xl p-3 text-xs text-slate-200 ml-6 anim-fade">
      <p class="text-[9px] font-bold text-sky-400 mb-1">Pertanyaan Backtest Kamu</p>
      ${esc(q)}
    </div>
  `);
  if (!customPrompt && inp) inp.value = '';

  const loadId = 'ld-' + Date.now();
  chatBox.insertAdjacentHTML('beforeend', `<div id="${loadId}" class="text-[10px] font-mono text-slate-400 p-2">⏳ AI sedang menghitung pola statistik dataset...</div>`);
  chatBox.scrollTop = chatBox.scrollHeight;

  const models = [
    'meta-llama/llama-3.3-70b-instruct:free',
    'qwen/qwen3-next-80b-a3b-instruct:free',
    'openai/gpt-oss-120b:free'
  ];
  const key = getKey();
  let reply = '', ok = false, lastErr = '';

  for (const m of models) {
    try {
      let res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(key ? { 'x-custom-key': key } : {}) },
        body: JSON.stringify({ model: m, messages: [{ role: 'user', content: buildDatasetPrompt(q) }], temperature: 0.5, max_tokens: 1600 })
      });

      if (res.status === 404 && key) {
        res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: m, messages: [{ role: 'user', content: buildDatasetPrompt(q) }], temperature: 0.5, max_tokens: 1600 })
        });
      }

      const d = await res.json();
      if (d.error) { lastErr = d.error.message || 'API Error'; continue; }
      if (d.choices?.[0]?.message?.content) { reply = d.choices[0].message.content; ok = true; break; }
    } catch (e) { lastErr = e.message; }
  }

  document.getElementById(loadId)?.remove();

  if (ok) {
    chatBox.insertAdjacentHTML('beforeend', `
      <div class="bg-slate-900/75 border border-slate-800 rounded-xl p-3.5 text-xs text-slate-200 mr-4 ai-out leading-relaxed anim-fade">
        <p class="text-[9px] font-bold text-amber-400 mb-1.5">📊 Hasil Analisis Kuantitatif AI</p>
        ${renderMarkdown(reply)}
      </div>
    `);
  } else {
    chatBox.insertAdjacentHTML('beforeend', `
      <div class="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-xs text-red-300">
        Gagal terhubung ke AI (${esc(lastErr)}). Isi API Key OpenRouter di tab <b>Sumber &amp; CSV</b>.
      </div>
    `);
  }
  chatBox.scrollTop = chatBox.scrollHeight;
}

export function initAIAnalyst() {
  document.getElementById('btn-ai-bt-send')?.addEventListener('click', () => askBacktestAI());
  document.querySelectorAll('[data-bt-qp]').forEach(btn => {
    btn.addEventListener('click', () => askBacktestAI(btn.dataset.btQp));
  });
}
