import { BULAN_LIST } from './utils.js';

function parseCSVLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if ((ch === ',' || ch === ';') && !inQuotes) { result.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  result.push(cur.trim());
  return result;
}

export function parseImportedCSV(csvText, fallbackYear = 2022) {
  const lines = csvText.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map(h => h.toUpperCase());
  const idxTahun = headers.findIndex(h => h.includes('TAHUN') || h.includes('YEAR'));
  const idxBulan = headers.findIndex(h => h.includes('BULAN') || h.includes('MONTH'));
  const idxTgl = headers.findIndex(h => h.includes('TANGGAL') || h.includes('DAY') || h.includes('DATE'));
  const idxData = headers.findIndex(h => h.includes('DATA') || h.includes('EVENT') || h.includes('INDIKATOR'));
  const idxPrev = headers.findIndex(h => h.includes('SEBELUM') || h.includes('PREV'));
  const idxFcst = headers.findIndex(h => h.includes('RAMALAN') || h.includes('FORECAST'));
  const idxAct = headers.findIndex(h => h.includes('SEBENAR') || h.includes('ACTUAL'));

  const imported = [];
  let lastMonthName = 'Januari';
  let lastYear = fallbackYear;

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 3) continue;

    if (idxTahun >= 0 && cols[idxTahun]) {
      const y = parseInt(cols[idxTahun], 10);
      if (!isNaN(y)) lastYear = y;
    }
    if (idxBulan >= 0 && cols[idxBulan]) lastMonthName = cols[idxBulan];

    const rawDateCol = idxTgl >= 0 ? cols[idxTgl] : cols[1];
    let year = lastYear;
    let monthIndex = BULAN_LIST.findIndex(b => b.toLowerCase() === lastMonthName.toLowerCase()) + 1;
    if (monthIndex <= 0) monthIndex = 1;
    let day = parseInt(rawDateCol, 10) || 1;

    if (/^\d{4}-\d{2}-\d{2}$/.test(rawDateCol)) {
      const [yy, mm, dd] = rawDateCol.split('-').map(Number);
      year = yy; monthIndex = mm; day = dd;
    }

    const rawLabel = (idxData >= 0 ? cols[idxData] : cols[2]) || 'DATA';
    const upper = rawLabel.toUpperCase();
    const code = upper.includes('NFP') ? 'NFP'
      : upper.includes('CPI') ? 'CPI'
      : upper.includes('BUNGA') || upper.includes('FOMC') || upper.includes('RATE') ? 'BUNGA'
      : upper.includes('UNEMP') || upper.includes('PENGANGGURAN') ? 'UNRATE'
      : 'CUSTOM';

    const previous = (idxPrev >= 0 ? cols[idxPrev] : cols[3]) || '-';
    const forecast = (idxFcst >= 0 ? cols[idxFcst] : cols[4]) || '';
    const actual = (idxAct >= 0 ? cols[idxAct] : cols[5]) || '-';

    const dateISO = `${year}-${String(monthIndex).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const prevNum = parseFloat(previous.replace(/[^0-9.-]/g, ''));
    const actNum = parseFloat(actual.replace(/[^0-9.-]/g, ''));

    imported.push({
      id: `IMP_${code}_${dateISO}_${i}`,
      dateISO, year, monthIndex,
      monthName: BULAN_LIST[monthIndex - 1] || lastMonthName,
      day, currency: 'USD', code, event: rawLabel,
      previous, previousNum: isNaN(prevNum) ? null : prevNum,
      forecast: forecast || null,
      forecastNum: forecast ? parseFloat(forecast.replace(/[^0-9.-]/g, '')) : null,
      actual, actualNum: isNaN(actNum) ? null : actNum,
      source: 'Impor CSV Pengguna'
    });
  }
  return imported;
}

export function downloadCSV(filename, headers, rows) {
  const escapeCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csvContent = [
    headers.map(escapeCell).join(','),
    ...rows.map(r => r.map(escapeCell).join(','))
  ].join('\n');

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
