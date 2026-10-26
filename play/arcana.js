// Runebound Depths - spell, element, gear and hero data (pure data + small helpers, no rendering).
// Spells are generated: element (8 base + 28 fusions) x shape (14) = 504, plus boss spells and legendaries.

export const ELEMENT_ORDER = ['arcane', 'fire', 'frost', 'storm', 'venom', 'shadow', 'holy', 'earth'];
export const ELEMENTS = {
  arcane: { name: 'Arcane', adj: 'Arcane', color: '#ff5fd8', icon: 0, dmg: 1.0, cd: 1.0, info: '+10% crit chance on its hits' },
  fire: { name: 'Fire', adj: 'Ember', color: '#ff7a1a', icon: 1, dmg: 1.1, cd: 1.0, info: 'Burns: damage over time' },
  frost: { name: 'Frost', adj: 'Frost', color: '#8fe6ff', icon: 2, dmg: 0.9, cd: 1.0, info: 'Chills; 3 chills freeze' },
  storm: { name: 'Storm', adj: 'Storm', color: '#fff36a', icon: 3, dmg: 1.0, cd: 0.9, info: 'Shocks: +25% damage taken' },
  venom: { name: 'Venom', adj: 'Venom', color: '#7dff6a', icon: 4, dmg: 0.8, cd: 1.0, info: 'Poison stacks up to 8 times' },
  shadow: { name: 'Shadow', adj: 'Shadow', color: '#a35cff', icon: 5, dmg: 1.0, cd: 1.0, info: 'Curses: cursed foes explode on death' },
  holy: { name: 'Holy', adj: 'Holy', color: '#ffe9a0', icon: 6, dmg: 1.0, cd: 1.0, info: 'Double damage to the undead' },
  earth: { name: 'Earth', adj: 'Stone', color: '#c8925a', icon: 7, dmg: 1.25, cd: 1.2, info: 'Heavy hits that stagger and stun' },
};
// you start with these; the rest are unlocked by killing bosses
export const START_ELEMENTS = ['arcane', 'fire', 'frost'];

const FUSION_NAMES = {
  'arcane+fire': 'Phoenix', 'arcane+frost': 'Crystal', 'arcane+storm': 'Ether', 'arcane+venom': 'Hex', 'arcane+shadow': 'Abyss', 'arcane+holy': 'Seraph', 'arcane+earth': 'Geode',
  'fire+frost': 'Steam', 'fire+storm': 'Plasma', 'fire+venom': 'Napalm', 'fire+shadow': 'Hellfire', 'fire+holy': 'Solar', 'fire+earth': 'Magma',
  'frost+storm': 'Blizzard', 'frost+venom': 'Rime', 'frost+shadow': 'Nightfrost', 'frost+holy': 'Aurora', 'frost+earth': 'Glacier',
  'storm+venom': 'Acid', 'storm+shadow': 'Doom', 'storm+holy': 'Judgment', 'storm+earth': 'Tempest',
  'venom+shadow': 'Plague', 'venom+holy': 'Thorn', 'venom+earth': 'Spore',
  'shadow+holy': 'Twilight', 'shadow+earth': 'Grave',
  'holy+earth': 'Titan',
};
export const elKey = (els) => [...els].sort((a, b) => ELEMENT_ORDER.indexOf(a) - ELEMENT_ORDER.indexOf(b)).join('+');

