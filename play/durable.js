// Durable saves for the app build: every localStorage save is mirrored into native storage (@capacitor/preferences),
// because iOS WKWebView can lose the last localStorage writes when iOS kills a backgrounded app. On boot, restore()
// puts back any save that localStorage lost. In a browser (web / itch build) there is no Capacitor and all of this is a no-op.
// Saves carry a timestamp `t`, so an older native copy never overwrites a newer localStorage one.
const prefs = () => { const C = window.Capacitor; return (C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.Preferences) || null; };
const tOf = (s) => { try { return (s && JSON.parse(s).t) || 0; } catch (e) { return 0; } };

// fire and forget: value null removes the key
export function mirror(key, value) {
  const p = prefs(); if (!p) return;
  try { (value == null ? p.remove({ key }) : p.set({ key, value })).catch(() => { /* native storage unavailable */ }); } catch (e) { /* ignore */ }
}

// Native only. Copies a newer native save into localStorage (and seeds native storage from saves made before it existed).
// endKey holds when the run save was last cleared, so a run that ended (shards paid) can't come back from a stale
// localStorage copy. Resolves true when localStorage changed: the caller reloads so every module reads the restored saves.
export async function restore(keys, runKey, endKey) {
  const p = prefs(); if (!p) return false;
  let changed = false;
  try {
    const end = +((await p.get({ key: endKey })).value || 0);
    for (const key of keys) {
      const nv = (await p.get({ key })).value, lv = localStorage.getItem(key);
      if (nv && (!lv || tOf(nv) > tOf(lv))) { localStorage.setItem(key, nv); changed = localStorage.getItem(key) === nv || changed; }
      else if (lv && !nv && key === runKey && end > tOf(lv)) { localStorage.removeItem(key); changed = true; } // ended after this save
      else if (lv && lv !== nv) mirror(key, lv);
    }
  } catch (e) { /* storage blocked or plugin missing: localStorage alone */ }
  return changed;
}
