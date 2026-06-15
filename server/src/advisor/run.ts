import { createBroker } from '../broker/index.js';
import { config } from '../config.js';
import { store } from '../db/index.js';
import { runAnalysis } from './analyze.js';

/**
 * One-shot, on-demand Claude analysis from the terminal.
 *
 *   npm run analyze
 *
 * Prints a week-ahead outlook + buy/sell suggestions for the watchlist and
 * saves it to the local audit store. Does not trade.
 */
async function main() {
  const broker = createBroker();
  console.log(`\nAsking Claude for a week-ahead view on: ${config.engine.watchlist.join(', ')}\n(this can take ~30-60s)\n`);
  const result = await runAnalysis(broker, config.engine.watchlist);
  store.recordAnalysis(result);
  console.log('─'.repeat(70));
  console.log(result.text);
  console.log('─'.repeat(70));
  console.log(`\nmodel: ${result.model} · web search: ${result.usedWebSearch} · ${result.ts}\n`);
}

main().catch((err) => {
  console.error('\nAnalysis failed:', (err as Error).message, '\n');
  process.exit(1);
});
