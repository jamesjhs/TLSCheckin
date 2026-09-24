import express, { Router, type Request, type Response } from 'express';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { config } from './config.js';
import { ensureCheckinsFile, normalizeCheckinMessage, readCheckinPresets, saveCheckinPresets } from './checkins.js';
import { initDb, getAdmin, recordAudit, findUserByIdentity, findUserById, updateLastSeen, upsertUserLocation, getFollowedUserStatuses, recordStatusViews, createUser, deleteUser, listUsers, setFollows, getFollowedIds, listAudit, getDb, getUserSecretLink, findUserSecretLinkByTokenHash, upsertUserSecretLink, rotateUserSecretLink, updateUserSmsPreferences, claimAcknowledgementSms, markAcknowledgementSmsSent, markAcknowledgementSmsFailed, getSmsSettings, updateSmsSettings, type AcknowledgementSmsCandidate, type UserRow } from './db.js';
import { noCache, requireAdmin, requireAdminPage } from './middleware.js';
import { getTurnstileConfig, verifyTurnstileToken } from './turnstile.js';
import { appTimezone, formatLocalFooter, localDdmmyy, localYymmdd, nowMs } from './time.js';
import { adminLoginPage, adminPage, formatFollowedStatusLine, passwordChangePage, publicHomePage, secretPinPage, userLandingPage } from './pages.js';
import { ACKNOWLEDGEMENT_SMS_TEXT, normalizeInternationalPhoneNumber, sendAcknowledgementSms, sendSms } from './sms.js';

const app = express();

app.set('trust proxy', 'loopback');
app.use(noCache);
app.use('/assets', express.static('public/assets'));
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: true, limit: '16kb' }));
app.use(session({
  name: 'tlscheckin_session',
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax'
  }
}));

const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false
});

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: true,
  legacyHeaders: false
});

const secretPinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: true,
  legacyHeaders: false
});

type TlsSession = typeof session.Session.prototype & {
  adminId?: number;
  userId?: number;
  mustChangePassword?: boolean;
  loggedInAt?: number;
};

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || '';
}

function currentAdminPath(req?: Request): string {
  const path = `/${localYymmdd()}`;
  return path;
}

function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase();
}

function parseCheckinCode(raw: unknown): { datePart: string; identity: string } | null {
  const value = String(raw ?? '').trim();
  const match = /^(\d{6})-?(\d{4}[a-z]{2})$/i.exec(value);
  if (!match) return null;
  return { datePart: match[1], identity: normalizeIdentity(match[2]) };
}

function selectedIds(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number).filter(Number.isInteger);
  if (typeof value === 'string' && value) return [Number(value)].filter(Number.isInteger);
  return [];
}

function stringValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry ?? ''));
  if (typeof value === 'string') return [value];
  return [];
}

function turnstileToken(req: Request): string {
  const body = (req.body ?? {}) as Record<string, unknown>;
  return String(body['cf-turnstile-response'] || body.turnstileToken || '');
}

function sessionData(req: Request): TlsSession {
  return req.session as typeof req.session & TlsSession;
}

function secretTokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateSecretToken(): string {
  return crypto.randomBytes(12).toString('base64url').slice(0, 15);
}

function generateUniqueSecretToken(): string {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const token = generateSecretToken();
    if (!findUserSecretLinkByTokenHash(secretTokenHash(token))) return token;
  }
  throw new Error('Unable to generate a unique secret link token.');
}

function secretUrl(req: Request, token: string): string {
  return `${req.protocol}://${req.get('host') ?? 'localhost'}/s/${token}`;
}

function buildStatusLines(user: UserRow, previousLastSeenAt: number | null): { lines: string[]; smsCandidates: AcknowledgementSmsCandidate[] } {
  const followed = getFollowedUserStatuses(user.id);
  const lines = followed.length ? followed.map((followedUser) => formatFollowedStatusLine(followedUser, previousLastSeenAt)) : ['Login noted'];
  return { lines, smsCandidates: recordStatusViews(user.id, followed) };
}

