import { buildApp } from './app';
import { parseEnv } from './config/env';

const env = parseEnv();
const app = buildApp(env);

async function start(): Promise<void> {
  try {
    await app.listen({ host: '0.0.0.0', port: env.SERVER_PORT });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'Shutting down');
  await app.close();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await start();
