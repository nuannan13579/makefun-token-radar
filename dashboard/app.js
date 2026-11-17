/* Token Launch Radar: renders window.RADAR (written by main.ts beside this page) with no network,
   no framework and no fetch. Views are hash routes: #/ the board, #/p/<slug> a protocol's detail,
   #/live the tokenized set-aside, #/method the model. Board filters live in the hash too, so a
   filtered view is a link and a screenshot of it shows exactly what was filtered. */

'use strict';

const R = window.RADAR;
const rows = R.rows;
const bySlug = new Map(rows.map((r) => [r.slug, r]));

/* ---------- formatting ---------- */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function fmtUsd(n) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n}`;
}
const fmtFull = (n) => `$${n.toLocaleString('en-US')}`;
const fmtMult = (x) => `${x.toFixed(2)}x`;
function fmtPct(x) {
  if (x === null || x === undefined) return '<span class="slug">n/a</span>';
  const cls = x > 0 ? 'pos' : x < 0 ? 'neg' : '';
  return `<span class="${cls}">${x > 0 ? '+' : ''}${x.toFixed(1)}%</span>`;
}
function fmtAge(days) {
  if (days === null) return 'not recorded';
  if (days < 365) return `${days} days`;
  const y = Math.floor(days / 365);
  return `${y} yr ${days - y * 365} d`;
}
const catName = (c) => (c === null || c === '' ? 'Uncategorised' : c);

/* ---------- board state ---------- */

const state = { q: '', cat: '', chain: '', min: 0, wl: false, sort: 'value' };
let lastBoardHash = '#/';

function hashForState() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.cat) p.set('cat', state.cat);
  if (state.chain) p.set('chain', state.chain);
  if (state.min) p.set('min', String(state.min));
  if (state.wl) p.set('wl', '1');
  if (state.sort !== 'value') p.set('sort', state.sort);
  const s = p.toString();
  return s ? `#/?${s}` : '#/';
}

function stateFromParams(p) {
  state.q = p.get('q') ?? '';
  state.cat = p.get('cat') ?? '';
  state.chain = p.get('chain') ?? '';
  state.min = Number(p.get('min') ?? 0) || 0;
  state.wl = p.get('wl') === '1';
  state.sort = p.get('sort') ?? 'value';
}

const SORTERS = {
  value: (a, b) => b.implied_value_usd - a.implied_value_usd || a.rank - b.rank,
  tvl: (a, b) => b.tvl_usd - a.tvl_usd || a.rank - b.rank,
  'change-desc': (a, b) => (b.change_7d ?? -Infinity) - (a.change_7d ?? -Infinity) || a.rank - b.rank,
  'change-asc': (a, b) => (a.change_7d ?? Infinity) - (b.change_7d ?? Infinity) || a.rank - b.rank,
  multiple: (a, b) => b.implied_multiple - a.implied_multiple || a.rank - b.rank,
  age: (a, b) => (b.age_days ?? -1) - (a.age_days ?? -1) || a.rank - b.rank,
  name: (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.rank - b.rank),
};

function visibleRows() {
  const q = state.q.trim().toLowerCase();
  const out = rows.filter((r) => {
    if (state.wl && !r.on_watchlist) return false;
    if (state.cat && catName(r.category) !== state.cat) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (state.min && r.implied_value_usd < state.min) return false;
    if (q && !r.name.toLowerCase().includes(q) && !r.slug.includes(q)) return false;
    return true;
  });
  out.sort(SORTERS[state.sort] ?? SORTERS.value);
  return out;
}

/* ---------- board view ---------- */

const boardBody = document.getElementById('board-body');
const countLine = document.getElementById('count-line');
const boardEmpty = document.getElementById('board-empty');

function chainsCell(chains) {
  if (chains.length === 0) return '<span class="slug">none recorded</span>';
  const shown = chains.slice(0, 2).map(esc).join(', ');
  return chains.length > 2 ? `${shown} <span class="slug">+${chains.length - 2}</span>` : shown;
}

