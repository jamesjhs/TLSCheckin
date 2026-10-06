import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import bcrypt from 'bcrypt';
import { config } from './config.js';
import { nowMs } from './time.js';

type Db = Database.Database;

let db: Db | null = null;

export type UserRow = {
  id: number;
  identity: string;
  last_seen_at: number | null;
  user_password_hash: string | null;
  phone_number: string | null;
  ack_sms_enabled: number;
  created_at: number;
  updated_at: number;
};

export type UserSecretLinkRow = {
  user_id: number;
  token: string | null;
  token_hash: string;
  pin_hash: string;
  created_at: number;
  updated_at: number;
};

export type FollowedUserStatusRow = UserRow & {
  viewer_seen_at: number | null;
  subject_seen_at: number | null;
  location_latitude: number | null;
  location_longitude: number | null;
  location_shared_at: number | null;
  personal_message_id: number | null;
  personal_message: string | null;
  personal_message_created_at: number | null;
};

export type AdminRow = {
  id: number;
  username: string;
  password_hash: string;
  must_change_password: number;
  created_at: number;
  updated_at: number;
};

export type SmsSettings = {
  accessKey: string;
  secretKey: string;
  senderId: string;
};

export type AcknowledgementSmsCandidate = {
  subjectId: number;
  subjectIdentity: string;
  viewerId: number;
  viewerIdentity: string;
  subjectSeenAt: number;
  phoneNumber: string;
};

