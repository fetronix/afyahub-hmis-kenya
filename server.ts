
import type { Express } from 'express';
import type { Server } from 'node:http';

import { createApp } from './src/app.ts';
import { pool } from './src/db/index.ts';

const PORT = Number(process.env.PORT ?? 3000);

let app: Express | undefined;
let httpServer: Server | undefined;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`Received ${signal}; shutting down JaliCare HMIS...`);

  const timeout = setTimeout(() => {
    console.error('Graceful shutdown timed out.');
    process.exit(1);
  }, 10_000);

  timeout.unref();

  try {
    if (httpServer) {
      await new Promise<void>((resolve, reject) => {
        httpServer!.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    }

    const closeResources = app?.locals.closeResources;

    if (typeof closeResources === 'function') {
      await closeResources();
    }

    await pool.end();

    console.log('JaliCare HMIS shutdown completed.');
  } catch (error) {
    console.error('Error during server shutdown:', error);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
  }
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

async function startServer(): Promise<void> {
  app = await createApp();

  httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `JaliCare HMIS server running on http://0.0.0.0:${PORT}`,
    );
  });
}

startServer().catch(async (error: unknown) => {
  console.error('Fatal server startup error:', error);

  try {
    await pool.end();
  } catch (closeError) {
    console.error('Failed to close database pool:', closeError);
  }

  process.exitCode = 1;
});
