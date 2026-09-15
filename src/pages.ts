import { getTurnstileConfig } from './turnstile.js';
import { formatLocalFooter, formatLocalShort } from './time.js';
import type { UserRow } from './db.js';

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
    .textbox { width: min(320px, 80vw); padding: 10px 12px; border: 1px solid #bbb; border-radius: 2px; text-align: center; }
    .button { padding: 8px 18px; border: 1px solid #888; background: #f4f4f4; color: #111; cursor: pointer; border-radius: 2px; }
    .button:disabled { opacity: .55; cursor: default; }
    .footer { position: fixed; left: 0; right: 0; bottom: 12px; text-align: center; color: #777; font-size: 13px; }
    .footer a { color: #777; text-decoration: none; }
    .lines { text-align: left; line-height: 1.8; min-width: min(420px, 80vw); }
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
    <input id="code" class="textbox" name="code" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" aria-label="Check-in code">
    <div id="turnstile"></div>
    <button id="submit" class="button" type="submit">Submit</button>
  </form>
</main>
<div class="footer"><a href="https://jahosi.co.uk/">jahosi.co.uk</a>&nbsp;&nbsp;&nbsp; Local server time ${escapeHtml(footer)}</div>
<script>
const turnstileConfig = ${JSON.stringify(turnstile)};
let widgetId = null;
function leave() {
  document.documentElement.innerHTML = '';
  try { history.replaceState(null, '', location.href); history.pushState(null, '', location.href); } catch {}
  location.replace('https://www.google.com/');
}
window.addEventListener('popstate', leave);
function token() {
  if (!turnstileConfig.enabled) return '';
  return window.turnstile && widgetId !== null ? (window.turnstile.getResponse(widgetId) || '') : '';
}
function initTurnstile() {
  if (!turnstileConfig.enabled) return;
  if (!window.turnstile || typeof window.turnstile.render !== 'function') { setTimeout(initTurnstile, 100); return; }
  widgetId = window.turnstile.render('#turnstile', {
    sitekey: turnstileConfig.siteKey,
    action: 'checkin',
    theme: 'light',
    callback: () => { document.getElementById('submit').disabled = false; },
    'expired-callback': () => { document.getElementById('submit').disabled = true; }
  });
}
document.getElementById('checkin-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = document.getElementById('code').value;
  const response = await fetch('/api/checkin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, 'cf-turnstile-response': token() })
  }).catch(() => null);
  if (!response || !response.ok) { leave(); return; }
  const result = await response.json();
  if (result.redirect) { leave(); return; }
  document.open(); document.write(result.html); document.close();
});
initTurnstile();
</script>`);
}

export function resultPage(lines: string[]): string {
  return basePage('TLSCheckin', `
<main class="center">
  <div class="stack">
    <div class="lines">${lines.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}</div>
    <button class="button" type="button" onclick="document.documentElement.innerHTML=''; location.replace('https://www.google.com/');">Exit</button>
  </div>
</main>`);
}

export function formatFollowedLine(user: UserRow): string {
  const initials = user.identity.slice(-2).toUpperCase();
  return user.last_seen_at
    ? `${initials} Last seen: ${formatLocalShort(user.last_seen_at)}`
    : `${initials} Last seen: Never logged in`;
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
const form = document.querySelector('form');
const statusBox = document.getElementById('turnstile-status');
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
