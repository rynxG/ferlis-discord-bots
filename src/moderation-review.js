import { brandTitle } from './ui.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits as P,
  Events,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { operationsSchema, audit, trackMessage } from './operations-store.js';
import { staffMayTarget, caseDateFields } from './staff-moderation.js';
export const reviewButtons = (id) =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('review:details:' + id)
      .setLabel('Review reason')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('review:undo:' + id)
      .setLabel('Undo punishment')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('review:false:' + id)
      .setLabel('False positive')
      .setStyle(ButtonStyle.Secondary),
  );
export function reversalAllowed(row, latest, effect, currentUntil) {
  if (!row || !latest || latest.id !== row.id) return false;
  if (/ban/i.test(row.action) && !/unban/i.test(row.action)) return true;
  return Boolean(
    /mute|timeout/i.test(row.action) &&
      !/unmute/i.test(row.action) &&
      effect?.expires &&
      Math.abs(Number(currentUntil || 0) - effect.expires) < 2000,
  );
}
const sharedLocks = new WeakMap();
export function installReviews(client, db, env) {
  operationsSchema(db);
  const locks = sharedLocks.get(db) || new Set();
  sharedLocks.set(db, locks);
  client.on(Events.InteractionCreate, async (i) => {
    if (i.guildId !== env.GUILD_ID || !i.customId?.startsWith('review:')) return;
    try {
      const [, action, id] = i.customId.split(':'),
        row = db.prepare('SELECT * FROM moderation_cases WHERE id=?').get(id);
      if (
        !i.memberPermissions?.has(P.ManageMessages) &&
        !i.memberPermissions?.has(P.ModerateMembers) &&
        !i.memberPermissions?.has(P.BanMembers)
      )
        return i.reply({
          content: 'Staff moderation permissions required.',
          flags: MessageFlags.Ephemeral,
        });
      if (!row) throw Error('This case expired or no longer exists.');
      if (action === 'details') {
        const review = db.prepare('SELECT * FROM case_reviews WHERE id=?').get(id);
        return i.reply({
          flags: MessageFlags.Ephemeral,
          embeds: [
            new EmbedBuilder()
              .setColor(0x2b2d31)
              .setTitle(brandTitle('Moderation review'))
              .setDescription(
                `Case: ${id}\nUser: <@${row.user}> (${row.user})\nAction: ${row.action}\nReason: ${row.reason}\nReview: ${review?.status || 'Pending'}${review ? '\nReview note: ' + review.note : ''}`,
              )
              .addFields(...caseDateFields(row.created))
              .setFooter({
                text: 'False positive marks the case for review. Undo is a separate, permission-checked action.',
              }),
          ],
        });
      }
      if (!i.isModalSubmit())
        return i.showModal(
          new ModalBuilder()
            .setCustomId(`review:${action}:${id}`)
            .setTitle(
              brandTitle(action === 'undo' ? 'Confirm punishment reversal' : 'Mark false positive'),
            )
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId('reason')
                  .setLabel('Reason for this review decision')
                  .setRequired(true)
                  .setMaxLength(500)
                  .setStyle(TextInputStyle.Paragraph),
              ),
            ),
        );
      if (!['undo', 'false'].includes(action)) return;
      if (locks.has(id)) throw Error('This case is already being reviewed.');
      locks.add(id);
      try {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const note = i.fields.getTextInputValue('reason');
        let outcome = 'False positive — staff flagged this case for review; punishment unchanged.';
        if (action === 'undo') {
          if (
            db.prepare('SELECT status FROM case_reviews WHERE id=?').get(id)?.status === 'Reversed'
          )
            throw Error('This case was already reversed.');
          const banned = /ban/i.test(row.action) && !/unban/i.test(row.action);
          if (!i.memberPermissions.has(banned ? P.BanMembers : P.ModerateMembers))
            throw Error('You lack the permission to reverse this punishment.');
          const latest = db
            .prepare(
              "SELECT * FROM moderation_cases WHERE user=? AND (lower(action) LIKE '%mute%' OR lower(action) LIKE '%timeout%' OR lower(action) LIKE '%ban%') ORDER BY created DESC,rowid DESC LIMIT 1",
            )
            .get(row.user);
          const effect = db.prepare('SELECT * FROM case_effects WHERE id=?').get(id);
          const target = banned ? null : await i.guild.members.fetch(row.user);
          if (!reversalAllowed(row, latest, effect, target?.communicationDisabledUntilTimestamp))
            throw Error(
              'A later or different punishment is active, or this case has no safe reversal snapshot. Review it manually.',
            );
          if (banned) {
            if (row.user === i.guild.ownerId) throw Error('Protected account.');
            await i.guild.bans.fetch(row.user);
            await i.guild.bans.remove(row.user, 'Case reversal ' + id + ': ' + note);
          } else {
            const actor = await i.guild.members.fetch(i.user.id);
            if (!staffMayTarget(actor, target) || !target.moderatable)
              throw Error('Role hierarchy prevents this reversal.');
            await target.timeout(
              effect.previous && effect.previous > Date.now() ? new Date(effect.previous) : null,
              'Case reversal ' + id + ': ' + note,
            );
            const offence = db.prepare('SELECT * FROM offences WHERE user=?').get(row.user);
            if (offence && effect.offence_count === offence.count) {
              db.prepare('UPDATE offences SET count=max(0,count-1),permanent=? WHERE user=?').run(
                effect.previous_permanent || 0,
                row.user,
              );
            }
          }
          outcome = 'Punishment reversed. Any earlier timeout was preserved.';
        }
        db.prepare(
          'INSERT INTO case_reviews VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,actor=excluded.actor,note=excluded.note,created=excluded.created',
        ).run(id, action === 'undo' ? 'Reversed' : 'False positive', i.user.id, note, Date.now());
        audit(db, i.user.id, `Case ${id}: ${action}; ${note}`);
        const channelId = db
          .prepare("SELECT value FROM settings WHERE key='channel:logs'")
          .get()?.value;
        if (channelId) {
          const channel = await client.channels.fetch(channelId);
          const message = await channel.send({
            embeds: [
              new EmbedBuilder()
                .setColor(0x57f287)
                .setTitle(brandTitle('Moderation review updated'))
                .setDescription(
                  `Case: ${id}\nMember: <@${row.user}>\nReviewer: <@${i.user.id}>\n${outcome}\nReason: ${note}`,
                )
                .setTimestamp(),
            ],
            allowedMentions: { parse: [] },
          });
          trackMessage(db, 'moderation', message);
        }
        await i.editReply(outcome);
      } finally {
        locks.delete(id);
      }
    } catch (e) {
      const payload = { content: e.message, flags: MessageFlags.Ephemeral };
      if (i.deferred) await i.editReply({ content: e.message }).catch(() => {});
      else await i.reply(payload).catch(() => {});
    }
  });
}
