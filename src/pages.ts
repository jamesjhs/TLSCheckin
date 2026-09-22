import { getTurnstileConfig } from './turnstile.js';
import { formatLocalFooter, formatLocalShort } from './time.js';
import type { FollowedUserStatusRow, UserRow } from './db.js';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
    input, button, select { font: inherit; }
    .center { min-height: 100vh; display: flex; align-items: center; justify-content: center; text-align: center; padding: 24px; box-sizing: border-box; }
    .stack { display: flex; flex-direction: column; gap: 12px; align-items: center; }
    .home-logo { width: min(360px, 82vw); aspect-ratio: 2 / 1; object-fit: contain; display: block; margin-bottom: 6px; }
    .textbox { width: min(320px, 80vw); padding: 10px 12px; border: 1px solid #bbb; border-radius: 2px; text-align: center; }
    .button { padding: 8px 18px; border: 1px solid #888; background: #f4f4f4; color: #111; cursor: pointer; border-radius: 2px; }
    .button:disabled { opacity: .55; cursor: default; }
    .footer { position: fixed; left: 0; right: 0; bottom: 12px; text-align: center; color: #777; font-size: 13px; }
    .footer a { color: #777; text-decoration: none; }
    .lines { text-align: center; line-height: 1.8; min-width: min(420px, 80vw); }
    .link-tools { width: min(520px, 88vw); margin-top: 8px; padding-top: 12px; border-top: 1px solid #ddd; }
    .pin-settings form { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; align-items: center; margin: 10px 0 0; }
    .link-tools .textbox { width: 120px; }
    .secret-link-row { display: flex; gap: 12px; align-items: flex-start; justify-content: center; }
    .secret-link-details { flex: 1 1 auto; min-width: 0; }
    .secret-link-actions { display: flex; flex: 0 0 auto; gap: 8px; align-items: center; }
    .secret-link-actions #rotate-form { margin: 0; }
    .secret-url { display: block; width: 100%; overflow-wrap: anywhere; line-height: 1.5; font-size: 13px; color: #333; min-height: 1.5em; }
    .secret-url[aria-disabled="true"] { color: #777; pointer-events: none; text-decoration: none; }
    .pin-settings { margin-top: 12px; }
    .pin-settings summary { cursor: pointer; display: inline-block; color: #555; font-size: 13px; }
    .pin-settings summary:focus-visible { outline: 2px solid #777; outline-offset: 3px; }
    .location-tools { display: flex; flex-direction: column; gap: 6px; align-items: center; }
    .session-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; align-items: center; }
    .session-actions form { margin: 0; }
    @media (max-width: 520px) { .secret-link-row { flex-direction: column; align-items: center; } }
    .muted { color: #777; font-size: 13px; }
    .admin { max-width: 960px; margin: 0 auto; padding: 24px; }
    .admin h1, .admin h2 { font-size: 20px; margin: 18px 0 10px; }
    .admin table { width: 100%; border-collapse: collapse; margin: 12px 0 24px; }
    .admin th, .admin td { border-bottom: 1px solid #ddd; padding: 8px; text-align: left; vertical-align: top; }
    .admin form { margin: 12px 0 24px; }
    .admin input, .admin select { padding: 7px 8px; margin: 3px 4px 3px 0; }
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
  <form id="checkin-form" class="stack" autocomplete="off">
    <img class="home-logo" src="/assets/tls-logo.png" alt="TLS">
    <input id="user" class="textbox" name="user" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="User" aria-label="User">
    <input id="secret" class="textbox" name="secret" type="password" autocomplete="off" inputmode="numeric" placeholder="Secret" aria-label="Secret">
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
    <div class="lines">${lines.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}</div>
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
}): string {
  return basePage('TLSCheckin', `
<main class="center">
  <div class="stack">
    <div class="lines">${data.lines.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}</div>
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
      <details class="pin-settings">
        <summary>PIN settings</summary>
        <form id="pin-form" method="post" action="/api/secret-link" autocomplete="off">
          <input id="pin" class="textbox" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="4-digit PIN" aria-label="4-digit PIN" required>
          <button class="button" type="submit">${data.hasSecretLink ? 'Update PIN' : 'Create Link'}</button>
        </form>
      </details>
    </section>
    <section class="location-tools" aria-label="Location sharing">
      <button id="share-location" class="button" type="button">Share Location</button>
      <div id="location-status" class="status" aria-live="polite"></div>
    </section>
    <div class="session-actions">
      <form method="post" action="/logout">
        <button class="button" type="submit">Log Out</button>
      </form>
      <button class="button" type="button" onclick="leave()">Exit</button>
    </div>
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
shareLocationButton.addEventListener('click', () => {
  locationStatusBox.className = 'status';
  locationStatusBox.textContent = 'Requesting location permission...';

  if (!navigator.geolocation) {
    locationStatusBox.className = 'error';
    locationStatusBox.textContent = 'Location is not available in this browser.';
    return;
  }

  const mapsWindow = window.open('about:blank', '_blank');
  if (mapsWindow) mapsWindow.opener = null;
  shareLocationButton.disabled = true;
  shareLocationButton.textContent = 'Getting Location';

  window.setTimeout(() => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude.toFixed(6);
        const lng = position.coords.longitude.toFixed(6);
        const mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(lat + ',' + lng);
        if (mapsWindow) {
          mapsWindow.location.href = mapsUrl;
        } else {
          window.open(mapsUrl, '_blank', 'noopener');
        }
        locationStatusBox.className = 'status';
        locationStatusBox.textContent = lat + ', ' + lng;
        shareLocationButton.disabled = false;
        shareLocationButton.textContent = 'Share Location';
      },
      (error) => {
        if (mapsWindow) mapsWindow.close();
        locationStatusBox.className = 'error';
        locationStatusBox.textContent = error.code === error.PERMISSION_DENIED ? 'Location permission was denied.' : 'Unable to get location.';
        shareLocationButton.disabled = false;
        shareLocationButton.textContent = 'Share Location';
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, 0);
});
</script>`);
}

export function secretPinPage(secretPath: string, error = ''): string {
  const turnstile = getTurnstileConfig();
  return basePage('TLSCheckin', `
<main class="center">
  <form class="stack" action="${escapeHtml(secretPath)}" method="post" autocomplete="off">
    <img class="home-logo" src="/assets/tls-logo.png" alt="TLS">
    <input class="textbox" name="pin" type="password" autocomplete="off" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="PIN" aria-label="PIN" required>
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
  if (!viewerLastSeenAt) return `${base} - Seen you: Not yet`;
  const hasSeenViewer = user.subject_seen_at !== null && user.subject_seen_at >= viewerLastSeenAt;
  return `${base} - Seen you: ${hasSeenViewer ? 'Yes' : 'Not yet'}`;
}

export function adminLoginPage(adminPath: string, error = ''): string {
  const turnstile = getTurnstileConfig();
  return basePage('TLSCheckin Admin', `
<main class="center">
  <form class="stack" action="${escapeHtml(adminPath)}/login" method="post" autocomplete="off">
    <input class="textbox" name="username" type="text" autocomplete="off" aria-label="Username">
    <input class="textbox" name="password" type="password" autocomplete="off" aria-label="Password">
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
    <input class="textbox" name="newPassword" type="password" autocomplete="off" placeholder="New password" aria-label="New password">
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
}): string {
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

  return basePage('TLSCheckin Admin', `
<main class="admin">
  <h1>TLSCheckin Admin</h1>
  <form action="${escapeHtml(data.adminPath)}/logout" method="post"><button class="button" type="submit">Log out</button></form>

  <h2>Create User</h2>
  <form action="${escapeHtml(data.adminPath)}/users" method="post" autocomplete="off">
    <input name="identity" type="text" autocomplete="off" placeholder="0612jr" pattern="[0-9]{4}[A-Za-z]{2}" required>
    <button class="button" type="submit">Create</button>
  </form>

  <h2>Users</h2>
  <table>
    <thead><tr><th>Identity</th><th>Last seen</th><th>Follows</th><th>Delete</th></tr></thead>
    <tbody>${userRows || '<tr><td colspan="4">No users created.</td></tr>'}</tbody>
  </table>

  <h2>Change Admin Password</h2>
  <form action="${escapeHtml(data.adminPath)}/change-password" method="post" autocomplete="off">
    <input name="newPassword" type="password" autocomplete="off" placeholder="New password" required>
    <button class="button" type="submit">Change</button>
  </form>

  <h2>Audit Trail</h2>
  <table>
    <thead><tr><th>Time</th><th>Event</th><th>Details</th><th>IP</th></tr></thead>
    <tbody>${auditRows || '<tr><td colspan="4">No audit events.</td></tr>'}</tbody>
  </table>
</main>`);
}
