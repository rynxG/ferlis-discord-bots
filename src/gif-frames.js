const hosts = new Set([
  'cdn.discordapp.com',
  'media.discordapp.net',
  'images-ext-1.discordapp.net',
  'images-ext-2.discordapp.net',
  'media.tenor.com',
  'media.giphy.com',
  'i.giphy.com',
]);
export function gifSources(message) {
  const urls = [
    ...[...(message.attachments?.values?.() || [])]
      .filter((a) => a.contentType === 'image/gif' || /\.gif(?:\?|$)/i.test(a.url || ''))
      .map((a) => a.url),
  ];
  for (const e of message.embeds || [])
    if (e.type === 'gifv' || /tenor\.com|giphy\.com|\.gif(?:\?|$)/i.test(e.url || ''))
      for (const image of [e.image, e.thumbnail]) if (image) urls.push(image.proxyURL || image.url);
  return [...new Set(urls)]
    .filter((raw) => {
      try {
        const u = new URL(raw);
        return u.protocol === 'https:' && hosts.has(u.hostname);
      } catch {
        return false;
      }
    })
    .slice(0, 2);
}
export function frameIndexes(count, limit = 8) {
  return [
    ...new Set(
      Array.from({ length: Math.min(count, limit) }, (_, n) =>
        Math.round((n * (count - 1)) / Math.max(1, Math.min(count, limit) - 1)),
      ),
    ),
  ];
}
let active = false;
export async function gifFrames(message, fetcher = fetch) {
  const sources = gifSources(message);
  if (!sources.length) return [];
  if (active) throw Error('GIF scanner busy; staff review may be needed');
  active = true;
  try {
    const { default: sharp } = await import('sharp');
    sharp.cache(false);
    sharp.concurrency(1);
    const frames = [];
    for (const url of sources) {
      const response = await fetcher(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) throw Error('GIF download failed');
      if (Number(response.headers.get('content-length')) > 8 * 1024 * 1024)
        throw Error('GIF exceeds 8 MB scan limit');
      let size = 0;
      const parts = [];
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) {
          await response.body.cancel?.().catch(() => {});
          throw Error('GIF exceeds 8 MB scan limit');
        }
        parts.push(chunk);
      }
      const bytes = Buffer.concat(parts),
        options = { limitInputPixels: 4 * 1024 * 1024, failOn: 'warning' };
      const metadata = await sharp(bytes, options).metadata();
      if ((metadata.pages || 1) > 500) throw Error('GIF exceeds 500 frame scan limit');
      for (const page of frameIndexes(metadata.pages || 1)) {
        const png = await sharp(bytes, { ...options, page, pages: 1 })
          .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
          .png()
          .toBuffer();
        frames.push('data:image/png;base64,' + png.toString('base64'));
      }
    }
    return frames;
  } finally {
    active = false;
  }
}
