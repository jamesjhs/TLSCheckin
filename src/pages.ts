import { getTurnstileConfig } from './turnstile.js';
import { formatLocalFooter, formatLocalShort } from './time.js';
import type { FollowedUserStatusRow, SmsSettings, UserRow } from './db.js';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function googleMapsUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude.toFixed(6)},${longitude.toFixed(6)}`)}`;
}

function renderLine(line: string): string {
  const mapsUrlPattern = /https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=([A-Za-z0-9.%,-]+)/g;
  let html = '';
  let lastIndex = 0;
  for (const match of line.matchAll(mapsUrlPattern)) {
    const url = match[0];
    const label = decodeURIComponent(match[1] ?? 'Map');
    html += escapeHtml(line.slice(lastIndex, match.index));
    html += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
    lastIndex = (match.index ?? 0) + url.length;
  }
  html += escapeHtml(line.slice(lastIndex));
  return html;
}

function basePage(title: string, body: string, extraHead = ''): string {
  const turnstile = getTurnstileConfig();
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <meta http-equiv="Cache-Control" content="no-store">
  <title>${escapeHtml(title)}</title>
  ${turnstile.enabled ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ''}
  <style>
    html, body { margin: 0; min-height: 100%; font-family: Arial, sans-serif; background: #fff; color: #111; }
    body { min-height: 100vh; }
    input, button, select, textarea { font: inherit; }
    .center { min-height: 100vh; display: flex; align-items: center; justify-content: center; text-align: center; padding: 24px; box-sizing: border-box; }
    .stack { display: flex; flex-direction: column; gap: 12px; align-items: center; }
    .home-logo { width: min(360px, 82vw); aspect-ratio: 2 / 1; object-fit: contain; display: block; margin-bottom: 6px; }
    .textbox { width: min(320px, 80vw); padding: 10px 12px; border: 1px solid #bbb; border-radius: 2px; text-align: center; }
    .button { padding: 8px 18px; border: 1px solid #888; background: #f4f4f4; color: #111; cursor: pointer; border-radius: 2px; }
    .button:disabled { opacity: .55; cursor: default; }
    .footer { position: fixed; left: 0; right: 0; bottom: 12px; text-align: center; color: #777; font-size: 13px; }
    .footer a { color: #777; text-decoration: none; }
    .landing-center { align-items: flex-start; padding-top: 28px; padding-bottom: 28px; }
    .landing-stack { width: min(680px, 94vw); align-items: stretch; text-align: left; }
    .landing-section { border: 1px solid #ddd; border-radius: 4px; background: #fff; }
    .landing-section summary { cursor: pointer; padding: 12px 14px; font-weight: 700; }
    .landing-section summary:focus-visible { outline: 2px solid #777; outline-offset: 3px; }
    .section-body { padding: 0 14px 14px; display: flex; flex-direction: column; gap: 12px; }
    .section-help { margin: 0; color: #555; font-size: 14px; line-height: 1.45; }
    .lines { text-align: left; line-height: 1.8; min-width: 0; }
    .link-tools { width: 100%; }
    .pin-settings form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 10px 0 0; }
    .link-tools .textbox { width: 120px; }
    .secret-link-row { display: flex; gap: 12px; align-items: flex-start; justify-content: space-between; }
    .secret-link-details { flex: 1 1 auto; min-width: 0; }
    .secret-link-actions { display: flex; flex: 0 0 auto; gap: 8px; align-items: center; }
    .secret-link-actions #rotate-form { margin: 0; }
    .secret-url { display: block; width: 100%; overflow-wrap: anywhere; line-height: 1.5; font-size: 13px; color: #333; min-height: 1.5em; }
    .secret-url[aria-disabled="true"] { color: #777; pointer-events: none; text-decoration: none; }
    .pin-settings { margin-top: 12px; }
    .pin-settings summary { cursor: pointer; display: inline-block; color: #555; font-size: 13px; }
    .pin-settings summary:focus-visible { outline: 2px solid #777; outline-offset: 3px; }
    .sms-tools { width: 100%; }
    .sms-tools form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .sms-tools .textbox { width: min(220px, 74vw); }
    .sms-choice { display: inline-flex; gap: 6px; align-items: center; font-size: 13px; color: #333; }
    .sms-preview { width: 100%; font-size: 13px; color: #555; line-height: 1.45; }
    .location-tools { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
    .session-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .session-actions form { margin: 0; }
    @media (max-width: 520px) { .secret-link-row { flex-direction: column; align-items: stretch; } }
    .muted { color: #777; font-size: 13px; }
    .admin { max-width: 960px; margin: 0 auto; padding: 24px; }
    .admin h1, .admin h2 { font-size: 20px; margin: 18px 0 10px; }
    .admin table { width: 100%; border-collapse: collapse; margin: 12px 0 24px; }
    .admin th, .admin td { border-bottom: 1px solid #ddd; padding: 8px; text-align: left; vertical-align: top; }
    .admin form { margin: 12px 0 24px; }
    .admin input, .admin select, .admin textarea { padding: 7px 8px; margin: 3px 4px 3px 0; }
    .admin textarea { width: min(100%, 720px); box-sizing: border-box; }
    .admin .status-panel { margin: 6px 0 10px; }
    .admin .preset-list { display: grid; gap: 10px; margin-bottom: 10px; }
    .admin .preset-item { display: grid; gap: 6px; }
    .admin .send-sms-form { display: grid; gap: 10px; max-width: 720px; }
    .admin .send-sms-form label, .admin .preset-item label { font-size: 13px; color: #444; }
    .error { color: #a40000; min-height: 1.2em; }
    .status { color: #666; min-height: 1.2em; font-size: 13px; }
  </style>
  ${extraHead}
</head>
<body>
${body}
</body>
</html>`;
}

export function publicHomePage(): string {
  const turnstile = getTurnstileConfig();
  const footer = formatLocalFooter();
  return basePage('TLSCheckin', `
<main class="center">
  <form id="checkin-form" class="stack" autocomplete="off" autocapitalize="off" spellcheck="false">
    <img class="home-logo" src="/assets/tls-logo.png" alt="TLS">
    <input id="user" class="textbox" name="user" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="User" aria-label="User">
    <input id="secret" class="textbox" name="secret" type="password" autocomplete="new-password" inputmode="numeric" placeholder="Secret" aria-label="Secret">
    ${turnstile.enabled ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(turnstile.siteKey ?? '')}" data-action="checkin" data-theme="light" data-callback="onCheckinTurnstileSuccess" data-expired-callback="onCheckinTurnstileExpired" data-error-callback="onCheckinTurnstileError"></div>` : ''}
    <button id="submit" class="button" type="submit">Submit</button>
    <div id="turnstile-status" class="status">${turnstile.enabled ? 'Waiting for Turnstile.' : ''}</div>
  </form>
</main>
<div class="footer"><a href="https://jahosi.co.uk/">jahosi.co.uk</a>&nbsp;&nbsp;&nbsp; Local server time ${escapeHtml(footer)}</div>
<script>
const turnstileConfig = ${JSON.stringify(turnstile)};
const redirectUrl = 'https://www.google.co.uk/';
const form = document.getElementById('checkin-form');
const statusBox = document.getElementById('turnstile-status');
function leave() {
  document.documentElement.innerHTML = '';
  try { history.replaceState(null, '', location.href); history.pushState(null, '', location.href); } catch {}
  location.replace(redirectUrl);
}
setTimeout(leave, 60000);
window.addEventListener('popstate', leave);
function currentTurnstileToken() {
  const field = form.querySelector('[name="cf-turnstile-response"]');
  return field && field.value ? field.value : '';
}
window.onCheckinTurnstileSuccess = function() {
  statusBox.className = 'status';
  statusBox.textContent = '';
};
window.onCheckinTurnstileExpired = function() {
  statusBox.className = 'error';
  statusBox.textContent = 'Turnstile expired. Complete it again.';
};
window.onCheckinTurnstileError = function() {
  statusBox.className = 'error';
  statusBox.textContent = 'Turnstile could not load. Refresh and try again.';
};
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const turnstileToken = currentTurnstileToken();
  if (turnstileConfig.enabled && !turnstileToken) {
    statusBox.className = 'error';
    statusBox.textContent = 'Complete Turnstile to continue.';
    return;
  }
  const user = document.getElementById('user').value.trim();
  const secret = document.getElementById('secret').value.trim();
  const code = secret + '-' + user;
  const response = await fetch('/api/checkin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, 'cf-turnstile-response': turnstileToken })
  }).catch(() => null);
  if (!response || !response.ok) { leave(); return; }
  const result = await response.json();
  if (result.redirect) { leave(); return; }
  document.open(); document.write(result.html); document.close();
});
</script>`);
}

export function resultPage(lines: string[]): string {
  return basePage('TLSCheckin', `
<main class="center">
  <div class="stack">
    <div class="lines">${lines.map((line) => `<div>${renderLine(line)}</div>`).join('')}</div>
    <button class="button" type="button" onclick="leave()">Exit</button>
  </div>
</main>
<script>
const redirectUrl = 'https://www.google.co.uk/';
function leave() {
  document.documentElement.innerHTML = '';
  try { history.replaceState(null, '', location.href); history.pushState(null, '', location.href); } catch {}
  location.replace(redirectUrl);
}
setTimeout(leave, 60000);
window.addEventListener('popstate', leave);
</script>`);
}

export function userLandingPage(data: {
  lines: string[];
  hasSecretLink: boolean;
  secretUrl?: string;
  linkStatus?: string;
  linkStatusIsError?: boolean;
  phoneNumber?: string;
  ackSmsEnabled?: boolean;
  smsPreviewText: string;
  smsStatus?: string;
  smsStatusIsError?: boolean;
}): string {
  return basePage('TLSCheckin', `
<main class="center landing-center">
  <div class="stack landing-stack">
    <details class="landing-section" open>
      <summary>Status and Seen</summary>
      <div class="section-body">
        <p class="section-help">Your check-in has been recorded. This section shows the latest status for the people you follow, including whether they have seen your current check-in.</p>
        <div class="lines">${data.lines.map((line) => `<div>${renderLine(line)}</div>`).join('')}</div>
      </div>
    </details>

    <details class="landing-section" open>
      <summary>Secret Link</summary>
      <div class="section-body">
        <p class="section-help">Create or update a four-digit PIN to use a quick login link. Copy the link for reuse, or rotate it to replace the old link with a new one.</p>
        <section class="link-tools" aria-label="Secret link settings">
          <div class="secret-link-row">
            <div class="secret-link-details">
              <div id="link-status" class="${data.linkStatusIsError ? 'error' : 'status'}">${escapeHtml(data.linkStatus ?? (data.hasSecretLink ? 'Secret link configured.' : 'Set a PIN to create a secret link.'))}</div>
              <a id="secret-url" class="secret-url" href="${data.secretUrl ? escapeHtml(data.secretUrl) : '#'}" ${data.secretUrl ? '' : 'aria-disabled="true"'} aria-label="Copy secret link">${data.secretUrl ? escapeHtml(data.secretUrl) : ''}</a>
            </div>
            <div class="secret-link-actions">
              <button id="copy-link" class="button" type="button" ${data.hasSecretLink ? '' : 'disabled'}>Copy Link</button>
              <form id="rotate-form" method="post" action="/api/secret-link/rotate">
                <button class="button" type="submit" ${data.hasSecretLink ? '' : 'disabled'}>Rotate Link</button>
              </form>
            </div>
          </div>
          <details class="pin-settings" open>
            <summary>PIN settings</summary>
            <form id="pin-form" method="post" action="/api/secret-link" autocomplete="off">
              <input id="pin" class="textbox" name="pin" type="password" autocomplete="new-password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="4-digit PIN" aria-label="4-digit PIN" required>
              <button class="button" type="submit">${data.hasSecretLink ? 'Update PIN' : 'Create Link'}</button>
            </form>
          </details>
        </section>
      </div>
    </details>

    <details class="landing-section" open>
      <summary>SMS Receipts</summary>
      <div class="section-body">
        <p class="section-help">Add your mobile number in international format and tick the box if you want a text when someone acknowledges your current check-in.</p>
        <section class="sms-tools" aria-label="Acknowledgement text settings">
          <form id="sms-form" method="post" action="/api/sms-preferences" autocomplete="off">
            <input id="sms-phone" class="textbox" name="phoneNumber" type="tel" autocomplete="tel" inputmode="tel" placeholder="+447710123456" aria-label="International phone number" value="${escapeHtml(data.phoneNumber ?? '')}">
            <label class="sms-choice">
              <input id="ack-sms-enabled" name="ackSmsEnabled" type="checkbox" ${data.ackSmsEnabled ? 'checked' : ''}>
              Receive acknowledgement texts
            </label>
            <button class="button" type="submit">Save</button>
            <div class="sms-preview">Preview: ${escapeHtml(data.smsPreviewText)}</div>
          </form>
          <div id="sms-status" class="${data.smsStatusIsError ? 'error' : 'status'}" aria-live="polite">${escapeHtml(data.smsStatus ?? '')}</div>
        </section>
      </div>
    </details>

    <details class="landing-section" open>
      <summary>Location Sharing</summary>
      <div class="section-body">
        <p class="section-help">Share your current browser location when you want the people who follow you to see a map link with your latest check-in status.</p>
        <section class="location-tools" aria-label="Location sharing">
          <button id="share-location" class="button" type="button">Share Location</button>
          <div id="location-status" class="status" aria-live="polite"></div>
        </section>
      </div>
    </details>

    <details class="landing-section" open>
      <summary>Logout/Exit</summary>
      <div class="section-body">
        <p class="section-help">Log out to end this TLSCheckin session, or use Exit to blank the page and leave quickly.</p>
        <div class="session-actions">
          <form method="post" action="/logout">
            <button class="button" type="submit">Log Out</button>
          </form>
          <button class="button" type="button" onclick="leave()">Exit</button>
        </div>
      </div>
    </details>
  </div>
</main>
<script>
const redirectUrl = 'https://www.google.co.uk/';
const statusBox = document.getElementById('link-status');
const secretUrlBox = document.getElementById('secret-url');
const copyButton = document.getElementById('copy-link');
const rotateButton = document.querySelector('#rotate-form button');
const shareLocationButton = document.getElementById('share-location');
const locationStatusBox = document.getElementById('location-status');
const smsStatusBox = document.getElementById('sms-status');
function leave() {
  document.documentElement.innerHTML = '';
  try { history.replaceState(null, '', location.href); history.pushState(null, '', location.href); } catch {}
  location.replace(redirectUrl);
}
setTimeout(leave, 60000);
window.addEventListener('popstate', leave);
function showResult(result) {
  statusBox.className = result.ok ? 'status' : 'error';
  statusBox.textContent = result.message || (result.ok ? 'Saved.' : 'Unable to save.');
  if (result.secretUrl) {
    secretUrlBox.textContent = result.secretUrl;
    secretUrlBox.href = result.secretUrl;
    secretUrlBox.removeAttribute('aria-disabled');
    if (copyButton) copyButton.disabled = false;
  }
  if (result.ok && rotateButton) rotateButton.disabled = false;
}
async function copySecretUrl(event) {
  event.preventDefault();
  const secretUrl = secretUrlBox.href;
  if (!secretUrl) return;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(secretUrl);
    } else {
      const helper = document.createElement('textarea');
      helper.value = secretUrl;
      helper.setAttribute('readonly', '');
      helper.style.position = 'fixed';
      helper.style.left = '-9999px';
      document.body.appendChild(helper);
      helper.select();
      document.execCommand('copy');
      helper.remove();
    }
    showResult({ ok: true, message: 'Secret link copied.' });
  } catch {
    showResult({ ok: false, message: 'Unable to copy. Select the link and copy it manually.' });
  }
}
secretUrlBox.addEventListener('click', copySecretUrl);
copyButton.addEventListener('click', copySecretUrl);
document.getElementById('pin-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const pin = document.getElementById('pin').value.trim();
  if (!/^\\d{4}$/.test(pin)) {
    showResult({ ok: false, message: 'Enter a 4-digit PIN.' });
    return;
  }
  const response = await fetch('/api/secret-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin })
  }).catch(() => null);
  showResult(response && response.ok ? await response.json() : { ok: false, message: 'Unable to save.' });
});
document.getElementById('rotate-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await fetch('/api/secret-link/rotate', { method: 'POST' }).catch(() => null);
  showResult(response && response.ok ? await response.json() : { ok: false, message: 'Unable to rotate.' });
});
document.getElementById('sms-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const phoneNumber = document.getElementById('sms-phone').value.trim();
  const ackSmsEnabled = document.getElementById('ack-sms-enabled').checked;
  const response = await fetch('/api/sms-preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber, ackSmsEnabled })
  }).catch(() => null);
  const result = response && response.ok ? await response.json() : response ? await response.json().catch(() => ({ ok: false, message: 'Unable to save SMS settings.' })) : { ok: false, message: 'Unable to save SMS settings.' };
  smsStatusBox.className = result.ok ? 'status' : 'error';
  smsStatusBox.textContent = result.message || (result.ok ? 'SMS settings saved.' : 'Unable to save SMS settings.');
  if (result.ok && result.phoneNumber !== undefined) document.getElementById('sms-phone').value = result.phoneNumber;
});
shareLocationButton.addEventListener('click', () => {
  locationStatusBox.className = 'status';
  locationStatusBox.textContent = 'Requesting location permission...';

  if (!navigator.geolocation) {
    locationStatusBox.className = 'error';
    locationStatusBox.textContent = 'Location is not available in this browser.';
    return;
  }

  shareLocationButton.disabled = true;
  shareLocationButton.textContent = 'Getting Location';

  requestAnimationFrame(() => {
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const latitude = Number(position.coords.latitude.toFixed(6));
        const longitude = Number(position.coords.longitude.toFixed(6));
        const mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(latitude + ',' + longitude);

        const response = await fetch('/api/location', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ latitude, longitude })
        }).catch(() => null);
        if (!response || !response.ok) {
          locationStatusBox.className = 'error';
          locationStatusBox.textContent = 'Location could not be shared.';
        } else {
          locationStatusBox.className = 'status';
          locationStatusBox.textContent = 'Shared location: ';
          const mapLink = document.createElement('a');
          mapLink.href = mapsUrl;
          mapLink.target = '_blank';
          mapLink.rel = 'noopener';
          mapLink.textContent = latitude + ', ' + longitude;
          locationStatusBox.appendChild(mapLink);
        }
        shareLocationButton.disabled = false;
        shareLocationButton.textContent = 'Share Location';
      },
      (error) => {
        locationStatusBox.className = 'error';
        locationStatusBox.textContent = error.code === error.PERMISSION_DENIED ? 'Location permission was denied.' : 'Unable to get location.';
        shareLocationButton.disabled = false;
        shareLocationButton.textContent = 'Share Location';
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
});
</script>`);
}

export function secretPinPage(secretPath: string, error = ''): string {
  const turnstile = getTurnstileConfig();
  return basePage('TLSCheckin', `
<main class="center">
  <form class="stack" action="${escapeHtml(secretPath)}" method="post" autocomplete="off" autocapitalize="off" spellcheck="false">
    <img class="home-logo" src="/assets/tls-logo.png" alt="TLS">
    <input class="textbox" name="pin" type="password" autocomplete="new-password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="PIN" aria-label="PIN" required>
    ${turnstile.enabled ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(turnstile.siteKey ?? '')}" data-action="secret_pin" data-theme="light" data-callback="onSecretTurnstileSuccess" data-expired-callback="onSecretTurnstileExpired" data-error-callback="onSecretTurnstileError"></div>` : ''}
    <button id="submit" class="button" type="submit">Submit</button>
    <div id="turnstile-status" class="${error ? 'error' : 'status'}">${escapeHtml(error || (turnstile.enabled ? 'Waiting for Turnstile.' : ''))}</div>
  </form>
</main>
<script>
const turnstileConfig = ${JSON.stringify(turnstile)};
const redirectUrl = 'https://www.google.co.uk/';
const form = document.querySelector('form');
const statusBox = document.getElementById('turnstile-status');
function leave() {
  document.documentElement.innerHTML = '';
  try { history.replaceState(null, '', location.href); history.pushState(null, '', location.href); } catch {}
  location.replace(redirectUrl);
}
setTimeout(leave, 60000);
window.addEventListener('popstate', leave);
function currentTurnstileToken() {
  const field = form.querySelector('[name="cf-turnstile-response"]');
  return field && field.value ? field.value : '';
}
window.onSecretTurnstileSuccess = function() {
  statusBox.className = 'status';
  statusBox.textContent = '';
};
window.onSecretTurnstileExpired = function() {
  statusBox.className = 'error';
  statusBox.textContent = 'Turnstile expired. Complete it again.';
};
window.onSecretTurnstileError = function() {
  statusBox.className = 'error';
  statusBox.textContent = 'Turnstile could not load. Refresh and try again.';
};
form.addEventListener('submit', event => {
  if (turnstileConfig.enabled && !currentTurnstileToken()) {
    event.preventDefault();
    statusBox.className = 'error';
    statusBox.textContent = 'Complete Turnstile to continue.';
  }
});
</script>`);
}

export function formatFollowedLine(user: UserRow): string {
  const initials = user.identity.slice(-2).toUpperCase();
  return user.last_seen_at
    ? `${initials} Last seen: ${formatLocalShort(user.last_seen_at)}`
    : `${initials} Last seen: Never logged in`;
}

export function formatFollowedStatusLine(user: FollowedUserStatusRow, viewerLastSeenAt: number | null): string {
  const base = formatFollowedLine(user);
  const location = user.location_latitude !== null && user.location_longitude !== null
    ? ` - Location: ${googleMapsUrl(user.location_latitude, user.location_longitude)}`
    : '';
  if (!viewerLastSeenAt) return `${base} - Seen you: Not yet${location}`;
  const hasSeenViewer = user.subject_seen_at !== null && user.subject_seen_at >= viewerLastSeenAt;
  return `${base} - Seen you: ${hasSeenViewer ? 'Yes' : 'Not yet'}${location}`;
}

export function adminLoginPage(adminPath: string, error = ''): string {
  const turnstile = getTurnstileConfig();
  return basePage('TLSCheckin Admin', `
<main class="center">
  <form class="stack" action="${escapeHtml(adminPath)}/login" method="post" autocomplete="off" autocapitalize="off" spellcheck="false">
    <input class="textbox" name="username" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" aria-label="Username">
    <input class="textbox" name="password" type="password" autocomplete="new-password" aria-label="Password">
    ${turnstile.enabled ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(turnstile.siteKey ?? '')}" data-action="admin_login" data-theme="light" data-callback="onAdminTurnstileSuccess" data-expired-callback="onAdminTurnstileExpired" data-error-callback="onAdminTurnstileError"></div>` : ''}
    <button id="submit" class="button" type="submit">Submit</button>
    <div id="turnstile-status" class="${error ? 'error' : 'status'}">${escapeHtml(error || (turnstile.enabled ? 'Waiting for Turnstile.' : ''))}</div>
  </form>
</main>
<script>
const turnstileConfig = ${JSON.stringify(turnstile)};
const redirectUrl = 'https://www.google.co.uk/';
const form = document.querySelector('form');
const statusBox = document.getElementById('turnstile-status');
function leave() {
  document.documentElement.innerHTML = '';
  try { history.replaceState(null, '', location.href); history.pushState(null, '', location.href); } catch {}
  location.replace(redirectUrl);
}
setTimeout(leave, 60000);
window.addEventListener('popstate', leave);
function currentTurnstileToken() {
  const field = form.querySelector('[name="cf-turnstile-response"]');
  return field && field.value ? field.value : '';
}
window.onAdminTurnstileSuccess = function() {
  statusBox.className = 'status';
  statusBox.textContent = '';
};
window.onAdminTurnstileExpired = function() {
  statusBox.className = 'error';
  statusBox.textContent = 'Turnstile expired. Complete it again.';
};
window.onAdminTurnstileError = function() {
  statusBox.className = 'error';
  statusBox.textContent = 'Turnstile could not load. Refresh and try again.';
};
form.addEventListener('submit', event => {
  if (turnstileConfig.enabled && !currentTurnstileToken()) {
    event.preventDefault();
    statusBox.className = 'error';
    statusBox.textContent = 'Complete Turnstile to continue.';
  }
});
</script>`);
}

export function passwordChangePage(adminPath: string, error = ''): string {
  return basePage('Change Password', `
<main class="center">
  <form class="stack" action="${escapeHtml(adminPath)}/change-password" method="post" autocomplete="off">
    <input class="textbox" name="newPassword" type="password" autocomplete="new-password" placeholder="New password" aria-label="New password">
    <button class="button" type="submit">Submit</button>
    <div class="error">${escapeHtml(error)}</div>
  </form>
</main>`);
}

export function adminPage(data: {
  adminPath: string;
  users: UserRow[];
  followedByUser: Map<number, number[]>;
  audit: Array<{ id: number; event_type: string; details: string; ip: string | null; created_at: number }>;
  smsSettings: SmsSettings;
  checkinPresets: string[];
  checkinPresetStatus?: string;
  checkinPresetStatusIsError?: boolean;
  smsSendStatus?: string;
  smsSendStatusIsError?: boolean;
  selectedCheckinUserId?: number;
  selectedPresetMessage?: string;
  draftCheckinMessage?: string;
}): string {
  const usersWithPhones = data.users.filter((user) => Boolean(user.phone_number));
  const userRows = data.users.map((user) => {
    const selected = new Set(data.followedByUser.get(user.id) ?? []);
    const options = data.users
      .filter((candidate) => candidate.id !== user.id)
      .map((candidate) => `<option value="${candidate.id}"${selected.has(candidate.id) ? ' selected' : ''}>${escapeHtml(candidate.identity)}</option>`)
      .join('');
    return `<tr>
      <td>${escapeHtml(user.identity)}</td>
      <td>${user.last_seen_at ? escapeHtml(formatLocalShort(user.last_seen_at)) : 'Never logged in'}</td>
      <td>
        <form action="${escapeHtml(data.adminPath)}/users/${user.id}/follows" method="post">
          <select name="followedIds" multiple size="4">${options}</select>
          <button class="button" type="submit">Save</button>
        </form>
      </td>
      <td>
        <form action="${escapeHtml(data.adminPath)}/users/${user.id}/delete" method="post">
          <button class="button" type="submit">Delete</button>
        </form>
      </td>
    </tr>`;
  }).join('');

  const auditRows = data.audit.map((event) => `<tr>
    <td>${escapeHtml(formatLocalShort(event.created_at))}</td>
    <td>${escapeHtml(event.event_type)}</td>
    <td>${escapeHtml(event.details)}</td>
    <td>${escapeHtml(event.ip ?? '')}</td>
  </tr>`).join('');
  const presetRows = [...data.checkinPresets, '', '', ''].map((preset, index) => `<div class="preset-item">
    <label for="preset-${index + 1}">Preset ${index + 1}</label>
    <textarea id="preset-${index + 1}" name="presetMessages" rows="3" maxlength="160">${escapeHtml(preset)}</textarea>
  </div>`).join('');
  const recipientOptions = usersWithPhones
    .map((user, index) => `<option value="${user.id}" data-phone="${escapeHtml(user.phone_number ?? '')}"${user.id === data.selectedCheckinUserId || (data.selectedCheckinUserId === undefined && index === 0) ? ' selected' : ''}>${escapeHtml(user.identity)} (${escapeHtml(user.phone_number ?? '')})</option>`)
    .join('');
  const hasPresets = data.checkinPresets.length > 0;
  const presetOptions = data.checkinPresets
    .map((preset, index) => `<option value="${escapeHtml(preset)}"${preset === data.selectedPresetMessage || (data.selectedPresetMessage === undefined && index === 0) ? ' selected' : ''}>Preset ${index + 1}: ${escapeHtml(preset.slice(0, 72))}${preset.length > 72 ? '…' : ''}</option>`)
    .join('');
  const defaultSelectedMessage = data.draftCheckinMessage ?? data.selectedPresetMessage ?? data.checkinPresets[0] ?? '';

  return basePage('TLSCheckin Admin', `
<main class="admin">
  <h1>TLSCheckin Admin</h1>
  <form action="${escapeHtml(data.adminPath)}/logout" method="post"><button class="button" type="submit">Log out</button></form>

  <h2>IntelliSoftware SMS</h2>
  <form action="${escapeHtml(data.adminPath)}/sms-settings" method="post" autocomplete="off">
    <input name="accessKey" type="text" autocomplete="off" placeholder="Access key" value="${escapeHtml(data.smsSettings.accessKey)}">
    <input name="secretKey" type="password" autocomplete="new-password" placeholder="${data.smsSettings.secretKey ? 'Secret key stored' : 'Secret key'}">
    <input name="senderId" type="text" autocomplete="off" placeholder="Sender ID" value="${escapeHtml(data.smsSettings.senderId)}">
    <button class="button" type="submit">Save SMS Settings</button>
    <div class="muted">Secret key is stored in the encrypted database. Leave it blank to keep the existing value.</div>
  </form>

  <h2>Check-in SMS Presets</h2>
  <div class="${data.checkinPresetStatusIsError ? 'error' : 'status'} status-panel">${escapeHtml(data.checkinPresetStatus ?? '')}</div>
  <form action="${escapeHtml(data.adminPath)}/checkin-presets" method="post" autocomplete="off">
    <div class="preset-list">${presetRows}</div>
    <button class="button" type="submit">Save Presets</button>
    <div class="muted">Preset messages are stored in ${escapeHtml('checkins.json')} on the server. Blank rows are ignored and messages are limited to 160 characters.</div>
  </form>

  <h2>Send Check-in SMS</h2>
  <div class="${data.smsSendStatusIsError ? 'error' : 'status'} status-panel">${escapeHtml(data.smsSendStatus ?? '')}</div>
  ${usersWithPhones.length ? `
  <form action="${escapeHtml(data.adminPath)}/send-checkin-sms" method="post" autocomplete="off" class="send-sms-form">
    <label for="checkin-user">User with saved phone number</label>
    <select id="checkin-user" name="userId">${recipientOptions}</select>
    ${hasPresets ? `
    <label for="preset-selector">Preset</label>
    <select id="preset-selector" name="presetMessage">${presetOptions}</select>
    ` : '<div class="muted">No preset is currently saved. Enter a message below.</div>'}
    <label for="checkin-message">Message</label>
    <textarea id="checkin-message" name="message" rows="4" maxlength="160">${escapeHtml(defaultSelectedMessage)}</textarea>
    <button class="button" type="submit">Send SMS</button>
    <div class="muted">${hasPresets ? 'The selected preset fills the message box and can be edited before sending.' : 'Messages are limited to 160 characters.'}</div>
  </form>
  ` : '<div class="muted">No users currently have a phone number saved for SMS sending.</div>'}

  <h2>Create User</h2>
  <form action="${escapeHtml(data.adminPath)}/users" method="post" autocomplete="off" autocapitalize="off" spellcheck="false">
    <input name="identity" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="0612jr" pattern="[0-9]{4}[A-Za-z]{2}" required>
    <button class="button" type="submit">Create</button>
  </form>

  <h2>Users</h2>
  <table>
    <thead><tr><th>Identity</th><th>Last seen</th><th>Follows</th><th>Delete</th></tr></thead>
    <tbody>${userRows || '<tr><td colspan="4">No users created.</td></tr>'}</tbody>
  </table>

  <h2>Change Admin Password</h2>
  <form action="${escapeHtml(data.adminPath)}/change-password" method="post" autocomplete="off">
    <input name="newPassword" type="password" autocomplete="new-password" placeholder="New password" required>
    <button class="button" type="submit">Change</button>
  </form>

  <h2>Audit Trail</h2>
  <table>
    <thead><tr><th>Time</th><th>Event</th><th>Details</th><th>IP</th></tr></thead>
    <tbody>${auditRows || '<tr><td colspan="4">No audit events.</td></tr>'}</tbody>
  </table>
</main>
<script>
/** @type {HTMLSelectElement | null} */
const presetSelector = document.getElementById('preset-selector');
/** @type {HTMLTextAreaElement | null} */
const checkinMessage = document.getElementById('checkin-message');
if (presetSelector && checkinMessage) {
  presetSelector.addEventListener('change', () => {
    checkinMessage.value = presetSelector.value;
  });
}
</script>`);
}
