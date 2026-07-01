import { readFileSync } from 'node:fs';
import { envSchema } from '../packages/shared-config/src/env.schema';

// envSchema is a plain z.object() so .shape is accessible directly.
const schemaKeys = new Set(Object.keys((envSchema as any).shape));

const exampleKeys = new Set(
  readFileSync('.env.example', 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('=')[0].trim())
    .filter(Boolean),
);

// NEXT_PUBLIC_* are Next.js-managed web env vars, not validated by the api Zod schema.
const serverExampleKeys = [...exampleKeys].filter((k) => !k.startsWith('NEXT_PUBLIC_'));

const missingInSchema = serverExampleKeys.filter((k) => !schemaKeys.has(k));
const missingInExample = [...schemaKeys].filter((k) => !exampleKeys.has(k));

if (missingInSchema.length || missingInExample.length) {
  if (missingInSchema.length) console.error('In .env.example, not in Zod schema:', missingInSchema);
  if (missingInExample.length)
    console.error('In Zod schema, not in .env.example:', missingInExample);
  process.exit(1);
}

console.log('.env.example matches the Zod env schema ✓');
