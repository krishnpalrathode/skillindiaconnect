import { envSchema, type Env } from './env.schema';

export function validateEnv(config?: Record<string, unknown>): Env {
  const data: Record<string, unknown> = config ?? (process.env as Record<string, unknown>);
  const result = envSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    console.error(`Invalid environment variables:\n${issues}`);
    process.exit(1);
  }
  return result.data;
}
