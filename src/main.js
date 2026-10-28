import { applyBranding, displayBotName } from './branding.js';
import { brandTitle } from './ui.js';
import {
  operationsSchema,
  setting,
  contextualQuestion,
  remember,
  inferTopic,
} from './operations-store.js';
import { installOperations, dashboardCommand, correctionCommand } from './operations.js';
import { installReviews } from './moderation-review.js';
import { createRaidGuard } from './raid.js';
import { supervise } from './supervisor.js';
import { icon, installIcons, colors } from './ui.js';
import {
  Client,
  GatewayIntentBits as I,
  PermissionFlagsBits as P,
  ChannelType,
  MessageFlags,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  Events,
  EmbedBuilder,
  Partials,
} from 'discord.js';
import {
  openStore,
  kinds,
  labels,
  FloodGuard,
  adReason,
  blockedReason,
  safeText,
  defaultBlockedWords,
  recordOffence,
  shouldNotifyTicketReply,
  ticketOverwrites,
  moderationInput,
} from './core.js';
import { installCommunity } from './community.js';
import { modCommands, installModeration, logCase } from './staff-moderation.js';
import { imageModeration } from './image-moderation.js';
import { ensureServerFeatures, priceEmbed, archiveTicket } from './features.js';
import { supportAnswer } from './ai.js';

const env = process.env;
const validate = process.argv.includes('--validate');
if (!validate && !process.argv.includes('--worker')) process.exit(await supervise(env));
const required = ['GUILD_ID', 'PARTIK_TOKEN', 'UTILITY_TOKEN', 'ASSISTANCE_TOKEN', 'ASSISTANCE_ID'];
for (const key of required)
  if (!validate && !env[key]) throw Error(`Missing ${key}; edit .env locally.`);
if (!validate && new Set([env.PARTIK_TOKEN, env.UTILITY_TOKEN, env.ASSISTANCE_TOKEN]).size !== 3)
  throw Error('Use three distinct bot tokens.');
const db = openStore(env.DATA_DIR || './data');
operationsSchema(db);
const clients = [];
const definitions = [];
const supportRole = () =>
  env.STAFF_ROLE_ID ||
  db.prepare("SELECT value FROM settings WHERE key='role:Support Team'").get()?.value;
const staff = (i) =>
  i.memberPermissions?.has(P.Administrator) ||
  i.memberPermissions?.has(P.ManageMessages) ||
  Boolean(
    supportRole() &&
      (i.member.roles.cache?.has(supportRole()) || i.member.roles.includes?.(supportRole())),
  );
const admin = (i) => i.memberPermissions?.has(P.Administrator);
const ephemeral = (content) => ({
  content,
  flags: MessageFlags.Ephemeral,
  allowedMentions: { parse: [] },
});
const ticket = (id) => db.prepare('SELECT * FROM tickets WHERE channel=?').get(id);
function command(name, description, restricted = false) {
  const cmd = new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setDMPermission(false);
  if (restricted) cmd.setDefaultMemberPermissions(P.Administrator);
  return cmd;
}
async function report(client, text) {
  console.log(new Date().toISOString(), text);
  const logId =
    env.MOD_LOG_CHANNEL_ID ||
    db.prepare("SELECT value FROM settings WHERE key='channel:logs'").get()?.value;
  if (logId) {
    const channel = await client.channels.fetch(logId).catch(() => null);
    if (channel?.guildId === env.GUILD_ID && channel.isTextBased())
      await channel
        .send({
          embeds: [
            new EmbedBuilder()
              .setColor(colors.bad)
              .setTitle(brandTitle('Moderation log'))
              .setDescription(text.slice(0, 3500))
              .setTimestamp(),
          ],
          allowedMentions: { parse: [] },
        })
        .catch(() => {});
  }
}
const products = { client: 'Client', accounts: 'Accounts', other: 'Something else' };
let invitePromise;
function serverInvite(guild) {
  return (invitePromise ??= (async () => {
    const saved = db.prepare("SELECT value FROM settings WHERE key='server-invite'").get()?.value;
    if (saved) return saved;
    const panel = db.prepare("SELECT value FROM settings WHERE key='panel'").get()?.value;
    const channel = await guild.channels.fetch(panel?.split(':')[0] || '1562512417542635584');
    const invite = await channel.createInvite({
      maxAge: 0,
      maxUses: 0,
      unique: false,
      reason: 'Permanent invite for bot bios requested by server owner',
    });
    db.prepare("INSERT INTO settings VALUES('server-invite',?)").run(invite.url);
    console.log('Permanent server invite: ' + invite.url);
    return invite.url;
  })());
}

function makeClient(name, commands, messageContent = false, members = false) {
  definitions.push({
    name: displayBotName(name),
    role: name,
    commands: commands.map((c) => c.toJSON()),
  });
  const client = new Client({
    intents: [
      I.Guilds,
      I.GuildMessages,
      I.DirectMessages,
      ...(name === 'Jerry' ? [I.GuildModeration] : []),
      ...(name === 'Feris Utility' ? [I.GuildVoiceStates] : []),
      ...(members ? [I.GuildMembers] : []),
      ...(messageContent ? [I.MessageContent] : []),
    ],
    partials: [Partials.Channel],
    allowedMentions: { parse: [] },
  });
  clients.push(client);
  client.once(Events.ClientReady, async () => {
    try {
      const guild = await client.guilds.fetch(env.GUILD_ID);
      client.user.setPresence({
        status: name === 'Jerry' ? 'online' : 'idle',
        activities: [{ name: 'Chrisp Client', type: 0 }],
      });
      await guild.commands.set(commands.map((c) => c.toJSON()));
      await applyBranding(client, name, guild, db, await serverInvite(guild)).catch((e) =>
        console.error(name + ' branding: ' + e.message),
      );
      console.log(`${name} online in ${guild.name}.`);
    } catch (err) {
      console.error(`${name} setup failed: ${err.message}`);
    }
  });
  client.on(Events.Error, (err) => console.error(`${name}: ${err.name}`));
  return client;
}
function onInteraction(client, handler) {
  client.on(Events.InteractionCreate, async (i) => {
    if (i.guildId !== env.GUILD_ID) return;
    try {
      await handler(i);
    } catch (err) {
      console.error('Interaction failed:', err.name, err.code || '', err.message);
      const message =
        'That action failed. Staff should check the bot permissions and configuration, then try again.';
      if (i.deferred || i.replied) await i.followUp(ephemeral(message)).catch(() => {});
      else await i.reply(ephemeral(message)).catch(() => {});
    }
  });
}

