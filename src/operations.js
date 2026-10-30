import { brandTitle } from './ui.js';
import {
  Events,
  PermissionFlagsBits as P,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  SlashCommandBuilder,
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  AttachmentBuilder,
} from 'discord.js';
import { operationsSchema, setting, setSetting, audit, trackMessage } from './operations-store.js';
import { createBackup, rotateBackups, maintain } from './maintenance.js';
import { reviewButtons } from './moderation-review.js';
import { resolve, join } from 'node:path';
const ep = (content) => ({
  content,
  flags: MessageFlags.Ephemeral,
  allowedMentions: { parse: [] },
});
const button = (id, label, style = ButtonStyle.Secondary) =>
  new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const row = (...buttons) => new ActionRowBuilder().addComponents(buttons);
const text = (id, label, value, max = 1800) =>
  new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label)
      .setStyle(max > 200 ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setMaxLength(max)
      .setRequired(true)
      .setValue(String(value ?? '')),
  );
const modal = (id, title, ...fields) =>
  new ModalBuilder().setCustomId(id).setTitle(brandTitle(title)).addComponents(fields);
export const dashboardCommand = new SlashCommandBuilder()
  .setName('staff-dashboard')
  .setDescription('Open the staff control dashboard')
  .setDMPermission(false)
  .setDefaultMemberPermissions(P.ManageMessages);
export const correctionCommand = new ContextMenuCommandBuilder()
  .setName('Correct support answer')
  .setType(ApplicationCommandType.Message)
  .setDMPermission(false)
  .setDefaultMemberPermissions(P.ManageMessages);
