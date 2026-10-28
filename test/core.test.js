import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openStore,
  FloodGuard,
  adReason,
  blockedReason,
  relevantKnowledge,
  safeText,
  defaultBlockedWords,
  sanction,
  recordOffence,
  shouldNotifyTicketReply,
  ticketOverwrites,
} from '../src/core.js';
import { supportAnswer } from '../src/ai.js';
import { spawnSync } from 'node:child_process';

test('domain allowlist permits real subdomains but rejects lookalikes and invite advertisements', () => {
  assert.equal(adReason('https://store.example.com/item', ['example.com']), null);
  assert.ok(adReason('https://example.com.attacker.net', ['example.com']));
  assert.ok(adReason('join discord.gg/example', []));
  assert.equal(adReason('ordinary message', []), null);
});
test('spam detector separates users and expires its time window', () => {
  const guard = new FloodGuard();
  assert.equal(guard.check('a', 'same', 0), null);
  assert.equal(guard.check('a', 'same', 100), null);
  assert.ok(guard.check('a', 'same', 200));
  assert.equal(guard.check('b', 'same', 200), null);
  assert.equal(guard.check('a', 'same', 9000), null);
});
test('word rules match complete normalized phrases, not substrings', () => {
  assert.ok(blockedReason('BUY—NOW', ['buy now']));
  assert.equal(blockedReason('classic', ['ass']), null);
});
test('knowledge persists and one-open-ticket constraint prevents duplicates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'farex-test-'));
  let db;
  try {
    db = openStore(dir);
    db.prepare('INSERT INTO knowledge(question,answer,author) VALUES(?,?,?)').run(
      'Where are refunds?',
      'Contact staff.',
      'admin',
    );
    db.prepare('INSERT INTO tickets(channel,owner,kind) VALUES(?,?,?)').run('c1', 'u1', 'support');
    assert.throws(() =>
      db
        .prepare('INSERT INTO tickets(channel,owner,kind) VALUES(?,?,?)')
        .run('c2', 'u1', 'purchase'),
    );
    db.prepare("UPDATE tickets SET state='closed' WHERE channel='c1'").run();
    db.prepare('INSERT INTO tickets(channel,owner,kind) VALUES(?,?,?)').run('c2', 'u1', 'purchase');
    db.close();
    db = openStore(dir);
    assert.equal(db.prepare('SELECT answer FROM knowledge').get().answer, 'Contact staff.');
    assert.equal(db.prepare("SELECT channel FROM tickets WHERE state='open'").get().channel, 'c2');
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('approved answers work without cloud AI and unknown topics do not invent policies', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'farex-ai-test-'));
  const db = openStore(dir);
  try {
    db.prepare('INSERT INTO knowledge(question,answer,author) VALUES(?,?,?)').run(
      'Where is the store?',
      'Use the shop link in announcements.',
      'admin',
    );
    assert.match(
      await supportAnswer(db, 'where is the store', { AI_PROVIDER: 'off' }),
      /shop link/,
    );
    assert.match(
      await supportAnswer(db, 'refund policy', { AI_PROVIDER: 'off' }),
      /can’t approve (?:a refund|refunds) or promise an outcome/,
    );
    assert.match(
      await supportAnswer(db, 'purple spaceship regulations', { AI_PROVIDER: 'off' }),
      /give me a little more detail/,
    );
    assert.equal(relevantKnowledge(db.prepare('SELECT * FROM knowledge').all(), 'store')[0].id, 1);
    assert.ok(!safeText('@everyone').includes('@everyone'));
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('all three bots and their slash commands construct without Discord credentials', () => {
  const dir = mkdtempSync(join(tmpdir(), 'farex-schema-test-'));
  try {
    const run = spawnSync(process.execPath, ['src/main.js', '--validate'], {
      encoding: 'utf8',
      env: { ...process.env, DATA_DIR: dir },
    });
    assert.equal(run.status, 0, run.stderr);
    const defs = JSON.parse(run.stdout);
    assert.deepEqual(
      defs.map((d) => d.name),
      ['Jerry', 'Chrisp Utility', 'Chrisp AI'],
    );
    assert.ok(defs[2].commands.includes('teach'));
    assert.ok(defs[1].commands.includes('ticket-setup'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('disguised profanity includes leetspeak, separated letters, zero-width and masks', () => {
  for (const text of [
    'N1gg##',
    'n.i.g.g.e.r',
    'f u c k',
    'f**k',
    'sh1t',
    'fu\u200bck',
    'b!tch',
    'nіgger',
  ])
    assert.ok(blockedReason(text, defaultBlockedWords), text);
  for (const text of ['classic', 'assignment', 'cocktail', 'good luck', 'hello world'])
    assert.equal(blockedReason(text, defaultBlockedWords), null, text);
});
test('persistent offences escalate after two warnings and deduplicate spam incidents', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((x) => sanction(x).days),
    [0, 0, 1, 3, 7, 28],
  );
  const dir = mkdtempSync(join(tmpdir(), 'farex-offence-test-'));
  let db = openStore(dir);
  try {
    assert.equal(recordOffence(db, 'user', 100000).count, 1);
    assert.equal(recordOffence(db, 'user', 100001), null);
    for (let n = 2; n <= 6; n++)
      assert.equal(recordOffence(db, 'user', 100000 + (n - 1) * 31000).count, n);
    db.close();
    db = openStore(dir);
    assert.equal(
      db.prepare('SELECT permanent,count FROM offences WHERE user=?').get('user').permanent,
      1,
    );
    assert.equal(db.prepare('SELECT count FROM offences WHERE user=?').get('user').count, 6);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('staff reply DMs only notify the owner of an open ticket about a human staff reply', () => {
  const row = { owner: 'member', state: 'open' };
  assert.equal(shouldNotifyTicketReply(row, { authorId: 'staff', isStaff: true }), true);
  assert.equal(shouldNotifyTicketReply(row, { authorId: 'member', isStaff: true }), false);
  assert.equal(shouldNotifyTicketReply(row, { authorId: 'other', isStaff: false }), false);
  assert.equal(shouldNotifyTicketReply(row, { authorId: 'bot', isStaff: true, bot: true }), false);
  assert.equal(
    shouldNotifyTicketReply({ ...row, state: 'closed' }, { authorId: 'staff', isStaff: true }),
    false,
  );
});

test('ticket permissions preserve types even when bot users are uncached', async () => {
  const { PermissionOverwrites, PermissionsBitField } = await import('discord.js');
  const rows = ticketOverwrites(
    [
      {
        id: '123',
        type: 1,
        allow: new PermissionsBitField(1024n),
        deny: new PermissionsBitField(0n),
      },
    ],
    '456',
  );
  const guild = { roles: { resolve: () => null }, client: { users: { resolve: () => null } } };
  assert.equal(PermissionOverwrites.resolve(rows[0], guild).type, 1);
  assert.equal(PermissionOverwrites.resolve(rows[1], guild).type, 1);
});
