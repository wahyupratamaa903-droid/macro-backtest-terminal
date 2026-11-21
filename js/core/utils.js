export const BULAN_LIST = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

export function esc(s) {
  if (typeof s !== 'string') return String(s ?? '');
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(s));
  return d.innerHTML;
}

export function renderMarkdown(raw) {
  let s = esc(raw);
  s = s.replace(/\*\*([^*\n]{1,300})\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*\\n]{1,200})\*/g, '<em>$1</em>');
  s = s.replace(/^### (.+)$/gm, '<h3 class="text-sky-400 font-bold mt-2 mb-1">$1</h3>');
  s = s.replace(/^[-•] (.+)$/gm, '<li>$1</li>');
  s = s.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
  s = s.replace(/\n{2,}/g, '</p><p class="mt-2">');
  s = s.replace(/\n/g, '<br>');
  return '<p>' + s + '</p>';
}

export function toast(msg, type = 'info') {
  const box = document.getElementById('alert-box');
  if (!box) return;
  const styles = {
    info: 'border-sky-500/35 text-sky-300 bg-slate-900/95',
    success: 'border-emerald-500/35 text-emerald-300 bg-slate-900/95',
    warning: 'border-amber-500/35 text-amber-300 bg-slate-900/95',
    error: 'border-red-500/35 text-red-300 bg-slate-900/95'
  };
  const el = document.createElement('div');
  el.className = `glass px-3.5 py-2.5 rounded-xl border text-xs font-medium shadow-lg ${styles[type] || styles.info}`;
  el.innerHTML = msg;
  box.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .25s';
    setTimeout(() => el.remove(), 260);
  }, 3200);
}
