function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function nowMs(): number {
  return Date.now();
}

export function localDdmmyy(date = new Date()): string {
  return `${pad(date.getDate())}${pad(date.getMonth() + 1)}${String(date.getFullYear()).slice(-2)}`;
}

export function localYymmdd(date = new Date()): string {
  return `${String(date.getFullYear()).slice(-2)}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

export function formatLocalFooter(date = new Date()): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())} ${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

export function formatLocalShort(timestampMs: number): string {
  const date = new Date(timestampMs);
  return `${pad(date.getHours())}:${pad(date.getMinutes())} ${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${String(date.getFullYear()).slice(-2)}`;
}