// beh = runtime behaviour; vis = projectile look. Numbers are level-1 values, tuned to roughly equal single-target DPS.
export const SHAPES = {
  bolt: { name: 'Bolt', tier: 0, beh: 'proj', vis: 'bolt', cd: 0.6, dmg: 10, speed: 13, homing: 9, count: 1, life: 1.1, size: 0.85, r: 0.28, range: 9, info: 'Homing shots at the nearest foe' },
  lance: { name: 'Lance', tier: 0, beh: 'proj', vis: 'lance', cd: 1.2, dmg: 18, speed: 24, pierce: 5, count: 1, life: 0.7, size: 1, r: 0.3, range: 10, info: 'A fast lance that pierces a line of foes' },
  orb: { name: 'Orb', tier: 0, beh: 'proj', vis: 'fire', cd: 2.6, dmg: 24, speed: 8.5, aoe: 1.8, count: 1, life: 1.6, size: 1.4, r: 0.32, range: 9, info: 'A slow orb that bursts in an area' },
  nova: { name: 'Nova', tier: 1, beh: 'nova', cd: 4.0, dmg: 16, radius: 3.0, range: 3.4, info: 'A blast all around you' },
  chain: { name: 'Chain', tier: 1, beh: 'chain', cd: 3.0, dmg: 14, jumps: 3, range: 8, info: 'Arcs between nearby foes' },
  halo: { name: 'Halo', tier: 2, beh: 'orbit', cd: 7, dmg: 8, count: 3, dur: 5, radius: 1.6, range: 7, info: 'Orbs circle you and shred what they touch' },
  fan: { name: 'Fan', tier: 0, beh: 'proj', vis: 'venom', cd: 2.0, dmg: 6, speed: 11, count: 5, spread: 0.8, life: 0.6, size: 0.55, r: 0.2, range: 6.5, info: 'A spread of darts' },
  rain: { name: 'Rain', tier: 2, beh: 'rain', cd: 6.5, dmg: 30, count: 5, aoe: 1.5, range: 10, info: 'Strikes fall from above onto your foes' },
  burst: { name: 'Burst', tier: 0, beh: 'radial', vis: 'venom', cd: 3.4, dmg: 8, count: 12, speed: 9, life: 0.8, size: 0.6, r: 0.22, range: 5, info: 'A ring of shots in every direction' },
  field: { name: 'Field', tier: 1, beh: 'zone', cd: 5, dmg: 6, radius: 1.8, dur: 3.5, range: 8, info: 'A lingering field under your foes' },
  glaive: { name: 'Glaive', tier: 1, beh: 'proj', vis: 'glaive', cd: 2.4, dmg: 13, speed: 12, boomerang: true, count: 1, life: 1.7, size: 0.9, r: 0.34, pierce: 99, range: 7, info: 'Flies out and comes back, cutting everything' },
  sigil: { name: 'Sigil', tier: 1, beh: 'mine', cd: 2.2, dmg: 32, aoe: 1.7, range: 6, info: 'A rune trap at your feet that bursts on contact' },
  ray: { name: 'Ray', tier: 2, beh: 'beam', cd: 4.5, dmg: 4, dur: 1.4, range: 7, info: 'A beam that locks onto a foe' },
  wisp: { name: 'Wisp', tier: 2, beh: 'summon', cd: 10, dmg: 7, dur: 8, count: 1, range: 8, info: 'A familiar that fights beside you' },
};
export const SHAPE_ORDER = Object.keys(SHAPES);
// rarity: strong shapes are rare finds; a fusion is one tier above its shape
export const SPELL_TIERS = [{ name: 'COMMON', color: '#d8d8e0', w: 3 }, { name: 'RARE', color: '#5fb4ff', w: 1.3 }, { name: 'EPIC', color: '#c07aff', w: 0.45 }, { name: 'LEGENDARY', color: '#ffa040', w: 0.15 }];
export function spellTier(def) {
  if (!def) return 0;
  if (def.legendary) return 3;
  if (def.bossSpell) return 2;
  return Math.min(3, (def.sh.tier || 0) + (def.fused ? 1 : 0));
}

const NAME_OVERRIDES = {
  'arcane.bolt': 'Arcane Bolt', 'fire.orb': 'Fireball', 'frost.nova': 'Frost Nova', 'storm.chain': 'Chain Lightning', 'arcane.halo': 'Arcane Orbs',
  'venom.fan': 'Venom Fan', 'fire.rain': 'Meteor Shower', 'holy.ray': 'Sunbeam', 'shadow.wisp': 'Shade', 'earth.rain': 'Rockslide', 'frost.lance': 'Icicle',
  'storm.ray': 'Arc Beam', 'fire.field': 'Firewall', 'venom.field': 'Toxic Pool', 'holy.nova': 'Divine Light', 'shadow.orb': 'Void Sphere', 'earth.glaive': 'Stone Disc',
};

