/**
 * Build the API route inventory that the API reference is generated from.
 *
 * Two independent sources are combined, and the combination is the point:
 *
 *   1. **The running application.** `createApp()` is built exactly as the
 *      server builds it, and the Express router tree is walked. This is the
 *      only way to see the *effective* path of every handler, including the
 *      prefixes applied by nested mounts.
 *   2. **The source files.** Each `*.routes.ts` registration is parsed for the
 *      permission calls in its handler chain, and the mount table in
 *      `src/routes/index.ts` and `src/app.ts` supplies the prefix for routers
 *      that register relative paths.
 *
 * Every dynamic route is matched to a static registration; anything left
 * unmatched is reported, because an undocumented route is exactly the thing
 * this inventory exists to prevent.
 *
 *   npx tsx scripts/docs/build-api-inventory.ts
 *
 * Outputs:
 *   docs/evidence/API_ROUTE_INVENTORY.json
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';

process.env.NODE_ENV = 'test';

const ROOT = resolve(import.meta.dirname, '..', '..');
const OUT = join(ROOT, 'docs', 'evidence', 'API_ROUTE_INVENTORY.json');

interface Registration {
  file: string;
  method: string;
  path: string;
  permissions: string[];
  anyPermissions: string[];
  superAdmin: boolean;
  facilityAdmin: boolean;
  moduleGates: string[];
  comment: string;
  line: number;
  fullPath: string | null;
  /** Local Express router variable the registration is attached to. */
  routerVar: string;
  /** Authentication applied by the handler chain: session, portal, or none. */
  auth: 'session' | 'portal' | 'none';
  /** Zod schema validated for the request body / query string, if any. */
  bodySchema: string | null;
  querySchema: string | null;
  /** Handler resolves a facility scope (tenant + facility isolation). */
  facilityScoped: boolean;
  /** Handler writes a file or PDF rather than JSON. */
  binary: boolean;
  /** Representative service call inside the handler, e.g. `patients.create`. */
  serviceCall: string | null;
  /** The handler passes the auth context to a service that decides access. */
  serviceAuthorisation: boolean;
}

interface RouteRecord {
  method: string;
  path: string;
  file: string | null;
  permissions: string[];
  anyPermissions: string[];
  superAdmin: boolean;
  facilityAdmin: boolean;
  moduleGates: string[];
  description: string;
  public: boolean;
  auth: 'session' | 'portal' | 'none';
  bodySchema: string | null;
  querySchema: string | null;
  facilityScoped: boolean;
  binary: boolean;
  serviceCall: string | null;
  serviceAuthorisation: boolean;
  source: string | null;
}

function filesUnder(dir: string, suffix: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full, suffix));
    else if (entry.endsWith(suffix)) out.push(full);
  }
  return out;
}

const rel = (p: string) => relative(ROOT, p).replace(/\\/g, '/');

/* ------------------------------------------------------------------ *
 * 1. Mount table
 * ------------------------------------------------------------------ */

interface ImportBinding {
  file: string;
  /** Exported name in the target module (`default` for a default import). */
  exported: string;
}

/** Some imports omit the `.ts` extension; resolve those against the disk. */
function resolveModule(path: string): string {
  for (const candidate of [path, `${path}.ts`, `${path}/index.ts`]) {
    if (existsSync(candidate)) return candidate;
  }
  return path;
}

/** Local identifier → source module, for any module that mounts routers. */
function importMap(file: string): Map<string, ImportBinding> {
  const source = readFileSync(join(ROOT, file), 'utf8');
  const map = new Map<string, ImportBinding>();
  const target = (specifier: string) =>
    resolveModule(resolve(dirname(join(ROOT, file)), specifier));
  for (const match of source.matchAll(/import\s+([A-Za-z0-9_]+)\s+from\s+'(\.[^']+)'/g)) {
    map.set(match[1], { file: target(match[2]), exported: 'default' });
  }
  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s+'(\.[^']+)'/g)) {
    for (const spec of match[1].split(',')) {
      const cleaned = spec.replace(/\btype\b/, '').trim();
      if (!cleaned) continue;
      const [imported, local] = cleaned.split(/\s+as\s+/).map((part) => part.trim());
      map.set(local ?? imported, { file: target(match[2]), exported: imported });
    }
  }
  return map;
}

