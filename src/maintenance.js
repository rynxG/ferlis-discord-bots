import { backup, DatabaseSync } from 'node:sqlite';
import { mkdir, readdir, stat, unlink, writeFile, readFile } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGzip, gunzipSync } from 'node:zlib';
import { resolve, join, basename } from 'node:path';
import { setting } from './operations-store.js';
export async function createBackup(db, dataDir, now = Date.now()) {
  const dir = resolve(dataDir, 'backups');
  await mkdir(dir, { recursive: true });
  const name = 'backup-' + now,
    temporary = join(dir, name + '.sqlite'),
    path = join(dir, name + '.sqlite.gz');
  try {
    await backup(db, temporary);
    const check = new DatabaseSync(temporary, { readOnly: true });
    try {
      if (check.prepare('PRAGMA quick_check').get().quick_check !== 'ok')
        throw Error('Backup validation failed');
    } finally {
      check.close();
    }
    await pipeline(
      createReadStream(temporary),
      createGzip(),
      createWriteStream(path, { flags: 'wx' }),
    );
    const info = await stat(path);
    db.prepare('INSERT INTO backup_runs VALUES(?,?,?)').run(basename(path), now, info.size);
    return path;
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
export async function validateBackup(path) {
  const data = gunzipSync(await readFile(path));
  return data.subarray(0, 16).toString() === 'SQLite format 3\0';
}
export function retentionPreview(db, now = Date.now()) {
  const result = { transcripts: 0, applications: 0, moderation: 0, messages: 0 };
  for (const [kind, key, table, column] of [
    ['applications', 'applicationDays', 'media_submissions', 'created'],
    ['moderation', 'moderationDays', 'moderation_cases', 'created'],
  ]) {
    const days = setting(db, key);
    if (!days) continue;
    const cutoff = now - days * 86400000;
    result[kind] = Number(
      db
        .prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column}<?`)
        .get(table === 'moderation_cases' ? new Date(cutoff).toISOString() : cutoff).n,
    );
  }
  for (const [kind, key] of [
    ['transcript', 'transcriptDays'],
    ['application', 'applicationDays'],
    ['moderation', 'moderationDays'],
  ]) {
    const days = setting(db, key);
    if (days)
      result.messages += Number(
        db
          .prepare('SELECT count(*) AS n FROM retained_messages WHERE kind=? AND created<?')
          .get(kind, now - days * 86400000).n,
      );
  }
  return result;
}
export async function maintain(db, client, dataDir, { dryRun = true, now = Date.now() } = {}) {
  const counts = retentionPreview(db, now),
    transcripts = resolve(dataDir, 'transcripts');
  const files = await readdir(transcripts).catch(() => []);
  const expired = [];
  const transcriptDays = setting(db, 'transcriptDays');
  if (transcriptDays)
    for (const name of files) {
      if (!/^ticket-\d+\.html$/.test(name)) continue;
      const path = join(transcripts, name);
      if ((await stat(path)).mtimeMs < now - transcriptDays * 86400000) expired.push(path);
    }
  counts.transcripts = expired.length;
  if (dryRun) return counts;
  for (const path of expired) await unlink(path);
  for (const [kind, key] of [
    ['transcript', 'transcriptDays'],
    ['application', 'applicationDays'],
    ['moderation', 'moderationDays'],
  ]) {
    const days = setting(db, key);
    if (!days) continue;
    for (const row of db
      .prepare('SELECT * FROM retained_messages WHERE kind=? AND created<?')
      .all(kind, now - days * 86400000)) {
      const channel = await client.channels
        .fetch(row.channel)
        .catch((e) => (e.code === 10003 ? null : Promise.reject(e)));
      if (channel) {
        const message = await channel.messages
          .fetch(row.message)
          .catch((e) => (e.code === 10008 ? null : Promise.reject(e)));
        if (message) await message.delete();
      }
      db.prepare('DELETE FROM retained_messages WHERE message=?').run(row.message);
    }
  }
  const appDays = setting(db, 'applicationDays');
  if (appDays) {
    const cutoff = now - appDays * 86400000;
    db.prepare('DELETE FROM media_drafts WHERE updated<?').run(cutoff);
    for (const table of ['application_messages', 'application_reviews'])
      db.prepare(
        `DELETE FROM ${table} WHERE id IN (SELECT id FROM media_submissions WHERE created<?)`,
      ).run(cutoff);
    db.prepare('DELETE FROM media_submissions WHERE created<?').run(cutoff);
  }
  const modDays = setting(db, 'moderationDays');
  if (modDays) {
    const cutoff = new Date(now - modDays * 86400000).toISOString();
    for (const table of ['case_reviews', 'case_effects', 'case_targets'])
      db.prepare(
        `DELETE FROM ${table} WHERE id IN (SELECT id FROM moderation_cases WHERE created<?)`,
      ).run(cutoff);
    db.prepare('DELETE FROM moderation_cases WHERE created<?').run(cutoff);
  }
  db.prepare('DELETE FROM support_memory WHERE updated<?').run(
    now - setting(db, 'memoryMinutes') * 60000,
  );
  db.prepare('DELETE FROM support_answers WHERE created<?').run(
    now - setting(db, 'memoryMinutes') * 60000,
  );
  db.prepare(
    'DELETE FROM support_corrections WHERE channel IN (SELECT channel FROM tickets WHERE state<>?)',
  ).run('open');
  return counts;
}
export async function rotateBackups(db, dataDir, now = Date.now()) {
  const dir = resolve(dataDir, 'backups'),
    cutoff = now - setting(db, 'backupDays') * 86400000;
  const rows = db.prepare('SELECT * FROM backup_runs ORDER BY created DESC').all();
  for (const row of rows.filter((r, n) => r.created < cutoff || n >= 14)) {
    if (!/^backup-\d+\.sqlite\.gz$/.test(row.path)) continue;
    await unlink(join(dir, row.path)).catch((e) => {
      if (e.code !== 'ENOENT') throw e;
    });
    db.prepare('DELETE FROM backup_runs WHERE path=?').run(row.path);
  }
}