export type FriendSummary = {
  followers: UserRow[];
  incomingRequests: UserRow[];
  outgoingRequests: UserRow[];
};

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function initDb(): Promise<void> {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  const instance = new Database(config.dbPath);
  db = instance;

  instance.pragma("cipher = 'sqlcipher'");
  instance.pragma(`key = ${sqlString(config.dbEncryptionKey)}`);
  instance.pragma('foreign_keys = ON');
  instance.pragma('journal_mode = WAL');

  instance.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      identity TEXT NOT NULL,
      last_seen_at INTEGER,
      user_password_hash TEXT,
      phone_number TEXT,
      ack_sms_enabled INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS users_identity_nocase_unique
      ON users (LOWER(identity));

    CREATE TABLE IF NOT EXISTS follows (
      follower_id INTEGER NOT NULL,
      followed_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (follower_id, followed_id),
      CHECK (follower_id <> followed_id),
      FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (followed_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS follow_requests (
      requester_id INTEGER NOT NULL,
      target_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (requester_id, target_id),
      CHECK (requester_id <> target_id),
      FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS status_views (
      viewer_id INTEGER NOT NULL,
      subject_id INTEGER NOT NULL,
      subject_seen_at INTEGER NOT NULL,
      viewed_at INTEGER NOT NULL,
      PRIMARY KEY (viewer_id, subject_id),
      CHECK (viewer_id <> subject_id),
      FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (subject_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_secret_links (
      user_id INTEGER PRIMARY KEY,
      token TEXT,
      token_hash TEXT NOT NULL UNIQUE,
      pin_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_locations (
      user_id INTEGER PRIMARY KEY,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      shared_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS personal_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS personal_messages_user_created_idx
      ON personal_messages (user_id, created_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS personal_message_views (
      message_id INTEGER NOT NULL,
      viewer_id INTEGER NOT NULL,
      viewed_at INTEGER NOT NULL,
      PRIMARY KEY (message_id, viewer_id),
      FOREIGN KEY (message_id) REFERENCES personal_messages(id) ON DELETE CASCADE,
      FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS acknowledgement_sms_notifications (
      subject_id INTEGER NOT NULL,
      viewer_id INTEGER NOT NULL,
      subject_seen_at INTEGER NOT NULL,
      phone_number TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_message_id TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (subject_id, viewer_id, subject_seen_at),
      FOREIGN KEY (subject_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '{}',
      ip TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  const secretLinkColumns = instance.prepare('PRAGMA table_info(user_secret_links)').all() as Array<{ name: string }>;
  if (!secretLinkColumns.some((column) => column.name === 'token')) {
    instance.prepare('ALTER TABLE user_secret_links ADD COLUMN token TEXT').run();
  }
  instance.prepare('CREATE UNIQUE INDEX IF NOT EXISTS user_secret_links_token_unique ON user_secret_links (token) WHERE token IS NOT NULL').run();

  const userColumns = instance.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
  if (!userColumns.some((column) => column.name === 'user_password_hash')) {
    instance.prepare('ALTER TABLE users ADD COLUMN user_password_hash TEXT').run();
  }
  if (!userColumns.some((column) => column.name === 'phone_number')) {
    instance.prepare('ALTER TABLE users ADD COLUMN phone_number TEXT').run();
  }
  if (!userColumns.some((column) => column.name === 'ack_sms_enabled')) {
    instance.prepare('ALTER TABLE users ADD COLUMN ack_sms_enabled INTEGER NOT NULL DEFAULT 0').run();
  }

  const admin = instance.prepare('SELECT id FROM admins WHERE id = 1').get() as { id: number } | undefined;
  if (!admin) {
    const hash = await bcrypt.hash(config.adminInitialPassword, 12);
    const ts = nowMs();
    instance.prepare(`
      INSERT INTO admins (id, username, password_hash, must_change_password, created_at, updated_at)
      VALUES (1, 'admin', ?, 1, ?, ?)
    `).run(hash, ts, ts);
    recordAudit('admin_initialized', { username: 'admin' });
  }
}

export function getDb(): Db {
  if (!db) throw new Error('Database has not been initialized.');
  return db;
}

export function recordAudit(eventType: string, details: Record<string, unknown> = {}, ip?: string): void {
  const database = getDb();
  database.prepare('INSERT INTO audit_events (event_type, details, ip, created_at) VALUES (?, ?, ?, ?)')
    .run(eventType, JSON.stringify(details), ip ?? null, nowMs());
}

export function getAdmin(): AdminRow {
  return getDb().prepare('SELECT * FROM admins WHERE id = 1').get() as AdminRow;
}

export function findUserByIdentity(identity: string): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE LOWER(identity) = LOWER(?)').get(identity) as UserRow | undefined;
}

export function findUserById(id: number): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function listUsers(): UserRow[] {
  return getDb().prepare('SELECT * FROM users ORDER BY LOWER(identity)').all() as UserRow[];
}

export function createUser(identity: string): UserRow {
  const ts = nowMs();
  const database = getDb();
  const result = database.prepare('INSERT INTO users (identity, created_at, updated_at) VALUES (?, ?, ?)').run(identity, ts, ts);
  return database.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid) as UserRow;
}

export function updateUserSmsPreferences(userId: number, phoneNumber: string | null, ackSmsEnabled: boolean): void {
  const ts = nowMs();
  getDb().prepare('UPDATE users SET phone_number = ?, ack_sms_enabled = ?, updated_at = ? WHERE id = ?')
    .run(phoneNumber, ackSmsEnabled ? 1 : 0, ts, userId);
}

export function updateUserPassword(userId: number, passwordHash: string | null): void {
  const ts = nowMs();
  getDb().prepare('UPDATE users SET user_password_hash = ?, updated_at = ? WHERE id = ?')
    .run(passwordHash, ts, userId);
}

export function deleteUser(id: number): UserRow | undefined {
  const database = getDb();
  const user = database.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  if (!user) return undefined;
  database.prepare('DELETE FROM users WHERE id = ?').run(id);
  return user;
}

export function setFollows(followerId: number, followedIds: number[]): void {
  const database = getDb();
  const ts = nowMs();
  const uniqueIds = [...new Set(followedIds)].filter((id) => Number.isInteger(id) && id > 0 && id !== followerId);
  const transaction = database.transaction(() => {
    database.prepare('DELETE FROM follows WHERE follower_id = ?').run(followerId);
    const insert = database.prepare('INSERT OR IGNORE INTO follows (follower_id, followed_id, created_at) VALUES (?, ?, ?)');
    for (const followedId of uniqueIds) insert.run(followerId, followedId, ts);
    database.prepare('UPDATE users SET updated_at = ? WHERE id = ?').run(ts, followerId);
  });
  transaction();
}

export function getFollowedUsers(followerId: number): UserRow[] {
  return getDb().prepare(`
    SELECT u.*
    FROM follows f
    JOIN users u ON u.id = f.followed_id
    WHERE f.follower_id = ?
    ORDER BY LOWER(u.identity)
  `).all(followerId) as UserRow[];
}

export function getFollowedUserStatuses(followerId: number): FollowedUserStatusRow[] {
  return getDb().prepare(`
    SELECT
      u.*,
      viewer_status.subject_seen_at AS viewer_seen_at,
      subject_status.subject_seen_at AS subject_seen_at,
      user_locations.latitude AS location_latitude,
      user_locations.longitude AS location_longitude,
      user_locations.shared_at AS location_shared_at,
      current_message.id AS personal_message_id,
      current_message.message AS personal_message,
      current_message.created_at AS personal_message_created_at
    FROM follows f
    JOIN users u ON u.id = f.followed_id
    LEFT JOIN status_views viewer_status
      ON viewer_status.viewer_id = ?
      AND viewer_status.subject_id = u.id
    LEFT JOIN status_views subject_status
      ON subject_status.viewer_id = u.id
      AND subject_status.subject_id = ?
    LEFT JOIN user_locations
      ON user_locations.user_id = u.id
    LEFT JOIN personal_messages current_message
      ON current_message.id = (
        SELECT pm.id
        FROM personal_messages pm
        WHERE pm.user_id = u.id
        ORDER BY pm.created_at DESC, pm.id DESC
        LIMIT 1
      )
      AND NOT EXISTS (
        SELECT 1
        FROM personal_message_views pmv
        WHERE pmv.message_id = current_message.id
          AND pmv.viewer_id = ?
      )
    WHERE f.follower_id = ?
    ORDER BY LOWER(u.identity)
  `).all(followerId, followerId, followerId, followerId) as FollowedUserStatusRow[];
}

export function getFollowedIds(followerId: number): number[] {
  const rows = getDb().prepare('SELECT followed_id FROM follows WHERE follower_id = ? ORDER BY followed_id').all(followerId) as { followed_id: number }[];
  return rows.map((row) => row.followed_id);
}

export function getFriendSummary(userId: number): FriendSummary {
  const database = getDb();
  const followers = database.prepare(`
    SELECT u.*
    FROM follows f
    JOIN users u ON u.id = f.follower_id
    WHERE f.followed_id = ?
    ORDER BY LOWER(u.identity)
  `).all(userId) as UserRow[];
  const incomingRequests = database.prepare(`
    SELECT u.*
    FROM follow_requests fr
    JOIN users u ON u.id = fr.requester_id
    WHERE fr.target_id = ?
    ORDER BY fr.created_at, LOWER(u.identity)
  `).all(userId) as UserRow[];
  const outgoingRequests = database.prepare(`
    SELECT u.*
    FROM follow_requests fr
    JOIN users u ON u.id = fr.target_id
    WHERE fr.requester_id = ?
    ORDER BY fr.created_at, LOWER(u.identity)
  `).all(userId) as UserRow[];
  return { followers, incomingRequests, outgoingRequests };
}

export type FollowRequestResult =
  | { ok: true; status: 'requested'; target: UserRow }
  | { ok: true; status: 'already_following'; target: UserRow }
  | { ok: true; status: 'already_pending'; target: UserRow }
  | { ok: false; reason: 'not_found' | 'self' };

export function requestFollow(requesterId: number, targetIdentity: string): FollowRequestResult {
  const target = findUserByIdentity(targetIdentity);
  if (!target) return { ok: false, reason: 'not_found' };
  if (target.id === requesterId) return { ok: false, reason: 'self' };

  const database = getDb();
  const existingFollow = database.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?').get(requesterId, target.id);
  if (existingFollow) return { ok: true, status: 'already_following', target };

  const existingRequest = database.prepare('SELECT 1 FROM follow_requests WHERE requester_id = ? AND target_id = ?').get(requesterId, target.id);
  if (existingRequest) return { ok: true, status: 'already_pending', target };

  database.prepare('INSERT INTO follow_requests (requester_id, target_id, created_at) VALUES (?, ?, ?)')
    .run(requesterId, target.id, nowMs());
  return { ok: true, status: 'requested', target };
}

export function approveFollowRequest(targetId: number, requesterId: number): boolean {
  const database = getDb();
  const ts = nowMs();
  const transaction = database.transaction(() => {
    const deleted = database.prepare('DELETE FROM follow_requests WHERE requester_id = ? AND target_id = ?').run(requesterId, targetId);
    if (deleted.changes === 0) return false;
    database.prepare('INSERT OR IGNORE INTO follows (follower_id, followed_id, created_at) VALUES (?, ?, ?)')
      .run(requesterId, targetId, ts);
    database.prepare('UPDATE users SET updated_at = ? WHERE id IN (?, ?)').run(ts, requesterId, targetId);
    return true;
  });
  return transaction() as boolean;
}

export function denyFollowRequest(targetId: number, requesterId: number): boolean {
  const result = getDb().prepare('DELETE FROM follow_requests WHERE requester_id = ? AND target_id = ?').run(requesterId, targetId);
  return result.changes > 0;
}

export function revokeFollowerAccess(followedId: number, followerId: number): boolean {
  const result = getDb().prepare('DELETE FROM follows WHERE follower_id = ? AND followed_id = ?').run(followerId, followedId);
  return result.changes > 0;
}

export function updateLastSeen(userId: number): number {
  const ts = nowMs();
  getDb().prepare('UPDATE users SET last_seen_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, userId);
  return ts;
}

export function upsertUserLocation(userId: number, latitude: number, longitude: number): void {
  const ts = nowMs();
  getDb().prepare(`
    INSERT INTO user_locations (user_id, latitude, longitude, shared_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id)
    DO UPDATE SET latitude = excluded.latitude, longitude = excluded.longitude, shared_at = excluded.shared_at, updated_at = excluded.updated_at
  `).run(userId, latitude, longitude, ts, ts);
}

export function savePersonalMessage(userId: number, message: string): void {
  const trimmed = message.trim();
  const database = getDb();
  const ts = nowMs();
  const transaction = database.transaction(() => {
    database.prepare('DELETE FROM personal_messages WHERE user_id = ?').run(userId);
    if (trimmed) {
      database.prepare('INSERT INTO personal_messages (user_id, message, created_at) VALUES (?, ?, ?)')
        .run(userId, trimmed, ts);
    }
    database.prepare('UPDATE users SET updated_at = ? WHERE id = ?').run(ts, userId);
  });
  transaction();
}

export function getCurrentPersonalMessage(userId: number): string {
  const row = getDb().prepare(`
    SELECT message
    FROM personal_messages
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(userId) as { message: string } | undefined;
  return row?.message ?? '';
}

export function recordPersonalMessageViews(viewerId: number, subjects: FollowedUserStatusRow[]): void {
  const messageIds = [...new Set(subjects
    .map((subject) => subject.personal_message_id)
    .filter((id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0))];
  if (messageIds.length === 0) return;

  const database = getDb();
  const ts = nowMs();
  const insert = database.prepare(`
    INSERT OR IGNORE INTO personal_message_views (message_id, viewer_id, viewed_at)
    VALUES (?, ?, ?)
  `);
  const transaction = database.transaction(() => {
    for (const messageId of messageIds) insert.run(messageId, viewerId, ts);
  });
  transaction();
}

export function recordStatusViews(viewerId: number, subjects: UserRow[]): AcknowledgementSmsCandidate[] {
  const viewableSubjects = subjects.filter((subject) => subject.id !== viewerId && subject.last_seen_at !== null);
  if (viewableSubjects.length === 0) return [];

  const database = getDb();
  const ts = nowMs();
  const viewer = database.prepare('SELECT identity FROM users WHERE id = ?').get(viewerId) as { identity: string } | undefined;
  const candidates: AcknowledgementSmsCandidate[] = [];
  const transaction = database.transaction(() => {
    const previousStatus = database.prepare('SELECT subject_seen_at FROM status_views WHERE viewer_id = ? AND subject_id = ?');
    const upsert = database.prepare(`
      INSERT INTO status_views (viewer_id, subject_id, subject_seen_at, viewed_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(viewer_id, subject_id)
      DO UPDATE SET subject_seen_at = excluded.subject_seen_at, viewed_at = excluded.viewed_at
    `);
    for (const subject of viewableSubjects) {
      const lastSeenAt = subject.last_seen_at;
      if (lastSeenAt === null) continue;
      const previous = previousStatus.get(viewerId, subject.id) as { subject_seen_at: number } | undefined;
      if (
        subject.ack_sms_enabled === 1 &&
        subject.phone_number &&
        viewer &&
        (!previous || previous.subject_seen_at < lastSeenAt)
      ) {
        candidates.push({
          subjectId: subject.id,
          subjectIdentity: subject.identity,
          viewerId,
          viewerIdentity: viewer.identity,
          subjectSeenAt: lastSeenAt,
          phoneNumber: subject.phone_number
        });
      }
      upsert.run(viewerId, subject.id, lastSeenAt, ts);
    }
  });
  transaction();
  return candidates;
}

export function claimAcknowledgementSms(candidate: AcknowledgementSmsCandidate, message: string): boolean {
  const ts = nowMs();
  const result = getDb().prepare(`
    INSERT OR IGNORE INTO acknowledgement_sms_notifications
      (subject_id, viewer_id, subject_seen_at, phone_number, message, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(candidate.subjectId, candidate.viewerId, candidate.subjectSeenAt, candidate.phoneNumber, message, ts, ts);
  return result.changes > 0;
}

export function markAcknowledgementSmsSent(candidate: AcknowledgementSmsCandidate, providerMessageId?: string): void {
  getDb().prepare(`
    UPDATE acknowledgement_sms_notifications
    SET status = 'sent', provider_message_id = ?, error = NULL, updated_at = ?
    WHERE subject_id = ? AND viewer_id = ? AND subject_seen_at = ?
  `).run(providerMessageId ?? null, nowMs(), candidate.subjectId, candidate.viewerId, candidate.subjectSeenAt);
}

export function markAcknowledgementSmsFailed(candidate: AcknowledgementSmsCandidate, error: string): void {
  getDb().prepare(`
    UPDATE acknowledgement_sms_notifications
    SET status = 'failed', error = ?, updated_at = ?
    WHERE subject_id = ? AND viewer_id = ? AND subject_seen_at = ?
  `).run(error.slice(0, 500), nowMs(), candidate.subjectId, candidate.viewerId, candidate.subjectSeenAt);
}

export function getSmsSettings(): SmsSettings {
  const rows = getDb().prepare("SELECT key, value FROM app_settings WHERE key IN ('intellisoftware_access_key', 'intellisoftware_secret_key', 'intellisoftware_sender_id')")
    .all() as Array<{ key: string; value: string }>;
  const settings = new Map(rows.map((row) => [row.key, row.value]));
  return {
    accessKey: settings.get('intellisoftware_access_key') ?? '',
    secretKey: settings.get('intellisoftware_secret_key') ?? '',
    senderId: settings.get('intellisoftware_sender_id') ?? ''
  };
}

export function updateSmsSettings(settings: SmsSettings): void {
  const database = getDb();
  const ts = nowMs();
  const upsert = database.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  const transaction = database.transaction(() => {
    upsert.run('intellisoftware_access_key', settings.accessKey, ts);
    upsert.run('intellisoftware_secret_key', settings.secretKey, ts);
    upsert.run('intellisoftware_sender_id', settings.senderId, ts);
  });
  transaction();
}

export function getUserSecretLink(userId: number): UserSecretLinkRow | undefined {
  return getDb().prepare('SELECT * FROM user_secret_links WHERE user_id = ?').get(userId) as UserSecretLinkRow | undefined;
}

export function findUserSecretLinkByTokenHash(tokenHash: string): UserSecretLinkRow | undefined {
  return getDb().prepare('SELECT * FROM user_secret_links WHERE token_hash = ?').get(tokenHash) as UserSecretLinkRow | undefined;
}

export function upsertUserSecretLink(userId: number, token: string, tokenHash: string, pinHash: string): void {
  const ts = nowMs();
  getDb().prepare(`
    INSERT INTO user_secret_links (user_id, token, token_hash, pin_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id)
    DO UPDATE SET token = excluded.token, token_hash = excluded.token_hash, pin_hash = excluded.pin_hash, updated_at = excluded.updated_at
  `).run(userId, token, tokenHash, pinHash, ts, ts);
}

export function rotateUserSecretLink(userId: number, token: string, tokenHash: string): boolean {
  const ts = nowMs();
  const result = getDb().prepare('UPDATE user_secret_links SET token = ?, token_hash = ?, updated_at = ? WHERE user_id = ?').run(token, tokenHash, ts, userId);
  return result.changes > 0;
}

export function listAudit(limit = 200): Array<{ id: number; event_type: string; details: string; ip: string | null; created_at: number }> {
  return getDb().prepare('SELECT * FROM audit_events ORDER BY created_at DESC, id DESC LIMIT ?').all(limit) as Array<{ id: number; event_type: string; details: string; ip: string | null; created_at: number }>;
}
