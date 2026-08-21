import { buildApp } from './app';
import { parseEnv } from './config/env';

const env = parseEnv();
const app = buildApp(env);
let shuttingDown = false;

async function start(): Promise<void> {
  try {
    await app.listen({ host: '0.0.0.0', port: env.SERVER_PORT });
  } catch (error) {
    app.log.fatal({ err: error }, 'Server startup failed');
    try {
      await app.close();
    } catch (closeError) {
      app.log.error({ err: closeError }, 'Server cleanup after failed startup failed');
    }
    process.exitCode = 1;
  }
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  app.log.info({ event: 'server.shutdown_started', signal }, 'Graceful shutdown started');
  const forcedExit = setTimeout(() => {
    app.log.fatal(
      { event: 'server.shutdown_timeout', signal, graceMs: env.SHUTDOWN_GRACE_MS },
      'Graceful shutdown timed out',
    );
    process.exit(1);
  }, env.SHUTDOWN_GRACE_MS);
  forcedExit.unref();

  try {
    await app.close();
    clearTimeout(forcedExit);
    app.log.info({ event: 'server.shutdown_complete', signal }, 'Graceful shutdown complete');
    process.exitCode = 0;
  } catch (error) {
    clearTimeout(forcedExit);
    app.log.error(
      { err: error, event: 'server.shutdown_failed', signal },
      'Graceful shutdown failed',
    );
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await start();