function renderBoard() {
  const vis = visibleRows();
  boardBody.innerHTML = vis
    .map(
      (r) => `<tr data-slug="${esc(r.slug)}" tabindex="0" role="link" aria-label="${esc(r.name)} detail">
      <td class="num">${r.rank}</td>
      <td><span class="pname">${esc(r.name)}</span>${r.on_watchlist ? '<span class="badge">Watchlist</span>' : ''}<br><span class="slug">${esc(r.slug)}</span></td>
      <td>${esc(catName(r.category))}</td>
      <td>${chainsCell(r.chains)}</td>
      <td class="num">${fmtUsd(r.tvl_usd)}</td>
      <td class="num">${fmtPct(r.change_7d)}</td>
      <td class="num"><strong>${fmtUsd(r.implied_value_usd)}</strong></td>
      <td class="num">${fmtMult(r.implied_multiple)}</td>
    </tr>`,
    )
    .join('');
  boardEmpty.hidden = vis.length > 0;
  countLine.innerHTML = `Showing <strong>${vis.length}</strong> of ${rows.length} ranked protocols` +
    (state.wl || state.cat || state.chain || state.min || state.q ? ' (filters on — <a href="#/" id="clear-filters">clear them</a>)' : '');
  const clear = document.getElementById('clear-filters');
  if (clear) clear.addEventListener('click', (e) => { e.preventDefault(); resetFilters(); });
}

function resetFilters() {
  state.q = ''; state.cat = ''; state.chain = ''; state.min = 0; state.wl = false; state.sort = 'value';
  syncControls();
  history.replaceState(null, '', '#/');
  lastBoardHash = '#/';
  renderBoard();
}

function syncControls() {
  document.getElementById('f-q').value = state.q;
  document.getElementById('f-cat').value = state.cat;
  document.getElementById('f-chain').value = state.chain;
  document.getElementById('f-min').value = String(state.min);
  document.getElementById('f-wl').checked = state.wl;
  document.getElementById('f-sort').value = state.sort;
}

function fillSelects() {
  const catCounts = new Map();
  const chainCounts = new Map();
  for (const r of rows) {
    catCounts.set(catName(r.category), (catCounts.get(catName(r.category)) ?? 0) + 1);
    for (const c of r.chains) chainCounts.set(c, (chainCounts.get(c) ?? 0) + 1);
  }
  const byCount = (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1);
  document.getElementById('f-cat').innerHTML =
    '<option value="">All categories</option>' +
    [...catCounts.entries()].sort(byCount).map(([c, n]) => `<option value="${esc(c)}">${esc(c)} (${n})</option>`).join('');
  document.getElementById('f-chain').innerHTML =
    '<option value="">All chains</option>' +
    [...chainCounts.entries()].sort(byCount).map(([c, n]) => `<option value="${esc(c)}">${esc(c)} (${n})</option>`).join('');
}

function wireControls() {
  const on = () => {
    state.q = document.getElementById('f-q').value;
    state.cat = document.getElementById('f-cat').value;
    state.chain = document.getElementById('f-chain').value;
    state.min = Number(document.getElementById('f-min').value) || 0;
    state.wl = document.getElementById('f-wl').checked;
    state.sort = document.getElementById('f-sort').value;
    lastBoardHash = hashForState();
    history.replaceState(null, '', lastBoardHash);
    renderBoard();
  };
  for (const id of ['f-q', 'f-cat', 'f-chain', 'f-min', 'f-wl', 'f-sort']) {
    document.getElementById(id).addEventListener('input', on);
    document.getElementById(id).addEventListener('change', on);
  }
  document.getElementById('controls').addEventListener('submit', (e) => e.preventDefault());
  boardBody.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-slug]');
    if (tr) location.hash = `#/p/${tr.dataset.slug}`;
  });
  boardBody.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const tr = e.target.closest('tr[data-slug]');
    if (tr) location.hash = `#/p/${tr.dataset.slug}`;
  });
}

/* ---------- detail view ---------- */

const detailView = document.getElementById('view-detail');

