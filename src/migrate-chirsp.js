import { Client, GatewayIntentBits, REST, Routes, ChannelType } from 'discord.js';
import { readFile } from 'node:fs/promises';
import { openStore } from './core.js';
import { brandedMessageEdit } from './brand-text.js';
import { createBackup } from './maintenance.js';

if (!process.argv.includes('--apply'))
  throw new Error('Use --apply to update existing bot-written messages.');
const db = openStore(process.env.DATA_DIR || './data');
const reader = new Client({ intents: [GatewayIntentBits.Guilds] });
const tokens = [process.env.PARTIK_TOKEN, process.env.UTILITY_TOKEN, process.env.ASSISTANCE_TOKEN];
const result = { channels: 0, scanned: 0, edited: 0, errors: [] };
try {
  await createBackup(db, process.env.DATA_DIR || './data');
  const authors = new Map();
  for (const token of tokens) {
    const rest = new REST({ version: '10' }).setToken(token);
    const user = await rest.get(Routes.user('@me'));
    authors.set(user.id, {
      rest,
      avatar: user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
        : null,
    });
  }
  await reader.login(process.env.UTILITY_TOKEN);
  const guild = await reader.guilds.fetch(process.env.GUILD_ID);
  await guild.channels.fetch();
  await guild.roles.fetch();
  const premiumId = db.prepare("SELECT value FROM settings WHERE key='role:Ferlis+'").get()?.value;
  const premium = guild.roles.cache.get(premiumId);
  if (premium && ['Ferlis+', 'Chirsp+', 'Chrisp+'].includes(premium.name))
    await premium.setName('Chrisp+', 'Owner requested current product branding');
  const channels = new Map(
    guild.channels.cache.filter((channel) => channel.isTextBased() && channel.messages),
  );
  const active = await guild.channels.fetchActiveThreads().catch(() => null);
  active?.threads.forEach((thread) => channels.set(thread.id, thread));
  for (const parent of guild.channels.cache.values()) {
    if (
      !parent.threads ||
      ![ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum].includes(
        parent.type,
      )
    )
      continue;
    let before;
    for (let page = 0; page < 100; page++) {
      const archived = await parent.threads
        .fetchArchived({ type: 'public', limit: 100, ...(before ? { before } : {}) })
        .catch(() => null);
      if (!archived) break;
      archived.threads.forEach((thread) => channels.set(thread.id, thread));
      if (!archived.hasMore || !archived.threads.size) break;
      before = archived.threads.last().archiveTimestamp;
    }
  }
  const banner = await readFile(new URL('../assets/chrisp-banner.png', import.meta.url));
  for (const channel of channels.values()) {
    if (!channel.viewable) continue;
    result.channels++;
    let before;
    for (let page = 0; page < 1000; page++) {
      let messages;
      try {
        messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      } catch (error) {
        result.errors.push({
          channel: channel.id,
          operation: 'read',
          code: error.code || error.name,
        });
        break;
      }
      if (!messages.size) break;
      for (const message of messages.values()) {
        result.scanned++;
        const author = authors.get(message.author.id);
        if (!author || message.webhookId) continue;
        const original = {
          content: message.content,
          embeds: message.embeds.map((embed) => embed.toJSON()),
          components: message.components.map((row) => row.toJSON()),
        };
        let body = brandedMessageEdit(original);
        let replaceBanner = false;
        const embeds = body?.embeds || structuredClone(original.embeds);
        for (const embed of embeds) {
          if (/(?:felris|ferlis)-banner\.png/.test(embed.image?.url || '')) {
            embed.image.url = 'attachment://chrisp-banner.png';
            replaceBanner = true;
          }
          for (const item of [embed.author, embed.footer]) {
            if (!item?.icon_url) continue;
            const owner = [...authors.entries()].find(([id]) =>
              item.icon_url.includes('/avatars/' + id + '/'),
            );
            if (owner?.[1].avatar && item.icon_url !== owner[1].avatar) {
              item.icon_url = owner[1].avatar;
              body = { ...(body || {}), embeds };
            }
          }
        }
        const files = [];
        if (replaceBanner) {
          files.push({ name: 'chrisp-banner.png', data: banner, contentType: 'image/png' });
          body = {
            ...(body || {}),
            embeds,
            attachments: [...message.attachments.values()]
              .map((a) => ({ id: a.id, filename: a.name }))
              .concat([{ id: 0, filename: 'chrisp-banner.png' }]),
          };
        }
        if (!body) continue;
        try {
          await author.rest.patch(Routes.channelMessage(channel.id, message.id), {
            body,
            ...(files.length ? { files } : {}),
          });
          result.edited++;
        } catch (error) {
          result.errors.push({
            channel: channel.id,
            message: message.id,
            operation: 'edit',
            code: error.code || error.name,
          });
        }
      }
      before = messages.last().id;
      if (messages.size < 100) break;
    }
  }
  db.prepare(
    'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
  ).run('branding:chrisp-migration', new Date().toISOString());
  console.log('CHRISP_MIGRATION_RESULT ' + JSON.stringify(result));
} finally {
  db.close();
  reader.destroy();
}
