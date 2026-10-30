import { readFile } from 'node:fs/promises';
export const colors = { good: 0x57f287, bad: 0xed4245, neutral: 0x2b2d31 };
export function brandTitle(value) {
  return String(value)
    .replace(/\b(?:CHRISP|FERLIS|FELRIS|FERIS|CHIRSP)\s*[•·]\s*/gi, '')
    .trim()
    .slice(0, 100);
}
const icons = new Map();
export const icon = (name, fallback = '▫️') => icons.get(name) || fallback;
export async function installIcons(guild) {
  const images = JSON.parse(
    await readFile(new URL('../assets/ui-icons.json', import.meta.url), 'utf8'),
  );
  await guild.emojis.fetch();
  for (const [name, png] of Object.entries(images)) {
    const emoji =
      guild.emojis.cache.find((e) => e.name === 'fe_' + name) ||
      (await guild.emojis.create({
        name: 'fe_' + name,
        attachment: Buffer.from(png, 'base64'),
        reason: 'White ticket and VoiceMaster controls requested by server owner',
      }));
    icons.set(name, { id: emoji.id, name: emoji.name, animated: false });
  }
  console.log('White panel icons ready:', icons.size);
}
