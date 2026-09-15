import https from 'node:https';
import { config, isTurnstileEnabled } from './config.js';

const TURNSTILE_HOSTNAME = 'challenges.cloudflare.com';
const TURNSTILE_PATH = '/turnstile/v0/siteverify';

export type TurnstileVerification = {
  ok: boolean;
  reason: string;
  enabled: boolean;
  expectedAction: string;
  expectedHostnames: string[];
  response?: {
    success?: boolean;
    action?: string;
    hostname?: string;
    errorCodes?: string[];
  };
  httpStatus?: number;
};

export function getTurnstileConfig(): { enabled: boolean; siteKey: string | null } {
  return isTurnstileEnabled()
    ? { enabled: true, siteKey: config.turnstileSiteKey }
    : { enabled: false, siteKey: null };
}

function result(ok: boolean, reason: string, expectedAction: string, response?: TurnstileVerification['response'], httpStatus?: number): TurnstileVerification {
  return {
    ok,
    reason,
    enabled: isTurnstileEnabled(),
    expectedAction,
    expectedHostnames: config.turnstileHostnames,
    response,
    httpStatus
  };
}

export function verifyTurnstileToken(token: string, expectedAction: string, remoteip?: string): Promise<TurnstileVerification> {
  if (!isTurnstileEnabled()) return Promise.resolve(result(true, 'disabled', expectedAction));
  if (!expectedAction) return Promise.resolve(result(false, 'missing_expected_action', expectedAction));
  if (config.turnstileHostnames.length === 0) return Promise.resolve(result(false, 'missing_expected_hostnames', expectedAction));
  if (!token) return Promise.resolve(result(false, 'missing_token', expectedAction));
  if (token.length > 2048) return Promise.resolve(result(false, 'token_too_long', expectedAction));

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
            const parsed = JSON.parse(data) as { success?: boolean; action?: string; hostname?: string; 'error-codes'?: string[] };
            const response = {
              success: parsed.success,
              action: parsed.action,
              hostname: parsed.hostname,
              errorCodes: parsed['error-codes']
            };

            if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
              resolve(result(false, 'siteverify_http_error', expectedAction, response, res.statusCode));
              return;
            }

            if (parsed.success !== true) {
              resolve(result(false, 'siteverify_unsuccessful', expectedAction, response, res.statusCode));
              return;
            }

            if (parsed.action !== expectedAction) {
              resolve(result(false, 'action_mismatch', expectedAction, response, res.statusCode));
              return;
            }

            if (typeof parsed.hostname !== 'string') {
              resolve(result(false, 'missing_hostname', expectedAction, response, res.statusCode));
              return;
            }

            if (!config.turnstileHostnames.includes(parsed.hostname.toLowerCase())) {
              resolve(result(false, 'hostname_mismatch', expectedAction, response, res.statusCode));
              return;
            }

            resolve(result(true, 'ok', expectedAction, response, res.statusCode));
          } catch {
            resolve(result(false, 'invalid_siteverify_json', expectedAction, undefined, res.statusCode));
          }
        });
      }
    );

    req.on('error', (error) => resolve(result(false, `siteverify_request_error:${error.message}`, expectedAction)));
    req.on('timeout', () => {
      req.destroy();
      resolve(result(false, 'siteverify_timeout', expectedAction));
    });
    req.write(body);
    req.end();
  });
}
