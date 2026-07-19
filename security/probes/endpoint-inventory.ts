/**
 * S8-H2 — THE endpoint inventory.
 *
 * The authz audit is only as trustworthy as its list of endpoints, so this does
 * NOT grep for decorators. It boots the real Nest container and walks the
 * DiscoveryService's controller graph, reading the SAME metadata keys the guards
 * read at request time (IS_PUBLIC_KEY, IS_OPTIONAL_AUTH_KEY,
 * REQUIRE_PERMISSIONS_KEY). If an endpoint exists, it is in this list; if a
 * guard would see a permission on it, so does this.
 *
 * Output: security/probes/out/endpoints.json, plus a printed summary of the
 * classes that matter for the audit:
 *   - PUBLIC            — no auth at all (each one must be intentionally public)
 *   - AUTH-ONLY         — authenticated but NO @RequirePermissions. For admin
 *                         surfaces this is the classic missing-guard hole; for
 *                         owner-scoped surfaces (my profile, my applications) it
 *                         is correct and the ownership check lives in the service.
 *   - PERMISSION-GATED  — the RBAC matrix decides.
 *
 *   pnpm security:inventory
 */
import './lib/env'; // MUST be the first import — see lib/env.ts
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { REPO_ROOT } from './lib/env';

/**
 * The module graph is loaded from the COMPILED build, not from source — the
 * audit is supposed to describe the artifact that ships. It also sidesteps a
 * source-mode trap: AppConfigModule resolves the root `.env` relative to
 * apps/api/dist/, so only the compiled layout finds it.
 *
 * `require` rather than `import` because the path is resolved at runtime.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AppApiModule } = require(
  path.join(REPO_ROOT, 'apps', 'api', 'dist', 'app-api.module.js'),
) as { AppApiModule: unknown };

const IS_PUBLIC_KEY = 'isPublic';
const IS_OPTIONAL_AUTH_KEY = 'isOptionalAuth';
const REQUIRE_PERMISSIONS_KEY = 'requiredPermissions';

export interface EndpointRecord {
  controller: string;
  handler: string;
  method: string;
  /** Full path as routed, including the /api/v1 prefix. */
  path: string;
  isPublic: boolean;
  isOptionalAuth: boolean;
  permissions: string[];
  /** PUBLIC | AUTH-ONLY | PERMISSION-GATED */
  klass: 'PUBLIC' | 'AUTH-ONLY' | 'PERMISSION-GATED';
}

const METHOD_NAMES: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.ALL]: 'ALL',
  [RequestMethod.OPTIONS]: 'OPTIONS',
  [RequestMethod.HEAD]: 'HEAD',
};

function joinPath(prefix: string, controllerPath: string, handlerPath: string): string {
  const parts = [prefix, controllerPath, handlerPath]
    .map((p) => (p ?? '').toString().replace(/^\/+|\/+$/g, ''))
    .filter((p) => p.length > 0);
  return '/' + parts.join('/');
}

export async function collectEndpoints(): Promise<EndpointRecord[]> {
  // abortOnError:false matters — Nest's default teardown calls process.exit(1)
  // on an init failure, which with logger:false swallows the reason entirely.
  const app = await NestFactory.createApplicationContext(AppApiModule as never, {
    logger: false,
    abortOnError: false,
  });
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const reflector = app.get(Reflector);

  const records: EndpointRecord[] = [];

  for (const wrapper of discovery.getControllers()) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) continue;

    const controllerPath = Reflect.getMetadata(PATH_METADATA, metatype) ?? '';
    const proto = Object.getPrototypeOf(instance);

    for (const methodName of scanner.getAllMethodNames(proto)) {
      const handler = proto[methodName];
      const httpMethod = Reflect.getMetadata(METHOD_METADATA, handler);
      if (httpMethod === undefined) continue; // not a route handler

      const handlerPath = Reflect.getMetadata(PATH_METADATA, handler) ?? '';

      // getAllAndOverride — the exact resolution the guards use, so a
      // class-level decorator is honoured the same way here as at runtime.
      const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, metatype]) ?? false;
      const isOptionalAuth =
        reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH_KEY, [handler, metatype]) ?? false;
      const permissions =
        reflector.getAllAndOverride<string[]>(REQUIRE_PERMISSIONS_KEY, [handler, metatype]) ?? [];

      // /health is registered outside the global prefix (load-balancer probe).
      const isHealth = String(controllerPath).replace(/^\/+/, '') === 'health';
      const prefix = isHealth ? '' : 'api/v1';

      records.push({
        controller: metatype.name,
        handler: methodName,
        method: METHOD_NAMES[httpMethod as number] ?? String(httpMethod),
        path: joinPath(prefix, String(controllerPath), String(handlerPath)),
        isPublic,
        isOptionalAuth,
        permissions,
        klass: isPublic ? 'PUBLIC' : permissions.length > 0 ? 'PERMISSION-GATED' : 'AUTH-ONLY',
      });
    }
  }

  await app.close();
  records.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return records;
}

async function main() {
  const records = await collectEndpoints();

  const outDir = path.join(__dirname, 'out');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'endpoints.json'), JSON.stringify(records, null, 2));

  const by = (k: EndpointRecord['klass']) => records.filter((r) => r.klass === k);

  console.log(`Discovered ${records.length} routed endpoints across ${new Set(records.map((r) => r.controller)).size} controllers\n`);

  console.log(`── PUBLIC (${by('PUBLIC').length}) — no auth; each must be intentionally public ──`);
  for (const r of by('PUBLIC')) {
    console.log(`  ${r.method.padEnd(6)} ${r.path}${r.isOptionalAuth ? '   [optional-auth]' : ''}`);
  }

  console.log(`\n── AUTH-ONLY (${by('AUTH-ONLY').length}) — authenticated, NO @RequirePermissions ──`);
  console.log('   (correct for owner-scoped routes; a missing guard for admin surfaces)');
  for (const r of by('AUTH-ONLY')) {
    console.log(`  ${r.method.padEnd(6)} ${r.path}   [${r.controller}.${r.handler}]`);
  }

  console.log(`\n── PERMISSION-GATED (${by('PERMISSION-GATED').length}) ──`);
  for (const r of by('PERMISSION-GATED')) {
    console.log(`  ${r.method.padEnd(6)} ${r.path.padEnd(52)} ${r.permissions.join(', ')}`);
  }

  console.log(`\nwrote ${path.relative(process.cwd(), path.join(outDir, 'endpoints.json'))}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
