import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, moderationInput, blockedReason, defaultBlockedWords } from '../src/core.js';
import { supportAnswer } from '../src/ai.js';
import { priceEmbed, transcriptHTML, archiveTicket } from '../src/features.js';

test('support answers only the most relevant question without question headings or knowledge IDs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ferlis-answer-')),
    db = openStore(dir);
  try {
    const put = db.prepare('INSERT INTO knowledge(question,answer,author) VALUES(?,?,?)');
    put.run('What is the client price?', 'The client costs €7.99.', 'admin');
    put.run('What is the token price?', 'Tokens cost 20M.', 'admin');
    assert.equal(
      await supportAnswer(db, 'What is the token price?', { AI_PROVIDER: 'off' }),
      'Tokens cost 20M.',
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('GIF messages bypass warnings but text added beside a GIF remains moderated', () => {
  const gif = {
    content: 'https://tenor.com/view/hello-123',
    embeds: [{ type: 'gifv', url: 'https://tenor.com/view/hello-123', title: 'fuck' }],
  };
  assert.equal(moderationInput(gif).gifOnly, true);
  const mixed = moderationInput({ ...gif, content: gif.content + ' N1gg##' });
  assert.equal(mixed.gifOnly, false);
  assert.ok(blockedReason(mixed.scan, defaultBlockedWords));
  const embed = moderationInput({ content: '', embeds: [{ description: 'N1gg##' }] });
  assert.ok(blockedReason(embed.scan, defaultBlockedWords));
});
test('Accounts pricing is separate from client pricing', () => {
  const accounts = priceEmbed('accounts').toJSON();
  assert.match(accounts.description, /24h Java Token/);
  assert.match(accounts.description, /5 Accounts/);
  assert.ok(!JSON.stringify(accounts).includes('1B'));
  assert.match(JSON.stringify(priceEmbed('client').toJSON()), /1B/);
  assert.ok(!JSON.stringify(priceEmbed('other').toJSON()).includes('7.99'));
});
test('transcript escapes HTML and retains content, embeds and attachment links', () => {
  const html = transcriptHTML({ name: '<ticket>', id: '1', guildId: '2' }, { owner: '3' }, [
    {
      author: { id: '4', username: '<img>' },
      createdTimestamp: 0,
      content: '<script>alert(1)</script>',
      embeds: [{ title: 'Pricing', fields: [{ name: 'Budget', value: '20M' }] }],
      attachments: new Map([
        ['a', { name: 'photo.png', url: 'https://cdn.discordapp.com/example' }],
      ]),
    },
  ]);
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Budget/);
  assert.match(html, /photo.png/);
});
test('transcript failure does not delete ticket and successful archive reaches staff and owner', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ferlis-transcript-'));
  const delivery = [];
  const channel = {
    name: 'test',
    id: '123',
    guildId: '2',
    messages: { fetch: async () => new Map() },
    client: {
      users: {
        fetch: async () => ({
          send: async () => {
            delivery.push('owner');
            throw Error('DM closed');
          },
        }),
      },
    },
    delete: () => assert.fail('archive function must not delete channels'),
  };
  const archive = { send: async () => delivery.push('staff') };
  try {
    await assert.rejects(
      archiveTicket(channel, { owner: 'u' }, archive, null, dir),
      /DMs are closed/,
    );
    assert.deepEqual(delivery, ['staff', 'owner']);
    delivery.length = 0;
    channel.client.users.fetch = async () => ({ send: async () => delivery.push('owner') });
    await archiveTicket(channel, { owner: 'u' }, archive, null, dir);
    assert.deepEqual(delivery, ['staff', 'owner']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
