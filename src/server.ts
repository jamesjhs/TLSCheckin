import express, { Router, type Request, type Response } from 'express';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcrypt';
import { config } from './config.js';
import { initDb, getAdmin, recordAudit, findUserByIdentity, updateLastSeen, getFollowedUsers, createUser, deleteUser, listUsers, setFollows, getFollowedIds, listAudit, getDb } from './db.js';
import { noCache, requireAdmin, requireAdminPage } from './middleware.js';
import { getTurnstileConfig, verifyTurnstileToken } from './turnstile.js';
import { localDdmmyy, localYymmdd, nowMs } from './time.js';
import { adminLoginPage, adminPage, formatFollowedLine, passwordChangePage, publicHomePage, resultPage } from './pages.js';

const app = express();

app.set('trust proxy', 'loopback');
app.use(noCache);
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: true, limit: '16kb' }));
app.use(session({
  name: 'tlscheckin_admin',
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

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || '';
}

function currentAdminPath(req?: Request): string {
  const path = `/${localYymmdd()}`;
  if (req) req.app.locals.adminPath = path;
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

function turnstileToken(req: Request): string {
  const body = (req.body ?? {}) as Record<string, unknown>;
  return String(body['cf-turnstile-response'] || body.turnstileToken || '');
}

app.get('/', (_req, res) => {
  res.type('html').send(publicHomePage());
});

app.get('/api/turnstile-config', (_req, res) => {
  res.json(getTurnstileConfig());
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

  updateLastSeen(user.id);
  recordAudit('public_checkin_success', { user: user.identity }, ip);
  const followed = getFollowedUsers(user.id);
  const lines = followed.length ? followed.map(formatFollowedLine) : ['Login noted'];
  res.json({ html: resultPage(lines) });
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
  req.app.locals.adminPath = `/${requestedDate}`;
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

function renderAdmin(req: Request, res: Response): void {
  const users = listUsers();
  const followedByUser = new Map<number, number[]>();
  for (const user of users) followedByUser.set(user.id, getFollowedIds(user.id));
  res.type('html').send(adminPage({
    adminPath: currentAdminPath(req),
    users,
    followedByUser,
    audit: listAudit(200)
  }));
}

app.use('/:adminDate', adminRouter);

app.use((_req, res) => {
  res.status(404).type('text').send('Not found');
});

initDb()
  .then(() => {
    app.listen(config.port, () => {
      console.log(`TLSCheckin listening on http://localhost:${config.port}`);
      console.log(`Admin path for local server date: ${currentAdminPath()}`);
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