async function sendAcknowledgementSmsMessages(candidates: AcknowledgementSmsCandidate[], ip: string): Promise<void> {
  if (candidates.length === 0) return;

  const settings = getSmsSettings();
  for (const candidate of candidates) {
    if (!claimAcknowledgementSms(candidate, ACKNOWLEDGEMENT_SMS_TEXT)) continue;

    try {
      const result = await sendAcknowledgementSms(settings, candidate.phoneNumber);
      if (result.ok) {
        markAcknowledgementSmsSent(candidate, result.providerMessageId);
        recordAudit('acknowledgement_sms_sent', {
          user: candidate.subjectIdentity,
          acknowledged_by: candidate.viewerIdentity
        }, ip);
      } else {
        markAcknowledgementSmsFailed(candidate, result.error);
        recordAudit('acknowledgement_sms_failed', {
          user: candidate.subjectIdentity,
          acknowledged_by: candidate.viewerIdentity,
          reason: result.error
        }, ip);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown SMS send failure.';
      markAcknowledgementSmsFailed(candidate, message);
      recordAudit('acknowledgement_sms_failed', {
        user: candidate.subjectIdentity,
        acknowledged_by: candidate.viewerIdentity,
        reason: message
      }, ip);
    }
  }
}

function getDisplaySecretUrl(req: Request, user: UserRow, generatedSecretUrl?: string): { hasSecretLink: boolean; displaySecretUrl?: string } {
  if (generatedSecretUrl) return { hasSecretLink: true, displaySecretUrl: generatedSecretUrl };

  const link = getUserSecretLink(user.id);
  if (!link) return { hasSecretLink: false };

  if (link.token) return { hasSecretLink: true, displaySecretUrl: secretUrl(req, link.token) };

  const token = generateUniqueSecretToken();
  rotateUserSecretLink(user.id, token, secretTokenHash(token));
  recordAudit('user_secret_link_rotated', { user: user.identity, reason: 'stored_token_migration' }, clientIp(req));
  return { hasSecretLink: true, displaySecretUrl: secretUrl(req, token) };
}

function wantsJson(req: Request): boolean {
  return req.is('application/json') === 'application/json' || req.accepts(['html', 'json']) === 'json';
}

type AdminRenderOptions = {
  checkinPresetStatus?: string;
  checkinPresetStatusIsError?: boolean;
  smsSendStatus?: string;
  smsSendStatusIsError?: boolean;
  selectedCheckinUserId?: number;
  selectedPresetMessage?: string;
  draftCheckinMessage?: string;
};

async function renderUserLanding(
  req: Request,
  res: Response,
  user: UserRow,
  generatedSecretUrl?: string,
  previousLastSeenAt = user.last_seen_at,
  linkStatus?: string,
  linkStatusIsError = false,
  smsStatus?: string,
  smsStatusIsError = false
): Promise<void> {
  const secretLink = getDisplaySecretUrl(req, user, generatedSecretUrl);
  const status = buildStatusLines(user, previousLastSeenAt);
  await sendAcknowledgementSmsMessages(status.smsCandidates, clientIp(req));
  res.type('html').send(userLandingPage({
    lines: status.lines,
    hasSecretLink: secretLink.hasSecretLink,
    secretUrl: secretLink.displaySecretUrl,
    linkStatus,
    linkStatusIsError,
    phoneNumber: user.phone_number ?? '',
    ackSmsEnabled: user.ack_sms_enabled === 1,
    smsPreviewText: ACKNOWLEDGEMENT_SMS_TEXT,
    smsStatus,
    smsStatusIsError
  }));
}

async function establishUserSession(req: Request, userId: number): Promise<void> {
  await new Promise<void>((resolve, reject) => req.session.regenerate((err) => err ? reject(err) : resolve()));
  const current = sessionData(req);
  current.userId = userId;
  current.loggedInAt = nowMs();
}

app.get('/', async (req, res) => {
  const userId = sessionData(req).userId;
  const user = userId ? findUserById(userId) : undefined;
  if (user) {
    await renderUserLanding(req, res, user);
    return;
  }
  res.type('html').send(publicHomePage());
});

app.get('/api/turnstile-config', (_req, res) => {
  res.json(getTurnstileConfig());
});

app.get('/api/server-time', (_req, res) => {
  res.json({
    timezone: appTimezone(),
    localServerTime: formatLocalFooter(),
    adminPath: currentAdminPath(),
    checkinDate: localDdmmyy(),
    isoNow: new Date().toISOString()
  });
});

app.post('/api/checkin', publicLimiter, async (req, res) => {
  const ip = clientIp(req);
  const turnstile = await verifyTurnstileToken(turnstileToken(req), 'checkin', ip);
  if (!turnstile.ok) {
    recordAudit('public_invalid_submission', { reason: 'turnstile_failed', detail: turnstile.reason }, ip);
    res.json({ redirect: true });
    return;
  }

  const parsed = parseCheckinCode(req.body.code);
  if (!parsed) {
    recordAudit('public_invalid_submission', { reason: String(req.body.code || '').trim() ? 'bad_format' : 'blank' }, ip);
    res.json({ redirect: true });
    return;
  }

  if (parsed.datePart !== localDdmmyy()) {
    recordAudit('public_invalid_submission', { reason: 'wrong_date' }, ip);
    res.json({ redirect: true });
    return;
  }

  const user = findUserByIdentity(parsed.identity);
  if (!user) {
    recordAudit('public_invalid_submission', { reason: 'unknown_identity' }, ip);
    res.json({ redirect: true });
    return;
  }

  const previousLastSeenAt = user.last_seen_at;
  updateLastSeen(user.id);
  await establishUserSession(req, user.id);
  recordAudit('public_checkin_success', { user: user.identity }, ip);
  const secretLink = getDisplaySecretUrl(req, user);
  const status = buildStatusLines(user, previousLastSeenAt);
  await sendAcknowledgementSmsMessages(status.smsCandidates, ip);
  res.json({
    html: userLandingPage({
      lines: status.lines,
      hasSecretLink: secretLink.hasSecretLink,
      secretUrl: secretLink.displaySecretUrl,
      phoneNumber: user.phone_number ?? '',
      ackSmsEnabled: user.ack_sms_enabled === 1,
      smsPreviewText: ACKNOWLEDGEMENT_SMS_TEXT
    })
  });
});

app.post('/api/secret-link', async (req, res) => {
  const userId = sessionData(req).userId;
  const user = userId ? findUserById(userId) : undefined;
  if (!user) {
    if (wantsJson(req)) {
      res.status(401).json({ ok: false, message: 'Login required.' });
    } else {
      res.redirect('/');
    }
    return;
  }

  const pin = String(((req.body ?? {}) as Record<string, unknown>).pin || '').trim();
  if (!/^\d{4}$/.test(pin)) {
    if (wantsJson(req)) {
      res.status(400).json({ ok: false, message: 'Enter a 4-digit PIN.' });
    } else {
      res.status(400);
      await renderUserLanding(req, res, user, undefined, user.last_seen_at, 'Enter a 4-digit PIN.', true);
    }
    return;
  }

  const token = generateUniqueSecretToken();
  const pinHash = await bcrypt.hash(pin, 12);
  upsertUserSecretLink(user.id, token, secretTokenHash(token), pinHash);
  recordAudit('user_secret_link_set', { user: user.identity }, clientIp(req));
  const url = secretUrl(req, token);
  if (wantsJson(req)) {
    res.json({ ok: true, message: 'Your quick login link', secretUrl: url });
  } else {
    await renderUserLanding(req, res, user, url, user.last_seen_at, 'Your quick login link');
  }
});

app.post('/api/secret-link/rotate', async (req, res) => {
  const userId = sessionData(req).userId;
  const user = userId ? findUserById(userId) : undefined;
  if (!user) {
    if (wantsJson(req)) {
      res.status(401).json({ ok: false, message: 'Login required.' });
    } else {
      res.redirect('/');
    }
    return;
  }

  if (!getUserSecretLink(user.id)) {
    if (wantsJson(req)) {
      res.status(400).json({ ok: false, message: 'Set a PIN first.' });
    } else {
      res.status(400);
      await renderUserLanding(req, res, user, undefined, user.last_seen_at, 'Set a PIN first.', true);
    }
    return;
  }

  const token = generateUniqueSecretToken();
  rotateUserSecretLink(user.id, token, secretTokenHash(token));
  recordAudit('user_secret_link_rotated', { user: user.identity }, clientIp(req));
  const url = secretUrl(req, token);
  if (wantsJson(req)) {
    res.json({ ok: true, message: 'Secret link rotated.', secretUrl: url });
  } else {
    await renderUserLanding(req, res, user, url, user.last_seen_at, 'Secret link rotated.');
  }
});

app.post('/api/sms-preferences', async (req, res) => {
  const userId = sessionData(req).userId;
  const user = userId ? findUserById(userId) : undefined;
  if (!user) {
    if (wantsJson(req)) {
      res.status(401).json({ ok: false, message: 'Login required.' });
    } else {
      res.redirect('/');
    }
    return;
  }
  const currentUser = user;

  async function respond(statusCode: number, result: { ok: boolean; message: string; phoneNumber?: string; ackSmsEnabled?: boolean }): Promise<void> {
    if (wantsJson(req)) {
      res.status(statusCode).json(result);
      return;
    }

    const refreshedUser = findUserById(currentUser.id) ?? currentUser;
    res.status(statusCode);
    await renderUserLanding(req, res, refreshedUser, undefined, refreshedUser.last_seen_at, undefined, false, result.message, !result.ok);
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const ackSmsEnabled = body.ackSmsEnabled === true || body.ackSmsEnabled === 'on' || body.ackSmsEnabled === 'true' || body.ackSmsEnabled === '1';
  const normalized = normalizeInternationalPhoneNumber(body.phoneNumber);
  if (!normalized.ok) {
    await respond(400, { ok: false, message: normalized.message });
    return;
  }
  if (ackSmsEnabled && !normalized.phoneNumber) {
    await respond(400, { ok: false, message: 'Enter a phone number to receive acknowledgement texts.' });
    return;
  }

  updateUserSmsPreferences(user.id, normalized.phoneNumber || null, ackSmsEnabled);
  recordAudit('user_sms_preferences_updated', {
    user: user.identity,
    ack_sms_enabled: ackSmsEnabled,
    phone_present: Boolean(normalized.phoneNumber)
  }, clientIp(req));
  await respond(200, {
    ok: true,
    message: ackSmsEnabled ? 'SMS acknowledgements enabled.' : 'SMS acknowledgements disabled.',
    phoneNumber: normalized.phoneNumber,
    ackSmsEnabled
  });
});

app.post('/api/location', (req, res) => {
  const userId = sessionData(req).userId;
  const user = userId ? findUserById(userId) : undefined;
  if (!user) {
    res.status(401).json({ ok: false, message: 'Login required.' });
    return;
  }

  const latitude = Number(((req.body ?? {}) as Record<string, unknown>).latitude);
  const longitude = Number(((req.body ?? {}) as Record<string, unknown>).longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    res.status(400).json({ ok: false, message: 'Invalid location.' });
    return;
  }

  upsertUserLocation(user.id, latitude, longitude);
  recordAudit('user_location_shared', { user: user.identity }, clientIp(req));
  res.json({ ok: true, message: 'Location shared.' });
});

app.post('/logout', (req, res) => {
  const userId = sessionData(req).userId;
  const user = userId ? findUserById(userId) : undefined;
  if (user) {
    recordAudit('user_logout', { user: user.identity }, clientIp(req));
  }
  req.session.destroy(() => {
    res.redirect('/');
  });
});

app.get('/s/:token', (req, res) => {
  const token = String(req.params.token || '');
  if (!/^[A-Za-z0-9_-]{15}$/.test(token) || !findUserSecretLinkByTokenHash(secretTokenHash(token))) {
    res.status(404).type('text').send('Not found');
    return;
  }
  res.type('html').send(secretPinPage(req.originalUrl));
});

app.post('/s/:token', secretPinLimiter, async (req, res) => {
  const ip = clientIp(req);
  const token = String(req.params.token || '');
  const secretPath = req.originalUrl.split('?')[0] || `/s/${token}`;
  const turnstile = await verifyTurnstileToken(turnstileToken(req), 'secret_pin', ip);
  if (!turnstile.ok) {
    recordAudit('secret_link_login_failure', { reason: 'turnstile_failed', detail: turnstile.reason }, ip);
    res.status(403).type('html').send(secretPinPage(secretPath, 'Login failed.'));
    return;
  }

  const link = /^[A-Za-z0-9_-]{15}$/.test(token) ? findUserSecretLinkByTokenHash(secretTokenHash(token)) : undefined;
  const user = link ? findUserById(link.user_id) : undefined;
  const pin = String(((req.body ?? {}) as Record<string, unknown>).pin || '');
  const pinOk = link ? await bcrypt.compare(pin, link.pin_hash) : false;
  if (!link || !user || !pinOk) {
    recordAudit('secret_link_login_failure', { reason: 'bad_pin_or_link' }, ip);
    res.status(401).type('html').send(secretPinPage(secretPath, 'Login failed.'));
    return;
  }

  const previousLastSeenAt = user.last_seen_at;
  updateLastSeen(user.id);
  await establishUserSession(req, user.id);
  recordAudit('secret_link_login_success', { user: user.identity }, ip);
  await renderUserLanding(req, res, user, undefined, previousLastSeenAt);
});

const adminRouter = Router({ mergeParams: true });

adminRouter.use((req, res, next) => {
  const requestedDate = String(req.params.adminDate || '');
  const sessionData = req.session as typeof req.session & { adminId?: number };
  const dateIsCurrent = requestedDate === localYymmdd();
  const authenticatedAdmin = Boolean(sessionData.adminId);
  if (!/^\d{6}$/.test(requestedDate) || (!dateIsCurrent && !authenticatedAdmin)) {
    res.status(404).type('text').send('Not found');
    return;
  }
  next();
});

adminRouter.get('/', (req, res) => {
  const sessionData = req.session as typeof req.session & { adminId?: number; mustChangePassword?: boolean };
  if (!sessionData.adminId) {
    res.type('html').send(adminLoginPage(currentAdminPath(req)));
    return;
  }
  if (sessionData.mustChangePassword) {
    res.type('html').send(passwordChangePage(currentAdminPath(req)));
    return;
  }
  renderAdmin(req, res);
});

adminRouter.post('/login', adminLoginLimiter, async (req, res) => {
  const ip = clientIp(req);
  const adminPath = currentAdminPath(req);
  const submittedUsername = String(((req.body ?? {}) as Record<string, unknown>).username || '').trim();
  const token = turnstileToken(req);
  const turnstile = await verifyTurnstileToken(token, 'admin_login', ip);
  if (!turnstile.ok) {
    console.warn('[admin-login] Turnstile verification failed', {
      ip,
      usernamePresent: submittedUsername.length > 0,
      tokenPresent: token.length > 0,
      tokenLength: token.length,
      reason: turnstile.reason,
      enabled: turnstile.enabled,
      expectedAction: turnstile.expectedAction,
      expectedHostnames: turnstile.expectedHostnames,
      siteverify: turnstile.response,
      httpStatus: turnstile.httpStatus
    });
    recordAudit('admin_login_failure', { reason: 'turnstile_failed', detail: turnstile.reason }, ip);
    res.status(403).type('html').send(adminLoginPage(adminPath, 'Login failed.'));
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const admin = getAdmin();
  const usernameOk = username === admin.username;
  const passwordOk = await bcrypt.compare(password, usernameOk ? admin.password_hash : '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinval');

  if (!usernameOk || !passwordOk) {
    console.warn('[admin-login] Credential verification failed', {
      ip,
      usernamePresent: username.length > 0,
      usernameMatchesAdmin: usernameOk,
      passwordPresent: password.length > 0,
      passwordMatches: usernameOk ? passwordOk : false
    });
    recordAudit('admin_login_failure', { reason: 'bad_credentials' }, ip);
    res.status(401).type('html').send(adminLoginPage(adminPath, 'Login failed.'));
    return;
  }

  await new Promise<void>((resolve, reject) => req.session.regenerate((err) => err ? reject(err) : resolve()));
  const sessionData = req.session as typeof req.session & { adminId?: number; mustChangePassword?: boolean; loggedInAt?: number };
  sessionData.adminId = admin.id;
  sessionData.mustChangePassword = admin.must_change_password === 1;
  sessionData.loggedInAt = nowMs();
  console.info('[admin-login] Login successful', {
    ip,
    mustChangePassword: sessionData.mustChangePassword
  });
  recordAudit('admin_login_success', { username: admin.username }, ip);
  res.redirect(sessionData.mustChangePassword ? `${adminPath}/change-password` : adminPath);
});

adminRouter.get('/change-password', requireAdminPage, (req, res) => {
  res.type('html').send(passwordChangePage(currentAdminPath(req)));
});

adminRouter.post('/change-password', requireAdminPage, async (req, res) => {
  const newPassword = String(req.body.newPassword || '');
  const adminPath = currentAdminPath(req);
  if (newPassword.length < 8) {
    res.status(400).type('html').send(passwordChangePage(adminPath, 'Password must be at least 8 characters.'));
    return;
  }
  const hash = await bcrypt.hash(newPassword, 12);
  getDb().prepare('UPDATE admins SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = 1').run(hash, nowMs());
  const sessionData = req.session as typeof req.session & { mustChangePassword?: boolean };
  sessionData.mustChangePassword = false;
  recordAudit('admin_password_change', { username: 'admin' }, clientIp(req));
  res.redirect(adminPath);
});

adminRouter.post('/sms-settings', requireAdmin, (req, res) => {
  const current = getSmsSettings();
  const body = (req.body ?? {}) as Record<string, unknown>;
  const accessKey = String(body.accessKey ?? '').trim();
  const secretKey = String(body.secretKey ?? '').trim();
  const senderId = String(body.senderId ?? '').trim();

  updateSmsSettings({
    accessKey,
    secretKey: secretKey || current.secretKey,
    senderId
  });
  recordAudit('intellisoftware_settings_updated', {
    access_key_present: Boolean(accessKey),
    secret_key_present: Boolean(secretKey || current.secretKey),
    sender_id_present: Boolean(senderId)
  }, clientIp(req));
  res.redirect(currentAdminPath(req));
});

adminRouter.post('/checkin-presets', requireAdmin, (req, res) => {
  try {
    const presets = saveCheckinPresets(stringValues(req.body.presetMessages));
    recordAudit('checkin_sms_presets_updated', { preset_count: presets.length }, clientIp(req));
    renderAdmin(req, res, { checkinPresetStatus: `Saved ${presets.length} check-in preset${presets.length === 1 ? '' : 's'}.` });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save check-in presets.';
    renderAdmin(req, res, { checkinPresetStatus: message, checkinPresetStatusIsError: true });
  }
});

adminRouter.post('/send-checkin-sms', requireAdmin, async (req, res) => {
  const userId = Number(req.body.userId);
  const selectedPresetMessage = String(req.body.presetMessage ?? '').trim();
  const rawMessage = String(req.body.message ?? '').trim() || selectedPresetMessage;
  const user = Number.isInteger(userId) ? findUserById(userId) : undefined;
  if (!user || !user.phone_number) {
    renderAdmin(req, res, {
      smsSendStatus: 'Select a user with a saved phone number.',
      smsSendStatusIsError: true,
      selectedCheckinUserId: Number.isInteger(userId) ? userId : undefined,
      selectedPresetMessage,
      draftCheckinMessage: rawMessage
    });
    return;
  }

  const normalizedPhone = normalizeInternationalPhoneNumber(user.phone_number);
  if (!normalizedPhone.ok || !normalizedPhone.phoneNumber) {
    renderAdmin(req, res, {
      smsSendStatus: 'The saved phone number for this user is invalid.',
      smsSendStatusIsError: true,
      selectedCheckinUserId: user.id,
      selectedPresetMessage,
      draftCheckinMessage: rawMessage
    });
    return;
  }

  const normalized = normalizeCheckinMessage(rawMessage);
  if (!normalized.ok) {
    renderAdmin(req, res, {
      smsSendStatus: normalized.message,
      smsSendStatusIsError: true,
      selectedCheckinUserId: user.id,
      selectedPresetMessage,
      draftCheckinMessage: rawMessage
    });
    return;
  }

  try {
    const result = await sendSms(getSmsSettings(), normalizedPhone.phoneNumber, normalized.message);
    if (!result.ok) {
      recordAudit('checkin_sms_failed', { user: user.identity, reason: result.error }, clientIp(req));
      renderAdmin(req, res, {
        smsSendStatus: result.error,
        smsSendStatusIsError: true,
        selectedCheckinUserId: user.id,
        selectedPresetMessage,
        draftCheckinMessage: normalized.message
      });
      return;
    }
    recordAudit('checkin_sms_sent', { user: user.identity, message_length: normalized.message.length }, clientIp(req));
    renderAdmin(req, res, {
      smsSendStatus: `SMS sent to ${user.identity}.`,
      selectedCheckinUserId: user.id,
      selectedPresetMessage,
      draftCheckinMessage: normalized.message
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown SMS send failure.';
    recordAudit('checkin_sms_failed', { user: user.identity, reason: message }, clientIp(req));
    renderAdmin(req, res, {
      smsSendStatus: message,
      smsSendStatusIsError: true,
      selectedCheckinUserId: user.id,
      selectedPresetMessage,
      draftCheckinMessage: normalized.message
    });
  }
});

adminRouter.post('/logout', requireAdmin, (req, res) => {
  req.session.destroy(() => {
    res.redirect(currentAdminPath(req));
  });
});

adminRouter.post('/users', requireAdmin, (req, res) => {
  const identity = normalizeIdentity(String(req.body.identity || ''));
  const adminPath = currentAdminPath(req);
  if (!/^\d{4}[a-z]{2}$/.test(identity)) {
    recordAudit('user_create_failed', { reason: 'bad_identity' }, clientIp(req));
    res.redirect(adminPath);
    return;
  }
  try {
    const user = createUser(identity);
    recordAudit('user_created', { user: user.identity }, clientIp(req));
  } catch {
    recordAudit('user_create_failed', { reason: 'duplicate_identity' }, clientIp(req));
  }
  res.redirect(adminPath);
});

adminRouter.post('/users/:id/delete', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const user = Number.isInteger(id) ? deleteUser(id) : undefined;
  if (user) {
    recordAudit('user_deleted', { user: user.identity }, clientIp(req));
  }
  res.redirect(currentAdminPath(req));
});

adminRouter.post('/users/:id/follows', requireAdmin, (req, res) => {
  const followerId = Number(req.params.id);
  const ids = selectedIds(req.body.followedIds);
  if (Number.isInteger(followerId)) {
    setFollows(followerId, ids);
    const follower = getDb().prepare('SELECT identity FROM users WHERE id = ?').get(followerId) as { identity: string } | undefined;
    const followed = listUsers().filter((user) => ids.includes(user.id)).map((user) => user.identity);
    recordAudit('follow_relationships_updated', { user: follower?.identity ?? followerId, follows: followed }, clientIp(req));
  }
  res.redirect(currentAdminPath(req));
});

function renderAdmin(req: Request, res: Response, options: AdminRenderOptions = {}): void {
  const users = listUsers();
  const followedByUser = new Map<number, number[]>();
  for (const user of users) followedByUser.set(user.id, getFollowedIds(user.id));
  res.type('html').send(adminPage({
    adminPath: currentAdminPath(req),
    users,
    followedByUser,
    audit: listAudit(200),
    smsSettings: getSmsSettings(),
    checkinPresets: readCheckinPresets(),
    ...options
  }));
}

app.use('/:adminDate', adminRouter);

app.use((_req, res) => {
  res.status(404).type('text').send('Not found');
});

initDb()
  .then(() => {
    ensureCheckinsFile();
    app.listen(config.port, () => {
      console.log(`TLSCheckin listening on http://localhost:${config.port}`);
      console.log(`Admin path for local server date: ${currentAdminPath()}`);
      console.log(`App timezone: ${appTimezone()}`);
      console.log('Turnstile configuration', {
        enabled: getTurnstileConfig().enabled,
        siteKey: getTurnstileConfig().siteKey,
        expectedHostnames: config.turnstileHostnames
      });
      if (getTurnstileConfig().enabled && config.turnstileHostnames.every((hostname) => hostname === 'localhost' || hostname === '127.0.0.1')) {
        console.warn('Turnstile is enabled with local-only TURNSTILE_HOSTNAMES. Set TURNSTILE_HOSTNAMES to the production hostname on deployed servers.');
      }
    });
  })
  .catch((error: unknown) => {
    console.error('TLSCheckin failed to start:', error);
    process.exit(1);
  });
