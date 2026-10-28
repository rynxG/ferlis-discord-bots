import { gifFrames } from './gif-frames.js';
// Only still images and sampled GIF frames, never member IDs or ticket transcripts.
export function moderationImages(message) {
  const urls = [...(message.attachments?.values?.() || [])]
    .filter((a) => /^image\/(png|jpeg|webp)$/.test(a.contentType || ''))
    .map((a) => a.url);
  for (const e of (message.embeds || []).filter(
    (e) => e.type !== 'gifv' && !/tenor\.com|giphy\.com/.test(e.url || ''),
  ))
    for (const media of [e.image, e.thumbnail]) if (media) urls.push(media.proxyURL || media.url);
  return [...new Set(urls)]
    .filter((raw) => {
      try {
        const u = new URL(raw);
        return (
          u.protocol === 'https:' &&
          [
            'cdn.discordapp.com',
            'media.discordapp.net',
            'images-ext-1.discordapp.net',
            'images-ext-2.discordapp.net',
          ].includes(u.hostname) &&
          !u.pathname.toLowerCase().endsWith('.gif')
        );
      } catch {
        return false;
      }
    })
    .slice(0, 4);
}
export async function imageModeration(message, db, env = process.env, fetcher = fetch) {
  if (env.MODERATION_PROVIDER !== 'openai' || !env.OPENAI_MODERATION_KEY) return null;
  // Do not send suspected CSAM to this endpoint; leave review/reporting to staff.
  const context = [
    message.content,
    ...(message.embeds || []).flatMap((e) => [e.title, e.description]),
    ...[...(message.attachments?.values?.() || [])].map((a) => a.name),
  ]
    .filter(Boolean)
    .join(' ');
  if (/\b(?:csam|child\s*porn|underage\s*(?:nude|sex))\b/i.test(context))
    return {
      reviewOnly: true,
      reason:
        'Suspected prohibited child-safety content requires staff review; image not sent to AI.',
    };
  const urls = [...moderationImages(message), ...(await gifFrames(message, fetcher))];
  if (!urls.length) return null;
  const day = 'image:' + new Date().toISOString().slice(0, 10);
  const used = db.prepare('SELECT count FROM usage WHERE day=?').get(day)?.count || 0;
  if (used >= Number(env.MODERATION_DAILY_LIMIT || 1000))
    throw Error('Image moderation daily limit reached');
  db.prepare(
    'INSERT INTO usage(day,count) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET count=count+1',
  ).run(day);
  const response = await fetcher('https://api.openai.com/v1/moderations', {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + env.OPENAI_MODERATION_KEY,
    },
    body: JSON.stringify({
      model: 'omni-moderation-latest',
      input: urls.map((url) => ({ type: 'image_url', image_url: { url } })),
    }),
  });
  if (!response.ok) throw Error('Image moderation service returned ' + response.status);
  const body = await response.json();
  if (!Array.isArray(body.results) || !body.results.length)
    throw Error('Invalid image moderation response');
  // Avoid punishing ordinary Minecraft combat imagery. Act on explicit sexual content or graphic gore.
  const categories = ['sexual', 'violence/graphic'];
  const found = body.results.flatMap((r) =>
    categories.filter((c) => r.flagged && r.categories?.[c]),
  );
  return found.length
    ? { reason: 'prohibited image content (' + [...new Set(found)].join(', ') + ')' }
    : null;
}
