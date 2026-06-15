import Anthropic from '@anthropic-ai/sdk';
import { RSI, SMA } from 'technicalindicators';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import type { Signal, Strategy, StrategyContext } from './types.js';

const log = createLogger('strategy:llm');

const MODEL = 'claude-opus-4-8';

/**
 * JSON schema constraining Claude's response to a list of trade decisions.
 * Structured outputs guarantee we get parseable, schema-valid JSON back so the
 * pipeline never has to guess at free-form text.
 */
const DECISION_SCHEMA = {
  type: 'object',
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          symbol: { type: 'string' },
          action: { type: 'string', enum: ['buy', 'sell', 'close', 'hold'] },
          reason: { type: 'string' },
          option: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['call', 'put'] },
              moneyness: { type: 'number' },
            },
            required: ['type'],
            additionalProperties: false,
          },
        },
        required: ['symbol', 'action', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['decisions'],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You are the decision engine for a personal, autonomous trading bot.
You are given a per-symbol market snapshot (recent indicators, latest price, and whether a position is currently held).
For each symbol, decide one action: "buy" (open/add a long), "close" (exit a held long), "sell" (same as close), or "hold" (do nothing).
Only recommend "buy" when there is a clear trend/momentum signal; only recommend "close" for symbols currently held.
You MAY optionally express a directional view as an options play by setting "option": {type:"call"|"put", moneyness:<fraction, 0=ATM>} on a "buy" decision — use this sparingly and only when conviction is high.
Be conservative: prefer "hold" when the signal is ambiguous. Keep each "reason" to one short sentence grounded in the data you were given.`;

interface SymbolSnapshot {
  symbol: string;
  price: number | null;
  smaFast: number | null;
  smaSlow: number | null;
  rsi: number | null;
  held: boolean;
  recentCloses: number[];
}

/**
 * LLM-driven strategy. Builds a compact, grounded market snapshot per symbol,
 * asks Claude for structured decisions, and maps them into engine signals.
 * Risk sizing, stops, and guardrails are still applied downstream — the model
 * only expresses intent, never places orders.
 */
export class LlmStrategy implements Strategy {
  readonly name = 'llm';
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: config.anthropic.apiKey });
  }

  private snapshot(ctx: StrategyContext): SymbolSnapshot[] {
    const held = new Set(ctx.positions.filter((p) => p.qty > 0).map((p) => p.symbol));
    return ctx.watchlist.map((symbol) => {
      const closes = (ctx.bars.get(symbol) ?? []).map((b) => b.close);
      const enough = closes.length >= 32;
      return {
        symbol,
        price: ctx.quotes.get(symbol)?.price ?? closes.at(-1) ?? null,
        smaFast: enough ? (SMA.calculate({ period: 10, values: closes }).at(-1) ?? null) : null,
        smaSlow: enough ? (SMA.calculate({ period: 30, values: closes }).at(-1) ?? null) : null,
        rsi: enough ? (RSI.calculate({ period: 14, values: closes }).at(-1) ?? null) : null,
        held: held.has(symbol),
        recentCloses: closes.slice(-10).map((c) => Number(c.toFixed(2))),
      };
    });
  }

  async evaluate(ctx: StrategyContext): Promise<Signal[]> {
    const snapshots = this.snapshot(ctx);

    let response;
    try {
      response = await this.client.messages.create({
        model: MODEL,
        max_tokens: 4000,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: 'medium',
          format: { type: 'json_schema', schema: DECISION_SCHEMA },
        },
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Account equity: ${ctx.account.equity}. Here is the current market snapshot:\n${JSON.stringify(snapshots, null, 2)}\n\nReturn your decisions.`,
          },
        ],
      });
    } catch (err) {
      log.error('Claude request failed; producing no signals this tick', (err as Error).message);
      return [];
    }

    if (response.stop_reason === 'refusal') {
      log.warn('Claude refused the request; no signals this tick');
      return [];
    }

    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') {
      log.warn('no text block in Claude response');
      return [];
    }

    let parsed: { decisions?: Array<{ symbol: string; action: string; reason: string; option?: { type: 'call' | 'put'; moneyness?: number } }> };
    try {
      parsed = JSON.parse(text.text);
    } catch (err) {
      log.error('failed to parse Claude JSON', (err as Error).message);
      return [];
    }

    const watch = new Set(ctx.watchlist);
    const signals: Signal[] = [];
    for (const d of parsed.decisions ?? []) {
      if (!watch.has(d.symbol)) continue; // ignore hallucinated symbols
      if (d.action === 'hold') continue;
      const action = d.action === 'sell' ? 'close' : (d.action as Signal['action']);
      const signal: Signal = { symbol: d.symbol, action, reason: d.reason };
      if (d.option && action === 'buy') {
        signal.option = { type: d.option.type, moneyness: d.option.moneyness };
      }
      signals.push(signal);
    }

    log.info(`Claude produced ${signals.length} actionable signal(s)`);
    return signals;
  }
}
