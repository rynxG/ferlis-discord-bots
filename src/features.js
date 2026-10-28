import { brandTitle } from './ui.js';
import { trackMessage } from './operations-store.js';
import { transcriptHTML, transcriptAvatars } from './transcript.js';
export { transcriptHTML } from './transcript.js';
import { ChannelType, PermissionFlagsBits as P, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const roleNames = ['Member', 'Ferlis+', 'Support Team', 'Development Team', 'Moderator'];
export async function ensureServerFeatures(guild, db) {
  await guild.roles.fetch();
  const hardened =
    db.prepare("SELECT value FROM settings WHERE key='security:hardened'").get()?.value === '1';
  const roles = {};
  for (const name of roleNames) {
    const displayName = name === 'Ferlis+' ? 'Chrisp+' : name;
    const savedId = db.prepare('SELECT value FROM settings WHERE key=?').get('role:' + name)?.value;
    let role =
      (savedId ? guild.roles.cache.get(savedId) : null) ||
      guild.roles.cache.find((r) => r.name === displayName || r.name === name);
    if (!role)
      role = await guild.roles.create({
        name: displayName,
        permissions: name === 'Moderator' && !hardened ? [P.ManageMessages, P.ModerateMembers] : [],
        hoist: name !== 'Member',
        reason: 'Server roles requested by owner',
      });
    roles[name] = role;
    db.prepare(
      'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    ).run('role:' + name, role.id);
  }
  let archiveId = db
    .prepare("SELECT value FROM settings WHERE key='transcript-channel'")
    .get()?.value;
  let archive = archiveId ? await guild.channels.fetch(archiveId).catch(() => null) : null;
  if (!archive)
    archive = await guild.channels.create({
      name: 'ticket-transcripts',
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: guild.id, type: 0, deny: [P.ViewChannel] },
        { id: roles['Support Team'].id, type: 0, allow: [P.ViewChannel, P.ReadMessageHistory] },
        { id: roles.Moderator.id, type: 0, allow: [P.ViewChannel, P.ReadMessageHistory] },
        {
          id: guild.client.user.id,
          type: 1,
          allow: [P.ViewChannel, P.SendMessages, P.AttachFiles, P.ReadMessageHistory],
        },
      ],
      reason: 'Private staff ticket transcript archive',
    });
  db.prepare(
    "INSERT INTO settings VALUES('transcript-channel',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(archive.id);
  await guild.channels.fetch();
  const existingBase = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.name.includes('│base-finds'),
  );
  let baseId = db.prepare("SELECT value FROM settings WHERE key='basefind-channel'").get()?.value;
  let base = existingBase || (baseId ? await guild.channels.fetch(baseId).catch(() => null) : null);
  if (!base)
    base = await guild.channels.create({
      name: 'base-finds',
      type: ChannelType.GuildText,
      permissionOverwrites: [
        {
          id: guild.id,
          type: 0,
          deny: [
            P.SendMessages,
            P.SendMessagesInThreads,
            P.CreatePublicThreads,
            P.CreatePrivateThreads,
          ],
        },
        {
          id: guild.client.user.id,
          type: 1,
          allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles],
        },
      ],
      reason: 'Base finds submitted with /basefind',
    });
  db.prepare(
    "INSERT INTO settings VALUES('basefind-channel',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(base.id);
  // A hardened server already has explicit, team-scoped channel permissions.
  // Never re-add Support access to staff tools or transferred tickets on startup.
  for (const row of hardened
    ? []
    : db
        .prepare(
          "SELECT value FROM settings WHERE key IN ('category:support','category:purchase','category:appeal','category:something-else') UNION SELECT channel AS value FROM tickets WHERE state!='deleted'",
        )
        .all()) {
    const ch = await guild.channels.fetch(row.value).catch(() => null);
    if (ch)
      for (const name of ['Support Team', 'Moderator'])
        await ch.permissionOverwrites.edit(roles[name], {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        });
  }
  return { roles, archive, base };
}
export function priceEmbed(product) {
  const embed = new EmbedBuilder()
    .setColor(0x20b9df)
    .setTitle(
      brandTitle(product === 'accounts' ? 'Account Purchase Information' : 'Purchase Information'),
    );
  if (product === 'accounts')
    return embed
      .setDescription(
        '24h Java Token - **20M**\n3d Token - **80M**\n\n**IRL money**\n24h Token - **0,25 EUR**\n3d Token - **0.70 EUR**\n\n__If buying accounts for real life currency the minimal purchase is 5 Accounts.__',
      )
      .setFooter({ text: 'CHRISP • Support Team' });
  if (product === 'other')
    return embed
      .setDescription(
        'Tell staff what you would like to buy. Staff will confirm availability and pricing.',
      )
      .setFooter({ text: 'CHRISP • Support Team' });
  return embed
    .setDescription('Thank you for your interest in **CHRISP**!')
    .addFields(
      { name: 'Donut Cash', value: 'Lifetime: **1B**\nMonthly: **400M**' },
      {
        name: 'Real money',
        value: 'Basic Edition is **free**\nCHRISP+ is **€7.99** or the local-currency equivalent.',
      },
    )
    .setFooter({ text: 'CHRISP • Support Team | Ask staff for purchase details.' });
}
export async function archiveTicket(channel, row, archive, db, dataDir) {
  const messages = [];
  let before;
  for (let page = 0; page < 1000; page++) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    messages.push(...batch.values());
    if (batch.size < 100) break;
    before = batch.last().id;
    if (page === 999) throw Error('Ticket too large to archive safely; channel kept.');
  }
  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const avatars = await transcriptAvatars(messages);
  const html = Buffer.from(transcriptHTML(channel, row, messages, avatars));
  if (html.length > 7 * 1024 * 1024)
    throw Error('Transcript exceeds safe upload size; channel kept.');
  const name = 'ticket-' + channel.id + '.html';
  await mkdir(join(dataDir, 'transcripts'), { recursive: true });
  await writeFile(join(dataDir, 'transcripts', name), html);
  const file = () => new AttachmentBuilder(html, { name });
  const note = {
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle(brandTitle('Ticket transcript'))
        .setDescription(
          `Ticket: **${channel.name}**\nOwner: <@${row.owner}>\nMessages: ${messages.length}`,
        )
        .setFooter({ text: 'Saved before ticket deletion' }),
    ],
    allowedMentions: { parse: [] },
  };
  const archived = await archive.send({ ...note, files: [file()] });
  if (archived?.id) trackMessage(db, 'transcript', archived);
  const owner = await channel.client.users.fetch(row.owner);
  await owner
    .send({ ...note, files: [file()] })
    .then((message) => {
      if (message?.id) trackMessage(db, 'transcript', message);
    })
    .catch(() => {
      throw Error(
        'Transcript saved for staff, but owner DMs are closed. Enable DMs and retry; channel kept.',
      );
    });
  // Deletion is performed by the caller only after BOTH deliveries succeed.
  return name;
}
