import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { openStore, FloodGuard } from '../src/core.js';
import {
  operationsSchema,
  remember,
  contextualQuestion,
  RaidShield,
  defaults,
  setSetting,
  setting,
} from '../src/operations-store.js';
import { createBackup, validateBackup, maintain, rotateBackups } from '../src/maintenance.js';
import { supportAnswer } from '../src/ai.js';
import { reversalAllowed } from '../src/moderation-review.js';
import { dashboardPayload } from '../src/operations.js';
import { restartDelay } from '../src/supervisor.js';
import { installOperations } from '../src/operations.js';
import { EventEmitter } from 'node:events';
import { Events, PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
function store() {
  const dir = mkdtempSync(join(tmpdir(), 'ferlis-ops-')),
    db = openStore(dir);
  operationsSchema(db);
  db.exec(
    'CREATE TABLE media_submissions(id TEXT,user TEXT,created INTEGER);CREATE TABLE media_drafts(user TEXT,step INTEGER,answers TEXT,updated INTEGER)',
  );
  return {
    dir,
    db,
    close() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test('support memory stays within its ticket, owner and expiry, and preserves product follow-ups', async () => {
  const s = store();
  try {
    remember(s.db, 'ticket', 'owner', 'I need accounts', 'Choose Accounts', 'accounts', 1000);
    const current = contextualQuestion(s.db, 'ticket', 'owner', 'how much?', 'support', 2000);
    assert.equal(current.topic, 'accounts');
    assert.match(current.question, /accounts/);
    assert.match(await supportAnswer(s.db, current.question, { AI_PROVIDER: 'off' }), /20M/);
    assert.equal(
      contextualQuestion(s.db, 'other', 'owner', 'how much?', 'support', 2000).topic,
      'support',
    );
    assert.equal(
      contextualQuestion(s.db, 'ticket', 'someone-else', 'how much?', 'support', 2000).topic,
      'support',
    );
    assert.equal(
      contextualQuestion(s.db, 'ticket', 'owner', 'how much?', 'support', 2000000).topic,
      'support',
    );
    assert.equal(
      contextualQuestion(s.db, 'ticket', 'owner', 'what does the client cost?', 'support', 2000)
        .topic,
      'client',
    );
  } finally {
    s.close();
  }
});
test('staff correction is ticket-scoped and does not silently publish global knowledge', () => {
  const s = store();
  try {
    s.db
      .prepare(
        'INSERT INTO support_corrections(channel,question,answer,author,created) VALUES(?,?,?,?,?)',
      )
      .run('ticket', 'Where is my order?', 'A staff-reviewed answer', 'staff', 1000);
    assert.equal(
      contextualQuestion(s.db, 'ticket', 'owner', 'Where is my order?').corrected,
      'A staff-reviewed answer',
    );
    assert.equal(
      contextualQuestion(s.db, 'other', 'owner', 'Where is my order?').corrected,
      undefined,
    );
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM knowledge').get().n, 0);
  } finally {
    s.close();
  }
});
test('old cases cannot reverse newer punishments or a different active timeout', () => {
  const row = { id: 'old', action: 'Automod mute' };
  assert.equal(reversalAllowed(row, { id: 'new' }, { expires: 50000 }, 50000), false);
  assert.equal(reversalAllowed(row, row, { expires: 50000 }, 90000), false);
  assert.equal(reversalAllowed(row, row, { expires: 50000 }, 50000), true);
  assert.equal(reversalAllowed(row, row, null, 50000), false);
  assert.equal(reversalAllowed({ id: 'ban', action: 'Ban' }, { id: 'ban' }, null, null), true);
  assert.equal(
    reversalAllowed({ id: 'warn', action: 'Warning' }, { id: 'warn' }, null, null),
    false,
  );
});
test('raid windows expire and coordinated-link alerts require distinct accounts', () => {
  const r = new RaidShield(),
    config = { ...defaults, joinCount: 3, joinSeconds: 10, linkCount: 2, linkSeconds: 5 };
  assert.equal(r.join(config, 1000), false);
  assert.equal(r.join(config, 2000), false);
  assert.equal(r.join(config, 3000), true);
  assert.equal(r.join(config, 14000), false);
  assert.equal(r.link('https://example.com/scam?a=1', 'same', config, 1000), false);
  assert.equal(r.link('https://example.com/scam?a=2', 'same', config, 1100), false);
  assert.equal(r.link('https://example.com/scam?a=3', 'other', config, 1200), true);
  assert.equal(r.link('https://example.com/scam', 'new', config, 10000), false);
});
test('spam thresholds are adjustable without affecting other users', () => {
  const flood = new FloodGuard(),
    cfg = { spamCount: 4, spamRepeat: 3, spamSeconds: 5 };
  for (let n = 0; n < 3; n++) assert.equal(flood.check('a', 'different ' + n, n * 1000, cfg), null);
  assert.match(flood.check('a', 'fourth', 3500, cfg), /spam/);
  assert.equal(flood.check('b', 'fourth', 3500, cfg), null);
  assert.equal(flood.check('a', 'later', 10000, cfg), null);
});
test('database backups contain recoverable SQLite data and rotation keeps the latest copy', async () => {
  const s = store();
  try {
    s.db
      .prepare('INSERT INTO knowledge(question,answer,author) VALUES(?,?,?)')
      .run('Saved fact', 'Preserved answer', 'admin');
    const path = await createBackup(s.db, s.dir, 1000000000);
    assert.equal(await validateBackup(path), true);
    assert.ok(gunzipSync(readFileSync(path)).includes(Buffer.from('Preserved answer')));
    await createBackup(s.db, s.dir, 2000000000);
    await rotateBackups(s.db, s.dir, 2000000001);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM backup_runs').get().n, 1);
  } finally {
    s.close();
  }
});
test('retention keeps records by default; preview never deletes and enabled cleanup removes only expired records', async () => {
  const s = store();
  try {
    s.db
      .prepare('INSERT INTO moderation_cases VALUES(?,?,?,?,?,?)')
      .run('old', 'Mute', 'member', 'staff', 'reason', new Date(1000).toISOString());
    s.db
      .prepare('INSERT INTO moderation_cases VALUES(?,?,?,?,?,?)')
      .run('new', 'Mute', 'member', 'staff', 'reason', new Date(200000000).toISOString());
    const client = { channels: { fetch: async () => assert.fail('No tracked messages to fetch') } };
    await maintain(s.db, client, s.dir, { dryRun: false, now: 200000001 });
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM moderation_cases').get().n, 2);
    setSetting(s.db, 'moderationDays', 1);
    const preview = await maintain(s.db, client, s.dir, { now: 200000001 });
    assert.equal(preview.moderation, 1);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM moderation_cases').get().n, 2);
    await maintain(s.db, client, s.dir, { dryRun: false, now: 200000001 });
    assert.equal(s.db.prepare('SELECT id FROM moderation_cases').get().id, 'new');
    assert.equal(setting(s.db, 'transcriptDays'), 0);
  } finally {
    s.close();
  }
});
test('dashboard components fit Discord limits and supervisor retries use bounded backoff', () => {
  const s = store();
  try {
    const payload = dashboardPayload(s.db, [['Jerry', { isReady: () => true }]]);
    assert.ok(payload.components.length <= 5);
    for (const r of payload.components) assert.ok(r.toJSON().components.length <= 5);
    assert.ok(JSON.stringify(payload.embeds[0].toJSON()).includes('Jerry'));
    assert.equal(restartDelay(0), 5000);
    assert.equal(restartDelay(100), 60000);
  } finally {
    s.close();
  }
});
test('dashboard refuses members and staff cannot change admin privacy settings', async () => {
  const s = store();
  try {
    const utility = new EventEmitter(),
      jerry = new EventEmitter(),
      support = new EventEmitter();
    installOperations(utility, jerry, support, s.db, { GUILD_ID: 'server' }, async () => {});
    const handler = utility.listeners(Events.InteractionCreate)[0];
    for (const [permissions, customId, expected] of [
      [[], 'desk:tickets', /Staff access/],
      [[P.ManageMessages], 'desk:privacy', /Administrator/],
    ]) {
      let response;
      const member = {
        permissions: new PermissionsBitField(permissions),
        roles: { cache: new Map() },
      };
      await handler({
        guildId: 'server',
        customId,
        user: { id: 'member' },
        guild: { members: { fetch: async () => member } },
        memberPermissions: member.permissions,
        reply: async (p) => {
          response = p;
        },
      });
      assert.match(response.content, expected);
      assert.equal(s.db.prepare('SELECT count(*) AS n FROM settings').get().n, 0);
    }
  } finally {
    s.close();
  }
});
test('only the ticket owner can rate a resolved ticket, and rating is accepted once', async () => {
  const s = store();
  try {
    s.db
      .prepare('INSERT INTO tickets(channel,owner,kind,state) VALUES(?,?,?,?)')
      .run('ticket', 'owner', 'support', 'closed');
    s.db.prepare('INSERT INTO ticket_work(channel,resolved) VALUES(?,?)').run('ticket', 1000);
    const utility = new EventEmitter(),
      jerry = new EventEmitter(),
      support = new EventEmitter();
    installOperations(utility, jerry, support, s.db, { GUILD_ID: 'server' }, async () => {});
    const handler = utility.listeners(Events.InteractionCreate)[0];
    let response;
    const interaction = (id) => ({
      customId: 'rating:ticket:owner:5',
      user: { id },
      reply: async (p) => {
        response = p;
      },
    });
    await handler(interaction('other'));
    assert.match(response.content, /Only the ticket owner/);
    await handler(interaction('owner'));
    assert.match(response.content, /5\/5/);
    await handler(interaction('owner'));
    assert.match(response.content, /already been rated/);
    assert.equal(s.db.prepare('SELECT rating FROM ticket_work').get().rating, 5);
  } finally {
    s.close();
  }
});
