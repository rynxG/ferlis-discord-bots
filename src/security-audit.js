import { Client, GatewayIntentBits as I, PermissionFlagsBits as P } from 'discord.js';
const client = new Client({ intents: [I.Guilds, I.GuildMembers] });
try {
  await client.login(process.env.PARTIK_TOKEN);
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  await guild.fetch();
  await guild.roles.fetch();
  await guild.channels.fetch();
  await guild.members.fetch();
  const normal = guild.roles.cache.filter((r) =>
    [
      '@everyone',
      'Member',
      'Ferlis+',
      'Chrisp+',
      'CHRISP+',
      'FERLIS+',
      'Media Team',
      'Server Booster',
      'voice-access',
    ].includes(r.name),
  );
  const data = {
    name: guild.name,
    features: guild.features,
    verification: guild.verificationLevel,
    contentFilter: guild.explicitContentFilter,
    mfa: guild.mfaLevel,
    premium: guild.premiumTier,
    memberCount: guild.memberCount,
    icon: Boolean(guild.icon),
    banner: Boolean(guild.banner),
    roles: guild.roles.cache
      .sort((a, b) => b.position - a.position)
      .map((r) => ({
        id: r.id,
        name: r.name,
        position: r.position,
        managed: r.managed,
        hoist: r.hoist,
        color: r.hexColor,
        permissions: r.permissions.toArray(),
      })),
    members: guild.members.cache.map((m) => ({
      id: m.user.bot ? m.id : m.id === guild.ownerId ? 'OWNER' : 'MEMBER',
      name: m.user.bot ? m.displayName : m.id === guild.ownerId ? 'Owner' : 'Member',
      bot: m.user.bot,
      roles: m.roles.cache.filter((r) => r.id !== guild.id).map((r) => r.id),
      permissions: m.permissions.toArray(),
    })),
    channels: guild.channels.cache.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      parent: c.parentId,
      slowmode: c.rateLimitPerUser || 0,
      overwrites: c.permissionOverwrites?.cache.map((o) => ({
        id: o.id,
        type: o.type,
        allow: o.allow.toArray(),
        deny: o.deny.toArray(),
      })),
      publicRoles: normal.map((r) => ({
        name: r.name,
        view: c.permissionsFor(r)?.has(P.ViewChannel) || false,
        send: c.permissionsFor(r)?.has(P.SendMessages) || false,
        threads: c.permissionsFor(r)?.has(P.CreatePublicThreads) || false,
        manage: c.permissionsFor(r)?.has(P.ManageChannels) || false,
      })),
    })),
    webhooks: await guild
      .fetchWebhooks()
      .then((h) =>
        h.map((w) => ({ id: w.id, channel: w.channelId, ownerBot: w.owner?.bot || false })),
      )
      .catch(() => []),
    automod: await guild.autoModerationRules
      .fetch()
      .then((r) =>
        r.map((rule) => ({
          id: rule.id,
          name: rule.name,
          enabled: rule.enabled,
          trigger: rule.triggerType,
        })),
      )
      .catch(() => []),
  };
  console.log('SECURITY_AUDIT_V1 ' + JSON.stringify(data));
} finally {
  client.destroy();
}
