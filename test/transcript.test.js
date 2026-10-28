import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transcriptHTML, transcriptAvatars } from '../src/transcript.js';

test('rich transcripts preserve embeds, markdown, avatars and safe links without executable HTML', () => {
  const html = transcriptHTML({ name: 'support', id: '1', guildId: '2' }, { owner: '3' }, [
    {
      id: '4',
      createdTimestamp: 0,
      author: {
        id: '3',
        username: 'Alice',
        bot: true,
        displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/a.png',
      },
      content: '**Hi** <script>alert(1)</script> [bad](javascript:alert) <@3>',
      embeds: [
        {
          color: 0x20b9df,
          title: 'Ticket info',
          description: '__Notice__',
          fields: [{ name: 'Subject', value: '**Support**', inline: true }],
          footer: { text: 'Team' },
          image: { url: 'https://cdn.discordapp.com/pic.png' },
        },
      ],
      components: [{ components: [{ label: 'Delete Request', style: 4 }] }],
    },
  ]);
  assert.match(html, /class="embed"/);
  assert.match(html, /border-left-color:#20b9df/);
  assert.match(html, /class="avatar"/);
  assert.match(html, /<strong>Hi<\/strong>/);
  assert.match(html, /<u>Notice<\/u>/);
  assert.match(html, /@Alice/);
  assert.match(html, /Delete Request/);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('href="javascript:'));
  assert.match(html, /Content-Security-Policy/);
});
test('profile pictures are embedded once per author and unsafe avatar URLs are not fetched', async () => {
  let calls = 0;
  const author = { id: '1', displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/a.png' };
  const response = await transcriptAvatars(
    [
      { author },
      { author },
      { author: { id: '2', displayAvatarURL: () => 'https://attacker.example/a.png' } },
    ],
    async () => {
      calls++;
      return {
        ok: true,
        headers: { get: (k) => (k === 'content-type' ? 'image/png' : null) },
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      };
    },
  );
  assert.equal(calls, 1);
  assert.equal(response.get('1'), 'data:image/png;base64,AQID');
  assert.equal(response.has('2'), false);
});