// boss spells: dropped by bosses, unlocked forever once seen; they are their bosses' own attacks
export const BOSS_SPELLS = {
  'boss.gloop': { name: 'Gloop Slam', boss: 'boss', els: ['venom'], beh: 'gloop', cd: 5, dmg: 30, range: 8, info: 'Leap-slam shockwave and a ring of slime', unlocks: 'venom' },
  'boss.bones': { name: 'Bone Eruption', boss: 'tyrant', els: ['shadow'], beh: 'bones', cd: 4.5, dmg: 22, range: 8, info: 'Lines of bones burst from the floor', unlocks: 'shadow' },
  'boss.gaze': { name: 'Hollow Gaze', boss: 'eyeboss', els: ['storm'], beh: 'gaze', cd: 7, dmg: 7, range: 9, info: 'A sweeping laser that cuts the whole room', unlocks: 'storm' },
  'boss.spores': { name: 'Spore Storm', boss: 'sporeboss', els: ['venom'], beh: 'spores', cd: 6, dmg: 7, range: 8, info: 'A spiralling storm of spores', unlocks: null },
  'boss.rocks': { name: 'Rockfall', boss: 'golemboss', els: ['earth'], beh: 'rocks', cd: 5.5, dmg: 28, range: 9, info: 'The ceiling comes down on your foes', unlocks: 'earth' },
  'boss.souls': { name: 'Soul Volley', boss: 'wraithboss', els: ['holy', 'frost'], beh: 'souls', cd: 3.5, dmg: 12, range: 9, info: 'Homing souls that hunt your foes', unlocks: 'holy' },
};
export const LEGENDARY = {
  meteor: { name: 'Meteor Storm', els: ['fire'], cd: 9, range: 10, info: 'Every 9s a rain of meteors crushes your foes' },
  hole: { name: 'Void Maw', els: ['shadow'], cd: 11, range: 8, info: 'Every 11s a black hole drags foes in, then detonates' },
  still: { name: 'Stillness', els: ['frost'], cd: 15, range: 8, info: 'Every 15s time stops for all foes for 2.5s' },
};
// old save ids -> new ids
export const LEGACY_IDS = { bolt: 'arcane.bolt', fire: 'fire.orb', frost: 'frost.nova', chain: 'storm.chain', orbs: 'arcane.halo', venom: 'venom.fan' };

function mixHex(a, b) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return '#' + x.map((v, i) => Math.round((v + y[i]) / 2).toString(16).padStart(2, '0')).join('');
}
const cache = new Map();
export function spellDef(id) {
  if (cache.has(id)) return cache.get(id);
  let d;
  if (LEGENDARY[id]) {
    const L = LEGENDARY[id];
    d = { id, name: L.name, els: L.els, color: ELEMENTS[L.els[0]].color, cd: L.cd, range: L.range, info: L.info, legendary: true, shape: 'legend', sh: {} };
  } else if (BOSS_SPELLS[id]) {
    const B = BOSS_SPELLS[id];
    d = { id, name: B.name, els: B.els, color: B.els.length > 1 ? mixHex(ELEMENTS[B.els[0]].color, ELEMENTS[B.els[1]].color) : ELEMENTS[B.els[0]].color,
      cd: B.cd, dmg: B.dmg, range: B.range, info: B.info, bossSpell: true, boss: B.boss, shape: 'boss', sh: { beh: B.beh } };
  } else {
    const [ek, shape] = id.split('.');
    const els = ek.split('+'), sh = SHAPES[shape];
    if (!sh || els.some((e) => !ELEMENTS[e])) return null;
    const fused = els.length > 1;
    const E = els.map((e) => ELEMENTS[e]);
    const dmgM = E.reduce((a, e) => a + e.dmg, 0) / E.length * (fused ? 1.2 : 1);
    const cdM = Math.min(...E.map((e) => e.cd));
    const name = NAME_OVERRIDES[id] || `${fused ? FUSION_NAMES[ek] : E[0].adj} ${sh.name}`;
    d = { id, name, els, shape, sh, fused, color: fused ? mixHex(E[0].color, E[1].color) : E[0].color,
      cd: +(sh.cd * cdM).toFixed(2), dmg: sh.dmg * dmgM, range: sh.range, info: sh.info + (fused ? ` (${E[0].name} + ${E[1].name})` : '') };
  }
  cache.set(id, d);
  return d;
}
export function allSpellIds() {
  const ids = [];
  const keys = [...ELEMENT_ORDER];
  for (let i = 0; i < ELEMENT_ORDER.length; i++) for (let j = i + 1; j < ELEMENT_ORDER.length; j++) keys.push(ELEMENT_ORDER[i] + '+' + ELEMENT_ORDER[j]);
  for (const k of keys) for (const s of SHAPE_ORDER) ids.push(k + '.' + s);
  return ids.concat(Object.keys(BOSS_SPELLS), Object.keys(LEGENDARY));
}
export const TOTAL_SPELLS = allSpellIds().length;
// what each level adds, per behaviour
export function levelText(def, lv) {
  if (lv === 2 || lv === 4) return '+30% damage';
  const b = def.sh.beh;
  if (lv === 3) return { proj: '+1 projectile', chain: '+2 jumps', orbit: '+1 orb', rain: '+2 strikes', radial: '+4 shots', nova: '+25% area', zone: '+25% area', mine: '+25% area', beam: '+50% duration', summon: '+1 familiar' }[b] || '+30% damage';
  if (lv === 5) return { proj: '+1 projectile, 15% faster', chain: '+3 jumps', orbit: '+2 orbs', rain: '+3 strikes', radial: '+6 shots', nova: 'Casts twice', zone: 'Lasts twice as long', mine: 'Drops two', beam: 'Splits to 2 foes', summon: '+1 familiar, faster' }[b] || '+30% damage';
  return '';
}
export function fusionOf(a, b) {
  const A = spellDef(a.id), B = spellDef(b.id);
  if (!A || !B || A.fused || B.fused || A.legendary || B.legendary || A.bossSpell || B.bossSpell) return null;
  if (A.els[0] === B.els[0]) return null;
  const main = b.lv > a.lv ? B : A; // the higher-level spell keeps its shape
  return elKey([A.els[0], B.els[0]]) + '.' + main.shape;
}