// 1. Jerry: rule-based moderation, with DM warnings after successful deletion.
const partik = makeClient(
  'Jerry',
  [
    ...modCommands,
    command('moderation-status', 'Show Jerry moderation configuration', true),
    command('mod-unmute', 'Remove a member’s timeout and permanent mute', true).addUserOption((o) =>
      o.setName('member').setDescription('Member to unmute').setRequired(true),
    ),
  ],
  true,
  true,
);
const flood = new FloodGuard();
const allowed = (env.ALLOWED_DOMAINS || '').split(',');
const raid = createRaidGuard(partik, db, env, allowed);
const blocked = [
  ...defaultBlockedWords,
  ...(env.BLOCKED_WORDS || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean),
];
async function renewPermanentMutes() {
  const guild = await partik.guilds.fetch(env.GUILD_ID);
  for (const row of db.prepare('SELECT user FROM offences WHERE permanent=1').all()) {
    const member = await guild.members.fetch(row.user).catch(() => null);
    if (
      member?.moderatable &&
      (member.communicationDisabledUntilTimestamp || 0) < Date.now() + 7 * 86400000
    )
      await member
        .timeout(28 * 86400000, 'Permanent mute: renewed until administrator removes it')
        .catch(() => report(partik, `Could not renew permanent mute for ${row.user}.`));
  }
}
partik.once(Events.ClientReady, () => {
  console.log(
    'Jerry image moderation: ' +
      (env.MODERATION_PROVIDER === 'openai' && env.OPENAI_MODERATION_KEY
        ? 'enabled'
        : 'waiting for OPENAI_MODERATION_KEY'),
  );
  renewPermanentMutes().catch((e) => console.error('Mute restore', e.name));
  setInterval(
    () => renewPermanentMutes().catch((e) => console.error('Mute renewal', e.name)),
    6 * 3600000,
  ).unref();
});
partik.on(Events.GuildMemberAdd, async (member) => {
  if (member.guild.id !== env.GUILD_ID || member.user.bot) return;
  try {
    const role = db.prepare("SELECT value FROM settings WHERE key='role:Member'").get()?.value;
    if (
      role &&
      db.prepare("SELECT value FROM settings WHERE key='security:member-role-mode'").get()
        ?.value !== 'after-first-message'
    )
      await member.roles.add(role, 'Automatic new member role');
    const channel = await member.guild.channels.fetch('1562499165332967605');
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(colors.good)
          .setTitle(brandTitle('Welcome to CHRISP!'))
          .setDescription(`Welcome <@${member.id}>!`)
          .setThumbnail(member.user.displayAvatarURL())
          .setTimestamp(),
      ],
      allowedMentions: { users: [member.id], parse: [] },
    });
  } catch (e) {
    console.error('Welcome/member role:', e.message);
  }
});
async function moderate(message, edited = false) {
  if (message.guildId !== env.GUILD_ID || message.author.bot || message.webhookId) return;
  const member =
    message.member || (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!member) return;
  if (
    db.prepare("SELECT value FROM settings WHERE key='security:member-role-mode'").get()?.value ===
    'after-first-message'
  ) {
    const memberRole = db
      .prepare("SELECT value FROM settings WHERE key='role:Member'")
      .get()?.value;
    if (memberRole && !member.roles.cache.has(memberRole))
      await member.roles
        .add(memberRole, 'Member completed Discord verification and sent their first message')
        .catch((e) => console.error('Verified member role:', e.message));
  }
  const staffExempt =
    member.permissions.has(P.ManageMessages) || member.permissions.has(P.Administrator);
  const input = moderationInput(message);
  const previousTimeout = member.communicationDisabledUntilTimestamp;
  const previousPermanent =
    db.prepare('SELECT permanent FROM offences WHERE user=?').get(member.id)?.permanent || 0;
  const raidReason = !staffExempt && !edited ? raid.check(message) : null;
  const badEmbed = !staffExempt && blockedReason(input.embedText, blocked);
  let vision = null;
  if (!staffExempt) {
    try {
      vision = await imageModeration(message, db, env);
    } catch (e) {
      await report(partik, 'Image check unavailable for message ' + message.id + ': ' + e.message);
    }
    if (vision?.reviewOnly) {
      await report(partik, 'Staff review needed for message ' + message.id + ': ' + vision.reason);
      vision = null;
    }
  }
  if (input.gifOnly && !vision) return;
  const spamReason =
    !edited && !input.gifOnly
      ? flood.check(message.author.id, input.content, Date.now(), raid.config())
      : null;
  const permanent = db
    .prepare('SELECT permanent FROM offences WHERE user=?')
    .get(message.author.id)?.permanent;
  const strict =
    /config.?sharing|base.?finds/i.test(message.channel.name || '') ||
    /config.?sharing/i.test(message.channel.parent?.name || '');
  const badFile =
    strict &&
    [...message.attachments.values()].some((a) =>
      /\.(?:exe|msi|bat|cmd|ps1|vbs|scr|dll|jar|com|js|sh)(?:$|\?)/i.test(a.name || ''),
    );
  const strictMention = strict && (message.mentions.everyone || message.mentions.roles.size > 0);
  const reason =
    (permanent ? 'permanent mute' : null) ||
    (!staffExempt && (adReason(input.content, allowed) || blockedReason(input.scan, blocked))) ||
    raidReason ||
    (!staffExempt && badFile ? 'an executable or script uploaded to a sharing channel' : null) ||
    (!staffExempt && strictMention ? 'mass/role mentions in a sharing channel' : null) ||
    vision?.reason ||
    (message.mentions.users.size + message.mentions.roles.size >= setting(db, 'mentionCount')
      ? 'mass mentions'
      : null) ||
    spamReason;
  if (!reason) return;
  try {
    await message.delete();
  } catch {
    await report(
      partik,
      `Jerry could not remove message ${message.id} in ${message.channelId}; check Manage Messages.`,
    );
    return;
  }
  await report(
    partik,
    `Jerry removed message ${message.id} from user ${message.author.id}: ${reason}.`,
  );
  if (permanent) return;
  const offence = recordOffence(db, message.author.id);
  if (!offence) return;
  if ((badEmbed || vision) && offence.days < 1) {
    offence.days = 1;
    offence.label = '1-day mute for prohibited embed/image content';
  }
  let outcome = offence.label;
  let appliedMute = false;
  if (offence.days) {
    if (!member.moderatable) {
      db.prepare('UPDATE offences SET permanent=0 WHERE user=?').run(member.id);
      outcome = 'Warning — this account cannot be timed out by Discord';
      await report(
        partik,
        `Cannot time out ${member.id}: owner/admin or role hierarchy restriction.`,
      );
    } else
      try {
        await member.timeout(offence.days * 86400000, `Offence #${offence.count}: ${reason}`);
        appliedMute = true;
      } catch {
        outcome += ' — could not apply; staff notified';
        await report(
          partik,
          `Timeout failed for ${member.id}. Check role hierarchy and Moderate Members.`,
        );
      }
  }
  await logCase(partik, db, env, {
    action: appliedMute ? 'Automod mute' : 'Automod warning',
    user: message.author,
    reason,
    source: 'Jerry automod',
    duration: appliedMute ? offence.label : undefined,
    ...(appliedMute
      ? {
          effect: {
            previous: previousTimeout,
            expires: member.communicationDisabledUntilTimestamp,
            offence_count: offence.count,
            previous_permanent: previousPermanent,
          },
        }
      : {}),
  }).catch((e) => console.error('Automod case log:', e.message));
  await message.author
    .send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle(brandTitle('Server moderation notice'))
          .setDescription(`Your message in **${safeText(message.guild.name)}** was removed.`)
          .addFields(
            { name: 'Reason', value: reason },
            { name: 'Offence', value: String(offence.count), inline: true },
            { name: 'Action', value: outcome, inline: true },
          )
          .setFooter({
            text: 'Disagree? Open an appeal ticket. Spam bursts count as one incident.',
          }),
      ],
      allowedMentions: { parse: [] },
    })
    .catch(() =>
      report(partik, `Could not DM user ${message.author.id}; their DMs may be closed.`),
    );
}
partik.on(Events.MessageCreate, (m) =>
  moderate(m).catch((e) => console.error('Moderation error', e.name)),
);
partik.on(Events.MessageUpdate, (_old, m) => {
  if (!m.partial) moderate(m, true).catch((e) => console.error('Moderation edit error', e.name));
});
onInteraction(partik, async (i) => {
  if (!i.isChatInputCommand() || !['moderation-status', 'mod-unmute'].includes(i.commandName))
    return;
  if (!admin(i)) return i.reply(ephemeral('Administrators only.'));
  if (i.commandName === 'mod-unmute') {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const member = await i.guild.members.fetch(i.options.getUser('member', true).id);
    await member.timeout(null, 'Administrator removed mute');
    db.prepare('DELETE FROM offences WHERE user=?').run(member.id);
    await logCase(partik, db, env, {
      action: 'Unmute',
      user: member.user,
      actor: i.user,
      reason: 'Administrator removed timeout and offence history',
    });
    return i.editReply('Mute and offence history cleared.');
  }
  await i.reply(
    ephemeral(
      `Jerry checks ads, spam, mass mentions and ${blocked.length} prohibited phrases including common disguises. Offences 1–2 warn, 3 mutes 1 day, 4 mutes 3 days, 5 mutes 7 days, 6+ permanently mutes until /mod-unmute. Permanent mutes use renewed 28-day timeouts. One incident per 30 seconds. Staff bypass link/word filters but still receive spam warnings. Discord cannot time out owners/admins. Closed DMs do not prevent moderation.`,
    ),
  );
});

