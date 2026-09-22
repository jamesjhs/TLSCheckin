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
};

export type AdminRow = {
  id: number;
  username: string;
  password_hash: string;
  must_change_password: number;
  created_at: number;
  updated_at: number;
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
      user_locations.shared_at AS location_shared_at
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
    WHERE f.follower_id = ?
    ORDER BY LOWER(u.identity)
  `).all(followerId, followerId, followerId) as FollowedUserStatusRow[];
}

export function getFollowedIds(followerId: number): number[] {
  const rows = getDb().prepare('SELECT followed_id FROM follows WHERE follower_id = ? ORDER BY followed_id').all(followerId) as { followed_id: number }[];
  return rows.map((row) => row.followed_id);
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

export function recordStatusViews(viewerId: number, subjects: UserRow[]): void {
  const viewableSubjects = subjects.filter((subject) => subject.id !== viewerId && subject.last_seen_at !== null);
  if (viewableSubjects.length === 0) return;

  const database = getDb();
  const ts = nowMs();
  const transaction = database.transaction(() => {
    const upsert = database.prepare(`
      INSERT INTO status_views (viewer_id, subject_id, subject_seen_at, viewed_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(viewer_id, subject_id)
      DO UPDATE SET subject_seen_at = excluded.subject_seen_at, viewed_at = excluded.viewed_at
    `);
    for (const subject of viewableSubjects) upsert.run(viewerId, subject.id, subject.last_seen_at, ts);
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
