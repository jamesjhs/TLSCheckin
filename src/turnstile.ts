import https from 'node:https';
import { config, isTurnstileEnabled } from './config.js';

const TURNSTILE_HOSTNAME = 'challenges.cloudflare.com';
const TURNSTILE_PATH = '/turnstile/v0/siteverify';

export function getTurnstileConfig(): { enabled: boolean; siteKey: string | null } {
  return isTurnstileEnabled()
    ? { enabled: true, siteKey: config.turnstileSiteKey }
    : { enabled: false, siteKey: null };
}

export function verifyTurnstileToken(token: string, expectedAction: string, remoteip?: string): Promise<boolean> {
  if (!isTurnstileEnabled()) return Promise.resolve(true);
  if (!token || token.length > 2048 || !expectedAction || config.turnstileHostnames.length === 0) return Promise.resolve(false);

  const params = new URLSearchParams({ secret: config.turnstileSecretKey, response: token });
  if (remoteip) params.append('remoteip', remoteip);
  const body = params.toString();

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: TURNSTILE_HOSTNAME,
        path: TURNSTILE_PATH,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: 5000
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data) as { success?: boolean; action?: string; hostname?: string };
            resolve(
              parsed.success === true &&
              parsed.action === expectedAction &&
              typeof parsed.hostname === 'string' &&
              config.turnstileHostnames.includes(parsed.hostname.toLowerCase())
            );
          } catch {
            resolve(false);
          }
        });
      }
    );

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.write(body);
    req.end();
  });
}
