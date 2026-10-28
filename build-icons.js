import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
const paths = {
  lock: '<rect x="7" y="12" width="18" height="15" rx="2"/><path d="M10 12V8a6 6 0 0 1 12 0v4"/>',
  unlock: '<rect x="7" y="12" width="18" height="15" rx="2"/><path d="M10 12V8a6 6 0 0 1 12 0"/>',
  rename: '<path d="m7 22 14-14 4 4-14 14-6 1zM19 10l4 4"/>',
  limit: '<circle cx="12" cy="10" r="4"/><path d="M4 27v-5a8 8 0 0 1 16 0v5M25 13v10M20 18h10"/>',
  info: '<circle cx="16" cy="16" r="12"/><path d="M16 14v9M16 8v1"/>',
  kick: '<path d="M14 5H5v22h9M12 16h17M23 10l6 6-6 6"/>',
  mute: '<rect x="12" y="3" width="8" height="15" rx="4"/><path d="M8 14v2a8 8 0 0 0 16 0v-2M16 24v5M10 29h12M3 3l26 26"/>',
  unmute:
    '<rect x="12" y="3" width="8" height="15" rx="4"/><path d="M8 14v2a8 8 0 0 0 16 0v-2M16 24v5M10 29h12"/>',
  deafen: '<path d="M5 22v-6a11 11 0 0 1 22 0v6M5 16h5v11H5zM22 16h5v11h-5zM3 3l26 26"/>',
  undeafen: '<path d="M5 22v-6a11 11 0 0 1 22 0v6M5 16h5v11H5zM22 16h5v11h-5z"/>',
  id: '<rect x="3" y="7" width="26" height="19" rx="2"/><circle cx="11" cy="14" r="3"/><path d="M6 22a5 5 0 0 1 10 0M20 13h5M20 19h5"/>',
  claim: '<path d="m4 9 6 6 6-10 6 10 6-6-3 17H7z"/>',
  support: '<circle cx="16" cy="9" r="5"/><path d="M6 28v-3a10 10 0 0 1 20 0v3"/>',
  purchase:
    '<rect x="5" y="11" width="22" height="17" rx="2"/><path d="M11 11V8a5 5 0 0 1 10 0v3M16 16v7M13 18h6"/>',
  appeal: '<path d="m16 3 11 4v9c0 7-11 13-11 13S5 23 5 16V7zM16 9v8M16 22v1"/>',
  other:
    '<circle cx="6" cy="16" r="2"/><circle cx="16" cy="16" r="2"/><circle cx="26" cy="16" r="2"/>',
  close: '<path d="M7 7l18 18M25 7 7 25"/>',
  delete: '<path d="M5 8h22M11 8V4h10v4M8 8l2 20h12l2-20M13 13v10M19 13v10"/>',
  transfer: '<path d="M4 10h23M21 4l6 6-6 6M28 23H5M11 17l-6 6 6 6"/>',
  trust: '<circle cx="12" cy="9" r="5"/><path d="M3 27v-3a9 9 0 0 1 18 0v3M21 14l3 3 6-7"/>',
  untrust: '<circle cx="12" cy="9" r="5"/><path d="M3 27v-3a9 9 0 0 1 18 0v3M22 13h8"/>',
  save: '<path d="M5 3h19l4 4v22H5zM10 3v9h12V3M10 29V19h13v10"/>',
};
const result = {};
for (const [name, path] of Object.entries(paths))
  result[name] = (
    await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 32 32"><g fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${path}</g></svg>`,
      ),
    )
      .png()
      .toBuffer()
  ).toString('base64');
await writeFile(new URL('./assets/ui-icons.json', import.meta.url), JSON.stringify(result));
console.log('Created', Object.keys(result).length, 'white icons');
