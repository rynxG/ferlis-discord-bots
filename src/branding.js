import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Keep legacy internal role names stable: they select tokens, intents and handlers.
// Public names can change without changing those routing keys.
export const displayBotName = (role) =>
  role === 'Jerry' ? 'Jerry' : role === 'Feris Utility' ? 'Chrisp Utility' : 'Chrisp AI';

export async function applyBranding(client, role, guild, db, invite) {
  const displayName = displayBotName(role);
  const save = (key, value) =>
    db
      .prepare(
        'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, value);
  const changed = (key, value) =>
    db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value !== value;
  const member = await guild.members.fetchMe();
  if (member.nickname !== displayName)
    await member.setNickname(displayName, 'Owner requested Chrisp bot branding');
  if (client.user.username !== displayName) await client.user.setUsername(displayName);

  const images =
    role === 'Jerry'
      ? [
          ['avatar', 'jerry.png'],
          ['banner', 'felris-banner.png'],
        ]
      : [
          ['avatar', 'chirsp-avatar.png'],
          ['banner', 'chirsp-banner.png'],
        ];
  for (const [kind, file] of images) {
    const data = await readFile(new URL('../assets/' + file, import.meta.url));
    const hash = createHash('sha256').update(data).digest('hex');
    const key = 'brand:' + client.user.id + ':' + kind;
    if (!changed(key, hash)) continue;
    if (kind === 'avatar') await client.user.setAvatar(data);
    else await client.user.setBanner(data);
    save(key, hash);
  }

  const purpose =
    role === 'Jerry'
      ? 'Jerry moderation.'
      : role === 'Feris Utility'
        ? 'Chrisp Utility tickets and voice rooms.'
        : 'Chrisp AI ticket support.';
  const description = purpose + ' Join our Discord: ' + invite;
  const key = 'brand:' + client.user.id + ':bio';
  if (changed(key, description)) {
    await client.application.edit({ description });
    save(key, description);
  }
  console.log(displayName + ' branding ready (' + role + ').');
}
