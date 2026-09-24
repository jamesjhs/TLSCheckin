import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export type CheckinsFile = {
  presets: string[];
};

const DEFAULT_CHECKIN_PRESETS = [
  'Hello from TLSCheckin — just a warm note to say we’re here.',
  'Wishing you a calm and steady day from TLSCheckin.',
  'TLSCheckin is thinking of you and sending a friendly hello.',
  'Just a quick hello from TLSCheckin and warm regards today.',
  'Hope your day is going smoothly — hello from TLSCheckin.',
  'Sending a little encouragement your way from TLSCheckin.',
  'TLSCheckin is checking in with a simple hello and warm thoughts.',
  'A friendly message from TLSCheckin is here for you today.',
  'Hello from TLSCheckin — we hope things are going well for you.',
  'TLSCheckin is sending a kind reminder that you’re being thought of.',
  'Just a gentle hello from TLSCheckin to brighten your day a little.',
  'Warm greetings from TLSCheckin and best wishes for the day ahead.',
  'TLSCheckin is here in the background, sending a friendly hello.',
  'A small hello from TLSCheckin, with warm thoughts for your day.',
  'Thinking of you today — hello from TLSCheckin.',
  'Hello from TLSCheckin — sending a warm and thoughtful greeting today.',
  'TLSCheckin is reaching out with a friendly hello and kind wishes.',
  'Wishing you a peaceful moment today from everyone at TLSCheckin.',
  'A warm hello from TLSCheckin, with thoughts of care and support.',
  'TLSCheckin is sending a gentle note and warm greetings your way.',
  'Just a friendly hello from TLSCheckin to be part of your day.',
  'Sending warm wishes from TLSCheckin and hoping today feels manageable.',
  'Hello from TLSCheckin — a simple message with care behind it.',
  'TLSCheckin is here with a warm hello and steady support.',
  'A kind hello from TLSCheckin is being sent your way today.',
  'TLSCheckin is thinking of you and sending a calm, friendly message.',
  'Warm greetings from TLSCheckin and best wishes for the rest of your day.',
  'Hello from TLSCheckin — sending a little warmth your way today.',
  'A friendly note from TLSCheckin is here with kind thoughts.',
  'TLSCheckin sends a warm hello and hopes your day brings some ease.',
  'Just a thoughtful hello from TLSCheckin and warm regards today.',
  'Sending a quiet, friendly hello from TLSCheckin.',
  'TLSCheckin is sharing a warm greeting and gentle support today.',
  'Hello from TLSCheckin — hoping your day holds a few bright moments.',
  'A warm and friendly message from TLSCheckin is with you today.'
] as const;

const CHECKIN_SMS_MAX_LENGTH = 160;

function uniqueMessages(messages: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const message of messages) {
    if (seen.has(message)) continue;
    seen.add(message);
    unique.push(message);
  }
  return unique;
}

function normalizePresetList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueMessages(value
    .map((entry) => typeof entry === 'string' ? entry.trim() : '')
    .filter((entry) => entry.length > 0 && entry.length <= CHECKIN_SMS_MAX_LENGTH));
}

function serializeCheckins(file: CheckinsFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function maxCheckinSmsLength(): number {
  return CHECKIN_SMS_MAX_LENGTH;
}

export function defaultCheckinPresets(): string[] {
  return [...DEFAULT_CHECKIN_PRESETS];
}

export function ensureCheckinsFile(): void {
  if (fs.existsSync(config.checkinsPath)) return;
  fs.mkdirSync(path.dirname(config.checkinsPath), { recursive: true });
  fs.writeFileSync(config.checkinsPath, serializeCheckins({ presets: defaultCheckinPresets() }), 'utf8');
}

export function readCheckinPresets(): string[] {
  ensureCheckinsFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(config.checkinsPath, 'utf8')) as Partial<CheckinsFile>;
    const presets = normalizePresetList(parsed.presets);
    if (presets.length > 0) return presets;
  } catch {}
  const presets = defaultCheckinPresets();
  fs.writeFileSync(config.checkinsPath, serializeCheckins({ presets }), 'utf8');
  return presets;
}

export function saveCheckinPresets(presets: string[]): string[] {
  const normalized = normalizePresetList(presets);
  if (normalized.length === 0) {
    throw new Error('Add at least one preset message.');
  }
  fs.mkdirSync(path.dirname(config.checkinsPath), { recursive: true });
  fs.writeFileSync(config.checkinsPath, serializeCheckins({ presets: normalized }), 'utf8');
  return normalized;
}

export function normalizeCheckinMessage(raw: unknown): { ok: true; message: string } | { ok: false; message: string } {
  const message = String(raw ?? '').trim();
  if (!message) return { ok: false, message: 'Enter an SMS message.' };
  if (message.length > CHECKIN_SMS_MAX_LENGTH) {
    return { ok: false, message: `SMS messages must be ${CHECKIN_SMS_MAX_LENGTH} characters or fewer.` };
  }
  return { ok: true, message };
}