// 2. Aerel Utility: persistent dropdown/modal handlers; private channels; no destructive close.
const utility = makeClient(
  'Feris Utility',
  [
    dashboardCommand,
    command('ticket-setup', 'Create private ticket categories and post the ticket panel', true),
    command('ticket-close', 'Close and lock the current ticket'),
    command('basefind', 'Share a base find (Chrisp+ members only)')
      .addStringOption((o) =>
        o
          .setName('description')
          .setDescription('Describe your base find')
          .setMaxLength(1800)
          .setRequired(true),
      )
      .addAttachmentOption((o) =>
        o.setName('picture').setDescription('Attach a picture of the base').setRequired(true),
      )
      .addBooleanOption((o) =>
        o.setName('anonymous').setDescription('Hide your name from the public post (default: yes)'),
      ),
  ],
  true,
);
let infrastructure;
utility.once(Events.ClientReady, () => {
  infrastructure = (async () => {
    const guild = utility.guilds.cache.get(env.GUILD_ID);
    await installIcons(guild);
    return ensureServerFeatures(guild, db);
  })();
  infrastructure
    .then(() => console.log('Server roles, transcript archive and base finds ready.'))
    .catch((e) => console.error('Server feature setup:', e.message));
});
function ticketPanel() {
  return {
    content: '',
    embeds: [
      new EmbedBuilder()
        .setColor(0x20b9df)
        .setTitle(brandTitle('Tickets'))
        .setDescription('Need help? **Make a selection below** to open a private ticket.')
        .addFields({
          name: 'Ticket Info',
          value:
            '• Choose the category that fits your question.\n• Explain your issue clearly and be patient.\n• Please do not open troll or duplicate tickets.\n• Please do not spam ping our staff. If we don’t answer fast we either are busy or sleeping.\n• Use common sense in tickets.',
        })
        .setFooter({ text: 'CHRISP • Support Team' }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('ticket:kind')
          .setPlaceholder('Make a selection')
          .addOptions(
            kinds.map((value, n) => ({
              label: labels[n],
              value,
              emoji: icon(value === 'something-else' ? 'other' : value),
              description: [
                'Questions and general support',
                'Products, prices and payments',
                'Request a punishment review',
                'Help with another topic',
              ][n],
            })),
          ),
      ),
    ],
  };
}
utility.once(Events.ClientReady, async () => {
  try {
    await infrastructure;
    const saved = db.prepare("SELECT value FROM settings WHERE key='panel'").get()?.value;
    if (saved) {
      const [channelId, messageId] = saved.split(':');
      const ch = await utility.channels.fetch(channelId);
      const msg = await ch.messages.fetch(messageId);
      await msg.edit(ticketPanel());
    }
    for (const row of db.prepare('SELECT channel,owner,kind FROM tickets').all()) {
      const ch = await utility.channels.fetch(row.channel).catch(() => null);
      if (!ch?.isTextBased()) continue;
      const messages = await ch.messages.fetch({ limit: 100 });
      const panelMessage = messages.find(
        (m) =>
          m.author.id === utility.user.id &&
          m.components.some((r) => r.components.some((c) => c.customId === 'ticket:close')),
      );
      if (panelMessage) {
        await panelMessage.edit({
          embeds: panelMessage.embeds.map((e) =>
            EmbedBuilder.from(e)
              .setTitle(brandTitle(e.title || 'Ticket'))
              .setFooter({ text: 'CHRISP • Support Team' }),
          ),
          components: [controls()],
        });
        if (row.kind === 'purchase') {
          const subject = panelMessage.embeds[0]?.fields.find((f) => f.name === 'Subject')?.value;
          const product = Object.entries(products).find(([, label]) => label === subject)?.[0];
          const pricing = messages.find(
            (m) =>
              m.author.id === utility.user.id &&
              m.embeds.some((e) =>
                ['Purchase Information', 'Account Purchase Information'].includes(
                  e.title?.replace(/^CHRISP\s*•\s*/, ''),
                ),
              ),
          );
          if (product && pricing) await pricing.edit({ embeds: [priceEmbed(product)] });
        }
      }
      const welcome = messages.find(
        (m) =>
          m.author.id === utility.user.id &&
          m.content.startsWith('**') &&
          m.components.some((r) => r.components.some((c) => c.customId === 'ticket:close')),
      );
      if (welcome) {
        const subject =
          welcome.content.match(/\*\*Subject:\*\* ([^\n]+)/)?.[1] || 'Support request';
        const details =
          welcome.content.match(/\*\*Details:\*\* ([\s\S]*?)\n\n/)?.[1] ||
          'Please describe your issue below.';
        await welcome.edit({
          content: '',
          embeds: [
            new EmbedBuilder()
              .setColor(0x20b9df)
              .setTitle(brandTitle(`${labels[kinds.indexOf(row.kind)] || 'Support'} ticket`))
              .addFields(
                { name: 'Member', value: `<@${row.owner}>`, inline: true },
                { name: 'Subject', value: subject.slice(0, 1024) },
                { name: 'Details', value: details.slice(0, 1024) },
              )
              .setFooter({ text: 'Use Request staff for human help.' }),
          ],
        });
      }
    }
  } catch (e) {
    console.error('Panel refresh or rename failed:', e.name);
  }
});
function controls() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:staff')
      .setEmoji(icon('support'))
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('ticket:close')
      .setEmoji(icon('close'))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('ticket:delete-request')
      .setEmoji(icon('delete'))
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('work:current')
      .setEmoji(icon('info'))
      .setStyle(ButtonStyle.Secondary),
  );
}
async function setup(i) {
  if (!admin(i)) return i.reply(ephemeral('Administrators only.'));
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const guild = i.guild;
  // Resolve IDs and preflight all bots before creating categories.
  const botMembers = await Promise.all(clients.map((c) => guild.members.fetch(c.user.id)));
  await infrastructure;
  const support = supportRole() ? await guild.roles.fetch(supportRole()) : null;
  if (env.STAFF_ROLE_ID && (!support || support.id === guild.id))
    throw Error('Staff role must be a valid role other than @everyone');
  const overwrites = [
    { id: guild.id, type: 0, deny: [P.ViewChannel] },
    ...botMembers.map((member) => ({
      id: member.id,
      type: 1,
      allow: [
        P.ViewChannel,
        P.SendMessages,
        P.ReadMessageHistory,
        ...(member.id === utility.user.id ? [P.ManageChannels, P.ManageRoles] : []),
      ],
    })),
    ...(support
      ? [{ id: support.id, type: 0, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] }]
      : []),
  ];
  for (let n = 0; n < kinds.length; n++) {
    const key = 'category:' + kinds[n];
    const previous = db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value;
    let category = previous ? await guild.channels.fetch(previous).catch(() => null) : null;
    if (!category)
      category = await guild.channels.create({
        name: labels[n],
        type: ChannelType.GuildCategory,
        permissionOverwrites: overwrites,
        reason: 'Ticket system setup',
      });
    if (category.type !== ChannelType.GuildCategory)
      throw Error('Configured category is not a category');
    db.prepare(
      'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    ).run(key, category.id);
  }
  const oldPanel = db.prepare("SELECT value FROM settings WHERE key='panel'").get()?.value;
  if (oldPanel) {
    const [channelId, messageId] = oldPanel.split(':');
    const ch = await guild.channels.fetch(channelId).catch(() => null);
    const message = ch?.isTextBased() ? await ch.messages.fetch(messageId).catch(() => null) : null;
    if (message) {
      await message.edit(ticketPanel());
      return i.editReply(`Ticket panel updated in <#${channelId}>.`);
    }
  }
  if (!i.channel?.isTextBased()) throw Error('Use a text channel');
  const panel = await i.channel.send(ticketPanel());
  db.prepare(
    "INSERT INTO settings VALUES('panel',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(`${i.channelId}:${panel.id}`);
  await i.editReply('Ticket panel and four private categories are ready.');
}
const creating = new Set();
const deleting = new Set();
async function createTicket(i) {
  const kind = i.customId.split(':')[2];
  if (!kinds.includes(kind)) return;
  if (kind === 'purchase' && !products[i.customId.split(':')[3]])
    return i.reply(ephemeral('Please select Purchase again from the ticket panel.'));
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  if (creating.has(i.user.id)) return i.editReply('Your ticket is already being created.');
  creating.add(i.user.id);
  try {
    const existing = db
      .prepare("SELECT channel FROM tickets WHERE owner=? AND state='open'")
      .get(i.user.id);
    if (existing) {
      const live = await i.guild.channels.fetch(existing.channel).catch(() => null);
      if (live) return await i.editReply(`You already have an open ticket: <#${live.id}>.`);
      db.prepare("UPDATE tickets SET state='closed' WHERE channel=?").run(existing.channel);
    }
    const categoryId = db
      .prepare('SELECT value FROM settings WHERE key=?')
      .get('category:' + kind)?.value;
    if (!categoryId) return await i.editReply('Ask an administrator to run /ticket-setup first.');
    const parent = await i.guild.channels.fetch(categoryId);
    const channel = await i.guild.channels.create({
      name: `${kind}-${i.user.id.slice(-6)}`,
      type: ChannelType.GuildText,
      parent: parent.id,
      permissionOverwrites: ticketOverwrites(
        [...parent.permissionOverwrites.cache.values()],
        i.user.id,
      ),
      reason: 'Member requested a private ticket',
    });
    db.prepare('INSERT INTO tickets(channel,owner,kind) VALUES(?,?,?)').run(
      channel.id,
      i.user.id,
      kind,
    );
    const product = products[i.customId.split(':')[3]];
    const subject = kind === 'purchase' ? product : i.fields.getTextInputValue('subject');
    const details =
      kind === 'purchase'
        ? 'Budget: ' + i.fields.getTextInputValue('budget')
        : i.fields.getTextInputValue('details');
    remember(db, channel.id, i.user.id, subject, '', inferTopic(subject, kind));
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x20b9df)
          .setTitle(brandTitle(`${labels[kinds.indexOf(kind)]} ticket`))
          .setDescription('Support will be with you soon. Please be patient.')
          .addFields(
            { name: 'Member', value: `<@${i.user.id}>`, inline: true },
            { name: 'Subject', value: safeText(subject) },
            { name: 'Details', value: safeText(details).slice(0, 1024) },
          )
          .setFooter({ text: 'Use Request staff for human help. Never share passwords.' }),
      ],
      components: [controls()],
    });
    if (kind === 'purchase') await channel.send({ embeds: [priceEmbed(i.customId.split(':')[3])] });
    await i.editReply(`Your private ticket is ready: <#${channel.id}>.`);
  } finally {
    creating.delete(i.user.id);
  }
}
async function closeTicket(i) {
  const row = ticket(i.channelId);
  if (!row || row.state !== 'open') return i.reply(ephemeral('This is not an open ticket.'));
  if (i.user.id !== row.owner && !staff(i))
    return i.reply(ephemeral('Only the ticket owner or staff can close it.'));
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  await i.channel.permissionOverwrites.edit(row.owner, {
    SendMessages: false,
    SendMessagesInThreads: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
  });
  db.prepare("UPDATE tickets SET state='closed', ai=0 WHERE channel=?").run(i.channelId);
  await i.channel.send({
    content:
      '**Ticket closed.** The conversation is retained for staff review; the channel has not been deleted.',
  });
  await i.editReply('Ticket closed and locked.');
}
onInteraction(utility, async (i) => {
  if (i.isChatInputCommand() && i.commandName === 'basefind') {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const config = await infrastructure;
    const member = await i.guild.members.fetch(i.user.id);
    if (!member.roles.cache.has(config.roles['Ferlis+'].id))
      return i.editReply('The Chrisp+ role is required to use /basefind.');
    const description = i.options.getString('description', true);
    if (blockedReason(description, blocked) || adReason(description, allowed))
      return i.editReply(
        'Your description contains prohibited language or an unapproved link. Please revise it.',
      );
    const picture = i.options.getAttachment('picture', true);
    const scan = await imageModeration(
      { attachments: new Map([[picture.id, picture]]) },
      db,
      env,
    ).catch(() => null);
    if (scan)
      return i.editReply(
        'This image cannot be posted. Please contact staff if you think this is a mistake.',
      );
    if (!picture.contentType?.startsWith('image/') || picture.contentType === 'image/svg+xml')
      return i.editReply('Please attach a PNG, JPEG, WebP or GIF image.');
    const anonymous = i.options.getBoolean('anonymous') ?? true;
    const embed = new EmbedBuilder()
      .setColor(0x20b9df)
      .setTitle(
        brandTitle(anonymous ? 'Anonymous Base Find' : 'Base Find by ' + member.displayName),
      )
      .setDescription(safeText(i.options.getString('description', true)))
      .setImage(picture.url)
      .setFooter({ text: 'Submit your base finds with /basefind • CHRISP+' });
    if (!anonymous)
      embed.setAuthor({ name: member.displayName, iconURL: i.user.displayAvatarURL() });
    const post = await config.base.send({ embeds: [embed], allowedMentions: { parse: [] } });
    return i.editReply('Base find posted: ' + post.url);
  }
  if (i.isButton() && i.customId === 'ticket:delete-request') {
    const row = ticket(i.channelId);
    if (!row || (row.owner !== i.user.id && !staff(i)))
      return i.reply(ephemeral('Only the ticket owner or staff can request deletion.'));
    return i.reply({
      ...ephemeral(
        'Delete this ticket permanently? A transcript will be sent to the private staff archive and the ticket owner’s DMs first. If either delivery fails, the channel will be kept.',
      ),
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('ticket:delete-confirm:' + i.user.id)
            .setLabel('Confirm deletion')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('ticket:delete-cancel:' + i.user.id)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
  }
  if (
    i.isButton() &&
    i.customId.startsWith('ticket:delete-cancel:') &&
    i.customId.endsWith(':' + i.user.id)
  )
    return i.update({ content: 'Deletion cancelled.', components: [] });
  if (i.isButton() && i.customId.startsWith('ticket:delete-confirm:')) {
    const row = ticket(i.channelId);
    if (!row || !i.customId.endsWith(':' + i.user.id) || (row.owner !== i.user.id && !staff(i)))
      return i.reply(ephemeral('Only the requester may confirm deletion.'));
    if (deleting.has(i.channelId))
      return i.reply(ephemeral('This ticket is already being archived.'));
    deleting.add(i.channelId);
    await i.update({ content: 'Saving and delivering the transcript…', components: [] });
    try {
      const config = await infrastructure;
      await archiveTicket(i.channel, row, config.archive, db, env.DATA_DIR || './data');
      await i.editReply(
        'Transcript delivered to staff and the ticket owner. Deleting this ticket.',
      );
      await i.channel.delete('Ticket deletion confirmed; transcript delivered to staff and owner');
      db.prepare("UPDATE tickets SET state='deleted',ai=0 WHERE channel=?").run(i.channelId);
    } catch (e) {
      await i.editReply('Ticket kept: ' + e.message);
    } finally {
      deleting.delete(i.channelId);
    }
    return;
  }
  if (i.isChatInputCommand() && i.commandName === 'ticket-setup') return setup(i);
  if (i.isChatInputCommand() && i.commandName === 'ticket-close') return closeTicket(i);
  if (i.isStringSelectMenu() && i.customId === 'ticket:kind') {
    const kind = i.values[0];
    if (!kinds.includes(kind)) return;
    if (kind === 'purchase')
      return i.reply({
        ...ephemeral('What Are you interested in buying'),
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('ticket:product')
              .setPlaceholder('What Are you interested in buying')
              .addOptions(Object.entries(products).map(([value, label]) => ({ value, label }))),
          ),
        ],
      });
    return i.showModal(
      new ModalBuilder()
        .setCustomId('ticket:new:' + kind)
        .setTitle(brandTitle(labels[kinds.indexOf(kind)] + ' ticket'))
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('subject')
              .setLabel(kind === 'something-else' ? 'What is your ticket about?' : 'Subject')
              .setStyle(TextInputStyle.Short)
              .setMaxLength(100)
              .setRequired(true),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('details')
              .setLabel('What happened, and how can we help?')
              .setStyle(TextInputStyle.Paragraph)
              .setMaxLength(1800)
              .setRequired(true),
          ),
        ),
    );
  }
  if (i.isStringSelectMenu() && i.customId === 'ticket:product') {
    const product = i.values[0];
    if (!products[product]) return;
    return i.showModal(
      new ModalBuilder()
        .setCustomId('ticket:new:purchase:' + product)
        .setTitle(brandTitle('Purchase — ' + products[product]))
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('budget')
              .setLabel('What is your budget?')
              .setStyle(TextInputStyle.Short)
              .setMaxLength(200)
              .setRequired(true),
          ),
        ),
    );
  }
  if (i.isModalSubmit() && i.customId.startsWith('ticket:new:')) return createTicket(i);
  if (i.isButton() && i.customId === 'ticket:close') return closeTicket(i);
  if (i.isButton() && i.customId === 'ticket:staff') {
    const row = ticket(i.channelId);
    if (!row || row.state !== 'open' || (row.owner !== i.user.id && !staff(i)))
      return i.reply(ephemeral('Only this ticket’s owner or staff may request help.'));
    const key = 'staffping:' + i.channelId;
    const last = Number(db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || 0);
    if (Date.now() - last < 300000)
      return i.reply(ephemeral('Staff have already been requested. Please wait a few minutes.'));
    db.prepare(
      'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    ).run(key, String(Date.now()));
    const ping = supportRole() ? `<@&${supportRole()}> ` : '';
    await i.channel.send({
      content: ping + 'Human assistance requested. Please review this ticket.',
      allowedMentions: { roles: supportRole() ? [supportRole()] : [], parse: [] },
    });
    return i.reply(ephemeral('Staff assistance requested.'));
  }
});
utility.on(Events.MessageCreate, async (message) => {
  if (message.guildId !== env.GUILD_ID || message.author.bot || message.webhookId) return;
  const row = ticket(message.channelId);
  if (!row || row.state !== 'open' || row.owner === message.author.id) return;
  const member =
    message.member || (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!member) return;
  const isStaff =
    member.permissions.has(P.Administrator) ||
    member.permissions.has(P.ManageMessages) ||
    Boolean(supportRole() && member.roles.cache.has(supportRole()));
  if (
    !shouldNotifyTicketReply(row, { authorId: message.author.id, bot: message.author.bot, isStaff })
  )
    return;
  try {
    const user = await utility.users.fetch(row.owner);
    const url = `https://discord.com/channels/${env.GUILD_ID}/${message.channelId}`;
    await user.send({
      embeds: [
        new EmbedBuilder()
          .setColor(colors.good)
          .setDescription(
            `**A Staff member has responded to your ticket!**\n[Open your ticket](${url})`,
          )
          .setFooter({ text: 'CHRISP • Support Team' }),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel('View ticket').setStyle(ButtonStyle.Link).setURL(url),
        ),
      ],
    });
  } catch {
    await report(
      utility,
      `Could not DM ticket owner ${row.owner} about staff reply ${message.id}; DMs may be closed.`,
    );
  }
});

