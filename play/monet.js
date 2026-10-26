// Monetization layer: rewarded ads, interstitials and in-app purchases behind one small API.
// On the web build everything runs in TEST mode (placeholder ad overlay, simulated purchases), so every placement can be
// tried on the phone link. In the app build (Capacitor) the native AdMob / billing plugins are used when present.
import { mirror } from './durable.js';

// iOS in-app purchases: off until Apple's Paid Apps agreement (bank + tax) is active. While off, the iOS app shows no paid
// items anywhere and never starts the App Store billing; Android and the web build are not affected.
const IOS_IAP = false; // turn on once Apple's Paid Apps agreement is active

export const PRODUCTS = [
  { sku: 'remove_ads', name: 'Remove Ads', info: 'No more interstitial ads. Rewarded ads stay optional.', price: '$2.99', once: true },
  { sku: 'starter_pack', name: 'Starter Pack', info: '1,000 soul shards and a legendary item in your Vault.', price: '$2.99', once: true },
  { sku: 'shards_s', name: 'Pouch of Souls', info: '500 soul shards', price: '$0.99', shards: 500 },
  { sku: 'shards_deal', name: 'Mega Deal', info: '1,400 soul shards · 3x MORE for just $1 extra', price: '$1.99', shards: 1400, deal: true },
  { sku: 'shards_m', name: 'Chest of Souls', info: '4,000 soul shards (+60%)', price: '$4.99', shards: 4000 },
  { sku: 'shards_l', name: 'Vault of Souls', info: '9,000 soul shards (+80%)', price: '$9.99', shards: 9000 },
];

const KEY = 'rbd_monet_v1';
const st = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } })();
const save = () => { st.t = Date.now(); const j = JSON.stringify(st); try { localStorage.setItem(KEY, j); } catch (e) { /* ignore */ } mirror(KEY, j); }; // mirror: native copy (durable.js)
st.owned = st.owned || {};

const native = () => (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) ? window.Capacitor : null;
// Public web build (itch.io): no ads at all, rewards are free, and purchases point to the Android app.
const web = () => !native() && !!window.RB_WEB;
const ios = () => !!native() && native().getPlatform() === 'ios';
// Google Play on Android, the App Store on iOS (same product ids in both stores).
const storePlatform = (C) => (ios() ? C.Platform.APPLE_APPSTORE : C.Platform.GOOGLE_PLAY);
const iap = () => IOS_IAP || !ios();

// ---------- Google Play Billing (cordova-plugin-purchase) in the app build ----------
// One-time items are non-consumable (Play remembers them, so they come back after a reinstall); shard packs are consumed.
// A purchase is delivered on "approved" and only then finished, so one paid while the app was closed is delivered on the
// next start through Monet.onGrant.
let billing = null;
function notice(title, text) {
  const el = document.createElement('div'); el.className = 'ad-overlay';
  el.innerHTML = `<div class="ad-box"><b>${title}</b><p>${text}</p><button class="ad-close">OK</button></div>`;
  document.getElementById('app').appendChild(el); el.querySelector('.ad-close').onclick = () => el.remove();
}
function deliver(sku) {
  const p = PRODUCTS.find((x) => x.sku === sku); if (!p) return;
  const w = billing.waiting.get(sku); billing.waiting.delete(sku);
  if (p.once) { if (st.owned[sku]) { if (w) w(null); return; } st.owned[sku] = true; save(); }
  if (w) w(p); else if (Monet.onGrant) Monet.onGrant(p);
}
function initBilling() {
  const C = window.CdvPurchase; if (billing || !native() || !C || !iap()) return;
  const { store, ProductType, Platform } = C;
  billing = { store, waiting: new Map(), status: 'connecting' };
  store.register(PRODUCTS.map((p) => ({ id: p.sku, type: p.once ? ProductType.NON_CONSUMABLE : ProductType.CONSUMABLE, platform: storePlatform(C) })));
  store.when()
    .productUpdated((pr) => {
      const p = PRODUCTS.find((x) => x.sku === pr.id); if (!p) return;
      if (pr.pricing && pr.pricing.price) p.price = pr.pricing.price; // the player's local price from Play
      if (p.once && pr.owned && !st.owned[p.sku]) { st.owned[p.sku] = true; save(); }
    })
    .approved((tx) => { for (const it of tx.products) deliver(it.id); tx.finish(); });
  store.error((e) => console.warn('billing', e && e.code, e && e.message));
  store.initialize([storePlatform(C)]).then(() => { billing.status = 'ready'; }, () => { billing.status = 'offline'; });
}
document.addEventListener('deviceready', initBilling);

