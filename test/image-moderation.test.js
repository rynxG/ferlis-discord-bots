import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, moderationInput } from '../src/core.js';
import { moderationImages, imageModeration } from '../src/image-moderation.js';

test('image checks ignore GIFs but still check other images posted beside them', () => {
  const message = {
    content: '',
    embeds: [
      {
        type: 'gifv',
        url: 'https://tenor.com/view/abc',
        image: { url: 'https://media.discordapp.net/hello.gif' },
      },
      { image: { proxyURL: 'https://images-ext-1.discordapp.net/external/a.png' } },
    ],
    attachments: new Map([
      ['a', { contentType: 'image/png', url: 'https://cdn.discordapp.com/attachments/a.png' }],
    ]),
  };
  assert.equal(moderationImages(message).length, 2);
  assert.equal(moderationInput(message).gifOnly, false);
  assert.deepEqual(moderationImages({ embeds: [message.embeds[0]] }), []);
});
test('OpenAI moderation sends only image URLs, acts on explicit images, and respects missing key and quota', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'feris-image-')),
    db = openStore(dir);
  let calls = 0;
  const message = {
    content: 'private message text',
    author: { id: 'private-id' },
    attachments: new Map([
      ['a', { contentType: 'image/png', url: 'https://cdn.discordapp.com/attachments/a.png' }],
    ]),
  };
  const env = {
    MODERATION_PROVIDER: 'openai',
    OPENAI_MODERATION_KEY: 'test',
    MODERATION_DAILY_LIMIT: '1',
  };
  const request = async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/moderations');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'omni-moderation-latest');
    assert.ok(!options.body.includes('private'));
    return {
      ok: true,
      json: async () => ({
        results: [{ flagged: true, categories: { sexual: true, violence: true } }],
      }),
    };
  };
  try {
    assert.equal(await imageModeration(message, db, {}, request), null);
    assert.equal(calls, 0);
    assert.match((await imageModeration(message, db, env, request)).reason, /sexual/);
    await assert.rejects(imageModeration(message, db, env, request), /daily limit/);
    assert.equal(calls, 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('ordinary game violence is not an automatic image mute and suspected child-abuse metadata is not transmitted', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'feris-image-safe-')),
    db = openStore(dir);
  const env = { MODERATION_PROVIDER: 'openai', OPENAI_MODERATION_KEY: 'test' };
  const message = {
    attachments: new Map([
      [
        'a',
        {
          name: 'game.png',
          contentType: 'image/png',
          url: 'https://cdn.discordapp.com/attachments/a.png',
        },
      ],
    ]),
  };
  try {
    assert.equal(
      await imageModeration(message, db, env, async () => ({
        ok: true,
        json: async () => ({ results: [{ flagged: true, categories: { violence: true } }] }),
      })),
      null,
    );
    const result = await imageModeration({ ...message, content: 'csam' }, db, env, () =>
      assert.fail('must not transmit suspected abuse images'),
    );
    assert.equal(result.reviewOnly, true);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