// ---------- enemy resistances (multipliers; 0 = immune) ----------
export const RES = {
  slime: { fire: 1.5, venom: 0.5 }, big: { fire: 1.5, venom: 0.5 }, boss: { fire: 1.3, venom: 0.4 },
  eye: { arcane: 0.5, storm: 1.5 }, eyeboss: { arcane: 0.5, storm: 1.4, holy: 1.3 },
  imp: { shadow: 0, holy: 1.75, fire: 0.75 },
  skeleton: { venom: 0, holy: 1.75, earth: 1.5, frost: 0.75 }, tyrant: { venom: 0, holy: 1.6, earth: 1.3, shadow: 0.5 },
  bomber: { fire: 0, frost: 1.75 },
  ghost: { shadow: 0.5, holy: 2, earth: 0.5, arcane: 1.3 }, wraithboss: { shadow: 0.3, holy: 1.8, frost: 0.6 },
  shroom: { venom: 0, fire: 1.75, frost: 0.75 }, sporeboss: { venom: 0, fire: 1.6 },
  golem: { earth: 0.25, storm: 1.5, venom: 0.5, fire: 0.75 }, golemboss: { earth: 0.25, storm: 1.4, venom: 0.5 },
  mimic: { arcane: 0.75, fire: 1.25 },
};
export const UNDEAD = new Set(['skeleton', 'ghost', 'tyrant', 'wraithboss']);
export function resistOf(type, els, extra) {
  let m = 0;
  for (const el of els) m += (extra && extra[el] !== undefined ? extra[el] : (RES[type] && RES[type][el] !== undefined ? RES[type][el] : 1));
  return els.length ? m / els.length : 1;
}