function basisSentence(r) {
  const m = r.model;
  const cat = catName(r.category);
  if (m.basis === 'category') {
    return `${cat}'s multiple is the median market-cap/TVL of its ${m.category_comp_count} tokenized comps — enough comps to stand on its own.`;
  }
  if (m.basis === 'category+family' || m.basis === 'category+market') {
    const target = m.basis === 'category+family' ? 'family' : 'all-market';
    return `${cat} has only ${m.category_comp_count} usable comp${m.category_comp_count === 1 ? '' : 's'} of its own (own median ${m.category_own_median === null ? 'n/a' : fmtMult(m.category_own_median)}), so its median is shrunk toward the ${target} median of ${m.fallback_comp_count} comps, weighted ${m.category_comp_count}/5 by its own count.`;
  }
  if (m.basis === 'family') return `${cat} has no usable tokenized comp of its own, so the board uses its family's median multiple, from ${m.fallback_comp_count} comps.`;
  return `${cat} has no usable tokenized comp of its own and no family with enough comps, so the board uses the all-market median multiple, from ${m.fallback_comp_count} comps.`;
}

function renderDetail(r) {
  const m = r.model;
  const comps = R.comps_by_category[r.category ?? ''] ?? [];
  const [bandLo, bandHi] = R.model.comp_multiple_band;
  const compRows = comps.length
    ? comps.map((c) => {
        const outlier = c.multiple < bandLo || c.multiple > bandHi;
        return `<tr><td>${esc(c.name)}${outlier ? ' <span class="slug">(outlier — excluded from the median)</span>' : ''}</td><td class="num">${fmtUsd(c.tvl_usd)}</td><td class="num">${fmtUsd(c.mcap_usd)}</td><td class="num">${fmtMult(c.multiple)}</td></tr>`;
      }).join('')
    : '<tr><td colspan="4">No tokenized protocol in this category has a usable market cap in the snapshot; the fallback above supplies the multiple.</td></tr>';
  detailView.innerHTML = `
    <a class="back" href="${esc(lastBoardHash)}">&larr; Back to the board</a>
    <div class="detail-head">
      <h2>${esc(r.name)}</h2>
      ${r.on_watchlist ? '<span class="badge">Watchlist</span>' : ''}
      <span class="slug">${esc(r.slug)} · ${esc(catName(r.category))}</span>
    </div>
    <p class="detail-sub">Rank ${r.rank} of ${rows.length} by implied value. The snapshot records no token for
      ${esc(r.name)} — no market cap, no CoinGecko id, no symbol — which is why it is on this board at all.</p>
    <div class="tiles">
      <div class="tile"><div class="t">TVL</div><div class="v">${fmtUsd(r.tvl_usd)}</div></div>
      <div class="tile"><div class="t">TVL change, 7d</div><div class="v">${fmtPct(r.change_7d)}</div></div>
      <div class="tile"><div class="t">Implied value</div><div class="v">${fmtUsd(r.implied_value_usd)}</div></div>
      <div class="tile"><div class="t">Implied multiple</div><div class="v">${fmtMult(r.implied_multiple)} of TVL</div></div>
      <div class="tile"><div class="t">Tracked since</div><div class="v">${r.listed_at ? esc(r.listed_at) : 'not recorded'}</div></div>
      <div class="tile"><div class="t">Age at snapshot</div><div class="v">${fmtAge(r.age_days)}</div></div>
      <div class="tile"><div class="t">Chains</div><div class="v">${r.chains.length || 'none recorded'}</div></div>
    </div>
    <div class="panel">
      <h3>How this implied value is computed</h3>
      <p class="formula">${fmtFull(r.tvl_usd)} TVL &times; ${fmtMult(m.multiple)} category multiple &times; ${m.adjustment.toFixed(2)} adjustment
        = <span class="res">${fmtFull(r.implied_value_usd)}</span></p>
      <p><strong>The multiple.</strong> ${basisSentence(r)}</p>
      <p><strong>The adjustment, ${m.adjustment.toFixed(2)}.</strong> Momentum ${m.momentum_factor.toFixed(2)}
        (7-day TVL change ${r.change_7d === null ? 'not reported, so neutral' : `${r.change_7d.toFixed(1)}%`}), age ${m.age_factor.toFixed(2)}
        (${fmtAge(r.age_days)} tracked with no token), breadth ${m.breadth_factor.toFixed(2)}
        (${r.chains.length} chain${r.chains.length === 1 ? '' : 's'}${r.chains.length ? `: ${r.chains.map(esc).join(', ')}` : ''}).
        The three are multiplied, then clamped to the model's ${R.model.adjustment_band[0]}–${R.model.adjustment_band[1]} band.</p>
      <h3>The comps behind the multiple</h3>
      <div class="tablebox"><table>
        <thead><tr><th>Tokenized comp</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Cap / TVL</th></tr></thead>
        <tbody>${compRows}</tbody>
      </table></div>
      <p class="note">The largest comps in ${esc(catName(r.category))} by TVL. The model uses every usable comp in the
        category (and, when a category is thin, its family), not only the ones shown.</p>
    </div>
    <div class="panel farm-panel">
      <h3>Farm plan</h3>
      <p>Six steps, written from ${esc(r.name)}'s own record — its category, its chains, its size. Costs are
        budgets, not quotes: network fees belong to the chain, and no step assumes a reward exists.</p>
      <ol class="steps">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    </div>
    <h3>Before any token: the standing checklist</h3>
    <ul class="checklist">
      <li>Use the real product first. A position you would not keep if no token ever came is a cost, not a farm.</li>
      <li>One wallet, genuine activity. Wallet farms, wash volume and borrowed snapshots are what published criteria exclude.</li>
      <li>Expect nothing on a schedule: the snapshot records no token, no points and no date, and none may ever exist.</li>
      <li>Never pay to claim, and reach claim pages only from the protocol's own site or app — fake claim sites are the standard theft.</li>
      <li>Keep your own log of wallets, dates and hashes; it is the only record that is certainly yours.</li>
    </ul>`;
}