/** `export { local as alias }` / `export default local` → exported name. */
function exportMap(file: string): Map<string, string> {
  if (!existsSync(file)) return new Map();
  const source = readFileSync(file, 'utf8');
  const map = new Map<string, string>();
  for (const match of source.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const spec of match[1].split(',')) {
      const cleaned = spec.replace(/\btype\b/, '').trim();
      if (!cleaned) continue;
      const [local, exported] = cleaned.split(/\s+as\s+/).map((part) => part.trim());
      map.set(exported ?? local, local);
    }
  }
  const fallback = /export\s+default\s+([A-Za-z0-9_]+)/.exec(source);
  if (fallback) map.set('default', fallback[1]);
  return map;
}

/** Local names bound to an Express `Router()` inside a module. */
function routersInFile(file: string): Set<string> {
  if (!existsSync(file)) return new Set();
  const source = readFileSync(file, 'utf8');
  return new Set(
    [...source.matchAll(/const\s+([A-Za-z0-9_]+)\s*(?::\s*[^=]+)?=\s*(?:express\.)?Router\(/g)].map(
      (match) => match[1],
    ),
  );
}

interface MountEdge {
  /** Offset of the `.use(` call in its module. */
  index: number;
  /** Local router variable that owns the child router. */
  parentVar: string;
  /** Literal prefix, or null when the router is mounted at the parent root. */
  prefix: string | null;
  targetFile: string;
  targetVar: string;
}

/** Every `parent.use([prefix,] importedRouter)` call in a module. */
function useEdges(file: string): MountEdge[] {
  const source = readFileSync(file, 'utf8');
  const imports = importMap(file);
  const exported = new Map<string, string>();
  const edges: MountEdge[] = [];
  for (const match of source.matchAll(/([A-Za-z0-9_]+)\.use\(/g)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    const args = balanced(source, open);
    const routerName = [...args.matchAll(/\b([A-Za-z0-9_]+)\b/g)]
      .map((word) => word[1])
      .find((name) => {
        const binding = imports.get(name);
        return binding ? routersInFile(binding.file).size > 0 : false;
      });
    if (!routerName) continue;
    const binding = imports.get(routerName)!;
    let localVar = exported.get(binding.file);
    if (!localVar) {
      localVar = exportMap(binding.file).get(binding.exported) ?? binding.exported;
      exported.set(binding.file, localVar);
    }
    const literal = /^\(\s*'([^']*)'/.exec(args);
    edges.push({
      index: match.index ?? 0,
      parentVar: match[1],
      prefix: literal ? literal[1] : null,
      targetFile: rel(binding.file),
      targetVar: localVar,
    });
  }
  return edges;
}

/* The two mounting entry points: `app.ts` mounts `/api/...` absolutely, and
 * `createApiRoutes()` in `routes/index.ts` is itself mounted at `/api`. */
const MOUNT_ROOTS: Record<string, string> = {
  'src/app.ts': '',
  'src/routes/index.ts': '/api',
};

const mounts = new Map<string, Set<string>>();
const addMount = (key: string, prefix: string) => {
  if (!mounts.has(key)) mounts.set(key, new Set());
  mounts.get(key)!.add(prefix);
};
for (const [file, base] of Object.entries(MOUNT_ROOTS)) {
  for (const edge of useEdges(file))
    addMount(`${edge.targetFile}#${edge.targetVar}`, `${base}${edge.prefix ?? ''}`);
}

/**
 * Router factories. `app.use('/api', createApiRoutes())` mounts a router that
 * is only created inside the factory, so the local variable is read from the
 * factory body rather than from an import.
 */
const allSources = new Map<string, string>();
function sourceOf(file: string): string {
  if (!allSources.has(file))
    allSources.set(
      file,
      existsSync(join(ROOT, file)) ? readFileSync(join(ROOT, file), 'utf8') : '',
    );
  return allSources.get(file)!;
}

/** The file that declares `export function <factory>` (or `const <factory>`). */
function factoryFile(factory: string): string | null {
  for (const file of filesUnder(join(ROOT, 'src'), '.ts').map((path) => rel(path))) {
    const pattern = new RegExp(`export (?:async )?(?:function|const) ${factory}\\b`);
    if (pattern.test(sourceOf(file))) return file;
  }
  return null;
}

function routerReturnedBy(file: string, factory: string): string | null {
  const source = sourceOf(file);
  if (!source) return null;
  const start = source.search(new RegExp(`(?:function|const)\\s+${factory}\\b`));
  if (start < 0) return null;
  const body = source.slice(start, start + 4000);
  const router = /const\s+([A-Za-z0-9_]+)\s*(?::\s*[^=]+)?=\s*(?:express\.)?Router\(/.exec(body);
  return router ? router[1] : null;
}

const appSource = readFileSync(join(ROOT, 'src/app.ts'), 'utf8');
for (const match of appSource.matchAll(/app\.use\(/g)) {
  const args = balanced(appSource, (match.index ?? 0) + match[0].length - 1);
  const factory = /\b(create[A-Za-z0-9_]+)\(\)/.exec(args);
  if (!factory) continue;
  const file = factoryFile(factory[1]);
  if (!file) continue;
  const localVar = routerReturnedBy(file, factory[1]);
  if (!localVar) continue;
  const literal = /^\(\s*'([^']*)'/.exec(args);
  addMount(`${file}#${localVar}`, literal ? literal[1] : '');
}

/**
 * Modules mounted before `app.use('/api', requireAuth)` are reachable without a
 * staff session: the login and invitation endpoints, the public booking API,
 * the patient portal, and signature-verified webhooks. Everything mounted after
 * that line inherits the session requirement.
 */
const appMounts = useEdges('src/app.ts');
const authLine = appSource.search(/app\.use\('\/api',\s*requireAuth\)/);
const preAuthMounts = new Set(
  appMounts
    .filter((edge) => authLine > 0 && edge.index < authLine)
    .map((edge) => `${edge.targetFile}#${edge.targetVar}`),
);

/* Every module that can register routes: the `*.routes.ts` convention plus
 * any module reachable from a mount. */
const scanFiles = new Set<string>(
  filesUnder(join(ROOT, 'src'), '.routes.ts').map((file) => rel(file)),
);
for (const key of mounts.keys()) scanFiles.add(key.split('#')[0]);
scanFiles.add('src/app.ts');
scanFiles.add('src/routes/index.ts');

/* Propagate prefixes through nested mounts until the table stops growing. */
const edgeCache = new Map<string, MountEdge[]>();
const edgesOf = (file: string) => {
  if (!edgeCache.has(file)) edgeCache.set(file, useEdges(file));
  return edgeCache.get(file)!;
};
for (let changed = true; changed;) {
  changed = false;
  for (const file of scanFiles) {
    for (const edge of edgesOf(file)) {
      const parentPrefixes = mounts.get(`${file}#${edge.parentVar}`);
      if (!parentPrefixes) continue;
      const key = `${edge.targetFile}#${edge.targetVar}`;
      const existing = mounts.get(key) ?? new Set<string>();
      for (const prefix of parentPrefixes) {
        const combined = `${prefix}${edge.prefix ?? ''}`;
        if (!existing.has(combined)) {
          existing.add(combined);
          changed = true;
        }
      }
      mounts.set(key, existing);
    }
  }
}

/* ------------------------------------------------------------------ *
 * 2. Static registrations
 * ------------------------------------------------------------------ */

function lineAt(source: string, index: number) {
  return source.slice(0, index).split('\n').length;
}

/** The comment block immediately above a registration, if any. */
function commentAbove(source: string, index: number): string {
  const before = source.slice(0, index);
  const end = before.lastIndexOf('\n') + 1;
  let cursor = end;
  const lines: string[] = [];
  for (let i = 0; i < 30; i++) {
    const prevEnd = cursor - 1;
    if (prevEnd <= 0) break;
    const prevStart = before.lastIndexOf('\n', prevEnd - 1) + 1;
    const line = before.slice(prevStart, prevEnd).trim();
    /* A comment belongs to a route only when it sits directly above it: a blank
     * line means the comment introduced a section, not this registration. */
    if (line === '') break;
    if (line.startsWith('*') || line.startsWith('/*') || line.startsWith('*/')) {
      lines.unshift(
        line
          .replace(/^\/\*+\s?/, '')
          .replace(/^\*+\s?/, '')
          .replace(/\*\/$/, '')
          .trim(),
      );
      cursor = prevStart;
      continue;
    }
    if (line.startsWith('//')) {
      lines.unshift(line.replace(/^\/\/+\s?/, '').trim());
      cursor = prevStart;
      continue;
    }
    break;
  }
  return lines
    .map((line) => line.replace(/^[=\-_*\s]+|[=\-_*\s]+$/g, '').trim())
    .filter((line) => /[A-Za-z]{3}/.test(line) && !/^[A-Z0-9 ,&/()'-]{18,}$/.test(line))
    .join(' ')
    .slice(0, 240);
}

/** Balanced parentheses from an opening index. */
function balanced(source: string, open: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (char === '\\') i++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') depth++;
    if (char === ')') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

const staticRegistrations: Registration[] = [];

/** Balanced brackets of any kind, from an opening index. */
function balancedAny(source: string, open: number, openChar: string, closeChar: string): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (char === '\\') i++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === openChar) depth++;
    if (char === closeChar) {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

const quotedValues = (text: string) => [...text.matchAll(/'([^']*)'/g)].map((match) => match[1]);

/**
 * Expand the two loop styles used for repetitive route families, so that each
 * concrete registration is seen by the parser:
 *
 *   for (const action of ['approve', 'reject'] as const) router.post(`/x/${action}`)
 *   for (const [path, method] of [['/a', 'get']] as const) router[method](path)
 */
function expandLoops(source: string): string {
  let body = source;

  /* Table-driven: for (const [path, method, work] of [ [...] ] as const) */
  for (;;) {
    const header = /for \(const \[(\w+), (\w+)(?:, \w+)?\] of \[/.exec(body);
    if (!header) break;
    const arrayOpen = (header.index ?? 0) + header[0].length - 1;
    const table = balancedAny(body, arrayOpen, '[', ']');
    const afterTable = (header.index ?? 0) + header[0].length - 1 + table.length;
    const braceOpen = body.indexOf('{', afterTable);
    if (braceOpen < 0) break;
    const block = balancedAny(body, braceOpen, '{', '}');
    const triples = [...table.matchAll(/\[\s*'([^']*)'\s*,\s*'(\w+)'/g)].map((m) => ({
      path: m[1],
      method: m[2],
    }));
    const endsWithBrace = block.endsWith('}');
    const inner = endsWithBrace ? block.slice(1, -1) : block.slice(1);
    const expanded = triples
      .map((triple) =>
        inner
          .replace(
            new RegExp(`\\[${header[2]}\\]\\(\\s*${header[1]}`, 'g'),
            `.${triple.method}('${triple.path}'`,
          )
          .split(header[1])
          .join(triple.path),
      )
      .join('\n');
    body = body.slice(0, header.index) + expanded + body.slice(braceOpen + block.length);
  }

  /* Name loop: for (const action of ['approve', 'reject'] as const) */
  for (;;) {
    const header = /for \(const (\w+) of \[([^\]]*)\] as const\) \{/.exec(body);
    if (!header) break;
    const braceOpen = (header.index ?? 0) + header[0].length - 1;
    const block = balancedAny(body, braceOpen, '{', '}');
    const values = quotedValues(header[2]);
    const inner = block.slice(1, -1);
    const expanded = values.map((value) => inner.split(`\${${header[1]}}`).join(value)).join('\n');
    body = body.slice(0, header.index) + expanded + body.slice(braceOpen + block.length);
  }

  return body;
}

const IGNORED_CALL_PREFIXES = new Set([
  'res',
  'req',
  'next',
  'console',
  'process',
  'logger',
  'Math',
  'JSON',
  'Object',
  'Number',
  'String',
  'Date',
  'Promise',
  'Array',
  'await',
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'typeof',
  'parseInt',
  'parseFloat',
  'setTimeout',
  'new',
]);

/**
 * First service call in a handler that is not runtime plumbing — usually the
 * function that does the work (`queries.listPatients`, `createInvoiceScoped`).
 */
function representativeCall(text: string): string | null {
  for (const match of text.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Za-z_$][A-Za-z0-9_$]*)\(/g)) {
    if (IGNORED_CALL_PREFIXES.has(match[1]) || match[1].startsWith('require')) continue;
    return `${match[1]}.${match[2]}`;
  }
  for (const match of text.matchAll(/(?:await\s+)?(?<![.\w$])([a-z][A-Za-z0-9_]*)\(/g)) {
    if (IGNORED_CALL_PREFIXES.has(match[1]) || match[1].startsWith('require')) continue;
    return `${match[1]}()`;
  }
  return null;
}

const AUTH_MARKERS = [/\brequirePortalAuth\b/, /\brequireAuth\b/] as const;

/** Session or portal authentication carried by a handler chain. */
function authOf(text: string): 'session' | 'portal' | 'none' {
  if (AUTH_MARKERS[0].test(text)) return 'portal';
  if (AUTH_MARKERS[1].test(text)) return 'session';
  return 'none';
}

/** `router.use(...)` guards: permission codes and authentication, per router. */
function routerGuards(source: string): {
  permissions: Map<string, string[]>;
  auth: Map<string, 'session' | 'portal' | 'none'>;
} {
  const permissions = new Map<string, string[]>();
  const auth = new Map<string, 'session' | 'portal' | 'none'>();
  for (const match of source.matchAll(/([A-Za-z0-9_]+)\.use\(/g)) {
    const args = balanced(source, (match.index ?? 0) + match[0].length - 1);
    const routerVar = match[1];
    const codes = [...args.matchAll(/require(?:Any)?Permission\(\s*([^)]*)\)/g)].flatMap((call) =>
      quotedValues(call[1]),
    );
    if (codes.length) {
      if (!permissions.has(routerVar)) permissions.set(routerVar, []);
      permissions.get(routerVar)!.push(...codes);
    }
    const chainAuth = authOf(args);
    if (chainAuth !== 'none') auth.set(routerVar, chainAuth);
  }
  return { permissions, auth };
}

/** Simple string constants in a module, used by `requirePermission(READ)`. */
function stringConstants(source: string): Map<string, string> {
  const constants = new Map<string, string>();
  for (const match of source.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*=\s*'([^']+)'/g)) {
    constants.set(match[1], match[2]);
  }
  return constants;
}

/** A permission argument list → codes, resolving module constants. */
function permissionCodes(args: string, constants: Map<string, string>): string[] {
  return [...args.matchAll(/require(?:Any)?Permission\(\s*([^)]*)\)/g)]
    .flatMap((call) => [...call[1].matchAll(/'([^']+)'|([A-Z][A-Z0-9_]*)/g)])
    .map((token) => token[1] ?? constants.get(token[2]) ?? '')
    .filter(Boolean);
}

for (const relative of [...scanFiles].sort()) {
  const file = join(ROOT, relative);
  const source = readFileSync(file, 'utf8');
  const body = expandLoops(source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')));
  const guards = routerGuards(body);
  const guardAuth = guards.auth;
  const constants = stringConstants(body);
  const pattern = /\b([A-Za-z0-9_$]+)\.(get|post|put|patch|delete|all)\(\s*(['"`])(\/[^'"`]*)?\3/g;
  for (const match of body.matchAll(pattern)) {
    const index = match.index ?? 0;
    const open = body.indexOf('(', index);
    const args = balanced(body, open);
    const permissions = permissionCodes(args, constants);
    const any = [...args.matchAll(/requireAnyPermission\(\s*\[([^\]]+)\]/g)].flatMap((m) =>
      [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]),
    );
    const modules = [...args.matchAll(/requireFacilityModule\(\s*'([^']+)'/g)].map((m) => m[1]);
    staticRegistrations.push({
      file: relative,
      method: match[2].toUpperCase(),
      path: match[4] ?? '',
      permissions: [...new Set([...permissions, ...(guards.permissions.get(match[1]) ?? [])])],
      anyPermissions: [...new Set(any)],
      superAdmin: /requireSuperAdmin/.test(args),
      facilityAdmin: /requireFacilityAdmin|requireFacilityIntegrationAdministrator/.test(args),
      moduleGates: [...new Set(modules)],
      comment: commentAbove(source, index),
      line: lineAt(body, index),
      fullPath: null,
      routerVar: match[1],
      auth: authOf(args) !== 'none' ? authOf(args) : (guardAuth.get(match[1]) ?? 'none'),
      bodySchema: /validateBody\(\s*([A-Za-z0-9_]+)/.exec(args)?.[1] ?? null,
      querySchema: /validateQuery\(\s*([A-Za-z0-9_]+)/.exec(args)?.[1] ?? null,
      facilityScoped: /resolveFacilityScope|requireScopedFacility|\bscope\(req|facilityScope/.test(
        args,
      ),
      binary:
        /res\.(?:sendFile|download)\(|application\/pdf|application\/octet-stream|setHeader\(\s*'Content-Type'/.test(
          args,
        ),
      serviceCall:
        representativeCall(args.indexOf('=>') >= 0 ? args.slice(args.indexOf('=>')) : args) ??
        /,\s*([a-z][A-Za-z0-9_]+)\s*,?\s*$/.exec(args.replace(/\s+/g, ' '))?.[1] ??
        null,
      serviceAuthorisation: /authContext/.test(args),
    });
  }
}

/*
 * Resolve a relative route to its effective path. A router mounted at one
 * prefix is unambiguous; one mounted at several is resolved per candidate and
 * matched against the running application below.
 */
for (const registration of staticRegistrations) {
  if (registration.path.startsWith('/api')) {
    registration.fullPath = registration.path;
    continue;
  }
  /* Prefer the mount of the exact router variable; fall back to any mount of
   * the module, because some modules re-export or compose their routers. */
  const prefixes =
    mounts.get(`${registration.file}#${registration.routerVar}`) ??
    new Set(
      [...mounts.entries()]
        .filter(([key]) => key.startsWith(`${registration.file}#`))
        .flatMap(([, values]) => [...values]),
    );
  if (!prefixes.size) prefixes.add('');
  const candidates = [...prefixes].map(
    (prefix) =>
      `${prefix}${registration.path === '/' ? '' : registration.path}`.replace(/\/$/, '') || '/',
  );
  registration.fullPath = candidates[0] ?? registration.path;
  (registration as Registration & { candidates?: string[] }).candidates = candidates;
}

/* ------------------------------------------------------------------ *
 * 3. Effective routes from the running app
 * ------------------------------------------------------------------ */

const { createApp } = await import(join(ROOT, 'src', 'app.ts'));
const app = await createApp();

interface DynamicRoute {
  method: string;
  path: string;
}

const dynamic: DynamicRoute[] = [];

function walk(stack: any[], prefix: string) {
  for (const layer of stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        dynamic.push({ method: method.toUpperCase(), path: `${prefix}${layer.route.path}` || '/' });
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      const source: string = layer.regexp?.source ?? '';
      const match = /^\^\\\/(.*?)\\\/\?\(\?=\\\/\|\$\)$/.exec(source);
      walk(layer.handle.stack, prefix + (match ? '/' + match[1].replace(/\\\//g, '/') : ''));
    }
  }
}
walk((app as any)._router.stack, '');

const normalise = (path: string) => path.replace(/\/$/, '') || '/';

const byPath = new Map<string, Registration[]>();
for (const registration of staticRegistrations) {
  const candidates = (registration as Registration & { candidates?: string[] }).candidates ?? [
    registration.fullPath ?? registration.path,
  ];
  for (const candidate of candidates) {
    const key = `${registration.method} ${normalise(candidate)}`;
    if (!byPath.has(key)) byPath.set(key, []);
    byPath.get(key)!.push(registration);
  }
}

/** Public mounts, established by reading `src/app.ts`, not by guessing. */
const PUBLIC_PREFIXES = [
  '/api/health',
  '/api/ready',
  '/api/auth',
  '/api/webhooks',
  '/api/booking/v1',
  '/api/portal',
  '/api/documents/portal',
];

const records: RouteRecord[] = dynamic.map((route) => {
  const key = `${route.method} ${normalise(route.path)}`;
  const matches = byPath.get(key) ?? [];
  const first = matches[0];
  const isPublicMount =
    matches.some((m) => preAuthMounts.has(`${m.file}#${m.routerVar}`)) ||
    PUBLIC_PREFIXES.some((prefix) => normalise(route.path).startsWith(prefix));
  const declared = first?.auth ?? 'none';
  const auth: RouteRecord['auth'] =
    declared !== 'none' ? declared : isPublicMount ? 'none' : 'session';
  return {
    method: route.method,
    path: normalise(route.path),
    file: first?.file ?? null,
    permissions: [...new Set(matches.flatMap((m) => m.permissions))],
    anyPermissions: [...new Set(matches.flatMap((m) => m.anyPermissions))],
    superAdmin: matches.some((m) => m.superAdmin),
    facilityAdmin: matches.some((m) => m.facilityAdmin),
    moduleGates: [...new Set(matches.flatMap((m) => m.moduleGates))],
    description: first?.comment ?? '',
    public: auth === 'none',
    auth,
    bodySchema: first?.bodySchema ?? null,
    querySchema: first?.querySchema ?? null,
    facilityScoped: matches.some((m) => m.facilityScoped),
    binary: first?.binary ?? false,
    serviceCall: first?.serviceCall ?? null,
    serviceAuthorisation: first?.serviceAuthorisation ?? false,
    source: first ? `${first.file}:${first.line}` : null,
  };
});

/*
 * Facility module gates are applied at the mount (`api.use('/laboratory',
 * requireFacilityModule('laboratory'), laboratoryRoutes)`), so they are read
 * from the mount module and attached to every route under that prefix.
 */
const mountGates: { prefix: string; modules: string[] }[] = [];
{
  const routesSource = readFileSync(join(ROOT, 'src', 'routes', 'index.ts'), 'utf8');
  for (const match of routesSource.matchAll(/([A-Za-z0-9_]+)\.use\(/g)) {
    const args = balanced(routesSource, (match.index ?? 0) + match[0].length - 1);
    const prefix = /^\(\s*'([^']*)'/.exec(args)?.[1] ?? '';
    const modules = [...args.matchAll(/requireFacilityModule\(\s*'([^']+)'/g)].map((m) => m[1]);
    if (modules.length && prefix.startsWith('/')) {
      mountGates.push({ prefix: `/api${prefix}`, modules: [...new Set(modules)] });
    }
  }
}
for (const record of records) {
  const gate = mountGates
    .filter((candidate) => record.path === candidate.prefix || record.path.startsWith(`${candidate.prefix}/`))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  if (gate) record.moduleGates = [...new Set([...record.moduleGates, ...gate.modules])];
}

const matched = records.filter((record) => record.file !== null).length;
const unmatched = records.filter((record) => record.file === null);

/* Prefix grouping used by the reference. */
const prefixOf = (path: string) => {
  const parts = path.split('/').filter(Boolean);
  if (parts[0] !== 'api') return 'other';
  return parts[1] ?? 'root';
};

const groups = new Map<string, RouteRecord[]>();
for (const record of records) {
  const group = prefixOf(record.path);
  if (!groups.has(group)) groups.set(group, []);
  groups.get(group)!.push(record);
}

const payload = {
  generatedAt: new Date().toISOString(),
  generatedBy: 'scripts/docs/build-api-inventory.ts',
  sources: {
    runningApplication: 'createApp() router tree',
    staticRegistrations: 'src/**/*.routes.ts',
    mounts: 'src/app.ts, src/routes/index.ts',
  },
  totals: {
    effectiveRoutes: records.length,
    staticRegistrations: staticRegistrations.length,
    matchedToSource: matched,
    unmatched,
    publicRoutes: records.filter((record) => record.public).length,
    guardedRoutes: records.filter((record) => record.permissions.length || record.superAdmin)
      .length,
    prefixes: groups.size,
  },
  prefixCounts: [...groups.entries()]
    .map(([prefix, routes]) => ({ prefix, routes: routes.length }))
    .sort((a, b) => b.routes - a.routes),
  routes: records.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)),
};

writeFileSync(OUT, `${JSON.stringify(payload, null, 1)}\n`);

console.info('API inventory', payload.totals);
if (unmatched.length) {
  console.info(
    'Unmatched (no static registration found):',
    unmatched.slice(0, 20).map((route) => `${route.method} ${route.path}`),
  );
}

process.exit(0);
