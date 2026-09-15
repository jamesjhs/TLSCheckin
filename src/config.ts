import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required. Check .env or environment variables.`);
  return value;
}

function optional(name: string): string {
  return process.env[name]?.trim() ?? '';
}

export const config = {
  port: Number(process.env.PORT || 9110),
  dbPath: path.resolve(process.cwd(), process.env.DB_PATH || './data/tlscheckin.db'),
  dbEncryptionKey: required('DB_ENCRYPTION_KEY'),
  adminInitialPassword: required('ADMIN_INITIAL_PASSWORD'),
  sessionSecret: required('SESSION_SECRET'),
  turnstileSiteKey: optional('TURNSTILE_SITE_KEY'),
  turnstileSecretKey: optional('TURNSTILE_SECRET_KEY')
};

if (!Number.isInteger(config.port) || config.port <= 0 || config.port > 65535) {
  throw new Error('PORT must be a valid TCP port number.');
}

if ((config.turnstileSiteKey && !config.turnstileSecretKey) || (!config.turnstileSiteKey && config.turnstileSecretKey)) {
  throw new Error('TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY must be configured together.');
}

export function isTurnstileEnabled(): boolean {
  return Boolean(config.turnstileSiteKey && config.turnstileSecretKey);
}
