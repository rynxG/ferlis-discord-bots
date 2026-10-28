import { brandTitle } from './ui.js';
import { operationsSchema, trackMessage } from './operations-store.js';
import { icon, colors } from './ui.js';
import {
  ChannelType,
  PermissionFlagsBits as P,
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from 'discord.js';
import { randomUUID } from 'node:crypto';
const ep = (content) => ({
  content,
  flags: MessageFlags.Ephemeral,
  allowedMentions: { parse: [] },
});
export const mediaQuestions = [
  'Do you own CHRISP+?',
  'Basic information about yourself (Timezone, Age, Country/Territory, Availability)',
  'How much would you be able to post weekly?',
  'What editing software do you use for edits?',
  'Send the video link you would like to apply with here',
  'Why would we accept you to the media team?',
];
export function canControlVoice(room, userId, currentChannelId) {
  return Boolean(room && room.owner === userId && room.channel === currentChannelId);
}
export function voiceTargetAllowed(owner, target, roomId) {
  return (
    target &&
    target.id !== owner.id &&
    !target.user.bot &&
    target.voice.channelId === roomId &&
    target.id !== target.guild.ownerId &&
    !target.permissions.has(P.Administrator) &&
    !target.permissions.has(P.ModerateMembers) &&
    !target.permissions.has(P.ManageMessages)
  );
}
export async function clearVoiceEffects(db, member, row) {
  if (!member) {
    db.prepare('DELETE FROM voice_effects WHERE user=?').run(row.user);
    return;
  }
  if (!member.voice.channelId) {
    db.prepare("UPDATE voice_effects SET channel='' WHERE user=?").run(row.user);
    return;
  }
  if (row.mute) await member.voice.setMute(false, 'Temporary room mute ended');
  if (row.deaf) await member.voice.setDeaf(false, 'Temporary room deafen ended');
  db.prepare('DELETE FROM voice_effects WHERE user=?').run(row.user);
}
export function voicePanel() {
  const actions = [
    ['lock', '🔒', 'Lock'],
    ['unlock', '🔓', 'Unlock'],
    ['rename', '✏️', 'Rename'],
    ['limit', '👥', 'Limit'],
    ['info', 'ℹ️', 'Room info'],
    ['kick', '🚪', 'Kick member'],
    ['mute', '🔇', 'Mute'],
    ['unmute', '🔊', 'Unmute'],
    ['deafen', '🙉', 'Deafen'],
    ['undeafen', '👂', 'Undeafen'],
    ['member-id', '🪪', 'Member ID'],
    ['claim', '👑', 'Claim room'],
    ['transfer', '👑', 'Transfer ownership'],
    ['trust', '👥', 'Trust member'],
    ['untrust', '🔒', 'Untrust member'],
    ['save', 'ℹ️', 'Save preferences'],
  ];
  const rows = [];
  for (let n = 0; n < actions.length; n += 4)
    rows.push(
      new ActionRowBuilder().addComponents(
        actions.slice(n, n + 4).map(([id, emoji, label]) =>
          new ButtonBuilder()
            .setCustomId('voice:' + id)
            .setEmoji(icon(id === 'member-id' ? 'id' : id, emoji))
            .setStyle(id === 'kick' ? ButtonStyle.Danger : ButtonStyle.Secondary),
        ),
      ),
    );
  const descriptions = [
    'Lock your voice channel',
    'Unlock your voice channel',
    'Rename your voice channel',
    'Change the member limit',
    'View room information',
    'Disconnect a member',
    'Mute a member',
    'Unmute a member',
    'Deafen a member',
    'Undeafen a member',
    'View a member’s ID',
    'Claim an abandoned room',
    'Transfer ownership to someone in your room',
    'Allow a trusted member to join your locked room',
    'Remove a member’s trusted access',
    'Save your room name, limit and lock preference',
  ];
  const guide = actions
    .map(([id, fallback], n) => {
      const emoji = icon(id === 'member-id' ? 'id' : id, fallback);
      return `${typeof emoji === 'string' ? emoji : `<:${emoji.name}:${emoji.id}>`} — ${descriptions[n]}`;
    })
    .join('\n');
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(colors.neutral)
        .setTitle(brandTitle('VoiceMaster Interface'))
        .setDescription(
          'Use the buttons below to control your voice channel.\n\n**Button guide**\n' + guide,
        )
        .setFooter({
          text: 'You must own and be inside the room. Member controls affect only your room; staff are protected.',
        }),
    ],
    components: rows,
  };
}
const mediaPanel = () => ({
  embeds: [
    new EmbedBuilder()
      .setColor(0x20b9df)
      .setTitle(brandTitle('Media Applications'))
      .setDescription(
        'Want to create content for CHRISP?\nPress **Start application** and answer six questions in DMs, one at a time.',
      )
      .setFooter({
        text: 'Your answers go to the private media-review channel only after you confirm.',
      }),
  ],
  components: [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('media:start')
        .setLabel('Start application')
        .setStyle(ButtonStyle.Primary),
    ),
  ],
});
export function installCommunity(utility, jerry, db, env, baseReady) {
  operationsSchema(db);
  db.exec(
    `CREATE TABLE IF NOT EXISTS voice_rooms(channel TEXT PRIMARY KEY,owner TEXT NOT NULL);CREATE TABLE IF NOT EXISTS voice_access(user TEXT PRIMARY KEY);CREATE TABLE IF NOT EXISTS voice_effects(user TEXT PRIMARY KEY,channel TEXT NOT NULL,mute INTEGER NOT NULL DEFAULT 0,deaf INTEGER NOT NULL DEFAULT 0);CREATE TABLE IF NOT EXISTS media_drafts(user TEXT PRIMARY KEY,step INTEGER NOT NULL,answers TEXT NOT NULL,updated INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS media_submissions(id TEXT PRIMARY KEY,user TEXT NOT NULL,created INTEGER NOT NULL);`,
  );
  const get = (key) => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value;
  const put = (key, value) =>
    db
      .prepare(
        'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, value);
  let ready;
  const busyMedia = new Set(),
    creating = new Set();
  async function setup() {
    await baseReady();
    const g = await utility.guilds.fetch(env.GUILD_ID);
    await g.roles.fetch();
    await g.channels.fetch();
    const staffRoles = ['Support Team', 'Development Team', 'Moderator']
      .map((n) => g.roles.cache.find((r) => r.name === n))
      .filter(Boolean);
    const mod = staffRoles.find((r) => r.name === 'Moderator');
    if (mod && !mod.permissions.has(P.BanMembers) && get('security:hardened') !== '1')
      await mod.setPermissions(
        mod.permissions.add(P.KickMembers, P.BanMembers),
        'Staff moderation commands requested by owner',
      );
    let access = g.roles.cache.find((r) => r.name === 'voice-access');
    if (!access)
      access = await g.roles.create({
        name: 'voice-access',
        permissions: [],
        reason: 'Temporary voice owner controls',
      });
    put('role:voice-access', access.id);
    const privateRules = [
      { id: g.id, type: 0, deny: [P.ViewChannel] },
      ...staffRoles.map((r) => ({
        id: r.id,
        type: 0,
        allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory],
      })),
      {
        id: utility.user.id,
        type: 1,
        allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageChannels],
      },
    ];
    async function channel(key, name, type, parent, permissionOverwrites) {
      let ch = get(key) ? await g.channels.fetch(get(key)).catch(() => null) : null;
      if (!ch) ch = g.channels.cache.find((c) => c.name === name && c.type === type);
      if (!ch)
        ch = await g.channels.create({
          name,
          type,
          ...(parent ? { parent } : {}),
          ...(permissionOverwrites ? { permissionOverwrites } : {}),
          reason: 'Feris community systems setup',
        });
      put(key, ch.id);
      return ch;
    }
    const staffCat = await channel(
      'category:staff-tools',
      'STAFF',
      ChannelType.GuildCategory,
      null,
      privateRules,
    );
    for (const name of [
      'staff-chat',
      'staff-commands',
      'automod-bans',
      'automod-mutes',
      'role-assingments',
      'logs',
      'media-review',
    ])
      await channel('channel:' + name, name, ChannelType.GuildText, staffCat.id, privateRules);
    const voiceCat = await channel('category:voice', 'VOICE', ChannelType.GuildCategory);
    const lobby = await channel(
      'voice:lobby',
      'Join to Create',
      ChannelType.GuildVoice,
      voiceCat.id,
    );
    const controls = await channel(
      'voice:controls',
      'voice-controls',
      ChannelType.GuildText,
      voiceCat.id,
      [
        { id: g.id, type: 0, deny: [P.ViewChannel] },
        ...staffRoles.map((r) => ({
          id: r.id,
          type: 0,
          allow: [P.ViewChannel, P.ReadMessageHistory],
        })),
        {
          id: access.id,
          type: 0,
          allow: [P.ViewChannel, P.ReadMessageHistory],
          deny: [P.SendMessages],
        },
        {
          id: utility.user.id,
          type: 1,
          allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory],
        },
      ],
    );
    await panel(controls, 'voice:panel', voicePanel());
    const application = await channel(
      'channel:media-applications',
      'media-applications',
      ChannelType.GuildText,
      null,
      [
        {
          id: g.id,
          type: 0,
          deny: [
            P.SendMessages,
            P.CreatePublicThreads,
            P.CreatePrivateThreads,
            P.SendMessagesInThreads,
          ],
        },
        {
          id: utility.user.id,
          type: 1,
          allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory],
        },
      ],
    );
    await panel(application, 'media:panel', mediaPanel());
    for (const row of db.prepare('SELECT * FROM voice_rooms').all()) {
      const ch = await g.channels.fetch(row.channel).catch(() => null);
      if (!ch) {
        db.prepare('DELETE FROM voice_rooms WHERE channel=?').run(row.channel);
        continue;
      }
      if (ch.members.size === 0) {
        await ch.delete('Empty temporary voice room cleanup');
        db.prepare('DELETE FROM voice_rooms WHERE channel=?').run(ch.id);
      } else if (!ch.members.has(row.owner)) {
        const next = ch.members.find((m) => !m.user.bot);
        if (next) db.prepare('UPDATE voice_rooms SET owner=? WHERE channel=?').run(next.id, ch.id);
      }
    }
    for (const row of db.prepare('SELECT user FROM voice_access').all()) {
      const member = await g.members.fetch(row.user).catch(() => null);
      if (
        member &&
        !db
          .prepare('SELECT channel FROM voice_rooms WHERE owner=? AND channel=?')
          .get(row.user, member.voice.channelId || '')
      )
        await member.roles.remove(access, 'Voice ownership ended');
      db.prepare('DELETE FROM voice_access WHERE user=?').run(row.user);
    }
    for (const row of db.prepare('SELECT * FROM voice_rooms').all()) {
      const m = await g.members.fetch(row.owner).catch(() => null);
      if (m?.voice.channelId === row.channel) await grant(m);
    }
    for (const effect of db.prepare('SELECT * FROM voice_effects').all()) {
      const member = await g.members.fetch(effect.user).catch(() => null);
      if (!member?.voice.channelId || member.voice.channelId !== effect.channel)
        await clearEffects(member, effect);
    }
    db.prepare('DELETE FROM media_drafts WHERE updated<?').run(Date.now() - 7 * 86400000);
    console.log('VoiceMaster, staff channels, punishment logs and media applications ready.');
    return { g, access, lobby, voiceCat, controls };
  }
  async function panel(ch, key, payload) {
    const id = get(key);
    const old = id ? await ch.messages.fetch(id).catch(() => null) : null;
    if (old) await old.edit(payload);
    else put(key, (await ch.send(payload)).id);
  }
  utility.once(Events.ClientReady, () => {
    ready = setup();
    ready.catch((e) => console.error('Community setup:', e.message));
  });
  async function grant(member) {
    await member.roles.add(get('role:voice-access'), 'Temporary voice room owner');
    db.prepare('INSERT OR IGNORE INTO voice_access VALUES(?)').run(member.id);
  }
  async function revoke(member) {
    if (member)
      await member.roles.remove(get('role:voice-access'), 'Left owned voice room').catch(() => {});
    if (member) db.prepare('DELETE FROM voice_access WHERE user=?').run(member.id);
  }
  async function clearEffects(member, row) {
    return clearVoiceEffects(db, member, row);
  }
  async function transferOwner(channel, previous, next) {
    const oldTrusted = db.prepare('SELECT user FROM voice_trusted WHERE owner=?').all(previous);
    for (const id of new Set([previous, ...oldTrusted.map((t) => t.user)]))
      if (id !== next.id) await channel.permissionOverwrites.edit(id, { Connect: null });
    const trusted = db.prepare('SELECT user FROM voice_trusted WHERE owner=?').all(next.id);
    for (const id of new Set([next.id, ...trusted.map((t) => t.user)]))
      await channel.permissionOverwrites.edit(id, { Connect: true });
    db.prepare('UPDATE voice_rooms SET owner=? WHERE channel=?').run(next.id, channel.id);
    const old = await channel.guild.members.fetch(previous).catch(() => null);
    await revoke(old);
    await grant(next);
  }

  let voiceQueue = Promise.resolve();
  utility.on(Events.VoiceStateUpdate, (old, state) => {
    if (state.guild.id !== env.GUILD_ID || old.channelId === state.channelId) return;
    voiceQueue = voiceQueue
      .then(() => voiceChange(old, state))
      .catch((e) => console.error('Voice update:', e.message));
  });
  async function voiceChange(old, state) {
    const config = await ready;
    const member = state.member || old.member;
    if (!member) return;
    if (member.user.bot) {
      const oldRoom = old.channelId
        ? db.prepare('SELECT channel FROM voice_rooms WHERE channel=?').get(old.channelId)
        : null;
      if (oldRoom) {
        const room = await config.g.channels.fetch(oldRoom.channel).catch(() => null);
        if (room && room.members.size === 0) {
          await room.delete('Empty temporary voice room');
          db.prepare('DELETE FROM voice_rooms WHERE channel=?').run(room.id);
        }
      }
      return;
    }
    const effect = db.prepare('SELECT * FROM voice_effects WHERE user=?').get(member.id);
    if (effect && effect.channel !== state.channelId) await clearEffects(member, effect);
    const owned = old.channelId
      ? db.prepare('SELECT * FROM voice_rooms WHERE channel=?').get(old.channelId)
      : null;
    if (owned) {
      const ch = await config.g.channels.fetch(owned.channel).catch(() => null);
      if (owned.owner === member.id) {
        await revoke(member);
        const next = ch?.members.find((m) => !m.user.bot && m.id !== member.id);
        if (next) {
          await transferOwner(ch, owned.owner, next);
        }
      }
      if (ch && ch.members.size === 0) {
        await ch.delete('Empty temporary voice room');
        db.prepare('DELETE FROM voice_rooms WHERE channel=?').run(ch.id);
      }
    }
    if (state.channelId === config.lobby.id && !creating.has(member.id)) {
      creating.add(member.id);
      try {
        const preference = db
          .prepare('SELECT * FROM voice_preferences WHERE user=?')
          .get(member.id);
        const trusted = db.prepare('SELECT user FROM voice_trusted WHERE owner=?').all(member.id);
        const room = await config.g.channels.create({
          name: preference?.name || member.displayName.slice(0, 70) + '’s room',
          userLimit: preference?.member_limit || 0,
          type: ChannelType.GuildVoice,
          parent: config.voiceCat.id,
          permissionOverwrites: [
            { id: config.g.id, type: 0, ...(preference?.locked ? { deny: [P.Connect] } : {}) },
            { id: member.id, type: 1, allow: [P.Connect] },
            ...trusted
              .filter((t) => t.user !== member.id)
              .map((t) => ({ id: t.user, type: 1, allow: [P.Connect] })),
          ],
          reason: 'Member joined Join to Create',
        });
        db.prepare('INSERT INTO voice_rooms VALUES(?,?)').run(room.id, member.id);
        try {
          await member.voice.setChannel(room, 'Personal voice room');
          await grant(member);
        } catch (e) {
          if (room.members.size === 0) {
            await room.delete('Could not move owner into temporary voice room');
            db.prepare('DELETE FROM voice_rooms WHERE channel=?').run(room.id);
          }
          throw e;
        }
      } finally {
        creating.delete(member.id);
      }
    }
  }
  async function ownedRoom(i) {
    const member = await i.guild.members.fetch(i.user.id);
    const room = member.voice.channelId
      ? db.prepare('SELECT * FROM voice_rooms WHERE channel=?').get(member.voice.channelId)
      : null;
    if (!canControlVoice(room, i.user.id, member.voice.channelId))
      throw Error('Only the owner inside their own temporary voice room can use this control.');
    const channel = await i.guild.channels.fetch(room.channel);
    return { member, room, channel };
  }
  utility.on(Events.InteractionCreate, async (i) => {
    if (!(i.guildId === env.GUILD_ID || !i.guildId) || !i.customId) return;
    if (!i.customId.startsWith('voice:') && !i.customId.startsWith('media:')) return;
    try {
      if (i.customId.startsWith('media:')) return await mediaInteraction(i);
      if (i.guildId !== env.GUILD_ID) return;
      await ready;
      const action = i.customId.split(':')[1];
      if (action === 'claim') {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const member = await i.guild.members.fetch(i.user.id);
        const room = db
          .prepare('SELECT * FROM voice_rooms WHERE channel=?')
          .get(member.voice.channelId || '');
        if (!room) return i.editReply('Join a personal voice room first.');
        if (member.voice.channel.members.has(room.owner))
          return i.editReply('The room owner is still present.');
        await transferOwner(member.voice.channel, room.owner, member);
        return i.editReply('You now own this room.');
      }
      const { member, room, channel } = await ownedRoom(i);
      if (i.isUserSelectMenu()) {
        const expected = i.customId.split(':')[2];
        if (expected !== room.channel) throw Error('This selector belongs to a different room.');
        const target = await i.guild.members.fetch(i.values[0]);
        if (['transfer', 'trust', 'untrust'].includes(action)) {
          if (target.user.bot || target.id === member.id)
            throw Error('Choose another human member.');
          await i.deferReply({ flags: MessageFlags.Ephemeral });
          if (action === 'transfer') {
            if (target.voice.channelId !== room.channel)
              throw Error('The new owner must be inside your room.');
            await transferOwner(channel, member.id, target);
            return i.editReply(
              'Room ownership transferred to <@' +
                target.id +
                '>. Your owner controls were removed.',
            );
          }
          if (action === 'trust') {
            await channel.permissionOverwrites.edit(target.id, { Connect: true });
            db.prepare('INSERT OR IGNORE INTO voice_trusted VALUES(?,?)').run(member.id, target.id);
          } else {
            await channel.permissionOverwrites.delete(
              target.id,
              'Owner removed trusted voice access',
            );
            db.prepare('DELETE FROM voice_trusted WHERE owner=? AND user=?').run(
              member.id,
              target.id,
            );
          }
          return i.editReply(
            action === 'trust'
              ? 'Trusted access saved. This member can join your locked rooms.'
              : 'Trusted access removed.',
          );
        }
        if (action === 'member-id') {
          if (target.voice.channelId !== room.channel) throw Error('Choose a member in your room.');
          return i.reply(ep(`Member: <@${target.id}>\nDiscord ID: ${target.id}`));
        }
        if (!voiceTargetAllowed(member, target, room.channel))
          throw Error('Choose a non-staff member currently inside your own room.');
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const existing = db.prepare('SELECT * FROM voice_effects WHERE user=?').get(target.id);
        if (action === 'kick') await target.voice.disconnect('Disconnected by personal room owner');
        else {
          const field = ['mute', 'unmute'].includes(action) ? 'mute' : 'deaf';
          const enabled = ['mute', 'deafen'].includes(action);
          if (!enabled && !existing?.[field])
            throw Error('Only a mute/deafen applied by this room panel can be removed here.');
          if (
            enabled &&
            (field === 'mute' ? target.voice.serverMute : target.voice.serverDeaf) &&
            !existing?.[field]
          )
            throw Error('A staff-applied mute/deafen is already active.');
          if (field === 'mute') await target.voice.setMute(enabled, 'Personal room owner control');
          else await target.voice.setDeaf(enabled, 'Personal room owner control');
          db.prepare(
            'INSERT INTO voice_effects(user,channel,mute,deaf) VALUES(?,?,?,?) ON CONFLICT(user) DO UPDATE SET channel=excluded.channel,mute=excluded.mute,deaf=excluded.deaf',
          ).run(
            target.id,
            room.channel,
            field === 'mute' ? Number(enabled) : existing?.mute || 0,
            field === 'deaf' ? Number(enabled) : existing?.deaf || 0,
          );
        }
        return i.editReply('Voice action applied to <@' + target.id + '> in your room only.');
      }
      if (i.isModalSubmit()) {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const value = i.fields.getTextInputValue('value');
        if (action === 'rename') await channel.setName(value.slice(0, 90), 'Voice owner rename');
        else {
          const limit = Number(value);
          if (!/^\d+$/.test(value) || limit > 99)
            throw Error('Use a number from 0 to 99 (0 means unlimited).');
          await channel.setUserLimit(limit, 'Voice owner limit');
        }
        return i.editReply('Room updated.');
      }
      if (['rename', 'limit'].includes(action))
        return i.showModal(
          new ModalBuilder()
            .setCustomId('voice:' + action)
            .setTitle(brandTitle(action === 'rename' ? 'Rename your room' : 'Member limit'))
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId('value')
                  .setLabel(action === 'rename' ? 'Room name' : '0 to 99 (0 = unlimited)')
                  .setStyle(TextInputStyle.Short)
                  .setMaxLength(action === 'rename' ? 90 : 2)
                  .setRequired(true),
              ),
            ),
        );
      if (
        [
          'kick',
          'mute',
          'unmute',
          'deafen',
          'undeafen',
          'member-id',
          'transfer',
          'trust',
          'untrust',
        ].includes(action)
      )
        return i.reply({
          ...ep(
            ['trust', 'untrust'].includes(action)
              ? 'Choose a server member to update trusted access.'
              : 'Choose a member currently inside your room.',
          ),
          components: [
            new ActionRowBuilder().addComponents(
              new UserSelectMenuBuilder()
                .setCustomId('voice:' + action + ':' + room.channel)
                .setPlaceholder('Select a room member')
                .setMinValues(1)
                .setMaxValues(1),
            ),
          ],
        });
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      if (action === 'save') {
        db.prepare(
          'INSERT INTO voice_preferences VALUES(?,?,?,?) ON CONFLICT(user) DO UPDATE SET name=excluded.name,member_limit=excluded.member_limit,locked=excluded.locked',
        ).run(
          member.id,
          channel.name,
          channel.userLimit || 0,
          Number(channel.permissionOverwrites.cache.get(i.guild.id)?.deny.has(P.Connect) || false),
        );
        return i.editReply('Room preferences saved for your next personal room.');
      }
      if (action === 'lock' || action === 'unlock') {
        await channel.permissionOverwrites.edit(i.guild.id, {
          Connect: action === 'lock' ? false : null,
        });
        return i.editReply(action === 'lock' ? 'Room locked.' : 'Room unlocked.');
      }
      return i.editReply(
        `Room: <#${channel.id}>\nOwner: <@${room.owner}>\nMembers: ${channel.members.size}\nRoom ID: ${channel.id}`,
      );
    } catch (e) {
      const payload = ep(e.message || 'That control failed.');
      if (i.deferred || i.replied) await i.followUp(payload).catch(() => {});
      else await i.reply(payload).catch(() => {});
    }
  });
  async function sendQuestion(user, draft) {
    await user.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x20b9df)
          .setTitle(
            brandTitle('Media application · ' + (draft.step + 1) + ' / ' + mediaQuestions.length),
          )
          .setDescription(mediaQuestions[draft.step])
          .setFooter({
            text: 'Reply with your answer. Type !cancel to discard your draft. Answers are shared with staff only after confirmation.',
          }),
      ],
    });
  }
  async function confirmation(user, answers) {
    await user.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x20b9df)
          .setTitle(brandTitle('Are you sure you’d like to submit your application?'))
          .setDescription(
            'Review your answers below. Choose **Yes, submit** to send them to the private media-review channel.',
          )
          .addFields(
            answers.map((value, n) => ({
              name: n + 1 + '. ' + mediaQuestions[n],
              value: value.slice(0, 1024),
            })),
          ),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('media:confirm')
            .setLabel('Yes, submit')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('media:cancel')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
  }
  async function mediaInteraction(i) {
    if (i.customId === 'media:start') {
      if (i.guildId !== env.GUILD_ID) return;
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      let draft = db.prepare('SELECT * FROM media_drafts WHERE user=?').get(i.user.id);
      if (draft && Date.now() - draft.updated > 7 * 86400000) {
        db.prepare('DELETE FROM media_drafts WHERE user=?').run(i.user.id);
        draft = null;
      }
      if (!draft) {
        draft = { step: 0, answers: '[]' };
        await sendQuestion(i.user, draft);
        db.prepare('INSERT INTO media_drafts VALUES(?,?,?,?)').run(i.user.id, 0, '[]', Date.now());
      } else if (draft.step === 6) await confirmation(i.user, JSON.parse(draft.answers));
      else await sendQuestion(i.user, draft);
      return i.editReply('Check your DMs for the next application question.');
    }
    if (i.guildId) return;
    const draft = db.prepare('SELECT * FROM media_drafts WHERE user=?').get(i.user.id);
    if (!draft) return i.reply(ep('No active draft. Start again from media-applications.'));
    if (i.customId === 'media:cancel') {
      db.prepare('DELETE FROM media_drafts WHERE user=?').run(i.user.id);
      return i.update({
        content: 'Application cancelled. Your draft answers were removed.',
        embeds: [],
        components: [],
      });
    }
    if (i.customId === 'media:confirm') {
      if (draft.step !== 6) return i.reply(ep('Finish the questions first.'));
      if (busyMedia.has(i.user.id)) return i.reply(ep('Submission already in progress.'));
      busyMedia.add(i.user.id);
      try {
        await i.deferUpdate();
        const config = await ready;
        const answers = JSON.parse(draft.answers);
        const id = randomUUID();
        const target = await config.g.channels.fetch(get('channel:media-review'));
        const submission = await target.send({
          embeds: [
            new EmbedBuilder()
              .setColor(colors.good)
              .setTitle(brandTitle('New media application'))
              .setDescription(
                `Applicant: <@${i.user.id}>\nUser ID: ${i.user.id}\nApplication ID: ${id}`,
              )
              .addFields(
                answers.map((value, n) => ({
                  name: n + 1 + '. ' + mediaQuestions[n],
                  value: value.slice(0, 1024),
                })),
              )
              .setTimestamp(),
          ],
          allowedMentions: { parse: [] },
        });
        trackMessage(db, 'application', submission);
        db.prepare('INSERT INTO application_messages VALUES(?,?,?)').run(
          id,
          submission.channelId,
          submission.id,
        );
        db.prepare('INSERT INTO media_submissions VALUES(?,?,?)').run(id, i.user.id, Date.now());
        db.prepare('DELETE FROM media_drafts WHERE user=?').run(i.user.id);
        await i.editReply({
          content: '',
          embeds: [
            new EmbedBuilder()
              .setColor(colors.good)
              .setTitle(brandTitle('Application submitted'))
              .setDescription('Your application was sent to staff. Application ID: ' + id),
          ],
          components: [],
        });
      } finally {
        busyMedia.delete(i.user.id);
      }
    }
  }
  utility.on(Events.MessageCreate, async (m) => {
    if (m.guildId || m.author.bot) return;
    const draft = db.prepare('SELECT * FROM media_drafts WHERE user=?').get(m.author.id);
    if (!draft || busyMedia.has(m.author.id)) return;
    busyMedia.add(m.author.id);
    try {
      if (m.content.trim().toLowerCase() === '!cancel') {
        db.prepare('DELETE FROM media_drafts WHERE user=?').run(m.author.id);
        await m.reply('Application cancelled. Draft removed.');
        return;
      }
      if (draft.step >= 6) {
        await m.reply('Please use the confirmation buttons above.');
        return;
      }
      const answer = m.content.trim();
      if (!answer || answer.length > 750) {
        await m.reply('Please reply with 1–750 characters.');
        return;
      }
      if (draft.step === 4) {
        try {
          if (new URL(answer).protocol !== 'https:') throw Error();
        } catch {
          await m.reply('Please send a complete HTTPS video link.');
          return;
        }
      }
      const answers = JSON.parse(draft.answers);
      answers.push(answer);
      db.prepare('UPDATE media_drafts SET step=?,answers=?,updated=? WHERE user=?').run(
        draft.step + 1,
        JSON.stringify(answers),
        Date.now(),
        m.author.id,
      );
      if (draft.step + 1 === 6) await confirmation(m.author, answers);
      else await sendQuestion(m.author, { step: draft.step + 1 });
    } catch (e) {
      console.error('Media DM:', e.message);
      await m
        .reply('I could not continue right now. Try Start application again to resume.')
        .catch(() => {});
    } finally {
      busyMedia.delete(m.author.id);
    }
  });
  jerry.on(Events.GuildMemberUpdate, async (old, member) => {
    if (member.guild.id !== env.GUILD_ID) return;
    try {
      await ready;
      if (!old.premiumSince && member.premiumSince) {
        const channel = await member.guild.channels.fetch('1562499172152643624');
        await channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(colors.good)
              .setTitle(brandTitle('Thank you for boosting!'))
              .setDescription(
                `<@${member.id}> just boosted **${member.guild.name}**!\nThank you for supporting our community.`,
              )
              .setThumbnail(member.user.displayAvatarURL())
              .addFields(
                {
                  name: 'Server boosts',
                  value: String(member.guild.premiumSubscriptionCount || 0),
                  inline: true,
                },
                { name: 'Boost level', value: String(member.guild.premiumTier), inline: true },
              )
              .setTimestamp(),
          ],
          allowedMentions: { parse: [] },
        });
      }
      const added = member.roles.cache.filter((r) => !old.roles.cache.has(r.id));
      const removed = old.roles.cache.filter((r) => !member.roles.cache.has(r.id));
      if (added.size || removed.size) {
        const channel = await member.guild.channels.fetch(get('channel:role-assingments'));
        await channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(removed.size ? colors.bad : colors.good)
              .setTitle(brandTitle('Role assignment updated'))
              .setDescription(`User: <@${member.id}>\nUser ID: ${member.id}`)
              .addFields(
                {
                  name: 'Added',
                  value:
                    added
                      .map((r) => '<@&' + r.id + '>')
                      .join(', ')
                      .slice(0, 1024) || 'None',
                },
                {
                  name: 'Removed',
                  value:
                    removed
                      .map((r) => '<@&' + r.id + '>')
                      .join(', ')
                      .slice(0, 1024) || 'None',
                },
              )
              .setTimestamp(),
          ],
          allowedMentions: { parse: [] },
        });
      }
    } catch (e) {
      console.error('Boost/role log:', e.message);
    }
  });
  jerry.on(Events.GuildAuditLogEntryCreate, (entry, guild) => {
    if (
      guild.id === env.GUILD_ID &&
      entry.executorId !== utility.user?.id &&
      entry.changes?.some((c) => ['mute', 'deaf'].includes(c.key))
    )
      db.prepare('DELETE FROM voice_effects WHERE user=?').run(entry.targetId);
  });

  async function membershipLog(member, joined) {
    if (member.guild.id !== env.GUILD_ID) return;
    try {
      await ready;
      const channel = await member.guild.channels.fetch(get('channel:logs'));
      const embed = new EmbedBuilder()
        .setColor(joined ? colors.good : colors.bad)
        .setTitle(brandTitle(joined ? 'User joined' : 'User left'))
        .setThumbnail(member.user.displayAvatarURL())
        .setDescription(
          `**User:** <@${member.id}> (${member.user.tag})\n**ID:** ${member.id}\n**${joined ? 'Created' : 'Joined'}:** ${joined ? '<t:' + Math.floor(member.user.createdTimestamp / 1000) + ':R>' : member.joinedTimestamp ? '<t:' + Math.floor(member.joinedTimestamp / 1000) + ':R>' : 'Unknown'}\n${
            joined
              ? ''
              : '**Roles:** ' +
                (member.roles?.cache
                  ?.filter((r) => r.id !== member.guild.id)
                  .map((r) => '<@&' + r.id + '>')
                  .join(' ')
                  .slice(0, 2000) || 'None') +
                '\n'
          }**Members:** ${member.guild.memberCount}`,
        )
        .setTimestamp();
      await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    } catch (e) {
      console.error('Membership log:', e.message);
    }
  }
  jerry.on(Events.GuildMemberAdd, (m) => membershipLog(m, true));
  jerry.on(Events.GuildMemberRemove, (m) => membershipLog(m, false));
  return { ready: () => ready };
}
