// Farm plans: what a reader should actually do, per protocol, before any token exists.
//
// Every plan is generated from the protocol's own snapshot record — its category chooses the actions,
// its chains name where they happen, its TVL sizes the suggested capital, its age sets how long to
// hold. No plan names a points program, a date or a reward the snapshot does not record, because the
// snapshot holds none: the honest claim is narrower. Protocols that later reward early users reward
// the ones who used the product for real, so every plan is written as genuine use: one wallet, real
// funds, real positions, held over time. Each step states what it costs and how long it takes, in
// plain estimates a reader can budget from; network fees are the chain's, not the protocol's, and are
// worded as the usual range for that chain, never as a quote.

import type { SnapshotProtocol } from './model.ts';

/** The working facts a plan is written from. */
interface PlanContext {
  name: string;
  category: string | null;
  /** The protocol's first-listed chain: where a farmer starts. */
  chain: string;
  /** A second chain it runs on, when it has one. */
  secondChain: string | null;
  /** Suggested working capital in dollars, sized from the protocol's TVL. */
  capital: number;
  /** How long to hold the position, in days, from the protocol's age. */
  holdDays: number;
}

/** Capital sized to the protocol: big enough to be a real user, small enough to repeat across a board. */
function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  return 50;
}

/** Younger protocols get a longer qualifying window: their user history is still being written. */
function holdDaysFor(ageDays: number | null): number {
  if (ageDays === null) return 60;
  if (ageDays < 180) return 60;
  if (ageDays < 365) return 45;
  return 30;
}

/** The fee wording for a chain: Ethereum mainnet is the expensive case; most other chains are not. */
function feeText(chain: string): string {
  if (chain === 'Ethereum') return 'Ethereum mainnet gas, roughly $5-25 per transaction at quiet times';
  return `network fees on ${chain}, usually under $2 per transaction`;
}

/** The core action for a category: the one thing a genuine user of this kind of protocol does first. */
function coreAction(ctx: PlanContext): string {
  const { name, chain, capital } = ctx;
  switch (ctx.category) {
    case 'Lending':
    case 'Uncollateralized Lending':
    case 'Collateral Markets':
      return `Supply $${capital} of USDC as collateral in ${name} on ${chain}, then borrow a small amount against it (about a quarter of what you supplied) so the position uses both sides of the market`;
    case 'CDP':
    case 'CDP Manager':
      return `Deposit $${capital} of collateral into a ${name} vault on ${chain} and mint a modest amount of its stablecoin against it, keeping the collateral ratio comfortably above the liquidation line`;
    case 'Dexs':
    case 'Liquidity Manager':
      return `Add $${capital} of liquidity to a core pair on ${name} on ${chain} (a stablecoin pair if one is offered, so the position is not hostage to price swings) and leave the LP position open`;
    case 'Derivatives':
    case 'Interest Rate Derivatives':
      return `Deposit $${capital} of USDC as margin on ${name} and open one small position you actually have a view on, sized so a bad day costs a few dollars, not the deposit`;
    case 'Options Vault':
      return `Deposit $${capital} into one of ${name}'s option vaults on ${chain} and let it roll through a full weekly cycle instead of withdrawing mid-round`;
    case 'Yield':
    case 'Yield Aggregator':
    case 'Farm':
    case 'Leveraged Farming':
    case 'CeDeFi':
      return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the vault shares in the same wallet, so the deposit has a continuous history`;
    case 'Risk Curators':
      return `Deposit $${capital} of USDC into one of the lending vaults curated through ${name} on ${chain}, choosing a vault whose assets you understand, and keep the shares in the same wallet`;
    case 'Onchain Capital Allocator':
    case 'Indexes':
      return `Deposit $${capital} into a ${name} allocation vault on ${chain} and hold the shares; these products reward assets that stay allocated, not assets that pass through`;
    case 'Basis Trading':
      return `Deposit $${capital} of USDC into ${name}'s basis strategy on ${chain} and hold the position through at least one funding cycle`;
    case 'Liquid Staking':
    case 'Staking Pool':
      return `Stake $${capital} of the chain's native asset through ${name} on ${chain} and hold the liquid staking receipt in the wallet that staked it`;
    case 'Liquid Restaking':
    case 'Restaking':
    case 'Restaked BTC':
      return `Restake $${capital} of a liquid staking asset through ${name} on ${chain} and hold the receipt; restaked positions are counted by duration as much as by size`;
    case 'Anchor BTC':
    case 'Decentralized BTC':
      return `Deposit a small amount of BTC (about $${capital} worth) into ${name} on ${chain} and hold the wrapped or staked position it issues`;
    case 'Bridge':
    case 'Canonical Bridge':
    case 'Cross Chain Bridge':
      return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds in an app on the far side instead of bridging straight back`;
    case 'RWA':
      return `Mint or buy about $${capital} of ${name}'s real-world-asset product on ${chain} and hold it; if the product asks for identity checks, complete them only on ${name}'s own site and only if you are eligible`;
    case 'Stablecoin Wrapper':
    case 'Dual-Token Stablecoin':
      return `Mint or wrap about $${capital} of the stable asset through ${name} on ${chain} and hold the issued token in the same wallet`;
    case 'Insurance':
      return `Buy about $${capital} of cover from ${name} on ${chain} for a position you actually hold elsewhere, and keep the policy to its expiry`;
    case 'Payments':
    case 'Crypto Card Issuer':
      return `Fund a ${name} account or card with about $${capital} and make your ordinary payments through it for a month, the way a normal customer would`;
    case 'Prediction Market':
      return `Fund $${capital} on ${name} and take positions in several markets you have actually read about, holding at least one to settlement`;
    case 'Chain':
      return `Bridge about $${capital} to ${chain} and use the chain itself: pay fees, and transact in two or three of its native apps each week, as a resident rather than a visitor`;
    case 'Privacy':
      return `Make one genuine shielded transfer of about $${capital} through ${name} on ${chain} (deposit, then a later withdrawal to your own second address), the use the tool exists for`;
    case 'Governance Incentives':
      return `Acquire a modest governance position in ${name} (about $${capital}), delegate or vote with it in the next live proposal, and keep the position while you participate`;
    case 'OTC Marketplace':
      return `Complete one genuine over-the-counter trade of about $${capital} through ${name} on ${chain}, from listing or accepting an offer to settlement`;
    default:
      return `Deposit $${capital} of USDC into ${name} on ${chain} through its own app and keep the position open, using the product the way its documentation describes`;
  }
}

/** The second action: the one that separates a user from a drive-by deposit. */
function deepenAction(ctx: PlanContext): string {
  const { name, chain, secondChain } = ctx;
  const other = secondChain ?? chain;
  switch (ctx.category) {
    case 'Lending':
    case 'Uncollateralized Lending':
    case 'Collateral Markets':
      return `Repay part of the borrow and borrow again once, so the account shows a full borrow-repay cycle rather than a single deposit. Cost: ${feeText(chain)}. Time: about 10 minutes`;
    case 'CDP':
    case 'CDP Manager':
      return `Use some of the minted stablecoin in a second protocol (a swap or a deposit), then top the vault back up once, so the position shows minting, use and management. Cost: ${feeText(chain)}. Time: about 15 minutes`;
    case 'Dexs':
    case 'Liquidity Manager':
      return `Make several ordinary swaps through ${name}'s own interface on ${other} across different days, the way a trader who keeps liquidity there would. Cost: swap fees plus ${feeText(other)}. Time: about 5 minutes per swap`;
    case 'Derivatives':
    case 'Interest Rate Derivatives':
      return `Close the first position and open a second one in a different week, keeping total volume modest and real rather than churned. Cost: trading fees on the volume you choose. Time: about 10 minutes per position`;
    case 'Bridge':
    case 'Canonical Bridge':
    case 'Cross Chain Bridge':
      return `Bridge a second, smaller amount back the other way in a later week, so the wallet has history in both directions and on both chains. Cost: the bridge's fee plus ${feeText(other)}. Time: about 15 minutes, plus the bridge's own transfer time`;
    case 'Liquid Staking':
    case 'Staking Pool':
    case 'Liquid Restaking':
    case 'Restaking':
    case 'Restaked BTC':
    case 'Anchor BTC':
    case 'Decentralized BTC':
      return `Use the staking receipt once in a second protocol (as collateral or in a liquidity pool) instead of leaving it idle, then return it before you unstake. Cost: ${feeText(other)}. Time: about 15 minutes`;
    case 'Chain':
      return `Hold a small balance of ${chain}'s gas asset in the same wallet and keep using the chain weekly; an address that only bridged in once reads as a tourist. Cost: the gas you actually use. Time: about 10 minutes a week`;
    default:
      return `Repeat the core action once more in a later week with a smaller amount, so the wallet shows a returning user rather than a single visit. Cost: ${feeText(other)}. Time: about 10 minutes`;
  }
}

