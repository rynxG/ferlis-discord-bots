import { normalize } from './core.js';
export const defaults = {
  joinCount: 8,
  joinSeconds: 10,
  mentionCount: 5,
  linkCount: 3,
  linkSeconds: 30,
  spamCount: 6,
  spamRepeat: 3,
  spamSeconds: 8,
  transcriptDays: 0,
  applicationDays: 0,
  moderationDays: 0,
  memoryMinutes: 30,
  backupDays: 7,
};
export function operationsSchema(db) {
  db.exec(`
 CREATE TABLE IF NOT EXISTS support_memory(channel TEXT PRIMARY KEY,owner TEXT NOT NULL,topic TEXT NOT NULL,question TEXT NOT NULL,answer TEXT NOT NULL,updated INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS support_corrections(id INTEGER PRIMARY KEY,channel TEXT NOT NULL,question TEXT NOT NULL,answer TEXT NOT NULL,author TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS support_answers(message TEXT PRIMARY KEY,channel TEXT NOT NULL,question TEXT NOT NULL,answer TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS application_messages(id TEXT PRIMARY KEY,channel TEXT NOT NULL,message TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS ticket_work(channel TEXT PRIMARY KEY,claimed TEXT,team TEXT,resolved INTEGER,rating INTEGER,rated INTEGER);
 CREATE TABLE IF NOT EXISTS case_reviews(id TEXT PRIMARY KEY,status TEXT NOT NULL,actor TEXT NOT NULL,note TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS case_effects(id TEXT PRIMARY KEY,expires INTEGER,previous INTEGER,offence_count INTEGER,previous_permanent INTEGER);
 CREATE TABLE IF NOT EXISTS case_targets(id TEXT PRIMARY KEY,channel TEXT NOT NULL,message TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS retained_messages(kind TEXT NOT NULL,channel TEXT NOT NULL,message TEXT PRIMARY KEY,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS voice_preferences(user TEXT PRIMARY KEY,name TEXT,member_limit INTEGER NOT NULL DEFAULT 0,locked INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS voice_trusted(owner TEXT NOT NULL,user TEXT NOT NULL,PRIMARY KEY(owner,user));
 CREATE TABLE IF NOT EXISTS download_access(user TEXT PRIMARY KEY,tag_started INTEGER,eligible_at INTEGER,updated INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS application_reviews(id TEXT PRIMARY KEY,status TEXT NOT NULL,actor TEXT NOT NULL,updated INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS operations_audit(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS backup_runs(path TEXT PRIMARY KEY,created INTEGER NOT NULL,size INTEGER NOT NULL);
 `);
}
export function setting(db, key) {
  const value = db.prepare('SELECT value FROM settings WHERE key=?').get('ops:' + key)?.value;
  return value === undefined ? defaults[key] : Number(value);
}
export function setSetting(db, key, value) {
  if (!(key in defaults) || !Number.isSafeInteger(value) || value < 0)
    throw Error('Invalid setting');
  db.prepare(
    'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
  ).run('ops:' + key, String(value));
}
export function audit(db, actor, action) {
  db.prepare('INSERT INTO operations_audit(actor,action,created) VALUES(?,?,?)').run(
    actor,
    action,
    Date.now(),
  );
}
export function remember(db, channel, owner, question, answer, topic, now = Date.now()) {
  db.prepare(
    'INSERT INTO support_memory VALUES(?,?,?,?,?,?) ON CONFLICT(channel) DO UPDATE SET owner=excluded.owner,topic=excluded.topic,question=excluded.question,answer=excluded.answer,updated=excluded.updated',
  ).run(channel, owner, topic, question.slice(0, 2000), answer.slice(0, 2000), now);
}
export function inferTopic(question, fallback = 'support') {
  const q = normalize(question);
  for (const [topic, re] of [
    ['accounts', /\b(accounts?|tokens?)\b/],
    ['client', /\b(client|chirsp|chrisp|ferlis|felris|feris)\b/],
    ['voice', /\b(vc|voice|room)\b/],
    ['media', /\b(media|application|apply)\b/],
    ['purchase', /\b(buy|purchase|payment|order|price|cost|budget)\b/],
    ['appeal', /\b(appeal|ban|mute|punishment)\b/],
  ])
    if (re.test(q)) return topic;
  return fallback;
}
export function contextualQuestion(
  db,
  channel,
  owner,
  question,
  ticketKind = 'support',
  now = Date.now(),
  correctionChannel = channel,
) {
  const saved = db
    .prepare('SELECT * FROM support_memory WHERE channel=? AND owner=?')
    .get(channel, owner);
  const live = saved && now - saved.updated < setting(db, 'memoryMinutes') * 60000 ? saved : null;
  let topic = inferTopic(question, live?.topic || ticketKind);
  if (topic === 'purchase' && ['accounts', 'client'].includes(live?.topic)) topic = live.topic;
  const short = normalize(question).split(' ').length <= 14;
  const follow =
    short &&
    /\b(it|that|this|they|them|those|more|much|price|cost|how|where|what|yes|no|why|buy|pay|download|install)\b/i.test(
      question,
    ) &&
    !/^\s*(hi+|hello|hey|thanks)\b/i.test(question);
  const expanded =
    follow && live && topic === live.topic && !new RegExp('\\b' + topic + '\\b', 'i').test(question)
      ? `${question} (${topic})`
      : question;
  const corrections = db
    .prepare(
      'SELECT question,answer FROM support_corrections WHERE channel=? ORDER BY created DESC LIMIT 30',
    )
    .all(correctionChannel);
  const corrected = corrections.find(
    (r) =>
      normalize(r.question) === normalize(question) ||
      normalize(r.question) === normalize(expanded),
  );
  return { question: expanded, topic, corrected: corrected?.answer };
}
export class RaidShield {
  constructor() {
    this.joins = [];
    this.links = new Map();
    this.lastAlert = 0;
  }
  join(config, now = Date.now()) {
    this.joins = this.joins.filter((t) => now - t < config.joinSeconds * 1000);
    this.joins.push(now);
    return this.joins.length >= config.joinCount;
  }
  link(content, user, config, now = Date.now()) {
    let hit = false;
    for (const raw of content.match(/https?:\/\/[^\s<>]+/gi) || []) {
      let key;
      try {
        const u = new URL(raw);
        key = u.hostname.toLowerCase() + u.pathname.toLowerCase();
      } catch {
        continue;
      }
      const recent = (this.links.get(key) || []).filter(
        (r) => now - r.time < config.linkSeconds * 1000,
      );
      recent.push({ user, time: now });
      this.links.set(key, recent);
      if (new Set(recent.map((r) => r.user)).size >= config.linkCount) hit = true;
    }
    if (this.links.size > 2000)
      for (const [k, rows] of this.links)
        if (now - rows.at(-1).time > config.linkSeconds * 1000) this.links.delete(k);
    return hit;
  }
}
export function trackMessage(db, kind, message) {
  db.prepare('INSERT OR IGNORE INTO retained_messages VALUES(?,?,?,?)').run(
    kind,
    message.channelId || message.channel.id,
    message.id,
    message.createdTimestamp || Date.now(),
  );
}
