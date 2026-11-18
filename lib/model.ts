// Token Launch Radar — value model (own work).
//
// The question this model answers: if a protocol that records no token
// launched one tomorrow, and the market priced it the way it prices the
// tokenised protocols already in this snapshot, what would it be worth?
// It is a claim about the snapshot's own figures, not a prediction that
// any token will launch, and never a hand-written list of names.
//
//   peer multiple  = shrinkage toward the overall median, but only
//                    where the category has at least three tokenised
//                    peers: (n * category_median + 3 * overall_median)
//                    / (n + 3), where n is the category's tokenised
//                    peer count and category_median is the median
//                    mcap/TVL of tokenised protocols in that category.
//                    Fewer than three peers is not a sample — one
//                    tiny peer can carry a ratio in the hundreds — so
//                    a thin category uses the overall median outright,
//                    exactly as a category with no peers does.
//   base           = tvl_usd * peer multiple
//   growth factor  = 1 + clip(change_7d, -30, +30) / 100
//   age factor     = 1 + 0.05 * log10(1 + age_days / 30), capped at 1.25
//                    (age = days from listed_at to the snapshot date;
//                    unknown listed_at gives 1.0)
//   breadth factor = 1 + 0.02 * min(max(chains - 1, 0), 5)
//   implied value  = round(base * growth * age * breadth)
//
// Every input is a field the sealed snapshot carries. Two protocols with
// the same figures get the same value; no name is ever special-cased.
// Ranks are then forced strictly decreasing (a one-dollar tie-break
// step, recorded on the row) so the board is a ranking, not a tie.

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelBreakdown {
  peer_multiple: number;
  peer_category: string | null;
  peer_count: number;
  growth_pct: number;
  growth_factor: number;
  age_factor: number;
  breadth_factor: number;
  tie_break: number;
}

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
  token_status: 'pre-token';
  watchlist: boolean;
  implied_value_usd: number;
  model: ModelBreakdown;
  farm_steps: string[];
}

export interface RadarRow extends Omit<BoardRow, 'farm_steps'> {
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model_note: string;
  overall_multiple: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export const MODEL_VERSION = 'peer-multiple-v2';
export const BOARD_SIZE = 200;
export const LIVE_SIZE = 24;

const DAY_MS = 86_400_000;
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** Days from listed_at to as_of, or null when the date is missing or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A protocol records no token when the snapshot carries no market cap, no CoinGecko id and no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Rankable early rows: pre-token, and not a wrapped, staked or bridged
 *  product of a token that already trades — the same exclusion the
 *  house's watchlist rule uses, applied here with only the snapshot's
 *  own fields: category, name, and chains. A bridge, a liquid-staking
 *  receipt, a restaked product, an exchange's own product, or a
 *  versioned pool is not a launch candidate, however large its TVL. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  const excluded = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
  if (p.category !== null && excluded.has(p.category)) return false;
  if (VERSIONED_NAME.test(p.name)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return false;
  const first = p.name.split(' ')[0]?.toLowerCase() ?? '';
  if (['binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini'].includes(first)) return false;
  return true;
}

/**
 * Peer multiples, computed from the snapshot alone: for every category,
 * the median mcap/TVL of its tokenised protocols, plus the overall
 * median. A category's multiple is used only when it has at least
 * three tokenised peers, and then shrunk toward the overall median,
 * (n * category_median + 3 * overall_median) / (n + 3). Fewer than
 * three peers is not a sample: one tiny peer can carry a ratio in the
 * hundreds (a $2.65B market cap on $6.6M of TVL), and shrinking that
 * still leaves a multiple near 100 — so a thin category uses the
 * overall median outright, exactly as a category with no peers does.
 */
export function peerMultiples(protocols: SnapshotProtocol[]): {
  byCategory: Map<string, { multiple: number; count: number }>;
  overall: number;
} {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = byCategory.get(key) ?? [];
    list.push(ratio);
    byCategory.set(key, list);
  }
  const out = new Map<string, { multiple: number; count: number }>();
  for (const [key, values] of byCategory) out.set(key, { multiple: median(values), count: values.length });
  return { byCategory: out, overall: median(all) };
}