/* ---------- live and method views ---------- */

function renderLive() {
  document.getElementById('live-body').innerHTML = R.live
    .map((c) => `<tr><td><span class="pname">${esc(c.name)}</span><br><span class="slug">${esc(c.slug)}</span></td><td>${esc(catName(c.category))}</td><td class="num">${fmtUsd(c.tvl_usd)}</td><td class="num">${fmtUsd(c.mcap_usd)}</td><td class="num">${fmtMult(c.multiple)}</td></tr>`)
    .join('');
}

const BASIS_LABEL = {
  category: 'Category median',
  'category+family': 'Shrunk to family',
  'category+market': 'Shrunk to market',
  family: 'Family median',
  market: 'Market median',
};

function renderMethod() {
  const c = R.model;
  document.getElementById('method-body').innerHTML = `
    <p>The board's question is narrow: <em>what would a token be worth if this protocol's record stayed
    exactly as the snapshot of ${esc(R.as_of)} shows it?</em> It does not ask whether a token is coming.
    The answer is built only from the snapshot's ten fields per protocol.</p>
    <p><strong>Evidence.</strong> ${R.market_comp_count} tokenized protocols in the snapshot carry a usable
    market cap. Each gives a market-cap-to-TVL multiple — the market's own price for one dollar of TVL in
    a protocol of that kind. Multiples below ${c.comp_multiple_band[0]}x or above ${c.comp_multiple_band[1]}x
    are dropped as outliers (a token at 400x its TVL prices something else entirely). A category's multiple
    is the <strong>median</strong> of its comps — medians ignore the one wild comp — and the all-market
    median is ${fmtMult(R.market_median)}.</p>
    <p><strong>Thin categories.</strong> A category with fewer than ${c.full_weight_comps} comps is not
    trusted alone: its median is shrunk toward its family's median in log space, weighted by its comp
    count, reaching full weight at ${c.full_weight_comps}. Families group categories whose TVL does the
    same work (lending and CDPs together; DEX, derivatives and options together; and so on). A category
    with no comps and no usable family takes the all-market median.</p>
    <p><strong>Adjustments.</strong> Base value is TVL x multiple. Three small adjustments follow, each
    from the snapshot's own fields: <span class="consts">momentum</span> (7-day TVL change clamped to
    ${c.momentum.floor_pct}%..+${c.momentum.cap_pct}%, weight ${c.momentum.weight}), <span class="consts">age</span>
    (+${c.age.weight_per_year * 100}% per tracked year, capped at ${c.age.cap_years} years; an unrecorded
    listing date is neutral), and <span class="consts">breadth</span> (+${c.breadth.weight * 100}% per chain
    past the first, capped at ${c.breadth.cap_extra_chains}). Multiplied together and clamped to
    ${c.adjustment_band[0]}–${c.adjustment_band[1]}, so no single field can dominate the multiple. Every
    factor is rounded to the four decimals the board prints before it is used, so the arithmetic on each
    protocol's page reproduces its implied value to the dollar.</p>
    <p><strong>Coverage.</strong> Every one of the snapshot's ${R.counts.watchlist} watchlist protocols is
    ranked, plus every other protocol that records no token — except exchange balance sheets, the bridge
    and restaked-BTC categories (their TVL is escrowed or wrapped assets whose tokens already trade), and
    wrapped, staked or versioned products of traded tokens. ${R.counts.set_aside} pre-token records are set
    aside on those grounds; ${R.counts.tokenized} protocols with tokens are never ranked and serve as comps.</p>`;
  document.getElementById('cat-body').innerHTML = R.categories
    .filter((x) => rows.some((r) => catName(r.category) === catName(x.category === '' ? null : x.category)))
    .map((x) => `<tr><td>${esc(catName(x.category === '' ? null : x.category))}</td><td>${esc(x.family ?? '—')}</td><td class="num">${x.comp_count}</td><td class="num">${x.own_median === null ? '—' : fmtMult(x.own_median)}</td><td class="num"><strong>${fmtMult(x.multiple)}</strong></td><td>${BASIS_LABEL[x.basis]}</td></tr>`)
    .join('');
}

