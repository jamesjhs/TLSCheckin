import { config } from './config.js';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

type DateParts = {
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
};

function parts(date = new Date()): DateParts {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: config.appTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const values = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    day: values.day,
    month: values.month,
    year: values.year,
    hour: values.hour === '24' ? '00' : values.hour,
    minute: values.minute
  };
}

export function nowMs(): number {
  return Date.now();
}

export function localDdmmyy(date = new Date()): string {
  const p = parts(date);
  return `${p.day}${p.month}${p.year.slice(-2)}`;
}

export function localYymmdd(date = new Date()): string {
  const p = parts(date);
  return `${p.year.slice(-2)}${p.month}${p.day}`;
}

export function formatLocalFooter(date = new Date()): string {
  const p = parts(date);
  return `${p.hour}:${p.minute} ${p.day}/${p.month}/${p.year}`;
}

export function formatLocalShort(timestampMs: number): string {
  const p = parts(new Date(timestampMs));
  return `${p.hour}:${p.minute} ${p.day}/${p.month}/${p.year.slice(-2)}`;
}

export function appTimezone(): string {
  return config.appTimezone;
}