// ---------- test-mode ad overlay ----------
function overlay(kind, placement, seconds) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'ad-overlay';
    el.innerHTML = `<div class="ad-box"><small>TEST ${kind === 'rewarded' ? 'REWARDED' : 'INTERSTITIAL'} AD · ${placement}</small>
      <b>Advertisement</b><p>A real ad plays here in the app.</p><div class="ad-bar"><i></i></div>
      <button class="ad-close" disabled>${seconds}</button></div>`;
    document.getElementById('app').appendChild(el);
    const btn = el.querySelector('.ad-close'), bar = el.querySelector('.ad-bar i');
    let left = seconds; bar.style.transition = `width ${seconds}s linear`; requestAnimationFrame(() => { bar.style.width = '100%'; });
    const tick = setInterval(() => {
      left--; btn.textContent = left > 0 ? left : (kind === 'rewarded' ? 'CLAIM REWARD' : 'CLOSE ✕');
      if (left <= 0) { clearInterval(tick); btn.disabled = false; }
    }, 1000);
    btn.addEventListener('click', () => { el.remove(); resolve(true); });
    if (kind === 'rewarded') {
      const quit = document.createElement('button'); quit.className = 'ad-skip'; quit.textContent = 'skip (no reward)';
      quit.addEventListener('click', () => { clearInterval(tick); el.remove(); resolve(false); });
      el.querySelector('.ad-box').appendChild(quit);
    }
  });
}

export const Monet = {
  onGrant: null, // set by the game: delivers a purchase that was paid while the app was closed
  get mode() { return native() ? 'app' : web() ? 'web' : 'test'; },
  get billingStatus() { return billing ? billing.status : 'off'; },
  // false on iOS while IOS_IAP is off: the game then hides every price, pack and BUY button
  get iapEnabled() { return iap(); },
  notice,
  init() { initBilling(); },
  get adsRemoved() { return !!st.owned.remove_ads; },
  owns(sku) { return !!st.owned[sku]; },
  // App Store rule: one-time items need a Restore Purchases button (shown on iOS only).
  get canRestore() { return ios() && iap(); },
  async restore() {
    initBilling(); if (!billing) return;
    try { await billing.store.restorePurchases(); notice('Purchases restored', 'Any one-time items you own are back.'); }
    catch (e) { notice('Restore failed', 'The App Store could not be reached. Try again later.'); }
  },
  // rewarded: resolves true only if the player watched to the end
  async rewarded(placement) {
    if (web()) return true;
    const cap = native();
    if (cap && cap.Plugins && cap.Plugins.AdMob) {
      try { const r = await cap.Plugins.AdMob.showRewardVideoAd(); return !!r; } catch (e) { return false; }
    }
    return overlay('rewarded', placement, 5);
  },
  // interstitial: skipped entirely once ads are removed
  async interstitial(placement) {
    if (this.adsRemoved || web()) return;
    const cap = native();
    if (cap && cap.Plugins && cap.Plugins.AdMob) { try { await cap.Plugins.AdMob.showInterstitial(); } catch (e) { /* no fill */ } return; }
    await overlay('interstitial', placement, 3);
  },
  // purchase: resolves the product on success, null on cancel
  async buy(sku) {
    const p = PRODUCTS.find((x) => x.sku === sku);
    if (!p || (p.once && st.owned[sku]) || !iap()) return null;
    if (web()) { notice('Android app only', 'Shop items are in the Android version of Runebound Depths. Everything here is free to play.'); return null; }
    const cap = native();
    if (cap && !window.CdvPurchase) { // app build without Google Play Billing yet: never hand out paid items for free
      const el = document.createElement('div'); el.className = 'ad-overlay';
      el.innerHTML = `<div class="ad-box"><b>Coming soon</b><p>Purchases open in the next update.</p><button class="ad-close">OK</button></div>`;
      document.getElementById('app').appendChild(el); el.querySelector('.ad-close').onclick = () => el.remove();
      return null;
    }
    if (cap) {
      initBilling();
      const C = window.CdvPurchase, pr = billing.store.get(sku, storePlatform(C)), offer = pr && pr.getOffer();
      if (!offer) { notice('Store unavailable', `${ios() ? 'The App Store' : 'Google Play'} could not be reached. Check your connection and try again.`); return null; }
      return new Promise((resolve) => {
        billing.waiting.set(sku, resolve);
        offer.order().then((err) => {
          if (!err) return; // success arrives through "approved"
          billing.waiting.delete(sku); resolve(null);
          if (err.code !== C.ErrorCode.PAYMENT_CANCELLED) notice('Purchase failed', err.message || 'Please try again.');
        });
      });
    }
    const ok = await new Promise((resolve) => {
      const el = document.createElement('div'); el.className = 'ad-overlay';
      el.innerHTML = `<div class="ad-box"><small>TEST PURCHASE · no money is charged</small><b>${p.name}</b><p>${p.info}</p><p class="ad-price">${p.price}</p>
        <button class="ad-close">BUY (TEST)</button><button class="ad-skip">cancel</button></div>`;
      document.getElementById('app').appendChild(el);
      el.querySelector('.ad-close').onclick = () => { el.remove(); resolve(true); };
      el.querySelector('.ad-skip').onclick = () => { el.remove(); resolve(false); };
    });
    if (!ok) return null;
    if (p.once) { st.owned[sku] = true; save(); }
    return p;
  },
  // simple daily counter for "free shards" style rewards
  dailyLeft(key, max) {
    const day = new Date().toDateString();
    if (!st.daily || st.daily.day !== day) st.daily = { day };
    return max - (st.daily[key] || 0);
  },
  useDaily(key) { this.dailyLeft(key, 0); st.daily[key] = (st.daily[key] || 0) + 1; save(); },
};
