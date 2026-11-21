const savedForecasts = (() => {
  try { return JSON.parse(localStorage.getItem('mbt_forecasts_v1') || '{}'); }
  catch (e) { return {}; }
})();

const savedImported = (() => {
  try {
    const arr = JSON.parse(localStorage.getItem('mbt_imported_v1') || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
})();

export const STATE = {
  startYear: 2015,
  endYear: 2020,
  indicator: 'ALL',
  monthFilter: 0,
  directionFilter: 'ALL',
  rawEvents: [],
  importedEvents: savedImported,
  filteredEvents: [],
  forecasts: savedForecasts,
  backtestPair: 'XAU/USD',
  backtestResults: [],
  loading: false
};

export function saveForecastValue(eventId, val) {
  const clean = (val || '').trim();
  if (clean) STATE.forecasts[eventId] = clean;
  else delete STATE.forecasts[eventId];
  localStorage.setItem('mbt_forecasts_v1', JSON.stringify(STATE.forecasts));
}

export function saveImportedEvents() {
  localStorage.setItem('mbt_imported_v1', JSON.stringify(STATE.importedEvents));
}

const listeners = {};
export function onEvent(name, cb) {
  if (!listeners[name]) listeners[name] = [];
  listeners[name].push(cb);
}
export function emitEvent(name, payload) {
  (listeners[name] || []).forEach(fn => {
    try { fn(payload); } catch (e) { console.error(e); }
  });
}
