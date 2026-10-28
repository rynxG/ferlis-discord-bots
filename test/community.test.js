import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits as P, PermissionsBitField } from 'discord.js';
import {
  canControlVoice,
  voiceTargetAllowed,
  voicePanel,
  mediaQuestions,
} from '../src/community.js';
import { staffMayTarget, modCommands, logCase } from '../src/staff-moderation.js';
import { commonAnswer } from '../src/common-answers.js';
import { openStore } from '../src/core.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearVoiceEffects } from '../src/community.js';
test('voice mute/deafen cleanup survives disconnect and clears on rejoin', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'voice-cleanup-')),
    db = openStore(dir);
  db.exec(
    'CREATE TABLE voice_effects(user TEXT PRIMARY KEY,channel TEXT,mute INTEGER,deaf INTEGER)',
  );
  try {
    db.prepare('INSERT INTO voice_effects VALUES(?,?,?,?)').run('user', 'old-room', 1, 1);
    await clearVoiceEffects(db, { voice: { channelId: null } }, { user: 'user', mute: 1, deaf: 1 });
    assert.equal(db.prepare('SELECT channel FROM voice_effects').get().channel, '');
    const changes = [];
    await clearVoiceEffects(
      db,
      {
        voice: {
          channelId: 'new-room',
          setMute: async (value) => changes.push(['mute', value]),
          setDeaf: async (value) => changes.push(['deaf', value]),
        },
      },
      { user: 'user', mute: 1, deaf: 1 },
    );
    assert.deepEqual(changes, [
      ['mute', false],
      ['deaf', false],
    ]);
    assert.equal(db.prepare('SELECT count(*) AS n FROM voice_effects').get().n, 0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('voice ownership never authorizes another room or an owner who left', () => {
  const room = { owner: 'a', channel: 'room' };
  assert.equal(canControlVoice(room, 'a', 'room'), true);
  assert.equal(canControlVoice(room, 'b', 'room'), false);
  assert.equal(canControlVoice(room, 'a', 'other'), false);
  assert.equal(canControlVoice(null, 'a', 'room'), false);
});
test('voice target guards protect staff, bots and members in another room', () => {
  const owner = { id: 'owner' };
  const member = {
    id: 'user',
    user: { bot: false },
    guild: { ownerId: 'guild-owner' },
    voice: { channelId: 'room' },
    permissions: new PermissionsBitField(),
  };
  assert.equal(voiceTargetAllowed(owner, member, 'room'), true);
  for (const patch of [
    { voice: { channelId: 'other' } },
    { user: { bot: true } },
    { id: 'owner' },
    { id: 'guild-owner' },
    { permissions: new PermissionsBitField(P.ModerateMembers) },
  ])
    assert.equal(voiceTargetAllowed(owner, { ...member, ...patch }, 'room'), false);
});
test('voice panel fits Discord component limits and contains requested controls', () => {
  const panel = voicePanel();
  assert.ok(panel.components.length <= 5);
  const ids = panel.components.flatMap((r) => r.toJSON().components.map((c) => c.custom_id));
  for (const id of [
    'kick',
    'mute',
    'unmute',
    'deafen',
    'undeafen',
    'member-id',
    'transfer',
    'trust',
    'untrust',
    'save',
  ])
    assert.ok(ids.includes('voice:' + id));
  panel.embeds[0].toJSON();
});
test('staff commands enforce native permissions and target hierarchy', () => {
  for (const c of modCommands) {
    const data = c.toJSON();
    assert.ok(data.default_member_permissions);
    assert.equal(data.dm_permission, false);
  }
  const g = { ownerId: 'root' };
  const target = { id: 'target', guild: g, user: { bot: false }, roles: { highest: {} } };
  assert.equal(
    staffMayTarget({ id: 'mod', roles: { highest: { comparePositionTo: () => -1 } } }, target),
    false,
  );
  assert.equal(staffMayTarget({ id: 'root' }, target), true);
});
test('punishment case IDs are unique and include user/date/reason in embeds', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'feris-case-'));
  const db = openStore(dir);
  const payloads = [];
  const client = {
    user: { id: 'bot' },
    channels: {
      fetch: async () => ({ isTextBased: () => true, send: async (p) => payloads.push(p) }),
    },
  };
  try {
    db.prepare('INSERT INTO settings VALUES(?,?)').run('channel:automod-mutes', 'log');
    const ids = [];
    for (let n = 0; n < 2; n++)
      ids.push(
        await logCase(
          client,
          db,
          {},
          {
            action: 'Mute',
            user: { id: 'user' },
            actor: { id: 'mod' },
            reason: 'Spam',
            duration: '1 day',
          },
        ),
      );
    assert.notEqual(ids[0], ids[1]);
    const fields = payloads[0].embeds[0].toJSON().fields;
    for (const name of ['Case / Ban ID', 'User', 'User ID', 'Reason', 'Date'])
      assert.ok(fields.some((f) => f.name === name));
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('free common answers cover repeated staff pings without inventing product claims', () => {
  assert.match(commonAnswer('Can I ping staff too much?'), /don’t repeatedly ping staff/);
  assert.match(commonAnswer('Why is support slow to respond?'), /busy, offline, or sleeping/);
  assert.equal(commonAnswer('What is the next release date?'), null);
});
test('media application asks the six required questions', () => {
  assert.equal(mediaQuestions.length, 6);
  assert.match(mediaQuestions[0], /CHRISP\+/i);
  assert.match(mediaQuestions[1], /Timezone, Age/);
  assert.match(mediaQuestions[4], /video link/);
  assert.ok(mediaQuestions.reduce((n, q) => n + q.length + 750, 0) < 5800);
});
