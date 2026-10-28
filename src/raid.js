import { brandTitle } from './ui.js';
import { Events, EmbedBuilder } from 'discord.js';
import { RaidShield, setting, trackMessage } from './operations-store.js';
import { adReason } from './core.js';
export function createRaidGuard(client, db, env, allowed) {
  const shield = new RaidShield();
  let lastJoinAlert = 0,
    lastLinkAlert = 0;
  const config = () =>
    Object.fromEntries(
      [
        'joinCount',
        'joinSeconds',
        'mentionCount',
        'linkCount',
        'linkSeconds',
        'spamCount',
        'spamRepeat',
        'spamSeconds',
      ].map((k) => [k, setting(db, k)]),
    );
  async function alert(title, description) {
    const id = db.prepare("SELECT value FROM settings WHERE key='channel:logs'").get()?.value;
    if (!id) return;
    const channel = await client.channels.fetch(id);
    const message = await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle(brandTitle(title))
          .setDescription(description)
          .setTimestamp(),
      ],
      allowedMentions: { parse: [] },
    });
    trackMessage(db, 'moderation', message);
  }
  client.on(Events.GuildMemberAdd, (member) => {
    if (member.guild.id !== env.GUILD_ID || member.user.bot) return;
    const cfg = config();
    if (shield.join(cfg) && Date.now() - lastJoinAlert > 30000) {
      lastJoinAlert = Date.now();
      alert(
        'Possible join raid',
        `${cfg.joinCount} or more joins within ${cfg.joinSeconds} seconds.\nLatest account: <@${member.id}> (${member.id})\nReview new members before taking action. No accounts were automatically banned.`,
      ).catch((e) => console.error('Raid alert:', e.message));
    }
  });
  return {
    config,
    check(message) {
      const cfg = config();
      if (message.mentions.users.size + message.mentions.roles.size >= cfg.mentionCount)
        return 'mass mentions';
      if (
        adReason(message.content || '', allowed) &&
        shield.link(message.content || '', message.author.id, cfg)
      ) {
        if (Date.now() - lastLinkAlert > 30000) {
          lastLinkAlert = Date.now();
          alert(
            'Repeated unapproved link campaign',
            `An unapproved link was shared by at least ${cfg.linkCount} distinct accounts within ${cfg.linkSeconds} seconds.\nLatest message: ${message.id}\nChannel: <#${message.channelId}>\nJerry is removing messages under the existing advertising rules.`,
          ).catch((e) => console.error('Raid link alert:', e.message));
        }
        return 'coordinated repeated unapproved links';
      }
      return null;
    },
  };
}