/**
 * A protocol's farm plan: six steps, each an action with its cost and its time. Steps one and six are
 * the same discipline for every protocol (one wallet, genuine use, records, official channels only);
 * the middle steps are the category's own work, written from the protocol's record.
 */
export function farmSteps(p: SnapshotProtocol, ageDays: number | null): string[] {
  const ctx: PlanContext = {
    name: p.name,
    category: p.category,
    chain: p.chains.length > 0 ? p.chains[0]! : 'its main chain',
    secondChain: p.chains.length > 1 ? p.chains[1]! : null,
    capital: capitalFor(p.tvl_usd),
    holdDays: holdDaysFor(ageDays),
  };
  const steps = [
    `Set up one wallet for ${ctx.name} and use it as a genuine user: real funds, positions you would keep anyway, no wallet farms or wash activity, since published reward criteria exclude them. Cost: nothing but the funds you move. Time: about 10 minutes`,
    `${coreAction(ctx)}. Cost: $${ctx.capital} of working capital plus ${feeText(ctx.chain)}. Time: about 15 minutes to set up`,
    deepenAction(ctx),
    `Return once a week and make one small qualifying action (a top-up, a swap, a vote or a rewards claim inside the app) so the wallet reads as an active user across many snapshots. Cost: ${feeText(ctx.chain)} each week. Time: about 10 minutes a week`,
    `Hold the position for at least ${ctx.holdDays} days before withdrawing anything; short in-and-out visits are the first thing sybil filters and snapshot-based criteria discard. Cost: the $${ctx.capital} stays in the position. Time: ${ctx.holdDays} days`,
    `Keep a simple log (wallet, dates, amounts, transaction hashes) and follow ${ctx.name}'s official site and announcement channel from inside its own app; never pay a fee to "claim" an unannounced token and never connect to a claim page you did not reach from the official site. Cost: nothing. Time: about 5 minutes a week`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}
