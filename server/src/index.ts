import { createBroker } from './broker/index.js';
import { config } from './config.js';
import { createLogger } from './logger.js';
import { createPipeline } from './engine/pipeline.js';
import { TradingEngine } from './engine/runtime.js';
import { startServer } from './server/http.js';
import { engineState } from './state.js';

const log = createLogger('main');

async function main() {
  log.info('TradeWeave starting…');
  log.info(
    `engine mode=${config.engine.mode}, tradingEnabled=${config.engine.tradingEnabled}, paper=${config.alpaca.paper}`,
  );

  const broker = createBroker();
  const engine = new TradingEngine(broker);
  engine.onTick = createPipeline();

  // Sanity check the broker connection at boot.
  try {
    const account = await broker.getAccount();
    log.info(`Connected to ${broker.name} — equity $${account.equity.toFixed(2)}, cash $${account.cash.toFixed(2)}`);
  } catch (err) {
    log.error('Could not fetch account at boot (check keys / connectivity)', (err as Error).message);
  }

  startServer(engine);
  engine.start();

  const shutdown = () => {
    log.info('Shutting down…');
    engine.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Surface the safety posture clearly on every boot.
  if (!engineState.canTrade()) {
    log.warn('Trading is currently DISABLED (observe-only). Enable via dashboard or TRADING_ENABLED=true.');
  } else if (!broker.paper) {
    log.warn('⚠️  LIVE trading is enabled with REAL money.');
  }
}

main().catch((err) => {
  log.error('Fatal startup error', err);
  process.exit(1);
});
