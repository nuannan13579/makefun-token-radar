// Board assembly: snapshot + comp model -> the ranked board, the dashboard's data, and the gate check.
//
// The board ranks every rankable pre-token protocol (lib/model.ts isRankable), watchlist first by
// guarantee and the rest because a radar that stops at the floor finds nothing early. Tokenized
// protocols are never ranked: they are the evidence (their multiples price the board) and the
// dashboard shows the largest of them separately, at the market's own values.

import {
  AGE_CAP_YEARS,
  AGE_WEIGHT_PER_YEAR,
  ADJUSTMENT_MAX,
  ADJUSTMENT_MIN,
  BREADTH_CAP_EXTRA,
  BREADTH_WEIGHT,
  COMP_MULTIPLE_MAX,
  COMP_MULTIPLE_MIN,
  FULL_WEIGHT_COMPS,
  MODEL_VERSION,
  MOMENTUM_CAP_PCT,
  MOMENTUM_FLOOR_PCT,
  MOMENTUM_WEIGHT,
  buildCompModel,
  isRankable,
  recordsNoToken,
  valueProtocol,
  type CategoryMultiple,
  type Comp,
  type CompModel,
  type MultipleBasis,
  type Snapshot,
  type SnapshotProtocol,
  type Valuation,
} from './model.ts';
import { farmSteps } from './farm.ts';

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  token_status: string;
  implied_value_usd: number;
  implied_multiple: number;
  model: {
    multiple: number;
    basis: MultipleBasis;
    category_comp_count: number;
    fallback_comp_count: number;
    category_own_median: number | null;
    momentum_factor: number;
    age_factor: number;
    breadth_factor: number;
    adjustment: number;
  };
  farm_steps: string[];
}

/** A board row as the dashboard receives it: the same numbers, plus nothing it cannot show. */
export interface RadarRow extends BoardRow {}

/** A tokenized protocol the dashboard sets aside: it already trades, at the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  methodology: string;
  counts: { protocols: number; pre_token: number; watchlist: number; board: number; set_aside: number; tokenized: number };
  market_median: number;
  market_comp_count: number;
  categories: CategoryMultiple[];
  comps_by_category: Record<string, Comp[]>;
  rows: RadarRow[];
  live: LiveRow[];
}

/** The method in plain language: printed in board.json and paraphrased on the dashboard. */
export function methodologyText(snapshot: Snapshot, model: CompModel): string {
  return [
    `Implied value answers one question: what would a token be worth if this protocol's record stayed as the snapshot of ${snapshot.as_of} shows it? It is this board's own claim, not a prediction that a token will be issued.`,
    `Evidence: the ${model.market_comp_count} tokenized protocols in the snapshot with a usable market cap give market-cap-to-TVL multiples; multiples below ${COMP_MULTIPLE_MIN} or above ${COMP_MULTIPLE_MAX} are dropped as outliers. Each category's multiple is the median of its tokenized comps (all-market median ${model.market_median}x). A category with fewer than ${FULL_WEIGHT_COMPS} comps is shrunk toward its family's median in log space, weighted by its comp count, and a category with no comps uses its family or the all-market median outright.`,
    `Base value = TVL x category multiple. Three adjustments follow, each from the snapshot's own fields: momentum (7-day TVL change clamped to ${MOMENTUM_FLOOR_PCT}%..+${MOMENTUM_CAP_PCT}%, weighted ${MOMENTUM_WEIGHT}), age (+${AGE_WEIGHT_PER_YEAR * 100}% per tracked year, capped at ${AGE_CAP_YEARS} years; an unrecorded listing date is neutral), and chain breadth (+${BREADTH_WEIGHT * 100}% per chain past the first, capped at ${BREADTH_CAP_EXTRA}). The combined adjustment is clamped to ${ADJUSTMENT_MIN}..${ADJUSTMENT_MAX}.`,
    `Coverage: every watchlist protocol is ranked, plus every other protocol that records no token, excluding exchange balance sheets, the bridge and restaked-BTC categories (whose TVL is escrowed or wrapped assets whose tokens already trade), and wrapped, staked or versioned products of tokens that already trade. Protocols with tokens are never ranked; the largest are shown separately at market value and serve as the comps.`,
  ].join(' ');
}

/** The whole board document board.json carries: method first, then the rows. */
export interface BoardDocument {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  methodology: string;
  model: {
    comp_multiple_band: [number, number];
    full_weight_comps: number;
    market_median: number;
    market_comp_count: number;
    momentum: { floor_pct: number; cap_pct: number; weight: number };
    age: { weight_per_year: number; cap_years: number };
    breadth: { weight: number; cap_extra_chains: number };
    adjustment_band: [number, number];
  };
  category_multiples: CategoryMultiple[];
  counts: RadarData['counts'];
  rows: BoardRow[];
}