// 3. Aerial Assistance: only explicit admin teaching is persisted as trusted knowledge.
const assistance = makeClient(
  'Ferlis Support',
  [
    correctionCommand,
    command('teach', 'Save or update an approved support question and answer', true)
      .addStringOption((o) =>
        o
          .setName('question')
          .setDescription('Example question')
          .setMaxLength(300)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('answer')
          .setDescription('Approved answer suitable for members')
          .setMaxLength(1800)
          .setRequired(true),
      )
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Existing knowledge ID to update').setMinValue(1),
      ),
    command('knowledge', 'List saved support knowledge', true),
    command('forget', 'Remove an incorrect support answer', true).addIntegerOption((o) =>
      o.setName('id').setDescription('Knowledge ID').setRequired(true).setMinValue(1),
    ),
    command('ai-enable', 'Enable configured AI in this ticket after member consent', true),
    command('ai-disable', 'Turn off AI processing in your current ticket'),
    command('ask', 'Ask a support question in your ticket').addStringOption((o) =>
      o
        .setName('question')
        .setDescription('Your support question; no passwords or payment details')
        .setMaxLength(2000)
        .setRequired(true),
    ),
  ],
  true,
);
assistance.once(Events.ClientReady, async () => {
  try {
    for (const row of db.prepare('SELECT channel FROM tickets').all()) {
      const channel = await assistance.channels.fetch(row.channel).catch(() => null);
      if (!channel?.isTextBased()) continue;
      const messages = await channel.messages.fetch({ limit: 100 });
      for (const message of messages.values())
        if (message.author.id === assistance.user.id && /\[#\d+\]/.test(message.content)) {
          const first = message.content
            .split('\n\n')[0]
            .replace(/^\*\*[^\n]+\*\*\n/, '')
            .replace(/\s*\[#\d+\]/g, '')
            .trim();
          if (first) await message.edit({ content: first, allowedMentions: { parse: [] } });
        }
    }
  } catch (e) {
    console.error('Support answer cleanup:', e.message);
  }
});
const busy = new Set();
const lastAnswer = new Map();
async function answer(channel, question) {
  if (busy.has(channel.id)) return null;
  busy.add(channel.id);
  try {
    const row = ticket(channel.id);
    const config = row?.ai ? env : { ...env, AI_PROVIDER: 'off' };
    if (!db.prepare('SELECT channel FROM support_memory WHERE channel=?').get(channel.id)) {
      const messages = await channel.messages.fetch({ limit: 50 });
      const welcome = messages.find(
        (m) =>
          m.author.id === utility.user.id &&
          m.embeds.some((e) => e.fields?.some((f) => f.name === 'Subject')),
      );
      const subject = welcome?.embeds[0]?.fields.find((f) => f.name === 'Subject')?.value;
      if (subject) remember(db, channel.id, row.owner, subject, '', inferTopic(subject, row.kind));
    }
    const context = contextualQuestion(db, channel.id, row.owner, question, row.kind);
    const result = context.corrected || (await supportAnswer(db, context.question, config));
    // Closing a ticket while AI is running must stop the pending public answer.
    const current = ticket(channel.id);
    if (current?.state !== 'open' || (row?.ai && !current.ai)) return null;
    remember(db, channel.id, row.owner, question, result, context.topic);
    lastAnswer.set(channel.id, Date.now());
    return safeText(result);
  } finally {
    busy.delete(channel.id);
  }
}
onInteraction(assistance, async (i) => {
  if (!i.isChatInputCommand()) return;
  if (['teach', 'knowledge', 'forget', 'ai-enable'].includes(i.commandName) && !admin(i))
    return i.reply(ephemeral('Administrators only.'));
  if (i.commandName === 'teach') {
    const q = i.options.getString('question', true),
      a = i.options.getString('answer', true),
      id = i.options.getInteger('id');
    if (id) {
      const change = db
        .prepare('UPDATE knowledge SET question=?,answer=?,author=? WHERE id=?')
        .run(q, a, i.user.id, id);
      return i.reply(
        ephemeral(change.changes ? `Updated knowledge #${id}.` : 'Knowledge ID not found.'),
      );
    }
    const result = db
      .prepare('INSERT INTO knowledge(question,answer,author) VALUES(?,?,?)')
      .run(q, a, i.user.id);
    return i.reply(
      ephemeral(
        `Saved knowledge #${result.lastInsertRowid}. Related ticket questions can now use this answer.`,
      ),
    );
  }
  if (i.commandName === 'knowledge') {
    const rows = db.prepare('SELECT id,question FROM knowledge ORDER BY id DESC LIMIT 20').all();
    return i.reply(
      ephemeral(
        rows.map((x) => `#${x.id}: ${safeText(x.question).slice(0, 70)}`).join('\n') ||
          'No knowledge saved. Use /teach.',
      ),
    );
  }
  if (i.commandName === 'forget') {
    const result = db
      .prepare('DELETE FROM knowledge WHERE id=?')
      .run(i.options.getInteger('id', true));
    return i.reply(ephemeral(result.changes ? 'Answer removed.' : 'Knowledge ID not found.'));
  }
  const row = ticket(i.channelId);
  if (!row || row.state !== 'open')
    return i.reply(ephemeral('Use this command inside an open support ticket.'));
  if (i.commandName === 'ai-disable') {
    if (row.owner !== i.user.id && !staff(i))
      return i.reply(ephemeral('Only this ticket’s owner or staff can disable AI.'));
    db.prepare('UPDATE tickets SET ai=0 WHERE channel=?').run(i.channelId);
    return i.reply(
      ephemeral('AI processing is off. Direct approved-answer lookup remains available.'),
    );
  }
  if (i.commandName === 'ai-enable') {
    if (!env.AI_PROVIDER || env.AI_PROVIDER === 'off')
      return i.reply(
        ephemeral('Configure an AI provider first. Approved answers still work without AI.'),
      );
    await i.channel.send({
      content: `An administrator wants to enable **${env.AI_PROVIDER === 'openai' ? 'OpenAI cloud AI' : 'local Ollama AI'}** in this ticket. Your questions and relevant approved support answers will be processed by that provider. No full transcript is sent. Ticket owner: choose whether you agree.`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('ai:consent')
            .setLabel('I agree — enable AI')
            .setStyle(ButtonStyle.Primary),
        ),
      ],
    });
    return i.reply(ephemeral('The ticket owner must agree using the button.'));
  }
  if (i.commandName === 'ask') {
    if (row.owner !== i.user.id && !staff(i))
      return i.reply(ephemeral('Only this ticket’s owner or staff can ask here.'));
    await i.deferReply();
    try {
      return i.editReply({
        content:
          (await answer(i.channel, i.options.getString('question', true))) ||
          'Please wait a few seconds before asking again.',
        allowedMentions: { parse: [] },
      });
    } catch {
      return i.editReply('AI is unavailable right now. Please use Request staff.');
    }
  }
});
// Consent buttons are handled by Aerial Assistance, not Aerel Utility.
onInteraction(assistance, async (i) => {
  if (!i.isButton() || i.customId !== 'ai:consent') return;
  const row = ticket(i.channelId);
  if (!row || row.owner !== i.user.id || row.state !== 'open')
    return i.reply(ephemeral('Only the owner of an open ticket can enable AI.'));
  db.prepare('UPDATE tickets SET ai=1 WHERE channel=?').run(i.channelId);
  await i.update({
    content:
      'The ticket owner agreed. AI assistance is enabled for this ticket. Use /ask or type your question here.',
    components: [],
  });
});
assistance.on(Events.MessageCreate, async (m) => {
  if (m.guildId !== env.GUILD_ID || m.author.bot) return;
  const row = ticket(m.channelId);
  if (!row || row.state !== 'open' || m.author.id !== row.owner || !m.content.trim()) return;
  const directed =
    m.mentions.users.has(assistance.user.id) ||
    (m.reference?.messageId &&
      (await m.channel.messages.fetch(m.reference.messageId).catch(() => null))?.author.id ===
        assistance.user.id);
  if (
    !directed &&
    !/[?？]/.test(m.content) &&
    !/^\s*(how|what|where|when|why|can|could|would|does|do|is|are|will|help|hi+|hello|hey|thanks|thank|i need|i want|i can.t|it won.t|it doesn.t|and|also|then|so|yes|no|ok)\b/i.test(
      m.content,
    )
  )
    return;
  try {
    await m.channel.sendTyping();
    const result = await answer(m.channel, m.content);
    if (result) {
      const reply = await m.channel.send({ content: result, allowedMentions: { parse: [] } });
      db.prepare('INSERT INTO support_answers VALUES(?,?,?,?,?)').run(
        reply.id,
        m.channelId,
        m.content.slice(0, 2000),
        result,
        Date.now(),
      );
    }
  } catch {
    await m.channel
      .send('I could not answer right now. Please use **Request staff**.')
      .catch(() => {});
  }
});

installModeration(partik, db, env, blocked);
const community = installCommunity(utility, partik, db, env, () => infrastructure);
installReviews(partik, db, env);
installReviews(utility, db, env);
installOperations(utility, partik, assistance, db, env, () => community.ready());

if (validate) {
  controls().toJSON();
  ticketPanel().embeds[0].toJSON();
  ticketPanel().components[0].toJSON();
  console.log(
    JSON.stringify(
      definitions.map((d) => ({ name: d.name, commands: d.commands.map((c) => c.name) })),
    ),
  );
  for (const c of clients) c.destroy();
  db.close();
} else {
  for (const [client, token] of [
    [partik, env.PARTIK_TOKEN],
    [utility, env.UTILITY_TOKEN],
    [assistance, env.ASSISTANCE_TOKEN],
  ]) {
    await client.login(token).catch(() => {
      throw Error('Bot login failed; check the corresponding local token and gateway intents.');
    });
  }
  setInterval(() => {
    if (process.connected)
      process.send({ type: 'health', ready: clients.every((c) => c.isReady()) });
  }, 15000).unref();
  if (assistance.user.id !== env.ASSISTANCE_ID)
    throw Error('ASSISTANCE_ID must match the Aerial Assistance bot.');
  async function stop() {
    for (const c of clients) c.destroy();
    db.close();
    process.exit(0);
  }
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
