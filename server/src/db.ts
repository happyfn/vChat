import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DB_PATH || path.join(dataDir, 'vchat.sqlite');
export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS guilds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invite_code TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS guild_members (
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('text', 'voice')),
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, id);
  CREATE INDEX IF NOT EXISTS idx_channels_guild ON channels(guild_id, position);
`);

export type UserRow = {
  id: number;
  username: string;
  password_hash: string;
  created_at: string;
};

export type GuildRow = {
  id: number;
  name: string;
  owner_id: number;
  invite_code: string;
  created_at: string;
};

export type ChannelRow = {
  id: number;
  guild_id: number;
  name: string;
  type: 'text' | 'voice';
  position: number;
};

export type MessageRow = {
  id: number;
  channel_id: number;
  user_id: number;
  content: string;
  created_at: string;
  username?: string;
};

export function isGuildMember(guildId: number, userId: number): boolean {
  const row = db
    .prepare('SELECT 1 FROM guild_members WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId);
  return Boolean(row);
}

export function getChannelForUser(channelId: number, userId: number): ChannelRow | null {
  const channel = db
    .prepare('SELECT * FROM channels WHERE id = ?')
    .get(channelId) as ChannelRow | undefined;
  if (!channel) return null;
  if (!isGuildMember(channel.guild_id, userId)) return null;
  return channel;
}
