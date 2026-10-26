/**
 * JaliCare HMIS
 * Production entry point
 *
 * This file is bundled to `build/server.js` by `npm run build:deploy` and
 * started by cPanel with plain `node`. It must therefore run on Node 22+
 * with no TypeScript loader, no Vite, and no build step at runtime.
 *
 * cPanel (Passenger) supplies the port in `process.env.PORT` and expects
 * the process to keep the port open. Hard-coding 3000 is the usual reason
 * a Node app shows "Application is not responding" on cPanel while the
 * logs say it started.
 */

import type { Express } from 'express';
import type { Server } from 'node:http';

import { createApp } from './src/app.ts';
import { pool } from './src/db/index.ts';

/** cPanel's default when the variable is missing locally. */
const DEFAULT_PORT = 3000;

/*
 * Bind to every interface: cPanel's reverse proxy connects over the
 * loopback or the account's own address, never to a name this process
 * would have to guess. HOST exists for the rare case of pinning to
 * 127.0.0.1 behind a same-host proxy.
 */
const HOST = process.env.HOST?.trim() || '0.0.0.0';

function resolvePort(): number {
  const raw = process.env.PORT;

  if (raw === undefined || raw.trim() === '') {
    console.warn(
      `PORT is not set; using ${DEFAULT_PORT}. cPanel always sets it — if you see this in production, the application is probably not running behind the proxy.`,
    );

    return DEFAULT_PORT;
  }

  const port = Number(raw);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535. Received "${raw}".`);
  }

  return port;
}

const PORT = resolvePort();

let app: Express | undefined;
let httpServer: Server | undefined;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`Received ${signal}; shutting down JaliCare HMIS...`);

  /*
   * A shutdown that hangs is worse than one that is abrupt: cPanel will
   * SIGKILL the process and leave the new instance to fight for the port.
   */
  const timeout = setTimeout(() => {
    console.error('Graceful shutdown timed out; forcing exit.');
    process.exit(1);
  }, 10_000);

  timeout.unref();

  try {
    if (httpServer) {
      await new Promise<void>((resolve, reject) => {
        httpServer!.close((error) => {
          /*
           * A server that never finished listening (EADDRINUSE on
           * startup) has nothing to close. Reporting that as a shutdown
           * failure buries the real error — the port — under a second
           * stack trace.
           */
          if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
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

    /* Idle clients keep the pool alive; end() would wait forever for them. */
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

/*
 * A rejected promise nobody handled used to leave the process running in
 * an unknown state, answering requests it could no longer complete. Log
 * it, then stop cleanly so the supervisor restarts a healthy instance.
 */
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
  void shutdown('unhandledRejection');
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  void shutdown('uncaughtException');
});

async function startServer(): Promise<void> {
  const port = PORT;

  app = await createApp();

  httpServer = app.listen(port, HOST, () => {
    console.log(`JaliCare HMIS listening on http://${HOST}:${port}`);
  });

  /*
   * A listening socket that fails later (EACCES, EADDRINUSE from a
   * second copy) must say so and exit 1. Without this handler Node
   * throws an uncaught 'error' event and cPanel only sees "aborted".
   */
  httpServer.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `Port ${port} is already in use. Another copy of this application is probably running; stop it before starting this one.`,
      );
    } else if (error.code === 'EACCES') {
      console.error(
        `Not allowed to bind port ${port}. On cPanel, let the application manager choose the port.`,
      );
    } else {
      console.error('HTTP server error:', error);
    }

    process.exitCode = 1;
    void shutdown('server-error');
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