/* ---------- routing ---------- */

const views = { board: document.getElementById('view-board'), detail: detailView, live: document.getElementById('view-live'), method: document.getElementById('view-method') };

function show(name, tab) {
  for (const [k, el] of Object.entries(views)) el.hidden = k !== name;
  for (const a of document.querySelectorAll('.tabs a')) {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  window.scrollTo(0, 0);
}

function route() {
  const hash = location.hash || '#/';
  const detailMatch = hash.match(/^#\/p\/(.+)$/);
  if (detailMatch) {
    const r = bySlug.get(decodeURIComponent(detailMatch[1]));
    if (r) {
      renderDetail(r);
      show('detail', 'board');
      return;
    }
  }
  if (hash.startsWith('#/live')) { show('live', 'live'); return; }
  if (hash.startsWith('#/method')) { show('method', 'method'); return; }
  const qAt = hash.indexOf('?');
  stateFromParams(new URLSearchParams(qAt >= 0 ? hash.slice(qAt + 1) : ''));
  syncControls();
  lastBoardHash = hashForState();
  renderBoard();
  show('board', 'board');
}

/* ---------- summary band ---------- */

function renderSummary() {
  const total = rows.reduce((n, r) => n + r.implied_value_usd, 0);
  const mults = rows.map((r) => r.implied_multiple).sort((a, b) => a - b);
  const medianMult = mults.length % 2 === 1 ? mults[Math.floor(mults.length / 2)] : (mults[mults.length / 2 - 1] + mults[mults.length / 2]) / 2;
  const wl = rows.filter((r) => r.on_watchlist).length;
  const stat = (t, v, s) => `<div class="stat"><div class="t">${t}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  document.getElementById('summary-band').innerHTML =
    stat('Board implied value, total', fmtUsd(total), `across all ${rows.length} ranked protocols`) +
    stat('Median implied multiple', fmtMult(medianMult), `all-market comp median is ${fmtMult(R.market_median)}`) +
    stat('Watchlist coverage', `${wl} of ${R.counts.watchlist}`, 'every watchlist protocol is ranked') +
    stat('Set aside as comps', String(R.counts.tokenized), 'protocols with tokens, never ranked');
}

/* ---------- boot ---------- */

document.getElementById('meta-line').textContent =
  `Snapshot: ${R.source} · ${R.counts.protocols} protocols scanned · ${R.counts.board} ranked by implied value · ` +
  `${R.counts.watchlist} of ${R.counts.watchlist} watchlist protocols covered · ${R.counts.tokenized} with tokens set aside as comps · Model ${R.model_version}`;
fillSelects();
wireControls();
renderSummary();
renderLive();
renderMethod();
window.addEventListener('hashchange', route);
route();