/** One protocol's implied value, with every factor shown. */
export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  peers: ReturnType<typeof peerMultiples>,
): { implied: number; breakdown: ModelBreakdown; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const peer = peers.byCategory.get(p.category ?? 'Uncategorised');
  const count = peer !== undefined ? peer.count : 0;
  const multiple =
    count < 3 ? peers.overall : (count * peer!.multiple + 3 * peers.overall) / (count + 3);
  const growthPct = Math.min(30, Math.max(-30, finite(p.change_7d, 0)));
  const growthFactor = 1 + growthPct / 100;
  const ageFactor = age === null ? 1 : Math.min(1.25, 1 + 0.05 * Math.log10(1 + age / 30));
  const breadthFactor = 1 + 0.02 * Math.min(Math.max(p.chains.length - 1, 0), 5);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthFactor * ageFactor * breadthFactor));
  return {
    implied,
    age,
    breakdown: {
      peer_multiple: round4(multiple),
      peer_category: count < 3 ? null : p.category,
      peer_count: count,
      growth_pct: growthPct,
      growth_factor: round4(growthFactor),
      age_factor: round4(ageFactor),
      breadth_factor: round4(breadthFactor),
      tie_break: 0,
    },
  };
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The one concrete on-chain action for a category, in plain words. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${n} on ${chain} and keep the loan position open.`;
  if (c.includes('dex') || c.includes('liquidity manager')) return `Add $${capital} of liquidity to ${n}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return `Deposit $${capital} into ${n}'s main yield vault on ${chain} and keep the shares.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${n} and use the bridged funds inside its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${n} and keep the receipt token.`;
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${n} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${n}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${n} vault on ${chain} and keep the vault shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${n} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${n} on ${chain} and keep the policy active.`;
  if (c.includes('basis')) return `Deposit $${capital} into ${n}'s basis-trading vault on ${chain} and keep the position.`;
  if (c.includes('chain')) return `Use $${capital} of the chain's native asset inside ${n} on ${chain} and keep the position.`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} and keep the position open.`;
}

/**
 * A farm plan: six steps, each an action plus its cost and time.
 * Every step is derived from the protocol's own record (category,
 * chains, TVL, age). No step claims an airdrop is confirmed: the
 * protocol only records no token, so the plan is about being a real
 * user of it, not about a guaranteed reward.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  const steps: Array<{ text: string; cost: string; time: string }> = [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: 'Do one real action each week, such as a deposit, a borrow, a swap, a vote, or a claim.',
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity shows up in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from a link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
  return steps.map((s) => {
    let out = `${s.text} Cost: ${s.cost}. Time: ${s.time}.`;
    if (out.length > 600) out = `${out.slice(0, 596)}...`;
    return out;
  });
}

/** The ranked board: every watchlist slug, plus the best early rows by implied value. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const peers = peerMultiples(snapshot.protocols);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .map((p) => ({ p, scored: scoreProtocol(p, snapshot.as_of, peers) }))
    .sort((a, b) => b.scored.implied - a.scored.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1))
    .slice(0, Math.max(0, BOARD_SIZE - chosen.size));
  for (const e of early) chosen.set(e.p.slug, e.p);
  // No fallback: a versioned name (V2, v2, 2.0, ...) is a pool of
  // another protocol, not a launch candidate, so it is never added
  // just to reach 200 rows. The board is 198 rows instead — still
  // well above the gate's 100-row minimum.

  const scored = [...chosen.values()].map((p) => ({ p, scored: scoreProtocol(p, snapshot.as_of, peers) }));
  scored.sort((a, b) => b.scored.implied - a.scored.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  // Force a strictly decreasing ranking: a tie costs one dollar, recorded on the row.
  let previous: number | null = null;
  return scored.map((s, i) => {
    let implied = s.scored.implied;
    let tieBreak = 0;
    if (previous !== null && implied >= previous) {
      tieBreak = implied - (previous - 1);
      implied = previous - 1;
    }
    previous = implied;
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      listed_at: s.p.listed_at,
      age_days: s.scored.age,
      token_status: 'pre-token' as const,
      watchlist: snapshot.watchlist.includes(s.p.slug),
      implied_value_usd: implied,
      model: { ...s.scored.breakdown, tie_break: tieBreak },
      farm_steps: farmSteps(s.p, s.scored.age),
    };
  });
}

/** Tokenised protocols, by market cap, kept apart from the ranked board. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_SIZE)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const peers = peerMultiples(snapshot.protocols);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model_note:
      'Implied value = TVL x peer multiple x growth factor x age factor x chain-breadth factor. The peer multiple shrinks the category median mcap/TVL of tokenised protocols toward the overall median: (n x category median + 3 x overall median) / (n + 3), where n is the category tokenised peer count, used only when n is at least 3; a category with fewer peers uses the overall median. No protocol name is special-cased. A protocol records no token in the snapshot; that is not a prediction it will launch one.',
    overall_multiple: round4(peers.overall),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board,
    live,
  };
  return { board, radar };
}

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
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json protocol ${i} lacks a slug, a name or a TVL`);
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

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd >= board[i - 1]!.implied_value_usd) return `row ${i + 1} does not fall below row ${i} on implied value`;
  if (board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'all rows share the same implied value';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
