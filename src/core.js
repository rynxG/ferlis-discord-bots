import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const kinds = ['support', 'purchase', 'appeal', 'something-else'];
export const labels = ['Support', 'Purchase', 'Appeal', 'Something Else'];
export function openStore(dir) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, 'bots.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS tickets(channel TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open', ai INTEGER NOT NULL DEFAULT 0);
    CREATE UNIQUE INDEX IF NOT EXISTS one_open ON tickets(owner) WHERE state='open';
    CREATE TABLE IF NOT EXISTS knowledge(id INTEGER PRIMARY KEY, question TEXT NOT NULL, answer TEXT NOT NULL, author TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS usage(day TEXT PRIMARY KEY, count INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS moderation_cases(id TEXT PRIMARY KEY,action TEXT NOT NULL,user TEXT NOT NULL,actor TEXT NOT NULL,reason TEXT NOT NULL,created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS offences(user TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, last INTEGER NOT NULL DEFAULT 0, permanent INTEGER NOT NULL DEFAULT 0);`);
  return db;
}
export function normalize(s) {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
export function relevantKnowledge(rows, question) {
  const stop = new Set([
    'the',
    'and',
    'for',
    'are',
    'you',
    'your',
    'how',
    'what',
    'where',
    'when',
    'why',
    'can',
    'does',
    'with',
    'this',
    'that',
    'have',
    'about',
    'please',
    'would',
    'could',
  ]);
  const terms = (s) =>
    new Set(
      normalize(s)
        .split(' ')
        .filter((t) => t.length > 2 && !stop.has(t)),
    );
  const query = terms(question);
  return rows
    .map((row) => {
      const title = terms(row.question);
      const answer = terms(row.answer);
      const account = /\b(accounts?|tokens?)\b/i;
      if (account.test(question) && !account.test(row.question + ' ' + row.answer))
        return { ...row, score: 0 };
      const matched = [...query].filter((t) => title.has(t)).length;
      const secondary = [...query].filter((t) => answer.has(t)).length;
      const coverage = matched / Math.max(1, query.size);
      return {
        ...row,
        score:
          normalize(row.question) === normalize(question)
            ? 100
            : matched && coverage >= 0.5
              ? (matched * 3) / Math.max(1, title.size) + secondary * 0.1
              : 0,
      };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
}
export function moderationInput(message) {
  const gifLink =
    /https?:\/\/(?:[a-z0-9-]+\.)?(?:tenor\.com|giphy\.com|giphy\.gif|gfycat\.com)\/[^\s<>]+|https?:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/[^\s<>]+\.gif(?:\?[^\s<>]*)?/gi;
  const content = (message.content || '').replace(gifLink, '').trim();
  const embeds = (message.embeds || [])
    .filter((e) => e.type !== 'gifv' && !/tenor\.com|giphy\.com/.test(e.url || ''))
    .map((e) =>
      [
        e.title,
        e.description,
        e.author?.name,
        e.footer?.text,
        ...(e.fields || []).flatMap((f) => [f.name, f.value]),
      ]
        .filter(Boolean)
        .join(' '),
    )
    .join(' ');
  const otherMedia =
    [...(message.attachments?.values?.() || [])].some((a) => a.contentType !== 'image/gif') ||
    (message.embeds || []).some(
      (e) =>
        e.type !== 'gifv' && !/tenor\.com|giphy\.com/.test(e.url || '') && (e.image || e.thumbnail),
    );
  const gifOnly =
    !otherMedia &&
    !content &&
    !embeds &&
    ((message.embeds || []).some(
      (e) => e.type === 'gifv' || /tenor\.com|giphy\.com/.test(e.url || ''),
    ) ||
      (message.content || '').match(gifLink) ||
      (message.attachments?.size &&
        [...message.attachments.values()].every((a) => a.contentType === 'image/gif')));
  return {
    content,
    embedText: embeds,
    scan: [content, embeds].filter(Boolean).join(' '),
    gifOnly: Boolean(gifOnly),
  };
}
export class FloodGuard {
  constructor() {
    this.users = new Map();
  }
  check(id, content, now = Date.now(), config = {}) {
    const list = (this.users.get(id) || []).filter(
      (e) => now - e.time < (config.spamSeconds || 8) * 1000,
    );
    list.push({ time: now, text: normalize(content) });
    this.users.set(id, list);
    if (this.users.size > 10000)
      for (const [key, value] of this.users)
        if (now - value.at(-1).time > 60000) this.users.delete(key);
    if (
      list.length >= (config.spamCount || 6) ||
      (normalize(content) &&
        list.filter((e) => e.text === normalize(content)).length >= (config.spamRepeat || 3))
    )
      return 'spam or repeated messages';
    return null;
  }
}
export function adReason(content, allowed = []) {
  const domains = allowed.map((x) => x.toLowerCase().trim()).filter(Boolean);
  // A conservative rule: Discord invite ads and off-site links, with an explicit allowlist.
  const urls =
    content.match(
      /(?:https?:\/\/|www\.)[^\s<>]+|(?:discord\.gg|discord(?:app)?\.com\/invite)\/[^\s<>]+/gi,
    ) || [];
  for (const raw of urls) {
    try {
      const host = new URL(/^https?:/i.test(raw) ? raw : 'https://' + raw).hostname.toLowerCase();
      if (!domains.some((d) => host === d || host.endsWith('.' + d)))
        return 'an unapproved link or advertisement';
    } catch {
      return 'an invalid advertising link';
    }
  }
  return null;
}
export function blockedReason(content, words) {
  const normalized = moderationText(content);
  for (const word of words) {
    const letters = moderationText(word).replace(/[^a-z]/g, '');
    if (!letters) continue;
    const pattern = letters
      .split('')
      .map((c) => c + '+')
      .join('[^a-z0-9]*');
    if (new RegExp('(?:^|[^a-z0-9])' + pattern + '(?=$|[^a-z0-9])', 'i').test(normalized))
      return 'prohibited language';
    for (const token of normalized.split(/\s+/)) {
      if (!/[*#_?]/.test(token) || token.replace(/[^a-z]/g, '').length < 2) continue;
      const censored = token.replace(/[^a-z*#_?]/g, '').replace(/[*#_?]+/g, '.{1,5}');
      if (censored && new RegExp('^' + censored + '$').test(letters)) return 'prohibited language';
    }
  }
  // Catch partially censored severe slurs as well as full and leetspeak forms.
  if (
    /(?:^|[^a-z0-9])n+[^a-z0-9]*i+[^a-z0-9]*g+[^a-z0-9]*g+(?:(?:[^a-z0-9]*[ae]r?)|[*#_?]+)(?=$|[^a-z0-9])/i.test(
      normalized,
    )
  )
    return 'prohibited language';
  return null;
}
export const defaultBlockedWords = [
  'fuck',
  'shit',
  'cunt',
  'bitch',
  'motherfucker',
  'bullshit',
  'asshole',
  'dickhead',
  'cock',
  'pussy',
  'porn',
  'hentai',
  'nigger',
  'nigga',
  'faggot',
  'retard',
  'kys',
  'kill yourself',
  'rape',
  'rapist',
  'raping',
  'molest',
  'molester',
  'pedo',
  'paedophile',
  'pedophile',
  'child porn',
  'cp trading',
  'dox',
  'doxx',
  'doxxing',
  'doxing',
  'swat',
  'swatting',
  'sieg heil',
  'heil hitler',
  'white power',
  'gas the jews',
  'tranny',
  'coon',
  'chink',
  'gook',
  'spic',
  'wetback',
  'beaner',
  'paki',
  'kike',
  'dyke',
  'fag',
  'faggots',
  'slut',
  'whore',
  'bastard',
  'dumbass',
  'jackass',
  'dipshit',
  'shithead',
  'fuckface',
  'cum',
  'semen',
  'blowjob',
  'handjob',
  'deepthroat',
  'gangbang',
  'incest',
  'bestiality',
  'zoophilia',
  'nudes',
  'nude trading',
  'suicide baiting',
  'scheiße',
  'scheisse',
  'kacke',
  'fick dich',
  'ficken',
  'verpiss dich',
  'hurensohn',
  'hurentochter',
  'arschloch',
  'fotze',
  'wichser',
  'schlampe',
  'schwuchtel',
  'halt die fresse',
  'halt dein maul',
  'vergewaltigen',
  'kinderschänder',
  'umbringen',
  'ich bring dich um',
  'doxxen',
];
export function moderationText(s) {
  const map = {
    0: 'o',
    1: 'i',
    3: 'e',
    4: 'a',
    5: 's',
    7: 't',
    8: 'b',
    9: 'g',
    '@': 'a',
    $: 's',
    '!': 'i',
    '|': 'i',
    '+': 't',
    а: 'a',
    е: 'e',
    і: 'i',
    о: 'o',
    с: 'c',
    р: 'p',
    х: 'x',
    у: 'y',
    ѕ: 's',
    ӏ: 'i',
  };
  return s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[\u200B-\u200F\u2060\uFEFF\p{M}]/gu, '')
    .replace(/[01345789@$!|+аеіосрхуѕӏ]/g, (c) => map[c] || c);
}
export function moderationLanguage(content, reason = '') {
  const words = new Set(
    moderationText(`${content || ''} ${reason || ''}`)
      .replace(/ß/g, 'ss')
      .split(/[^a-z]+/)
      .filter(Boolean),
  );
  const germanHints = [
    'ich',
    'du',
    'wir',
    'ihr',
    'nicht',
    'bitte',
    'danke',
    'warum',
    'was',
    'wie',
    'ist',
    'sind',
    'bin',
    'bist',
    'habe',
    'hast',
    'wurde',
    'werden',
    'kann',
    'kannst',
    'und',
    'aber',
    'oder',
    'fur',
    'mit',
    'euch',
    'mir',
    'mich',
    'mein',
    'meine',
    'dein',
    'deine',
    'einen',
    'einem',
    'hier',
    'dort',
    'mochte',
    'mochtest',
    'hilfe',
  ];
  const hits = germanHints.filter((word) => words.has(word)).length;
  const germanWords = [
    'scheiße',
    'scheisse',
    'kacke',
    'fick dich',
    'ficken',
    'verpiss dich',
    'hurensohn',
    'hurentochter',
    'arschloch',
    'fotze',
    'wichser',
    'schlampe',
    'schwuchtel',
    'halt die fresse',
    'halt dein maul',
    'vergewaltigen',
    'kinderschänder',
    'umbringen',
    'ich bring dich um',
    'doxxen',
  ];
  return hits >= 2 || blockedReason(content || '', germanWords) ? 'de' : 'en';
}
export function sanction(count) {
  return count < 3
    ? { days: 0, label: 'Warning' }
    : count === 3
      ? { days: 1, label: '1-day mute' }
      : count === 4
        ? { days: 3, label: '3-day mute' }
        : count === 5
          ? { days: 7, label: '7-day mute' }
          : { days: 28, label: 'Permanent mute (until staff removes it)', permanent: true };
}
export function recordOffence(db, id, now = Date.now()) {
  const previous = db.prepare('SELECT * FROM offences WHERE user=?').get(id);
  // One offence per 30-second incident; delete every spam message, but avoid instant escalation.
  if (previous && now - previous.last < 30000) return null;
  db.prepare(
    'INSERT INTO offences(user,count,last) VALUES(?,1,?) ON CONFLICT(user) DO UPDATE SET count=count+1,last=excluded.last',
  ).run(id, now);
  const row = db.prepare('SELECT * FROM offences WHERE user=?').get(id);
  const result = sanction(row.count);
  if (result.permanent) db.prepare('UPDATE offences SET permanent=1 WHERE user=?').run(id);
  return { ...result, count: row.count };
}
export function safeText(text) {
  return text.replace(/@/g, '@\u200b').slice(0, 1850);
}
export function shouldNotifyTicketReply(row, { authorId, bot = false, isStaff = false }) {
  return Boolean(row && row.state === 'open' && row.owner !== authorId && !bot && isStaff);
}
export function ticketOverwrites(overwrites, owner) {
  return [
    ...overwrites.map((o) => ({
      id: o.id,
      type: o.type,
      allow: o.allow.bitfield,
      deny: o.deny.bitfield,
    })),
    {
      id: owner,
      type: 1,
      allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles'],
    },
  ];
}
