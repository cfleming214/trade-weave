import type { BrokerAdapter, OptionContract } from '../broker/types.js';
import { createLogger } from '../logger.js';

const log = createLogger('options');

/**
 * Resolves a concrete option contract to trade from a strategy's intent.
 * Given an underlying, call/put, a spot price, and a target moneyness, it pulls
 * the chain from the broker and picks the contract whose strike is closest to
 * the desired strike, optionally constrained to an expiration.
 */
export async function selectContract(
  broker: BrokerAdapter,
  params: {
    underlying: string;
    type: 'call' | 'put';
    spot: number;
    /** 0 = ATM; for calls +X is OTM, for puts +X is OTM (below spot). */
    moneyness?: number;
    expiration?: string;
  },
): Promise<OptionContract | null> {
  const moneyness = params.moneyness ?? 0;
  // Calls: OTM strikes are above spot; puts: OTM strikes are below spot.
  const targetStrike =
    params.type === 'call' ? params.spot * (1 + moneyness) : params.spot * (1 - moneyness);

  let chain: OptionContract[];
  try {
    chain = await broker.getOptionChain({
      underlying: params.underlying,
      type: params.type,
      expiration: params.expiration,
      strikeGte: targetStrike * 0.8,
      strikeLte: targetStrike * 1.2,
    });
  } catch (err) {
    log.warn(`option chain fetch failed for ${params.underlying}`, (err as Error).message);
    return null;
  }
  if (!chain.length) {
    log.warn(`no option contracts for ${params.underlying} (${params.type})`);
    return null;
  }

  // Prefer the requested expiration if any contracts match; otherwise the nearest expiry.
  const byExpiry = params.expiration
    ? chain.filter((c) => c.expiration === params.expiration)
    : chain;
  const pool = byExpiry.length ? byExpiry : chain;

  // Closest strike to target wins.
  pool.sort((a, b) => Math.abs(a.strike - targetStrike) - Math.abs(b.strike - targetStrike));
  const chosen = pool[0]!;
  log.info(
    `selected ${chosen.symbol} (${params.type} strike ${chosen.strike} exp ${chosen.expiration}) for ${params.underlying} spot ${params.spot}`,
  );
  return chosen;
}
