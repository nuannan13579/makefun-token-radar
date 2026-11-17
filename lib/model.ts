// Token Launch Radar: the valuation model.
//
// One sealed snapshot of the protocol universe goes in; one ranked board comes out. The board ranks
// protocols that record no token yet by IMPLIED VALUE: what a token would be worth if the protocol's
// record stayed exactly as the snapshot shows it. Nothing here predicts that a token will be issued.
//
// The model, in one paragraph. Protocols that DO have tokens are the evidence: for each of them the
// snapshot gives a market cap and a TVL, so their market-cap-to-TVL multiple is a market price for
// "one dollar of TVL in a protocol like this". For every category we take the median multiple of its
// tokenized protocols (medians resist the one wild comp), after dropping multiples outside
// [0.005, 20] as data outliers. A category with fewer than five usable comps is not trusted on its
// own: its median is shrunk toward its family's median in log space, reaching full weight at five
// comps, and a family too thin to use shrinks toward the all-market median the same way. A pre-token
// protocol's base value is its TVL times that multiple. Three adjustments follow, each computed from
// the snapshot's own fields and each kept small: 7-day TVL momentum (a growing protocol's record is
// worth more than a shrinking one's), age (a protocol tracked for years at scale with no token has a
// longer proven record), and chain breadth (a protocol live on many chains reaches more users). The
// combined adjustment is clamped to [0.75, 1.60] so no single field can dominate the multiple.
//
// Every number the board prints is recomputed from the snapshot by this file: the category table with
// comp counts and medians ships in board.json and in the dashboard's data, so a reader can audit any
// row back to the comps behind it.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

// ---------------------------------------------------------------- the model's stated constants

/** A comp multiple outside this band is a data outlier, not a valuation signal (log-symmetric-ish). */
export const COMP_MULTIPLE_MIN = 0.005;
export const COMP_MULTIPLE_MAX = 20;
/** A category median earns full weight at this many usable comps; below it, shrinkage applies. */
export const FULL_WEIGHT_COMPS = 5;
/** Momentum: change_7d is clamped to this band before it moves the value. */
export const MOMENTUM_FLOOR_PCT = -30;
export const MOMENTUM_CAP_PCT = 50;
/** Momentum weight: a +50% week is worth at most x1.30, a -30% week at least x0.82. */
export const MOMENTUM_WEIGHT = 0.6;
/** Age: +5% per tracked year, capped at four years (x1.20 at most). */
export const AGE_WEIGHT_PER_YEAR = 0.05;
export const AGE_CAP_YEARS = 4;
/** Breadth: +2% per chain past the first, capped at five extra chains (x1.10 at most). */
export const BREADTH_WEIGHT = 0.02;
export const BREADTH_CAP_EXTRA = 5;
/** The three adjustments together never move a value outside this band. */
export const ADJUSTMENT_MIN = 0.75;
export const ADJUSTMENT_MAX = 1.6;

/** The model's version label, printed on the board and the dashboard. */
export const MODEL_VERSION = 'comp-median-2';

/**
 * Category families: the fallback grouping when a category's own comps are thin. Families group
 * categories whose tokens the market prices on the same basis (what the TVL does), never by name
 * similarity alone. A category in no family falls back to the all-market median directly.
 */
export const FAMILIES: Readonly<Record<string, readonly string[]>> = {
  'Lending & credit': ['Lending', 'CDP', 'CDP Manager', 'Collateral Markets', 'Collateral Management', 'Uncollateralized Lending', 'Leveraged Farming'],
  'Trading venues': ['Dexs', 'Derivatives', 'Options', 'Options Vault', 'Interest Rate Derivatives', 'Prediction Market', 'OTC Marketplace'],
  'Yield & vaults': ['Yield', 'Yield Aggregator', 'Farm', 'Risk Curators', 'Onchain Capital Allocator', 'Liquidity Manager', 'Indexes', 'Basis Trading'],
  'Staking & restaking': ['Liquid Staking', 'Staking Pool', 'Liquid Restaking', 'Restaking', 'Restaked BTC', 'Dual-Token Stablecoin'],
  'Bridges & wrapped BTC': ['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Anchor BTC', 'Decentralized BTC', 'Stablecoin Wrapper'],
  'Real-world assets & payments': ['RWA', 'Insurance', 'Payments', 'Crypto Card Issuer', 'CeDeFi'],
  Infrastructure: ['Chain', 'Privacy', 'Governance Incentives', 'Launchpad', 'NFT Marketplace', 'AI Agents', 'Decentralized AI', 'Token Locker', 'DOR', 'CEX'],
};

/** Category -> family name, derived from FAMILIES. */
const FAMILY_OF: ReadonlyMap<string, string> = new Map(
  Object.entries(FAMILIES).flatMap(([family, cats]) => cats.map((c) => [c, family] as const)),
);

