import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/core.js';
import { supportAnswer } from '../src/ai.js';
import { gifFrames, frameIndexes, gifSources } from '../src/gif-frames.js';
import sharp from 'sharp';
test('free helper answers screenshot questions without confusing accounts with client downloads', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'helper-update-')),
    db = openStore(dir);
  try {
    db.prepare('INSERT INTO knowledge(question,answer,author) VALUES(?,?,?)').run(
      'How do I download the client?',
      'The client has not released.',
      'admin',
    );
    const ask = (q) => supportAnswer(db, q, { AI_PROVIDER: 'off' });
    assert.match(await ask('Hii'), /Hi!/);
    assert.match(await ask('I need help'), /Tell me what/);
    assert.match(await ask('How do I buy'), /Purchase/);
    assert.match(await ask('How do I get support'), /Request staff/);
    assert.match(await ask('How do I download the accounts'), /Accounts are separate/);
    assert.equal(await ask('How do I download the client?'), 'The client has not released.');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('GIF scanner samples across the animation, accepts trusted media only and outputs PNG frames', async () => {
  assert.deepEqual(frameIndexes(20), [0, 3, 5, 8, 11, 14, 16, 19]);
  const input = {
    attachments: new Map([
      ['gif', { contentType: 'image/gif', url: 'https://cdn.discordapp.com/attachments/test.gif' }],
    ]),
  };
  assert.equal(gifSources(input).length, 1);
  assert.equal(
    gifSources({
      attachments: new Map([
        ['x', { contentType: 'image/gif', url: 'https://localhost/test.gif' }],
      ]),
    }).length,
    0,
  );
  const gif = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#fff' } })
    .gif()
    .toBuffer();
  const frames = await gifFrames(input, async () => new Response(gif));
  assert.equal(frames.length, 1);
  assert.ok(frames[0].startsWith('data:image/png;base64,'));
});
