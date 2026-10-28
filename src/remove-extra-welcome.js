import { REST, Routes } from 'discord.js';
const rest = new REST({ version: '10' }).setToken(process.env.UTILITY_TOKEN);
const channel = '1562499165332967605',
  utility = '1562505750884913274';
const messages = await rest.get(Routes.channelMessages(channel), {
  query: new URLSearchParams({ limit: '100' }),
});
const matches = messages.filter(
  (m) =>
    m.author.id === utility &&
    m.embeds?.some(
      (e) =>
        e.title === 'FERLIS • Community' &&
        e.description ===
          'Welcome to Ferlis Client. Join our Discord community using the button below.',
    ),
);
if (matches.length !== 1) throw Error('Expected exactly one extra invite panel; nothing changed.');
await rest.delete(Routes.channelMessage(channel, matches[0].id), {
  reason: 'Owner requested removal of the extra invite panel; retain normal welcomes and bot bios',
});
console.log('Removed only the extra community invite panel.');
