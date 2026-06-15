import Anthropic from '@anthropic-ai/sdk';
import { RSI, SMA } from 'technicalindicators';
import type { BrokerAdapter } from '../broker/types.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('advisor');

const MODEL = 'claude-opus-4-8';

export interface AnalysisResult {
  ts: string;
  model: string;
  usedWebSearch: boolean;
  text: string;
}

const SYSTEM_PROMPT = `You are a candid markets analyst writing a short, on-demand outlook for the week ahead for a single personal trader.
Focus ONLY on the symbols in their watchlist. The trader reviews everything manually — nothing you say is auto-executed.
If web search is available, ground your view in current prices, upcoming earnings, and macro/economic events for the coming week; if it is not, reason from the price/indicator data you are given and say so.

Write in markdown with exactly these sections:
## Week ahead
2-4 sentences on the overall setup for this watchlist and key events to watch.
## By symbol
One short paragraph per symbol: trend, what the indicators say, and notable catalysts.
## Suggestions
One line per symbol in the form: \`SYMBOL — BUY | SELL | HOLD | WATCH — one-sentence rationale\`.
## Risks
2-3 bullet points on what could invalidate the above.

Be concise and honest about uncertainty. Do not give guarantees or price targets you can't justify. End with one line: "Not financial advice — for your own review."`;

interface SymbolContext {
  symbol: string;
  lastPrice: number | null;
  changePct5d: number | null;
  sma20: number | null;
  sma50: number | null;
  rsi14: number | null;
  position: { qty: number; avgEntry: number; unrealizedPlPct: number } | null;
}

async function buildContext(broker: BrokerAdapter, watchlist: string[]): Promise<SymbolContext[]> {
  const positions = await broker.getPositions().catch(() => []);
  const posBySymbol = new Map(positions.map((p) => [p.symbol, p]));

  return Promise.all(
    watchlist.map(async (symbol) => {
      const bars = await broker.getBars(symbol, '1Day', 60).catch(() => []);
      const closes = bars.map((b) => b.close);
      const enough = closes.length >= 52;
      const last = closes.at(-1) ?? null;
      const fiveAgo = closes.at(-6) ?? null;
      const pos = posBySymbol.get(symbol);
      return {
        symbol,
        lastPrice: last,
        changePct5d: last && fiveAgo ? Number((((last - fiveAgo) / fiveAgo) * 100).toFixed(2)) : null,
        sma20: enough ? Number((SMA.calculate({ period: 20, values: closes }).at(-1) ?? 0).toFixed(2)) : null,
        sma50: enough ? Number((SMA.calculate({ period: 50, values: closes }).at(-1) ?? 0).toFixed(2)) : null,
        rsi14: enough ? Number((RSI.calculate({ period: 14, values: closes }).at(-1) ?? 0).toFixed(1)) : null,
        position: pos
          ? { qty: pos.qty, avgEntry: pos.avgEntryPrice, unrealizedPlPct: Number((pos.unrealizedPlPct * 100).toFixed(2)) }
          : null,
      };
    }),
  );
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/**
 * Runs a single, on-demand market analysis. Purely advisory — it gathers the
 * watchlist's price/indicator context (and the current positions), asks Claude
 * for a week-ahead outlook with buy/sell suggestions, and returns the markdown.
 * It NEVER places orders. Uses web search when enabled/available, and falls
 * back to data-only analysis if the tool path fails.
 */
export async function runAnalysis(broker: BrokerAdapter, watchlist: string[]): Promise<AnalysisResult> {
  if (!config.anthropic.configured) {
    throw new Error('ANTHROPIC_API_KEY is not set — add it to server/.env to use Claude analysis.');
  }
  const client = new Anthropic({ apiKey: config.anthropic.apiKey });
  const context = await buildContext(broker, watchlist);
  const today = new Date().toISOString().slice(0, 10);

  const userMessage =
    `Today is ${today}. Give me your outlook for the upcoming trading week for my watchlist, and concrete buy/sell suggestions.\n\n` +
    `Watchlist data (daily indicators + my current positions):\n${JSON.stringify(context, null, 2)}`;

  const wantSearch = config.anthropic.analysisWebSearch;

  const call = async (withTools: boolean) => {
    let messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }];
    let response = await client.messages.create({
      model: MODEL,
      max_tokens: 6000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      system: SYSTEM_PROMPT,
      messages,
      ...(withTools ? { tools: [{ type: 'web_search_20260209', name: 'web_search' }] } : {}),
    });
    // Server-tool loops can pause; resume until done (bounded).
    let guard = 0;
    while (response.stop_reason === 'pause_turn' && guard < 5) {
      messages = [{ role: 'user', content: userMessage }, { role: 'assistant', content: response.content }];
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 6000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
        system: SYSTEM_PROMPT,
        messages,
        ...(withTools ? { tools: [{ type: 'web_search_20260209', name: 'web_search' }] } : {}),
      });
      guard++;
    }
    return response;
  };

  let usedWebSearch = wantSearch;
  let response;
  try {
    response = await call(wantSearch);
  } catch (err) {
    if (wantSearch) {
      log.warn(`analysis with web search failed (${(err as Error).message}); retrying data-only`);
      usedWebSearch = false;
      response = await call(false);
    } else {
      throw err;
    }
  }

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude declined to produce an analysis for this request.');
  }
  const text = extractText(response.content);
  if (!text) throw new Error('Claude returned no analysis text.');

  log.info(`analysis complete (web search: ${usedWebSearch}, ${text.length} chars)`);
  return { ts: new Date().toISOString(), model: MODEL, usedWebSearch, text };
}
