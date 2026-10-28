const escape = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const safeURL = (value) => {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' ? u.href : '';
  } catch {
    return '';
  }
};
const imageURL = (value) =>
  /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(value || '')
    ? value
    : safeURL(value);
function image(src, cls, alt = '') {
  const url = imageURL(src);
  return url
    ? `<img class="${cls}" src="${escape(url)}" alt="${escape(alt)}" loading="lazy" referrerpolicy="no-referrer">`
    : '';
}
export function transcriptHTML(channel, row, messages, avatars = new Map()) {
  const users = new Map(
    messages
      .filter((m) => m.author)
      .map((m) => [
        m.author.id,
        m.member?.displayName || m.author.globalName || m.author.username || m.author.tag,
      ]),
  );
  function markdown(text) {
    const pattern =
      /```(?:[^\n`]*\n)?([\s\S]*?)```|`([^`\n]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|<@!?(\d+)>|<@&(\d+)>|<#(\d+)>/g;
    let out = '',
      last = 0;
    for (const m of String(text ?? '').matchAll(pattern)) {
      out += escape(String(text).slice(last, m.index));
      if (m[1] !== undefined) out += '<pre class="code">' + escape(m[1]) + '</pre>';
      else if (m[2]) out += '<code>' + escape(m[2]) + '</code>';
      else if (m[3]) out += '<strong>' + escape(m[3]) + '</strong>';
      else if (m[4]) out += '<u>' + escape(m[4]) + '</u>';
      else if (m[5]) {
        const url = safeURL(m[6]);
        out += url
          ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(m[5])}</a>`
          : escape(m[5]);
      } else {
        const name = m[7]
          ? users.get(m[7]) || channel.guild?.members?.cache?.get(m[7])?.displayName || m[7]
          : m[8]
            ? channel.guild?.roles?.cache?.get(m[8])?.name || m[8]
            : channel.guild?.channels?.cache?.get(m[9])?.name || m[9];
        out += `<span class="mention">${m[9] ? '#' : '@'}${escape(name)}</span>`;
      }
      last = m.index + m[0].length;
    }
    return (out + escape(String(text ?? '').slice(last))).replace(/\n/g, '<br>');
  }
  function embed(e) {
    const color =
      Number.isInteger(e.color) && e.color >= 0 && e.color <= 0xffffff
        ? '#' + e.color.toString(16).padStart(6, '0')
        : '#5865f2';
    const title = e.title
      ? `<div class="embed-title">${safeURL(e.url) ? `<a href="${escape(safeURL(e.url))}" rel="noopener noreferrer" target="_blank">${escape(e.title)}</a>` : escape(e.title)}</div>`
      : '';
    const fields = (e.fields || [])
      .map(
        (f) =>
          `<div class="field ${f.inline ? 'inline' : ''}"><b>${markdown(f.name)}</b><div>${markdown(f.value)}</div></div>`,
      )
      .join('');
    return `<section class="embed" style="border-left-color:${color}">${image(e.thumbnail?.proxyURL || e.thumbnail?.url, 'thumbnail')}<div class="embed-body">${e.author?.name ? `<div class="embed-author">${image(e.author.proxyIconURL || e.author.iconURL, 'small-avatar')}${escape(e.author.name)}</div>` : ''}${title}${e.description ? `<div class="description">${markdown(e.description)}</div>` : ''}${fields ? `<div class="fields">${fields}</div>` : ''}${image(e.image?.proxyURL || e.image?.url, 'embed-image')}${e.footer?.text || e.timestamp ? `<div class="footer">${image(e.footer?.proxyIconURL || e.footer?.iconURL, 'footer-icon')}${escape(e.footer?.text || '')}${e.timestamp ? ' • ' + escape(new Date(e.timestamp).toLocaleString('en-GB', { timeZone: 'UTC' })) + ' UTC' : ''}</div>` : ''}</div></section>`;
  }
  const entries = messages
    .map((m) => {
      const name = users.get(m.author?.id) || 'System';
      const avatar =
        avatars.get(m.author?.id) ||
        m.member?.displayAvatarURL?.({ extension: 'png', size: 64 }) ||
        m.author?.displayAvatarURL?.({ extension: 'png', size: 64 });
      const timestamp = new Date(m.createdTimestamp).toISOString();
      const attachments = [...(m.attachments?.values?.() || [])]
        .map((a) => {
          const url = safeURL(a.url);
          return `<div class="attachment">${/^image\//.test(a.contentType || '') ? image(a.proxyURL || a.url, 'attachment-image', a.name) : ''}${url ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">📎 ${escape(a.name || 'Attachment')}</a>` : escape(a.name)}</div>`;
        })
        .join('');
      const controls = (m.components || [])
        .map(
          (r) =>
            `<div class="controls">${(r.components || []).map((c) => `<span class="control ${c.style === 4 ? 'danger' : c.style === 1 ? 'primary' : ''}">${escape(c.label || c.placeholder || c.options?.map((o) => o.label).join(' / ') || 'Control')}</span>`).join('')}</div>`,
        )
        .join('');
      return `<article class="message"><div class="avatar-wrap">${image(avatar, 'avatar', name) || `<div class="avatar fallback">${escape(name[0] || '?')}</div>`}</div><div class="message-body"><header><b>${escape(name)}</b>${m.author?.bot ? '<span class="bot-tag">APP</span>' : ''}<time datetime="${timestamp}" title="${timestamp}">${escape(timestamp.replace('T', ' ').replace(/\.\d+Z$/, ' UTC'))}</time></header>${m.content ? `<div class="content">${markdown(m.content)}</div>` : ''}${(m.embeds || []).map(embed).join('')}${attachments}${controls}<div class="message-id">${escape(m.author?.id || '')} · ${escape(m.id || '')}</div></div></article>`;
    })
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>${escape(channel.name)} — Ticket transcript</title><style>
*{box-sizing:border-box}body{background:#313338;color:#dbdee1;font:15px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0}.page{max-width:1040px;margin:0 auto;padding:32px 20px}.ticket-header{border-bottom:1px solid #45474e;padding:0 12px 24px;margin-bottom:12px}h1{font-size:26px;color:#f2f3f5;margin:0 0 8px}.meta,.notice{font-size:12px;color:#aeb2ba}.notice{margin-top:10px}.message{display:flex;gap:16px;padding:16px 12px;border-radius:5px}.message:hover{background:#2e3035}.avatar-wrap{flex:0 0 40px}.avatar{display:block;width:40px;height:40px;border-radius:50%;object-fit:cover}.fallback{display:grid;place-items:center;background:#5865f2;color:white;font-size:21px}.message-body{min-width:0;flex:1}header{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:3px}header b{color:#f2f3f5;font-size:15px}.bot-tag{font-size:10px;line-height:15px;background:#5865f2;color:white;border-radius:3px;padding:0 4px;font-weight:600}time{font-size:11px;color:#a0a4ac}.content,.description,.field{overflow-wrap:anywhere}.embed{position:relative;max-width:560px;background:#2b2d31;border:1px solid #25262b;border-left:4px solid;border-radius:4px;margin:8px 0 0;padding:14px 16px;overflow:hidden}.embed-title{font-size:16px;font-weight:700;color:#f2f3f5;margin:0 0 8px}.description{font-size:14px}.fields{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin-top:12px}.field{grid-column:span 6;font-size:14px}.field.inline{grid-column:span 2}.field b{display:block;margin-bottom:3px;color:#f2f3f5}.footer{display:flex;align-items:center;gap:6px;margin-top:14px;font-size:11px;color:#c1c4ca}.embed-author{display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px;margin-bottom:8px}.small-avatar{width:24px;height:24px;border-radius:50%}.footer-icon{width:18px;height:18px;border-radius:50%}.thumbnail{float:right;width:72px;max-height:90px;object-fit:contain;margin:0 0 8px 16px;border-radius:4px}.embed-image,.attachment-image{display:block;max-width:100%;max-height:450px;border-radius:4px;margin-top:12px;object-fit:contain}.attachment{margin-top:8px}.attachment a{display:inline-block;margin-top:5px;font-size:13px}a{color:#73baff;text-decoration:none}a:hover{text-decoration:underline}.mention{background:#414675;color:#d3d6ff;border-radius:3px;padding:0 2px}code,.code{background:#1e1f22;border-radius:4px;padding:2px 5px;font:13px ui-monospace,monospace}.code{padding:12px;white-space:pre-wrap}.controls{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.control{font-size:13px;font-weight:500;background:#4e5058;color:#f2f3f5;border-radius:4px;padding:7px 14px}.control.primary{background:#5865f2}.control.danger{background:#da373c}.message-id{font-size:10px;color:#8a8e97;margin-top:5px}@media(max-width:600px){.page{padding:20px 8px}.message{gap:10px;padding:14px 6px}.field.inline{grid-column:span 3}.embed{padding:12px}.thumbnail{width:50px}time{font-size:10px}}
</style></head><body><main class="page"><div class="ticket-header"><h1># ${escape(channel.name)}</h1><div class="meta">${escape(channel.guild?.name || 'Discord ticket')} · ${messages.length} messages · Owner ${escape(users.get(row.owner) || row.owner)}</div><div class="meta">Guild ${escape(channel.guildId)} · Channel ${escape(channel.id)}</div><div class="notice">Profile pictures are saved into this file when available. Other images and attachments use original links, which Discord may expire. Deleted or unavailable messages cannot be recovered. All times are UTC.</div></div>${entries}</main></body></html>`;
}
export async function transcriptAvatars(messages, fetcher = fetch) {
  const avatars = new Map();
  let bytes = 0;
  const deadline = Date.now() + 15000;
  for (const m of messages) {
    if (Date.now() > deadline || avatars.size >= 64) break;
    const id = m.author?.id;
    if (!id || avatars.has(id)) continue;
    const url =
      m.member?.displayAvatarURL?.({ extension: 'png', size: 64 }) ||
      m.author?.displayAvatarURL?.({ extension: 'png', size: 64 });
    if (!url) continue;
    try {
      const parsed = new URL(url);
      if (
        parsed.protocol !== 'https:' ||
        !['cdn.discordapp.com', 'media.discordapp.net'].includes(parsed.hostname)
      )
        continue;
      const response = await fetcher(url, { signal: AbortSignal.timeout(4000), redirect: 'error' });
      const mime = response.headers.get('content-type')?.split(';')[0];
      if (
        !response.ok ||
        !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime) ||
        Number(response.headers.get('content-length') || 0) > 262144
      )
        continue;
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length > 262144 || bytes + data.length > 2 * 1024 * 1024) continue;
      bytes += data.length;
      avatars.set(id, `data:${mime};base64,${data.toString('base64')}`);
    } catch {
      /* Use the original avatar URL if embedding is unavailable. */
    }
  }
  return avatars;
}
