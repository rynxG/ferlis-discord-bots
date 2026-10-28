import { brandTitle } from './ui.js';
import {
  SlashCommandBuilder,
  PermissionFlagsBits as P,
  EmbedBuilder,
  MessageFlags,
  Events,
} from 'discord.js';
import { randomUUID } from 'node:crypto';
import { operationsSchema, trackMessage } from './operations-store.js';
import { reviewButtons } from './moderation-review.js';
export function caseDateFields(value) {
  const seconds = Math.floor(new Date(value).getTime() / 1000);
  if (!Number.isFinite(seconds)) throw Error('Invalid case date');
  return [
    { name: 'Date', value: `<t:${seconds}:D>`, inline: true },
    { name: 'Time', value: `<t:${seconds}:t>`, inline: true },
  ];
}
export async function refreshCaseDates(client, db) {
  for (const key of ['channel:automod-bans', 'channel:automod-mutes', 'channel:logs']) {
    const id = db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value;
    if (!id) continue;
    const channel = await client.channels.fetch(id).catch(() => null);
    if (!channel?.isTextBased()) continue;
    for (const message of (await channel.messages.fetch({ limit: 100 })).values()) {
      if (message.author.id !== client.user.id) continue;
      let changed = false;
      const embeds = message.embeds.map((embed) => {
        const date = embed.fields.find((f) => f.name === 'Date');
        if (
          !embed.fields.some((f) => f.name === 'Case / Ban ID') ||
          !date ||
          !/^\d{4}-\d\d-\d\dT/.test(date.value)
        )
          return embed;
        const fields = [];
        for (const field of embed.fields) {
          if (field.name === 'Date') fields.push(...caseDateFields(date.value));
          else if (field.name !== 'Time') fields.push(field);
        }
        changed = true;
        return EmbedBuilder.from(embed).setFields(fields);
      });
      if (changed) await message.edit({ embeds });
    }
  }
}
export const modCommands = [
  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a member and record a case')
    .setDefaultMemberPermissions(P.ManageMessages),
  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Time out a member')
    .setDefaultMemberPermissions(P.ModerateMembers),
  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Remove a member timeout')
    .setDefaultMemberPermissions(P.ModerateMembers),
  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Remove a member from the server')
    .setDefaultMemberPermissions(P.KickMembers),
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member without deleting their messages')
    .setDefaultMemberPermissions(P.BanMembers),
].map((cmd) => {
  cmd
    .setDMPermission(false)
    .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true));
  if (cmd.name === 'mute')
    cmd.addIntegerOption((o) =>
      o
        .setName('minutes')
        .setDescription('Duration in minutes (max 40320 / 28 days)')
        .setMinValue(1)
        .setMaxValue(40320)
        .setRequired(true),
    );
  return cmd.addStringOption((o) =>
    o
      .setName('reason')
      .setDescription('Reason for this action')
      .setMaxLength(500)
      .setRequired(true),
  );
});
modCommands.push(
  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user by Discord ID')
    .setDMPermission(false)
    .setDefaultMemberPermissions(P.BanMembers)
    .addStringOption((o) =>
      o.setName('user-id').setDescription('Discord user ID').setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(500),
    ),
);
modCommands.push(
  new SlashCommandBuilder()
    .setName('blocked-words')
    .setDescription('Show the full moderation word list (admins only)')
    .setDMPermission(false)
    .setDefaultMemberPermissions(P.Administrator),
);
export async function logCase(
  client,
  db,
  env,
  { action, user, actor, reason, duration, effect, source = 'Staff command' },
) {
  operationsSchema(db);
  const id = randomUUID();
  const now = new Date();
  db.prepare(
    'INSERT INTO moderation_cases(id,action,user,actor,reason,created) VALUES(?,?,?,?,?,?)',
  ).run(id, action, user.id, actor?.id || client.user.id, reason, now.toISOString());
  if (effect)
    db.prepare('INSERT INTO case_effects VALUES(?,?,?,?,?)').run(
      id,
      effect.expires || null,
      effect.previous || null,
      effect.offence_count ?? null,
      effect.previous_permanent || 0,
    );
  const key = /ban/i.test(action)
    ? 'automod-bans'
    : /mute|timeout/i.test(action)
      ? 'automod-mutes'
      : 'logs';
  const channelId = db
    .prepare('SELECT value FROM settings WHERE key=?')
    .get('channel:' + key)?.value;
  const channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
  const embed = new EmbedBuilder()
    .setColor(/unmute|unban/i.test(action) ? 0x57f287 : 0xed4245)
    .setTitle(brandTitle(action))
    .addFields(
      { name: 'Case / Ban ID', value: id },
      { name: 'User', value: `<@${user.id}>`, inline: true },
      { name: 'User ID', value: user.id, inline: true },
      { name: 'Moderator', value: `<@${actor?.id || client.user.id}>`, inline: true },
      { name: 'Reason', value: String(reason || 'No reason supplied').slice(0, 1024) },
      ...caseDateFields(now),
      { name: 'Source', value: source, inline: true },
      ...(duration ? [{ name: 'Duration', value: duration, inline: true }] : []),
    )
    .setTimestamp(now);
  if (channel?.isTextBased())
    await channel
      .send({ embeds: [embed], components: [reviewButtons(id)], allowedMentions: { parse: [] } })
      .then((message) => {
        if (message?.id) {
          trackMessage(db, 'moderation', message);
          db.prepare('INSERT OR REPLACE INTO case_targets VALUES(?,?,?)').run(
            id,
            message.channelId || channelId,
            message.id,
          );
        }
      })
      .catch((e) =>
        console.error('Case ' + id + ' recorded; Discord log delivery failed:', e.message),
      );
  return id;
}
export function staffMayTarget(actor, target) {
  return (
    actor.id !== target.id &&
    target.id !== target.guild.ownerId &&
    !target.user.bot &&
    (actor.id === target.guild.ownerId ||
      actor.roles.highest.comparePositionTo(target.roles.highest) > 0)
  );
}
export function installModeration(client, db, env, words) {
  client.once(Events.ClientReady, () =>
    refreshCaseDates(client, db).catch((e) => console.error('Case date refresh:', e.message)),
  );
  const ep = (content) => ({ content, flags: MessageFlags.Ephemeral });
  client.on(Events.InteractionCreate, async (i) => {
    if (i.guildId !== env.GUILD_ID || !i.isChatInputCommand()) return;
    const name = i.commandName;
    if (![...modCommands.map((c) => c.name)].includes(name)) return;
    try {
      if (name === 'blocked-words') {
        if (!i.memberPermissions.has(P.Administrator)) return i.reply(ep('Administrators only.'));
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const pages = [];
        let page = '';
        for (const word of [...new Set(words)]) {
          if (page.length + word.length + 3 > 1750) {
            pages.push(page);
            page = '';
          }
          page += (page ? ', ' : '') + word;
        }
        if (page) pages.push(page);
        await i.editReply({
          content: `Full prohibited-word list (${new Set(words).size} phrases):\n${pages.shift() || 'Empty'}`,
          allowedMentions: { parse: [] },
        });
        for (const content of pages)
          await i.followUp({ ...ep(content), allowedMentions: { parse: [] } });
        return;
      }
      const permission = {
        warn: P.ManageMessages,
        mute: P.ModerateMembers,
        unmute: P.ModerateMembers,
        kick: P.KickMembers,
        ban: P.BanMembers,
        unban: P.BanMembers,
      }[name];
      if (!i.memberPermissions.has(permission))
        return i.reply(ep('You do not have the permission for this moderation action.'));
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const reason = i.options.getString('reason', true);
      if (name === 'unban') {
        const id = i.options.getString('user-id', true);
        if (!/^\d{17,22}$/.test(id)) return i.editReply('Enter a valid Discord user ID.');
        await i.guild.bans.remove(id, reason);
        const caseId = await logCase(client, db, env, {
          action: 'Unban',
          user: { id },
          actor: i.user,
          reason,
        });
        return i.editReply('User unbanned. Case: ' + caseId);
      }
      const user = i.options.getUser('member', true),
        target = await i.guild.members.fetch(user.id);
      const actor = await i.guild.members.fetch(i.user.id);
      if (!staffMayTarget(actor, target))
        return i.editReply(
          'You cannot use this action on yourself, bots, the owner, or members at/above your role.',
        );
      let duration;
      const previous = target.communicationDisabledUntilTimestamp;
      if (name === 'mute') {
        if (!target.moderatable)
          return i.editReply('Discord does not allow this bot to time out that member.');
        duration = i.options.getInteger('minutes', true) + ' minutes';
        await target.timeout(i.options.getInteger('minutes', true) * 60000, reason);
      }
      if (name === 'unmute') {
        await target.timeout(null, reason);
        db.prepare('DELETE FROM offences WHERE user=?').run(user.id);
      }
      if (name === 'kick') {
        if (!target.kickable) return i.editReply('This member cannot be kicked by the bot.');
        await target.kick(reason);
      }
      if (name === 'ban') {
        if (!target.bannable) return i.editReply('This member cannot be banned by the bot.');
        await target.ban({ deleteMessageSeconds: 0, reason });
      }
      const caseId = await logCase(client, db, env, {
        action: name[0].toUpperCase() + name.slice(1),
        user,
        actor: i.user,
        reason,
        duration,
        ...(name === 'mute'
          ? { effect: { previous, expires: target.communicationDisabledUntilTimestamp } }
          : {}),
      });
      await user
        .send({
          embeds: [
            new EmbedBuilder()
              .setColor(/unmute|unban/.test(name) ? 0x57f287 : 0xed4245)
              .setTitle(brandTitle('Server moderation notice'))
              .setDescription(
                `Action: **${name}**\nReason: ${reason}\n${duration ? 'Duration: ' + duration + '\n' : ''}Case: ${caseId}`,
              )
              .setFooter({ text: i.guild.name }),
          ],
          allowedMentions: { parse: [] },
        })
        .catch(() => {});
      await i.editReply('Action completed. Case: ' + caseId);
    } catch (e) {
      console.error('Staff moderation:', e.message);
      const msg = ep(
        'The action could not be completed. Check the bot’s permissions and role order.',
      );
      if (i.deferred) await i.editReply(msg.content).catch(() => {});
      else await i.reply(msg).catch(() => {});
    }
  });
  client.on(Events.GuildAuditLogEntryCreate, async (entry, guild) => {
    if (guild.id !== env.GUILD_ID || entry.executorId === client.user.id) return;
    const action =
      entry.action === 22
        ? 'Ban'
        : entry.action === 23
          ? 'Unban'
          : entry.action === 20
            ? 'Kick'
            : entry.action === 24 &&
                entry.changes.some((c) => c.key === 'communication_disabled_until')
              ? entry.changes.find((c) => c.key === 'communication_disabled_until').new
                ? 'Timeout'
                : 'Unmute'
              : null;
    if (action && entry.targetId)
      await logCase(client, db, env, {
        action,
        user: { id: entry.targetId },
        actor: { id: entry.executorId || client.user.id },
        reason: entry.reason || 'Recorded from Discord audit log',
        source: 'Discord audit log',
      }).catch((e) => console.error('Audit log:', e.message));
  });
}
