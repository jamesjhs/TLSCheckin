import type { SmsSettings } from './db.js';

export const ACKNOWLEDGEMENT_SMS_TEXT = 'Acknowledgement received, thank you for using TLS';

export function normalizeInternationalPhoneNumber(raw: unknown): { ok: true; phoneNumber: string } | { ok: false; message: string } {
  const value = String(raw ?? '').trim();
  if (!value) return { ok: true, phoneNumber: '' };
  if (!/^\+?[1-9][0-9]{7,14}$/.test(value)) {
    return { ok: false, message: 'Enter an international phone number, for example +447710123456.' };
  }
  const phoneNumber = value.replace(/^\+/, '');
  if (phoneNumber.startsWith('0')) {
    return { ok: false, message: 'Use the international country code, not a local leading zero.' };
  }
  return { ok: true, phoneNumber };
}

export function smsSettingsAreComplete(settings: SmsSettings): boolean {
  return Boolean(settings.accessKey && settings.secretKey);
}

export function normalizeSmsText(raw: unknown, maxLength = 160): { ok: true; text: string } | { ok: false; message: string } {
  const text = String(raw ?? '').trim();
  if (!text) return { ok: false, message: 'Enter an SMS message.' };
  if (text.length > maxLength) return { ok: false, message: `SMS messages must be ${maxLength} characters or fewer.` };
  return { ok: true, text };
}

type IntelliSoftwareResponse = {
  response_status?: string;
  messages?: Array<{
    to?: string;
    id?: string;
    error?: string;
    error_code?: number;
    error_description?: string;
  }>;
  errors?: Array<{
    error?: string;
    error_code?: number;
    error_description?: string;
  }>;
};

function describeError(response: IntelliSoftwareResponse): string {
  const firstMessageError = response.messages?.find((message) => message.error);
  const firstOverallError = response.errors?.[0];
  const error = firstMessageError ?? firstOverallError;
  if (!error) return 'SMS gateway did not accept the message.';
  return [error.error, error.error_code, error.error_description].filter((value) => value !== undefined && value !== '').join(' ');
}

export async function sendSms(settings: SmsSettings, to: string, text: string): Promise<{ ok: true; providerMessageId?: string } | { ok: false; error: string }> {
  if (!smsSettingsAreComplete(settings)) return { ok: false, error: 'IntelliSoftware settings are incomplete.' };

  const response = await fetch('https://www.intellisoftware.co.uk/api/json/sendmsg.aspx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth: {
        authtype: 'accesskey',
        accesskey: settings.accessKey,
        secretkey: settings.secretKey
      },
      request_version: '1.0.0',
      response_version: '1.0.3',
      message: {
        ...(settings.senderId ? { from: settings.senderId } : {}),
        to,
        channel: 'sms',
        content: {
          msgtype: 'text',
          text,
          maxconcat: 1
        }
      }
    })
  });

  if (!response.ok) {
    return { ok: false, error: `SMS gateway HTTP ${response.status}.` };
  }

  const body = await response.json().catch(() => null) as IntelliSoftwareResponse | null;
  if (!body) return { ok: false, error: 'SMS gateway returned invalid JSON.' };
  if (body.response_status !== 'ok') return { ok: false, error: describeError(body) };

  const message = body.messages?.[0];
  if (message?.error) return { ok: false, error: describeError(body) };
  return { ok: true, providerMessageId: message?.id };
}

export async function sendAcknowledgementSms(settings: SmsSettings, to: string): Promise<{ ok: true; providerMessageId?: string } | { ok: false; error: string }> {
  return sendSms(settings, to, ACKNOWLEDGEMENT_SMS_TEXT);
}
