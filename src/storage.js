const STORAGE_KEY = "tire-price-compare-state-v1";

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveState(state) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...state,
      savedAt: new Date().toISOString()
    })
  );
}

export function clearState() {
  localStorage.removeItem(STORAGE_KEY);
}