export function isStaff(member, db) {
  return Boolean(
    member?.permissions?.has(P.Administrator) ||
      member?.permissions?.has(P.ManageMessages) ||
      ['Support Team', 'Development Team', 'Moderator'].some((name) =>
        member?.roles?.cache?.has(
          db.prepare('SELECT value FROM settings WHERE key=?').get('role:' + name)?.value,
        ),
      ),
  );
}
export async function offerRating(client, db, channel, ticket) {
  db.prepare(
    'INSERT INTO ticket_work(channel,resolved) VALUES(?,?) ON CONFLICT(channel) DO UPDATE SET resolved=excluded.resolved',
  ).run(channel.id, Date.now());
  const payload = {
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle(brandTitle('Ticket resolved'))
        .setDescription(
          `How was your support experience in **${channel.name}**?\nChoose 1 (poor) to 5 (excellent). One rating per ticket.`,
        ),
    ],
    components: [
      row(
        ...[1, 2, 3, 4, 5].map((n) =>
          button(`rating:${channel.id}:${ticket.owner}:${n}`, String(n), ButtonStyle.Secondary),
        ),
      ),
    ],
    allowedMentions: { parse: [] },
  };
  await channel.send(payload);
  const owner = await client.users.fetch(ticket.owner);
  await owner.send(payload).catch(() => {});
}
export function dashboardPayload(db, clients) {
  const retention = (key) => (setting(db, key) ? setting(db, key) + ' days' : 'Keep (cleanup off)');
  const open = db.prepare("SELECT count(*) AS n FROM tickets WHERE state='open'").get().n;
  const pending = db
    .prepare(
      'SELECT count(*) AS n FROM media_submissions s LEFT JOIN application_reviews r ON r.id=s.id WHERE r.id IS NULL',
    )
    .get().n;
  const last = db
    .prepare('SELECT created FROM backup_runs ORDER BY created DESC LIMIT 1')
    .get()?.created;
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x2b2d31)
        .setTitle(brandTitle('Staff Dashboard'))
        .setDescription(
          'Manage the server from one place. Settings, global answers, privacy and backups require Administrator.',
        )
        .addFields(
          { name: 'Open tickets', value: String(open), inline: true },
          { name: 'Applications awaiting review', value: String(pending), inline: true },
          {
            name: 'Bot health',
            value: clients.map(([name, c]) => `${c.isReady() ? '🟢' : '🔴'} ${name}`).join('\n'),
            inline: true,
          },
          {
            name: 'Last database backup',
            value: last ? `<t:${Math.floor(last / 1000)}:R>` : 'Not yet created',
          },
          {
            name: 'Privacy',
            value: `Transcript: ${retention('transcriptDays')} · Applications: ${retention('applicationDays')} · Cases: ${retention('moderationDays')}\nTicket memory: ${setting(db, 'memoryMinutes')} minutes · Backups: ${setting(db, 'backupDays')} days`,
          },
        )
        .setTimestamp(),
    ],
    components: [
      row(
        button('desk:tickets', 'Tickets'),
        button('desk:applications', 'Applications'),
        button('desk:moderation', 'Moderation review'),
        button('desk:knowledge', 'Approved answers'),
      ),
      row(
        button('desk:settings', 'Moderation settings'),
        button('desk:privacy', 'Privacy'),
        button('desk:backup', 'Create backup'),
        button('desk:health', 'Refresh health'),
      ),
    ],
    allowedMentions: { parse: [] },
  };
}
export function installOperations(utility, jerry, assistance, db, env, baseReady) {
  operationsSchema(db);
  const clients = [
      ['Moderation', jerry],
      ['Chrisp Utility • Commands', utility],
      ['Chrisp AI • Commands', assistance],
    ],
    locks = new Set();
  let ready,
    dashboard,
    maintenanceBusy = false;
  const get = (key) => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value;
  const put = (key, value) =>
    db
      .prepare(
        'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, String(value));
  async function log(actor, description) {
    audit(db, actor, description);
    const ch = get('channel:logs')
      ? await utility.channels.fetch(get('channel:logs')).catch(() => null)
      : null;
    if (ch)
      await ch.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle(brandTitle('Staff action'))
            .setDescription(`<@${actor}> · ${description}`.slice(0, 3900))
            .setTimestamp(),
        ],
        allowedMentions: { parse: [] },
      });
  }
  async function refresh() {
    if (!dashboard) return;
    const old = get('dashboard:message')
      ? await dashboard.messages.fetch(get('dashboard:message')).catch(() => null)
      : null;
    if (old) await old.edit(dashboardPayload(db, clients));
    else put('dashboard:message', (await dashboard.send(dashboardPayload(db, clients))).id);
  }
  async function setup() {
    await baseReady();
    const guild = await utility.guilds.fetch(env.GUILD_ID);
    await guild.channels.fetch();
    for (const ticket of db
      .prepare("SELECT channel FROM tickets WHERE state IN ('open','closed')")
      .all())
      if (!guild.channels.cache.has(ticket.channel))
        db.prepare("UPDATE tickets SET state='deleted',ai=0 WHERE channel=?").run(ticket.channel);
    dashboard = get('channel:staff-dashboard')
      ? await guild.channels.fetch(get('channel:staff-dashboard')).catch(() => null)
      : null;
    if (!dashboard) {
      const parent = get('category:staff-tools');
      dashboard = await guild.channels.create({
        name: 'staff-dashboard',
        type: ChannelType.GuildText,
        parent,
        reason: 'Staff dashboard requested by owner',
        permissionOverwrites: [
          { id: guild.id, type: 0, deny: [P.ViewChannel] },
          ...['Support Team', 'Development Team', 'Moderator']
            .map((n) => get('role:' + n))
            .filter(Boolean)
            .map((id) => ({
              id,
              type: 0,
              allow: [P.ViewChannel, P.ReadMessageHistory],
              deny: [P.SendMessages],
            })),
          {
            id: utility.user.id,
            type: 1,
            allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory],
          },
        ],
      });
      put('channel:staff-dashboard', dashboard.id);
    }
    const reviewChannel = get('channel:media-review')
      ? await guild.channels.fetch(get('channel:media-review'))
      : null;
    if (reviewChannel)
      for (const message of (await reviewChannel.messages.fetch({ limit: 100 })).values()) {
        if (message.author.id !== utility.user.id) continue;
        const appId = message.embeds[0]?.description?.match(
          /Application ID: ([a-f0-9-]{36})/i,
        )?.[1];
        if (appId && db.prepare('SELECT id FROM media_submissions WHERE id=?').get(appId)) {
          db.prepare('INSERT OR IGNORE INTO application_messages VALUES(?,?,?)').run(
            appId,
            message.channelId,
            message.id,
          );
          trackMessage(db, 'application', message);
        }
      }
    await refresh();
    await runMaintenance();
    setInterval(
      () => runMaintenance().catch((e) => console.error('Maintenance:', e.message)),
      3600000,
    ).unref();
    setInterval(
      () => refresh().catch((e) => console.error('Dashboard:', e.message)),
      300000,
    ).unref();
    console.log('Staff dashboard, support memory, reviews, privacy and backups ready.');
  }
  async function runMaintenance() {
    if (maintenanceBusy) return;
    maintenanceBusy = true;
    try {
      const last =
        db.prepare('SELECT created FROM backup_runs ORDER BY created DESC LIMIT 1').get()
          ?.created || 0;
      if (Date.now() - last > 12 * 3600000) await createBackup(db, env.DATA_DIR || './data');
      await rotateBackups(db, env.DATA_DIR || './data');
      await maintain(db, utility, env.DATA_DIR || './data', { dryRun: false });
      await refresh();
    } finally {
      maintenanceBusy = false;
    }
  }
  utility.on(Events.ChannelDelete, (channel) => {
    if (channel.guildId === env.GUILD_ID) {
      db.prepare("UPDATE tickets SET state='deleted',ai=0 WHERE channel=?").run(channel.id);
      db.prepare('DELETE FROM support_memory WHERE channel=?').run(channel.id);
    }
  });
  utility.once(Events.ClientReady, () => {
    ready = setup();
    ready.catch((e) => console.error('Operations setup:', e.message));
  });
  async function member(i) {
    return i.guild.members.fetch(i.user.id);
  }
  async function requireStaff(i) {
    if (!isStaff(await member(i), db)) throw Error('Staff access required.');
  }
  function requireAdmin(i) {
    if (!i.memberPermissions?.has(P.Administrator))
      throw Error('Administrator permission required.');
  }
  function ticketDetails(channel) {
    const ticket = db.prepare('SELECT * FROM tickets WHERE channel=?').get(channel);
    if (!ticket) throw Error('Ticket not found.');
    const work = db.prepare('SELECT * FROM ticket_work WHERE channel=?').get(channel);
    return { ticket, work };
  }
  function workPayload(channel) {
    const { ticket, work } = ticketDetails(channel);
    return {
      ...ep(
        `Ticket: <#${channel}>\nOwner: <@${ticket.owner}>\nState: ${ticket.state}\nClaimed by: ${work?.claimed ? '<@' + work.claimed + '>' : 'Unclaimed'}\nTeam: ${work?.team || ticket.kind}\nRating: ${work?.rating || 'Not rated'}`,
      ),
      components: [
        row(
          button('work:claim:' + channel, 'Claim / release'),
          button('work:transfer:' + channel, 'Transfer team'),
          button('work:resolve:' + channel, 'Mark resolved', ButtonStyle.Success),
        ),
      ],
    };
  }
  async function selection(i, type, page = 0) {
    await requireStaff(i);
    if (type === 'knowledge') requireAdmin(i);
    const size = 20,
      offset = page * size;
    let entries;
    if (type === 'tickets')
      entries = db
        .prepare(
          "SELECT t.channel AS value,t.kind||' · '||t.state AS label,t.owner AS description FROM tickets t WHERE t.state IN ('open','closed') ORDER BY rowid DESC LIMIT ? OFFSET ?",
        )
        .all(size, offset);
    if (type === 'applications')
      entries = db
        .prepare(
          "SELECT s.id AS value,'Application '||substr(s.id,1,8) AS label,s.user||' · '||coalesce(r.status,'Pending') AS description FROM media_submissions s LEFT JOIN application_reviews r ON r.id=s.id ORDER BY s.created DESC LIMIT ? OFFSET ?",
        )
        .all(size, offset);
    if (type === 'moderation')
      entries = db
        .prepare(
          "SELECT c.id AS value,c.action||' · '||substr(c.id,1,8) AS label,c.user||' · '||coalesce(r.status,'Pending') AS description FROM moderation_cases c LEFT JOIN case_reviews r ON r.id=c.id ORDER BY c.created DESC LIMIT ? OFFSET ?",
        )
        .all(size, offset);
    if (type === 'knowledge')
      entries = db
        .prepare(
          'SELECT cast(id AS TEXT) AS value,question AS label,answer AS description FROM knowledge ORDER BY id DESC LIMIT ? OFFSET ?',
        )
        .all(size, offset);
    const components = [];
    if (entries?.length)
      components.push(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('desk-select:' + type)
            .setPlaceholder('Choose an entry')
            .addOptions(
              entries.map((e) => ({
                value: e.value,
                label: e.label.slice(0, 100),
                description: e.description.slice(0, 100),
              })),
            ),
        ),
      );
    components.push(
      row(
        button(`desk-page:${type}:${Math.max(0, page - 1)}`, 'Previous'),
        button(`desk-page:${type}:${page + 1}`, 'Next'),
        ...(type === 'knowledge' ? [button('desk:knowledge-new', 'Add approved answer')] : []),
      ),
    );
    return i.reply({
      ...ep(
        `${type[0].toUpperCase() + type.slice(1)} · Page ${page + 1}${entries?.length ? '' : ' · No entries'}`,
      ),
      components,
    });
  }
  utility.on(Events.InteractionCreate, async (i) => {
    const id = i.customId || '';
    if (i.guildId && i.guildId !== env.GUILD_ID) return;
    if (i.commandName !== 'staff-dashboard' && !/^(desk[:\-]|work:|rating:)/.test(id)) return;
    try {
      if (id.startsWith('rating:')) {
        const [, channel, owner, value] = id.split(':');
        if (i.user.id !== owner) throw Error('Only the ticket owner can rate this ticket.');
        const { ticket, work } = ticketDetails(channel);
        if (ticket.owner !== owner || !work?.resolved || work.rating)
          throw Error('This ticket has already been rated or is not resolved.');
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1 || n > 5) throw Error('Invalid rating.');
        db.prepare(
          'UPDATE ticket_work SET rating=?,rated=? WHERE channel=? AND rating IS NULL',
        ).run(n, Date.now(), channel);
        return i.reply({ ...ep('Thank you! Your ' + n + '/5 rating was recorded.') });
      }
      if (!i.guildId) throw Error('Use the staff dashboard in the server.');
      await requireStaff(i);
      await ready;
      if (i.commandName === 'staff-dashboard' || id === 'desk:health')
        return i.reply({ ...dashboardPayload(db, clients), flags: MessageFlags.Ephemeral });
      if (id === 'work:current') return i.reply(workPayload(i.channelId));
      if (id.startsWith('work:')) {
        const [, action, channelId] = id.split(':'),
          { ticket, work } = ticketDetails(channelId);
        if (locks.has(channelId)) throw Error('Another staff action is running on this ticket.');
        if (action === 'transfer' && !i.isStringSelectMenu())
          return i.reply({
            ...ep('Choose the staff team that should handle this ticket.'),
            components: [
              new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                  .setCustomId('work:transfer:' + channelId)
                  .setPlaceholder('Receiving team')
                  .addOptions(
                    ['Support Team', 'Development Team', 'Moderator'].map((value) => ({
                      label: value,
                      value,
                    })),
                  ),
              ),
            ],
          });
        locks.add(channelId);
        try {
          await i.deferReply({ flags: MessageFlags.Ephemeral });
          const channel = await i.guild.channels.fetch(channelId);
          if (action === 'claim') {
            if (ticket.state !== 'open') throw Error('Only open tickets can be claimed.');
            if (
              work?.claimed &&
              work.claimed !== i.user.id &&
              !i.memberPermissions.has(P.Administrator)
            )
              throw Error('Another staff member has already claimed this ticket.');
            const claimed = work?.claimed === i.user.id ? null : i.user.id;
            db.prepare(
              'INSERT INTO ticket_work(channel,claimed) VALUES(?,?) ON CONFLICT(channel) DO UPDATE SET claimed=excluded.claimed',
            ).run(channelId, claimed);
            await channel.send({
              embeds: [
                new EmbedBuilder()
                  .setColor(0x57f287)
                  .setDescription(
                    claimed
                      ? `<@${claimed}> claimed this ticket.`
                      : 'This ticket is available for staff to claim.',
                  ),
              ],
              allowedMentions: { parse: [] },
            });
            await i.editReply(claimed ? 'Ticket claimed.' : 'Claim released.');
          } else if (action === 'transfer') {
            if (ticket.state !== 'open') throw Error('Only open tickets can be transferred.');
            const team = i.values[0];
            if (!['Support Team', 'Development Team', 'Moderator'].includes(team))
              throw Error('Invalid team.');
            const roleId = get('role:' + team);
            if (!roleId) throw Error('Receiving team role is missing.');
            const rules = [
              { id: i.guildId, type: 0, deny: [P.ViewChannel] },
              {
                id: ticket.owner,
                type: 1,
                allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles],
              },
              { id: roleId, type: 0, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] },
              ...clients.map(([, c]) => ({
                id: c.user.id,
                type: 1,
                allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageChannels],
              })),
            ];
            let category = get('team-category:' + team)
              ? await i.guild.channels.fetch(get('team-category:' + team)).catch(() => null)
              : null;
            if (!category) {
              category = await i.guild.channels.create({
                name: team + ' Tickets',
                type: ChannelType.GuildCategory,
                permissionOverwrites: rules.filter((r) => r.id !== ticket.owner),
                reason: 'Private team ticket routing',
              });
              put('team-category:' + team, category.id);
            }
            await channel.permissionOverwrites.set(rules, 'Ticket transferred to ' + team);
            await channel.setParent(category.id, {
              lockPermissions: false,
              reason: 'Ticket transferred to ' + team,
            });
            db.prepare(
              'INSERT INTO ticket_work(channel,team) VALUES(?,?) ON CONFLICT(channel) DO UPDATE SET team=excluded.team,claimed=NULL',
            ).run(channelId, team);
            await i.editReply('Transferred to ' + team + '. The owner retains access.');
          } else if (action === 'resolve') {
            if (ticket.state !== 'open') throw Error('This ticket is already closed.');
            await channel.permissionOverwrites.edit(ticket.owner, {
              SendMessages: false,
              SendMessagesInThreads: false,
              CreatePublicThreads: false,
              CreatePrivateThreads: false,
            });
            db.prepare("UPDATE tickets SET state='closed',ai=0 WHERE channel=?").run(channelId);
            db.prepare('DELETE FROM support_memory WHERE channel=?').run(channelId);
            await offerRating(utility, db, channel, ticket);
            await i.editReply('Ticket resolved and locked. A satisfaction rating was requested.');
          } else throw Error('Unknown ticket action.');
          await log(i.user.id, `Ticket ${channelId}: ${action}`);
          await refresh();
          return;
        } finally {
          locks.delete(channelId);
        }
      }
      if (id.startsWith('desk-page:')) {
        const [, type, page] = id.split(':');
        if (!['tickets', 'applications', 'moderation', 'knowledge'].includes(type))
          throw Error('Unknown page.');
        return selection(i, type, Math.min(1000, Math.max(0, Number(page) || 0)));
      }
      if (['desk:tickets', 'desk:applications', 'desk:moderation', 'desk:knowledge'].includes(id))
        return selection(i, id.split(':')[1]);
      if (id.startsWith('desk-select:')) {
        const type = id.split(':')[1],
          value = i.values[0];
        if (type === 'tickets') return i.reply(workPayload(value));
        if (type === 'moderation')
          return i.reply({ ...ep('Review case ' + value), components: [reviewButtons(value)] });
        if (type === 'applications') {
          const app = db.prepare('SELECT * FROM media_submissions WHERE id=?').get(value);
          if (!app) throw Error('Application expired.');
          const review = db.prepare('SELECT * FROM application_reviews WHERE id=?').get(value);
          const original = db.prepare('SELECT * FROM application_messages WHERE id=?').get(value);
          return i.reply({
            ...ep(
              `Applicant: <@${app.user}>\nApplication: ${value}\nStatus: ${review?.status || 'Pending'}\n${original ? '[Read submission](https://discord.com/channels/' + env.GUILD_ID + '/' + original.channel + '/' + original.message + ')' : ''}\nStaff review applications manually.`,
            ),
            components: [row(button('desk-app:' + value, 'Mark reviewed'))],
          });
        }
        if (type === 'knowledge') {
          requireAdmin(i);
          const item = db.prepare('SELECT * FROM knowledge WHERE id=?').get(Number(value));
          if (!item) throw Error('Answer not found.');
          return i.showModal(
            modal(
              'desk-answer:' + item.id,
              'Edit approved answer',
              text('question', 'Question', item.question, 300),
              text('answer', 'Approved answer', item.answer),
            ),
          );
        }
      }
      if (id.startsWith('desk-app:')) {
        const appId = id.split(':')[1];
        if (!db.prepare('SELECT id FROM media_submissions WHERE id=?').get(appId))
          throw Error('Application expired.');
        db.prepare(
          'INSERT INTO application_reviews VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,actor=excluded.actor,updated=excluded.updated',
        ).run(appId, 'Reviewed', i.user.id, Date.now());
        await log(i.user.id, 'Application ' + appId + ' marked reviewed');
        await refresh();
        return i.reply(ep('Marked reviewed. No acceptance or rejection was sent.'));
      }
      requireAdmin(i);
      if (id === 'desk:knowledge-new')
        return i.showModal(
          modal(
            'desk-answer:new',
            'Add approved answer',
            text('question', 'Question', '', 300),
            text('answer', 'Approved answer', ''),
          ),
        );
      if (id.startsWith('desk-answer:') && i.isModalSubmit()) {
        const record = id.split(':')[1],
          q = i.fields.getTextInputValue('question'),
          a = i.fields.getTextInputValue('answer');
        if (record === 'new')
          db.prepare('INSERT INTO knowledge(question,answer,author) VALUES(?,?,?)').run(
            q,
            a,
            i.user.id,
          );
        else
          db.prepare('UPDATE knowledge SET question=?,answer=?,author=? WHERE id=?').run(
            q,
            a,
            i.user.id,
            Number(record),
          );
        await log(i.user.id, 'Approved support answer ' + record + ' saved');
        return i.reply(ep('Approved answer saved.'));
      }
      if (id === 'desk:settings')
        return i.reply({
          ...ep(
            `Raid alert: ${setting(db, 'joinCount')} joins / ${setting(db, 'joinSeconds')}s\nMass mentions: ${setting(db, 'mentionCount')}\nRepeated unapproved links: ${setting(db, 'linkCount')} distinct users / ${setting(db, 'linkSeconds')}s\nJoin bursts alert staff; existing message moderation handles offending messages.`,
          ),
          components: [
            row(
              button('desk:raid-edit', 'Raid thresholds'),
              button('desk:spam-edit', 'Spam thresholds'),
            ),
          ],
        });
      const settingForms = {
        raid: {
          title: 'Raid protection thresholds',
          fields: [
            ['joinCount', 'Joins before alert', 2, 100],
            ['joinSeconds', 'Join window in seconds', 3, 120],
            ['mentionCount', 'Mentions per message', 2, 50],
            ['linkCount', 'Distinct users sharing unapproved link', 2, 30],
            ['linkSeconds', 'Link window in seconds', 5, 300],
          ],
        },
        spam: {
          title: 'Spam protection thresholds',
          fields: [
            ['spamCount', 'Messages per window', 3, 30],
            ['spamRepeat', 'Identical messages per window', 2, 15],
            ['spamSeconds', 'Window in seconds', 3, 60],
          ],
        },
        privacy: {
          title: 'Privacy retention — 0 means keep',
          fields: [
            ['transcriptDays', 'Transcript retention days (0 = keep)', 0, 3650],
            ['applicationDays', 'Application retention days (0 = keep)', 0, 3650],
            ['moderationDays', 'Case retention days (0 = keep)', 0, 3650],
            ['memoryMinutes', 'Ticket memory minutes', 5, 1440],
            ['backupDays', 'Backup retention days', 1, 30],
          ],
        },
      };
      for (const [type, form] of Object.entries(settingForms)) {
        if (id === 'desk:' + type + '-edit')
          return i.showModal(
            modal(
              'desk-config:' + type,
              form.title,
              ...form.fields.map(([key, label]) => text(key, label, setting(db, key), 6)),
            ),
          );
        if (id === 'desk-config:' + type && i.isModalSubmit()) {
          const values = form.fields.map(([key, label, min, max]) => {
            const raw = i.fields.getTextInputValue(key),
              n = Number(raw);
            if (!/^\d+$/.test(raw) || n < min || n > max)
              throw Error(label + ': use ' + min + '–' + max);
            return [key, n];
          });
          if (type === 'privacy') {
            const token = i.user.id + ':' + Date.now();
            put('pending-retention:' + token, JSON.stringify(values));
            return i.reply({
              ...ep(
                'Apply these retention periods? Expired bot records, tracked archive/review messages, and local transcripts will be permanently removed during scheduled cleanup. Existing downloaded files and messages sent before tracking began cannot be recalled. Backups expire separately.\n' +
                  values.map(([k, v]) => k + ': ' + v).join('\n'),
              ),
              components: [
                row(button('desk-retention:' + token, 'Apply retention', ButtonStyle.Danger)),
              ],
            });
          }
          for (const [k, v] of values) setSetting(db, k, v);
          await log(i.user.id, type + ' thresholds updated');
          return i.reply(ep('Thresholds saved and active.'));
        }
      }
      if (id === 'desk:privacy')
        return i.reply({
          ...ep(
            'Retention is disabled when its value is 0. Configure periods, preview affected records, and confirm before applying. Old copies downloaded by people cannot be recalled.',
          ),
          components: [
            row(
              button('desk:privacy-edit', 'Configure retention'),
              button('desk:privacy-preview', 'Preview cleanup'),
            ),
          ],
        });
      if (id === 'desk:privacy-preview') {
        const preview = await maintain(db, utility, env.DATA_DIR || './data');
        return i.reply(ep('Dry run — nothing deleted:\n' + JSON.stringify(preview, null, 2)));
      }
      if (id.startsWith('desk-retention:')) {
        const token = id.slice('desk-retention:'.length);
        if (!token.startsWith(i.user.id + ':') || Date.now() - Number(token.split(':')[1]) > 600000)
          throw Error('Confirmation expired.');
        const pending = get('pending-retention:' + token);
        if (!pending) throw Error('Already applied or expired.');
        const values = JSON.parse(pending);
        for (const [k, v] of values) setSetting(db, k, v);
        db.prepare('DELETE FROM settings WHERE key=?').run('pending-retention:' + token);
        await log(i.user.id, 'Retention periods configured');
        await refresh();
        return i.update({
          content:
            'Retention saved. Scheduled cleanup will enforce these periods. Use Preview cleanup to inspect the current counts.',
          components: [],
        });
      }
      if (id === 'desk:backup') {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        if (maintenanceBusy) throw Error('Backup or maintenance is already running.');
        maintenanceBusy = true;
        try {
          const path = await createBackup(db, env.DATA_DIR || './data');
          await rotateBackups(db, env.DATA_DIR || './data');
          await log(i.user.id, 'Database backup created');
          await refresh();
          return i.editReply({
            content:
              'Validated database backup created. Keep this file private; it contains ticket metadata, approved answers and bot records. It excludes bot/API secrets and raw Discord message history.',
            files: [new AttachmentBuilder(path)],
          });
        } finally {
          maintenanceBusy = false;
        }
      }
    } catch (e) {
      if (i.deferred) await i.editReply({ content: e.message }).catch(() => {});
      else if (i.replied) await i.followUp(ep(e.message)).catch(() => {});
      else await i.reply(ep(e.message)).catch(() => {});
    }
  });
  assistance.on(Events.InteractionCreate, async (i) => {
    if (i.guildId !== env.GUILD_ID) return;
    try {
      if (i.isMessageContextMenuCommand() && i.commandName === 'Correct support answer') {
        await requireStaff(i);
        if (i.targetMessage.author.id !== assistance.user.id)
          throw Error('Choose an answer posted by Chrisp AI.');
        const source = db
          .prepare('SELECT * FROM support_answers WHERE message=? AND channel=?')
          .get(i.targetMessage.id, i.channelId);
        const memory = db.prepare('SELECT * FROM support_memory WHERE channel=?').get(i.channelId);
        if (!source && (!memory || memory.answer !== i.targetMessage.content))
          throw Error('This answer’s memory expired. Ask the question again first.');
        return i.showModal(
          modal(
            'support-correct:' + i.targetMessage.id,
            'Correct this ticket answer',
            text('question', 'Question being corrected', (source || memory).question, 300),
            text('answer', 'Correct answer', ''),
          ),
        );
      }
      if (i.isModalSubmit() && i.customId.startsWith('support-correct:')) {
        await requireStaff(i);
        const ticket = db
          .prepare("SELECT * FROM tickets WHERE channel=? AND state='open'")
          .get(i.channelId);
        if (!ticket) throw Error('Use this in an open ticket.');
        const question = i.fields.getTextInputValue('question'),
          answer = i.fields.getTextInputValue('answer');
        const result = db
          .prepare(
            'INSERT INTO support_corrections(channel,question,answer,author,created) VALUES(?,?,?,?,?)',
          )
          .run(i.channelId, question, answer, i.user.id, Date.now());
        audit(
          db,
          i.user.id,
          'Support correction ' + result.lastInsertRowid + ' for ticket ' + i.channelId,
        );
        await i.reply(
          ep('Saved for this ticket. Administrators can publish it as a global answer.'),
        );
        await i.channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x57f287)
              .setTitle(brandTitle('Staff answer correction'))
              .setDescription(answer)
              .setFooter({ text: 'This correction applies to this ticket.' }),
          ],
          components: i.memberPermissions.has(P.Administrator)
            ? [
                row(
                  button('support-publish:' + result.lastInsertRowid, 'Publish as approved answer'),
                ),
              ]
            : [],
          allowedMentions: { parse: [] },
        });
        return;
      }
      if (i.isButton() && i.customId.startsWith('support-publish:')) {
        requireAdmin(i);
        const correction = db
          .prepare('SELECT * FROM support_corrections WHERE id=? AND channel=?')
          .get(Number(i.customId.split(':')[1]), i.channelId);
        if (!correction) throw Error('Correction expired.');
        const existing = db
          .prepare('SELECT id FROM knowledge WHERE question=?')
          .get(correction.question);
        if (existing)
          db.prepare('UPDATE knowledge SET answer=?,author=? WHERE id=?').run(
            correction.answer,
            i.user.id,
            existing.id,
          );
        else
          db.prepare('INSERT INTO knowledge(question,answer,author) VALUES(?,?,?)').run(
            correction.question,
            correction.answer,
            i.user.id,
          );
        audit(db, i.user.id, 'Published support correction ' + correction.id);
        return i.reply(ep('Published as an admin-approved answer.'));
      }
    } catch (e) {
      if (!i.replied && !i.deferred) await i.reply(ep(e.message)).catch(() => {});
    }
  });
  return { ready: () => ready, refresh, runMaintenance };
}