/** Build the board document and the dashboard's data from one snapshot. */
export function buildBoard(snapshot: Snapshot): { doc: BoardDocument; radar: RadarData } {
  const model = buildCompModel(snapshot);
  const watchlist = new Set(snapshot.watchlist);

  const chosen: SnapshotProtocol[] = [];
  const chosenSlugs = new Set<string>();
  for (const slug of snapshot.watchlist) {
    const p = snapshot.protocols.find((q) => q.slug === slug);
    if (p !== undefined && !chosenSlugs.has(slug)) {
      chosen.push(p);
      chosenSlugs.add(slug);
    }
  }
  for (const p of snapshot.protocols) {
    if (!chosenSlugs.has(p.slug) && isRankable(p)) {
      chosen.push(p);
      chosenSlugs.add(p.slug);
    }
  }

  const scored = chosen.map((p) => ({ p, v: valueProtocol(p, snapshot.as_of, model) }));
  scored.sort((a, b) => b.v.implied_value_usd - a.v.implied_value_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  const rows: BoardRow[] = scored.map(({ p, v }, i) => {
    const resolved = model.byCategory.get(p.category ?? '')!;
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: v.age_days,
      on_watchlist: watchlist.has(p.slug),
      token_status: 'no token recorded',
      implied_value_usd: v.implied_value_usd,
      implied_multiple: v.implied_multiple,
      model: {
        multiple: v.multiple,
        basis: v.basis,
        category_comp_count: resolved.comp_count,
        fallback_comp_count: resolved.fallback_comp_count,
        category_own_median: resolved.own_median,
        momentum_factor: v.momentum_factor,
        age_factor: v.age_factor,
        breadth_factor: v.breadth_factor,
        adjustment: v.adjustment,
      },
      farm_steps: farmSteps(p, v.age_days),
    };
  });

  const preToken = snapshot.protocols.filter(recordsNoToken).length;
  const counts: RadarData['counts'] = {
    protocols: snapshot.protocols.length,
    pre_token: preToken,
    watchlist: snapshot.watchlist.length,
    board: rows.length,
    set_aside: preToken - rows.length,
    tokenized: snapshot.protocols.length - preToken,
  };
  const categories = [...model.byCategory.values()].sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  const methodology = methodologyText(snapshot, model);

  const doc: BoardDocument = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    methodology,
    model: {
      comp_multiple_band: [COMP_MULTIPLE_MIN, COMP_MULTIPLE_MAX],
      full_weight_comps: FULL_WEIGHT_COMPS,
      market_median: model.market_median,
      market_comp_count: model.market_comp_count,
      momentum: { floor_pct: MOMENTUM_FLOOR_PCT, cap_pct: MOMENTUM_CAP_PCT, weight: MOMENTUM_WEIGHT },
      age: { weight_per_year: AGE_WEIGHT_PER_YEAR, cap_years: AGE_CAP_YEARS },
      breadth: { weight: BREADTH_WEIGHT, cap_extra_chains: BREADTH_CAP_EXTRA },
      adjustment_band: [ADJUSTMENT_MIN, ADJUSTMENT_MAX],
    },
    category_multiples: categories,
    counts,
    rows,
  };

  const compsByCategory: Record<string, Comp[]> = {};
  for (const key of [...model.examplesByCategory.keys()].sort()) {
    const examples = model.examplesByCategory.get(key)!;
    if (examples.length > 0) compsByCategory[key] = examples;
  }
  const live: LiveRow[] = model.comps
    .filter((c) => c.multiple >= COMP_MULTIPLE_MIN && c.multiple <= COMP_MULTIPLE_MAX)
    .sort((a, b) => b.mcap_usd - a.mcap_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, 30)
    .map((c) => ({ slug: c.slug, name: c.name, category: c.category, tvl_usd: c.tvl_usd, mcap_usd: c.mcap_usd, multiple: Math.round(c.multiple * 1000) / 1000 }));

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    methodology,
    counts,
    market_median: model.market_median,
    market_comp_count: model.market_comp_count,
    categories,
    comps_by_category: compsByCategory,
    rows,
    live,
  };
  return { doc, radar };
}

/** Why a board is not one the gate will take, or null. Mirrors the gate's board rows one by one. */
export function boardIssue(rows: BoardRow[], snapshot: Snapshot): string | null {
  if (rows.length < 100 || rows.length > 4000) return `the board holds ${rows.length} rows, outside 100..4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const r of rows) {
    if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    if (typeof r.name !== 'string' || r.name.trim() === '') return `${r.slug} has no name`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...rows].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `rank ${i + 1} outvalues rank ${i}`;
  }
  if (rows.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  return null;
}

/** The dashboard's data as one script: window.RADAR, no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar).replace(/</g, '\\u003c')};\n`;
}