// ---------------------------------------------------------------- small numeric helpers

const DAY_MS = 86_400_000;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round3 = (n: number): number => Math.round(n * 1e3) / 1e3;

/** The median of a non-empty list (the list is copied, never mutated). */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

// ---------------------------------------------------------------- who is on the board

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * Categories whose TVL is, by construction, another asset in transit or in a wrapper: a bridge's TVL
 * is escrowed BTC, ETH and stablecoins whose tokens already trade (WBTC and USDT0 sit in Bridge in
 * this snapshot, each a traded token wearing a bridge's name), and restaked BTC is Bitcoin restated.
 * The watchlist's rule sets Bridge and Canonical Bridge aside for exactly this reason; the board does
 * the same for every bridge category and for Restaked BTC. A bridge service with a token of its own
 * coming (a network's cross-chain service) belongs to that network's record, not to the escrow total.
 */
const WRAPPER_CATEGORIES: ReadonlySet<string> = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Restaked BTC']);

/**
 * Whether a pre-token protocol belongs on the ranked board. The board sets aside what the watchlist's
 * own rule sets aside, for the same reason: an exchange's balance sheet is not a launch candidate,
 * and a wrapped, staked, bridged or versioned product of a protocol whose token already trades is
 * that token wearing another name, not a token that does not exist yet. Watchlist slugs are always
 * ranked: the caller adds them before this filter is consulted for the rest.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category === 'CEX') return false;
  if (p.category !== null && WRAPPER_CATEGORIES.has(p.category)) return false;
  if (VERSIONED_NAME.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

// ---------------------------------------------------------------- the comp evidence

/** One tokenized protocol used as a valuation comparable. */
export interface Comp {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

/** The multiples one grouping carries, after outlier trimming. */
interface MultipleSet {
  /** Usable comp multiples (trimmed), in comp order. */
  multiples: number[];
  /** How many comps trimming dropped. */
  dropped: number;
}

/** Every tokenized protocol with a usable market cap, as a comp (snapshot order: by slug). */
export function collectComps(snapshot: Snapshot): Comp[] {
  const comps: Comp[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    comps.push({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, multiple: p.mcap_usd / p.tvl_usd });
  }
  return comps;
}

/** The trimmed multiples of one comp subset. */
function multipleSet(comps: readonly Comp[]): MultipleSet {
  const kept: number[] = [];
  let dropped = 0;
  for (const c of comps) {
    if (c.multiple >= COMP_MULTIPLE_MIN && c.multiple <= COMP_MULTIPLE_MAX) kept.push(c.multiple);
    else dropped += 1;
  }
  return { multiples: kept, dropped };
}

/** How a category's multiple was reached: its own comps, shrunk to its family, or shrunk to the market. */
export type MultipleBasis = 'category' | 'category+family' | 'category+market' | 'family' | 'market';

/** The resolved multiple for one category, with the evidence behind it. */
export interface CategoryMultiple {
  category: string;
  family: string | null;
  basis: MultipleBasis;
  /** The multiple the model applies (after any shrinkage), rounded to 4 decimals. */
  multiple: number;
  /** The category's own trimmed median, before shrinkage; null when it has no usable comp. */
  own_median: number | null;
  /** Usable comps in the category itself. */
  comp_count: number;
  /** Usable comps in the fallback set actually used (family or market); 0 when basis is 'category'. */
  fallback_comp_count: number;
  /** Comps dropped as outliers from the category itself. */
  dropped_outliers: number;
}

/** Everything the model derives from the comp set, once per snapshot. */
export interface CompModel {
  comps: Comp[];
  /** The all-market trimmed median multiple. */
  market_median: number;
  market_comp_count: number;
  /** Per-category resolution, keyed by category name ('' stands for a null category). */
  byCategory: Map<string, CategoryMultiple>;
  /** The largest comps of each category by TVL, for the detail view (keyed like byCategory). */
  examplesByCategory: Map<string, Comp[]>;
}

/**
 * Shrink a thin median toward a fallback median in log space: the own median carries weight
 * n / FULL_WEIGHT_COMPS and the fallback the rest, so five own comps would stand alone (the caller
 * uses them directly) and zero own comps land exactly on the fallback.
 */
function shrink(ownMedian: number, fallbackMedian: number, ownCount: number): number {
  const w = clamp(ownCount / FULL_WEIGHT_COMPS, 0, 1);
  return Math.exp(w * Math.log(ownMedian) + (1 - w) * Math.log(fallbackMedian));
}

/** Build the comp model: medians per category with family and market fallbacks. */
export function buildCompModel(snapshot: Snapshot): CompModel {
  const comps = collectComps(snapshot);
  const marketSet = multipleSet(comps);
  const marketMedian = median(marketSet.multiples);

  const inCategory = (cat: string | null): Comp[] => comps.filter((c) => (c.category ?? '') === (cat ?? ''));
  const inFamily = (family: string): Comp[] => {
    const cats = new Set(FAMILIES[family] ?? []);
    return comps.filter((c) => c.category !== null && cats.has(c.category));
  };

  const categories = new Set<string>();
  for (const p of snapshot.protocols) categories.add(p.category ?? '');
  for (const c of comps) categories.add(c.category ?? '');

  const byCategory = new Map<string, CategoryMultiple>();
  const examplesByCategory = new Map<string, Comp[]>();
  for (const key of [...categories].sort()) {
    const category = key === '' ? null : key;
    const own = inCategory(category);
    const ownSet = multipleSet(own);
    const ownMedian = ownSet.multiples.length > 0 ? median(ownSet.multiples) : null;
    const family = category === null ? null : (FAMILY_OF.get(category) ?? null);

    let multiple: number;
    let basis: MultipleBasis;
    let fallbackCount = 0;
    if (ownSet.multiples.length >= FULL_WEIGHT_COMPS && ownMedian !== null) {
      multiple = ownMedian;
      basis = 'category';
    } else {
      // Prefer the family fallback; use the market when the family is itself too thin or absent.
      let fallbackMedian = marketMedian;
      let fallbackBasis: MultipleBasis = ownMedian === null ? 'market' : 'category+market';
      fallbackCount = marketSet.multiples.length;
      if (family !== null) {
        const famSet = multipleSet(inFamily(family));
        if (famSet.multiples.length >= FULL_WEIGHT_COMPS) {
          fallbackMedian = median(famSet.multiples);
          fallbackBasis = ownMedian === null ? 'family' : 'category+family';
          fallbackCount = famSet.multiples.length;
        }
      }
      multiple = ownMedian === null ? fallbackMedian : shrink(ownMedian, fallbackMedian, ownSet.multiples.length);
      basis = fallbackBasis;
    }

    byCategory.set(key, {
      category: key,
      family,
      basis,
      multiple: round4(multiple),
      own_median: ownMedian === null ? null : round4(ownMedian),
      comp_count: ownSet.multiples.length,
      fallback_comp_count: basis === 'category' ? 0 : fallbackCount,
      dropped_outliers: ownSet.dropped,
    });
    examplesByCategory.set(
      key,
      [...own].sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1)).slice(0, 5),
    );
  }
  return { comps, market_median: round4(marketMedian), market_comp_count: marketSet.multiples.length, byCategory, examplesByCategory };
}

// ---------------------------------------------------------------- scoring one protocol

/** The full arithmetic of one protocol's implied value, every factor stated. */
export interface Valuation {
  multiple: number;
  basis: MultipleBasis;
  momentum_factor: number;
  age_factor: number;
  breadth_factor: number;
  adjustment: number;
  implied_value_usd: number;
  implied_multiple: number;
  age_days: number | null;
}

/** Value one pre-token protocol from the comp model and the snapshot's date. */
export function valueProtocol(p: SnapshotProtocol, asOf: string, model: CompModel): Valuation {
  const resolved = model.byCategory.get(p.category ?? '')!;
  const age = ageDays(asOf, p.listed_at);

  const change = p.change_7d === null ? 0 : clamp(p.change_7d, MOMENTUM_FLOOR_PCT, MOMENTUM_CAP_PCT);
  // Each factor is rounded to the 4 decimals the board prints BEFORE it is used, so the arithmetic a
  // reader can check (TVL x multiple x adjustment) reproduces the printed implied value exactly.
  const momentumFactor = round4(p.change_7d === null ? 1 : 1 + (change / 100) * MOMENTUM_WEIGHT);
  const ageYears = age === null ? 0 : age / 365.25;
  const ageFactor = round4(age === null ? 1 : 1 + AGE_WEIGHT_PER_YEAR * Math.min(ageYears, AGE_CAP_YEARS));
  const breadthFactor = round4(1 + BREADTH_WEIGHT * Math.min(Math.max(p.chains.length - 1, 0), BREADTH_CAP_EXTRA));

  const adjustment = round4(clamp(momentumFactor * ageFactor * breadthFactor, ADJUSTMENT_MIN, ADJUSTMENT_MAX));
  const implied = Math.max(1, Math.round(p.tvl_usd * resolved.multiple * adjustment));
  return {
    multiple: resolved.multiple,
    basis: resolved.basis,
    momentum_factor: momentumFactor,
    age_factor: ageFactor,
    breadth_factor: breadthFactor,
    adjustment,
    implied_value_usd: implied,
    implied_multiple: round3(implied / p.tvl_usd),
    age_days: age,
  };
}

// ---------------------------------------------------------------- snapshot parsing

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}