// ---------- heroes (same mechanics, different look and a small passive) ----------
// cls decides what the Ragnarok-style stats do (see derive)
export const HEROES = {
  wizard: { name: 'Wizard', cls: 'mage', sprite: 'wizard', vis: null, cost: 0, info: 'Mage: INT = damage, DEX = faster casting', start: 'arcane.bolt', tipColor: 0xff7fe0,
    base: { str: 1, agi: 2, vit: 2, int: 6, dex: 4, luk: 2 } },
  amazon: { name: 'Amazon', cls: 'hunter', sprite: 'amazon', vis: 'javelin', cost: 80, info: 'Hunter: STR + DEX = damage, throws pierce one more foe', start: 'arcane.lance', tipColor: 0xffd27a,
    base: { str: 4, agi: 5, vit: 3, int: 1, dex: 4, luk: 2 } },
  berserker: { name: 'Berserker', cls: 'warrior', sprite: 'berserker', vis: 'axe', cost: 110, info: 'Warrior: STR = damage, VIT gives more hearts', start: 'earth.glaive', tipColor: 0xc8d4e0,
    base: { str: 7, agi: 3, vit: 6, int: 1, dex: 2, luk: 1 } },
  ranger: { name: 'Ranger', cls: 'archer', sprite: 'ranger', vis: 'arrow', cost: 90, info: 'Archer: DEX = damage, AGI = attack speed, +2 range', start: 'arcane.bolt', tipColor: 0xb8f07a,
    base: { str: 2, agi: 5, vit: 2, int: 1, dex: 6, luk: 3 } },
  necro: { name: 'Necromancer', cls: 'mage', sprite: 'necro', vis: 'skull', cost: 140, info: 'Mage: every hit curses, cursed foes explode harder', start: 'shadow.bolt', tipColor: 0x7dff9a,
    base: { str: 1, agi: 2, vit: 3, int: 6, dex: 3, luk: 3 } },
};
export const STATS = ['str', 'agi', 'vit', 'int', 'dex', 'luk'];
export const STAT_NAMES = { str: 'STR', agi: 'AGI', vit: 'VIT', int: 'INT', dex: 'DEX', luk: 'LUK' };
// Ragnarok-style: the same stat means different things for different classes
export function derive(cls, st) {
  const d = { dmg: 1, cd: 1, dodge: Math.min(0.45, st.agi * 0.006), hearts: Math.floor(st.vit / 5), crit: st.luk * 0.008, critDmg: st.luk * 0.02,
    status: 1 + st.int * 0.03, speed: 1 + st.agi * 0.004, loot: st.luk * 0.02 };
  if (cls === 'mage') { d.dmg = 1 + st.int * 0.04 + st.str * 0.005; d.cd = 1 / (1 + st.dex * 0.015 + st.agi * 0.004); }
  else if (cls === 'archer') { d.dmg = 1 + st.dex * 0.04 + st.str * 0.01; d.cd = 1 / (1 + st.agi * 0.015 + st.dex * 0.004); }
  else if (cls === 'warrior') { d.dmg = 1 + st.str * 0.04 + st.dex * 0.01; d.cd = 1 / (1 + st.agi * 0.012); d.hearts = Math.floor(st.vit / 4); }
  else { d.dmg = 1 + st.str * 0.025 + st.dex * 0.025; d.cd = 1 / (1 + st.agi * 0.013); } // hunter
  return d;
}
export function statInfo(cls, k) {
  const main = { mage: { int: 'damage', dex: 'casting speed' }, archer: { dex: 'damage', agi: 'attack speed' }, warrior: { str: 'damage', vit: 'hearts (1 per 4)' }, hunter: { str: 'damage', dex: 'damage', agi: 'attack speed' } }[cls] || {};
  const base = { str: 'a little damage', agi: 'dodge, move speed', vit: 'hearts (1 per 5)', int: 'status effect power', dex: 'a little speed', luk: 'crit, crit damage, loot' };
  return main[k] ? `${main[k]} · ${base[k]}` : base[k];
}
// progressive and slow: each level-up is a power pick, so they should feel earned (lv1 22, lv5 92, lv10 252, lv20 812 xp)
export const xpNeed = (lv) => Math.round(12 + 8 * lv + 1.6 * lv * lv);

// ---------- gear ----------
export const SLOTS = ['hat', 'robe', 'staff', 'ring', 'amulet', 'boots'];
export const SLOT_NAMES = { hat: 'Hat', robe: 'Robe', staff: 'Staff', ring: 'Ring', amulet: 'Amulet', boots: 'Boots' };
const BASE_NAMES = { hat: ['Hood', 'Cowl', 'Hat', 'Circlet'], robe: ['Robe', 'Vestments', 'Cloak', 'Mantle'], staff: ['Staff', 'Rod', 'Wand', 'Scepter'],
  ring: ['Ring', 'Band', 'Loop', 'Signet'], amulet: ['Amulet', 'Pendant', 'Talisman', 'Charm'], boots: ['Boots', 'Slippers', 'Treads', 'Sandals'] };
