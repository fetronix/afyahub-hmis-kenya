import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
const { createApp } = await import('../../app.ts');

it('dump', async () => {
  const app: any = await createApp();
  const stack = app.stack ?? app._router?.stack ?? [];
  const out: string[] = [];
  const walk = (layers: any[], prefix: string) => {
    for (const layer of layers) {
      if (layer.route) {
        for (const [m, on] of Object.entries(layer.route.methods ?? {})) {
          if (on) out.push(`${String(m).toUpperCase()} ${prefix}${layer.route.path}`);
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack, prefix);
      }
    }
  };
  walk(stack, '');
  writeFileSync('/tmp/allroutes.json', JSON.stringify(out, null, 2));
});
