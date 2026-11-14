/**
 * Chainable Drizzle query mock queue for HTTP integration and service tests
 * when PostgreSQL is not running locally. Every queued step resolves in order
 * and records inserted/updated/deleted payloads for audit-trail verification.
 */

export interface MockDbCall {
  op: 'select' | 'insert' | 'update' | 'delete';
  values?: unknown;
}

export function createMockDbState() {
  const selectQueue: unknown[] = [];
  const insertQueue: unknown[] = [];
  const updateQueue: unknown[] = [];
  const deleteQueue: unknown[] = [];
  const calls: MockDbCall[] = [];
  let nextError: unknown = null;

  function maybeThrow() {
    if (nextError !== null) {
      const err = nextError;
      nextError = null;
      throw err;
    }
  }

  function makeChain(queue: unknown[], op: MockDbCall['op'], defaultVal: unknown = []) {
    let recordedValues: unknown = undefined;
    const resolveNext = async () => {
      maybeThrow();
      calls.push({ op, ...(recordedValues !== undefined ? { values: recordedValues } : {}) });
      if (queue.length > 0) {
        const next = queue.shift();
        if (next instanceof Error) throw next;
        return next;
      }
      return defaultVal;
    };

    const chain: Record<string, any> = {
      from: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      groupBy: () => chain,
      limit: () => chain,
      offset: () => chain,
      for: () => chain,
      values: (vals: unknown) => {
        recordedValues = vals;
        return chain;
      },
      set: (vals: unknown) => {
        recordedValues = vals;
        return chain;
      },
      onConflictDoNothing: () => chain,
      onConflictDoUpdate: () => chain,
      returning: () => chain,
      then: (onFulfilled?: (v: any) => any, onRejected?: (e: any) => any) =>
        resolveNext().then(onFulfilled, onRejected),
      catch: (onRejected?: (e: any) => any) => resolveNext().catch(onRejected),
    };

    return chain;
  }

  const executor: Record<string, any> = {
    select: () => makeChain(selectQueue, 'select', []),
    insert: () => makeChain(insertQueue, 'insert', [{ id: 1 }]),
    update: () => makeChain(updateQueue, 'update', []),
    delete: () => makeChain(deleteQueue, 'delete', []),
    execute: async (query: unknown) => {
      maybeThrow();
      calls.push({ op: 'select', values: query });
      return { rows: [{ value: '1' }] };
    },
    transaction: async (cb: (tx: any) => Promise<any>) => {
      maybeThrow();
      return cb(executor);
    },
  };

  return {
    executor,
    calls,
    reset() {
      selectQueue.length = 0;
      insertQueue.length = 0;
      updateQueue.length = 0;
      deleteQueue.length = 0;
      calls.length = 0;
      nextError = null;
    },
    queueSelect(...results: unknown[]) {
      selectQueue.push(...results);
    },
    queueInsert(...results: unknown[]) {
      insertQueue.push(...results);
    },
    queueUpdate(...results: unknown[]) {
      updateQueue.push(...results);
    },
    queueDelete(...results: unknown[]) {
      deleteQueue.push(...results);
    },
    throwOnce(err: unknown) {
      nextError = err;
    },
  };
}