export const RARITY = [
  { key: 'common', name: 'Common', color: '#d8d8e0', n: 1, mult: 1 },
  { key: 'rare', name: 'Rare', color: '#5fb4ff', n: 2, mult: 1.15 },
  { key: 'epic', name: 'Epic', color: '#c07aff', n: 3, mult: 1.3 },
  { key: 'legendary', name: 'Legendary', color: '#ffa040', n: 3, mult: 1.5 },
];
export const AFFIXES = {
  power: { pre: 'Mighty', lo: 6, hi: 14, fmt: (v) => `+${v}% spell damage` },
  haste: { pre: 'Quick', lo: 4, hi: 9, fmt: (v) => `-${v}% cooldowns` },
  vit: { pre: 'Sturdy', lo: 1, hi: 1, fmt: () => '+1 heart', slots: ['hat', 'robe', 'amulet'] },
  speed: { pre: 'Fleet', lo: 5, hi: 10, fmt: (v) => `+${v}% move speed`, slots: ['boots', 'robe'] },
  crit: { pre: 'Keen', lo: 4, hi: 9, fmt: (v) => `+${v}% crit chance` },
  critdmg: { pre: 'Cruel', lo: 20, hi: 45, fmt: (v) => `+${v}% crit damage` },
  area: { pre: 'Vast', lo: 8, hi: 18, fmt: (v) => `+${v}% area` },
  dur: { pre: 'Lasting', lo: 10, hi: 25, fmt: (v) => `+${v}% duration` },
  proj: { pre: 'Twin', lo: 1, hi: 1, fmt: () => '+1 projectile', slots: ['staff', 'amulet'], minRarity: 1 },
  magnet: { pre: 'Magnetic', lo: 20, hi: 50, fmt: (v) => `+${v}% pickup range`, slots: ['ring', 'boots'] },
  luck: { pre: 'Lucky', lo: 10, hi: 25, fmt: (v) => `+${v}% luck` },
  dodge: { pre: 'Nimble', lo: 4, hi: 8, fmt: (v) => `${v}% chance to dodge`, slots: ['robe', 'boots', 'ring'] },
  el: { pre: null, lo: 15, hi: 35, fmt: (v, el) => `+${v}% ${ELEMENTS[el].name} damage` },
  str: { pre: 'Brutal', lo: 1, hi: 3, fmt: (v) => `+${v} STR`, stat: true },
  agi: { pre: 'Swift', lo: 1, hi: 3, fmt: (v) => `+${v} AGI`, stat: true },
  vitst: { pre: 'Hale', lo: 1, hi: 3, fmt: (v) => `+${v} VIT`, stat: true },
  int: { pre: 'Sage', lo: 1, hi: 3, fmt: (v) => `+${v} INT`, stat: true },
  dex: { pre: 'Deft', lo: 1, hi: 3, fmt: (v) => `+${v} DEX`, stat: true },
  luk: { pre: 'Fortunate', lo: 1, hi: 3, fmt: (v) => `+${v} LUK`, stat: true },
};
const EL_PRE = { arcane: 'Mystic', fire: 'Emberwoven', frost: 'Rimed', storm: 'Charged', venom: 'Toxic', shadow: 'Umbral', holy: 'Blessed', earth: 'Stoneset' };
export const UNIQUES = {
  hat: [{ id: 'cinders', name: 'Crown of Cinders', info: 'Burning foes explode when they die' }, { id: 'glass', name: 'Glass Hat', info: '+50% damage, but -1 heart' }],
  robe: [{ id: 'mirror', name: 'Robe of Mirrors', info: 'The first hit in every room is blocked' }, { id: 'shroud', name: 'Shroud of Night', info: 'Curse explosions are twice as big' }],
  staff: [{ id: 'stormcaller', name: 'Stormcaller', info: 'Every 8th cast fires twice' }, { id: 'prism', name: 'Prism Staff', info: 'Every hit adds a random element' }],
  ring: [{ id: 'echo', name: 'Ring of Echoes', info: '20% chance for spells to cast twice' }, { id: 'ouro', name: 'Ouroboros', info: 'Kills shave 0.1s off every cooldown' }],
  amulet: [{ id: 'lich', name: 'Heart of the Lich', info: 'Heal half a heart every 15 kills' }, { id: 'hourglass', name: 'Hourglass', info: '-20% cooldowns' }],
  boots: [{ id: 'frostwalk', name: 'Frostwalkers', info: 'You leave a chilling trail' }, { id: 'league', name: 'Seven-League Boots', info: '+30% speed, pickups fly to you' }],
};
export function rollRarity(rnd, floor, luck = 0, min = 0) {
  const w = [60, 28 + floor, 10 + floor * 0.8, (2 + floor * 0.4) * (1 + luck)];
  for (let i = 0; i < min; i++) w[i] = 0;
  let t = w.reduce((a, b) => a + b, 0) * rnd();
  for (let i = 0; i < 4; i++) if ((t -= w[i]) <= 0) return i;
  return 3;
}
export function rollGear(rnd, floor, luck = 0, minRarity = 0, slot = null) {
  const pickA = (a) => a[Math.floor(rnd() * a.length)];
  slot = slot || pickA(SLOTS);
  const r = rollRarity(rnd, floor, luck, minRarity), R = RARITY[r];
  const scale = R.mult * (1 + 0.04 * Math.min(floor, 20));
  const pool = Object.keys(AFFIXES).filter((k) => (!AFFIXES[k].slots || AFFIXES[k].slots.includes(slot)) && (AFFIXES[k].minRarity || 0) <= r);
  const affixes = [];
  while (affixes.length < R.n && pool.length) {
    const id = pool.splice(Math.floor(rnd() * pool.length), 1)[0], A = AFFIXES[id];
    let v = A.lo + Math.round(rnd() * (A.hi - A.lo));
    if (A.stat) v = Math.max(1, Math.round(v * R.mult + Math.floor(floor / 6)));
    else if (A.hi > 1) v = Math.round(v * scale);
    affixes.push(id === 'el' ? { id, v, el: pickA(ELEMENT_ORDER) } : { id, v });
  }
  const item = { slot, rarity: r, affixes, uid: Math.floor(rnd() * 1e9) };
  if (r === 3) { const u = pickA(UNIQUES[slot]); item.unique = u.id; item.name = u.name; item.uinfo = u.info; }
  else {
    const a = affixes[0];
    item.name = `${a.id === 'el' ? EL_PRE[a.el] : AFFIXES[a.id].pre} ${pickA(BASE_NAMES[slot])}`;
  }
  return item;
}
export function gearLines(item) {
  const out = item.affixes.map((a) => AFFIXES[a.id].fmt(a.v, a.el));
  if (item.uinfo) out.push(item.uinfo);
  return out;
}
export function gearScore(item) {
  return item.rarity * 10 + item.affixes.reduce((s, a) => s + (AFFIXES[a.id].stat ? a.v : AFFIXES[a.id].hi > 1 ? a.v / AFFIXES[a.id].hi * 3 : 3), 0) + (item.unique ? 6 : 0);
}
// totals from everything equipped
export function gearTotals(equipped) {
  const t = { st: { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 }, dmg: 1, cd: 1, hp: 0, speed: 1, crit: 0, critDmg: 0, area: 1, dur: 1, proj: 0, magnet: 1, luck: 0, dodge: 0, el: {}, flags: {} };
  for (const it of Object.values(equipped)) {
    if (!it) continue;
    for (const a of it.affixes) {
      const v = a.v;
      switch (a.id) {
        case 'power': t.dmg *= 1 + v / 100; break;
        case 'haste': t.cd *= 1 - v / 100; break;
        case 'vit': t.hp += 2 * v; break;
        case 'speed': t.speed *= 1 + v / 100; break;
        case 'crit': t.crit += v / 100; break;
        case 'critdmg': t.critDmg += v / 100; break;
        case 'area': t.area *= 1 + v / 100; break;
        case 'dur': t.dur *= 1 + v / 100; break;
        case 'proj': t.proj += 1; break;
        case 'magnet': t.magnet *= 1 + v / 100; break;
        case 'luck': t.luck += v / 100; break;
        case 'dodge': t.dodge += v / 100; break;
        case 'el': t.el[a.el] = (t.el[a.el] || 1) * (1 + v / 100); break;
        case 'str': case 'agi': case 'int': case 'dex': case 'luk': t.st[a.id] += v; break;
        case 'vitst': t.st.vit += v; break;
      }
    }
    if (it.unique) {
      t.flags[it.unique] = true;
      if (it.unique === 'glass') { t.dmg *= 1.5; t.hp -= 2; }
      if (it.unique === 'hourglass') t.cd *= 0.8;
      if (it.unique === 'league') { t.speed *= 1.3; t.magnet *= 3; }
    }
  }
  return t;
}
