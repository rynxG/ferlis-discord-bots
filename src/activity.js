import {
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const day = 24 * 60 * 60 * 1000;
const today = () => new Date().toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() - day).toISOString().slice(0, 10);
const maxBet = 100;
const standardHourlyGambleLimit = 15;
const privilegedHourlyGambleLimit = 40;
const hour = 60 * 60 * 1000;
const gameTimeoutMs = 5 * 60 * 1000;
const redNumbers = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const rouletteColor = (number) =>
  number === 0 ? 'green' : redNumbers.has(number) ? 'red' : 'black';
const colorEmoji = (color) => ({ red: '🔴', black: '⚫', green: '🟢' })[color];
const pick = (items) => items[randomInt(items.length)];
const shuffle = (items) => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
};
const rouletteNumbers = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14,
  31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

let gifRenderQueue = Promise.resolve();
function renderGif(factory) {
  const result = gifRenderQueue.then(factory, factory);
  gifRenderQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function createRouletteGif(result) {
  const size = 440;
  const renderSize = 1080;
  const center = size / 2;
  const step = 360 / rouletteNumbers.length;
  const resultIndex = rouletteNumbers.indexOf(result);
  const finalRotation = -resultIndex * step;
  const frames = [];
  const frameCount = 32;

  for (let frame = 0; frame < frameCount; frame++) {
    const progress = frame / (frameCount - 1);
    const eased = 1 - (1 - progress) ** 4;
    const rotation = finalRotation - 3.25 * 360 * (1 - eased);
    const ballRotation = -90 - 5.5 * 360 * (1 - eased);
    const slots = rouletteNumbers
      .map((number, index) => {
        const start = (-90 + index * step - step / 2) * (Math.PI / 180);
        const end = start + step * (Math.PI / 180);
        const outer = 190;
        const inner = 132;
        const point = (radius, angle) => [
          center + radius * Math.cos(angle),
          center + radius * Math.sin(angle),
        ];
        const [x1, y1] = point(outer, start);
        const [x2, y2] = point(outer, end);
        const [x3, y3] = point(inner, end);
        const [x4, y4] = point(inner, start);
        const fill = number === 0 ? '#16834d' : redNumbers.has(number) ? '#b82d36' : '#25272d';
        return `<path d="M ${x1} ${y1} A ${outer} ${outer} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${inner} ${inner} 0 0 0 ${x4} ${y4} Z" fill="${fill}" stroke="#d2aa53" stroke-width="1.5"/><text x="${center}" y="${center - 160}" transform="rotate(${index * step} ${center} ${center})" fill="#fffdf7" stroke="#171316" stroke-width="1.5" paint-order="stroke" font-family="Arial,sans-serif" font-size="13" font-weight="800" text-anchor="middle" dominant-baseline="middle">${number}</text>`;
      })
      .join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${renderSize}" height="${renderSize}" viewBox="0 0 ${size} ${size}"><defs><radialGradient id="felt"><stop offset="0" stop-color="#127548"/><stop offset="1" stop-color="#064327"/></radialGradient><linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe59a"/><stop offset=".5" stop-color="#856021"/><stop offset="1" stop-color="#f3d378"/></linearGradient></defs><rect width="100%" height="100%" rx="24" fill="#171316"/><circle cx="${center}" cy="${center}" r="211" fill="url(#rim)" stroke="#f6df9a" stroke-width="3"/><circle cx="${center}" cy="${center}" r="198" fill="#674b1a" stroke="#a5833e" stroke-width="2"/><g transform="rotate(${rotation} ${center} ${center})">${slots}<circle cx="${center}" cy="${center}" r="130" fill="url(#felt)" stroke="#e0c16a" stroke-width="4"/><circle cx="${center}" cy="${center}" r="117" fill="none" stroke="#72c78a" stroke-opacity=".35" stroke-width="2"/><text x="${center}" y="${center + 12}" fill="#69d58e" font-family="Arial,sans-serif" font-size="52" font-weight="800" text-anchor="middle">C</text></g><g transform="rotate(${ballRotation} ${center} ${center})"><circle cx="${center}" cy="${center - 202}" r="8" fill="#fff8da" stroke="#70521e" stroke-width="3"/><circle cx="${center}" cy="${center - 202}" r="3" fill="white"/></g><path d="M ${center - 15} 6 L ${center + 15} 6 L ${center} 40 Z" fill="#fff1bd" stroke="#59451e" stroke-width="2"/><circle cx="${center}" cy="${center}" r="12" fill="#e9d184" stroke="#fff0bc" stroke-width="3"/></svg>`;
    frames.push(await sharp(Buffer.from(svg)).png().toBuffer());
  }

  return sharp(frames, { join: { animated: true } })
    .gif({
      loop: 1,
      delay: frames.map((_, index) => (index > 23 ? 130 : 70)),
      colours: 128,
      dither: 0.15,
      interFrameMaxError: 0,
      effort: 8,
    })
    .toBuffer();
}

async function createCoinGif(result) {
  const width = 360;
  const height = 260;
  const renderWidth = 1080;
  const renderHeight = 780;
  const centerX = width / 2;
  const radius = 56;
  const frames = [];
  const frameCount = 36;
  const finalAngle = result === 'heads' ? Math.PI * 8 : Math.PI * 9;
  const logoBuffer = await sharp(
    await readFile(new URL('../assets/chrisp-logo-white.png', import.meta.url)),
  )
    .resize(36, 36, { fit: 'inside' })
    .png()
    .toBuffer();
  const logoData = logoBuffer.toString('base64');

  for (let frame = 0; frame < frameCount; frame++) {
    const progress = frame / (frameCount - 1);
    const flight = Math.min(progress / 0.84, 1);
    const spin = Math.min(progress / 0.82, 1);
    const easedSpin = 1 - (1 - spin) ** 3;
    const angle = finalAngle * easedSpin;
    const face = Math.cos(angle) >= 0 ? 'HEADS' : 'TAILS';
    const faceScale = Math.max(0.035, Math.abs(Math.cos(angle)));
    const coinY = 158 - 36 * Math.sin(Math.PI * flight);
    const sideOffset = Math.sin(angle) * 7;
    const handOpacity = Math.max(0, 1 - progress / 0.15);
    const impact = progress > 0.84 ? (progress - 0.84) / 0.16 : 0;
    const bounce = progress > 0.84 ? Math.sin(impact * Math.PI * 2) * 4 * (1 - impact) : 0;
    const landedY = coinY - bounce;
    const liftGlow = Math.sin(Math.PI * flight);
    const shadowWidth = 30 + 22 * liftGlow;
    const shadowOpacity = 0.48 - 0.24 * liftGlow;
    const edgeRidges = Array.from({ length: 9 }, (_, index) => {
      const x = -40 + index * 10;
      return `<path d="M ${x} -5 v 10"/>`;
    }).join('');
    const coin = `
      <g transform="translate(${centerX} ${landedY})">
        <ellipse cx="0" cy="${sideOffset + 2}" rx="${radius + 3}" ry="${radius * faceScale + 11}" fill="#44260d"/>
        <ellipse cx="0" cy="${sideOffset}" rx="${radius + 2}" ry="${radius * faceScale + 9}" fill="url(#edge3d)" stroke="#ffe8a0" stroke-width="2"/>
        <path d="${edgeRidges}" stroke="#774711" stroke-width="2" opacity="${(0.16 + 0.68 * (1 - faceScale)).toFixed(2)}"/>
        <g transform="translate(0 ${-sideOffset * 0.4}) scale(1 ${faceScale})">
          <circle r="${radius + 1}" fill="#6a400f" stroke="#fff0b4" stroke-width="2.5"/>
          <circle r="${radius - 3}" fill="url(#gold)" stroke="url(#rim)" stroke-width="4"/>
          <circle r="${radius - 10}" fill="none" stroke="#855315" stroke-width="2"/>
          <circle r="${radius - 15}" fill="none" stroke="#fff0b4" stroke-width="1.2"/>
          <circle r="${radius - 20}" fill="none" stroke="#a66e1c" stroke-width="1" stroke-dasharray="2 3"/>
          <path d="M -34 -30 Q 0 -48 34 -30 M -34 30 Q 0 48 34 30" fill="none" stroke="#fff1bd" stroke-width="1.2" opacity=".75"/>
          <text x="0" y="-24" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" font-weight="800" letter-spacing="2.4" fill="#70440f">${face}</text>
          <image x="-18" y="-16" width="36" height="36" href="data:image/png;base64,${logoData}" opacity=".2" preserveAspectRatio="xMidYMid meet"/>
          <text x="0" y="38" text-anchor="middle" font-family="Arial,sans-serif" font-size="6.5" font-weight="800" letter-spacing="1.8" fill="#70440f">CHRISP · 50 / 50</text>
          <circle cx="0" cy="-${radius - 8}" r="2.2" fill="#fff7d7"/>
          <circle cx="0" cy="${radius - 8}" r="2.2" fill="#fff7d7"/>
        </g>
      </g>`;
    const hand = `<g opacity="${handOpacity.toFixed(2)}"><path d="M 0 229 C 22 219 45 198 70 176 C 88 161 101 151 113 151 C 123 151 128 160 122 168 C 108 184 91 198 77 212 C 62 225 42 239 20 247 Z" fill="url(#skin)" stroke="#d7a789" stroke-width="2"/><path d="M 0 253 C 27 245 49 229 71 216 C 88 206 103 199 112 202 C 121 206 121 215 112 222 C 92 238 69 251 46 260 H 0 Z" fill="url(#skinLight)" stroke="#edc0a0" stroke-width="2"/><path d="M 17 228 C 48 214 71 188 98 170 M 15 250 C 43 239 65 221 89 210" fill="none" stroke="#f7d1ad" stroke-width="2" opacity=".7"/><path d="M 94 169 Q 106 161 115 161 M 89 212 Q 101 206 110 207" fill="none" stroke="#8c5140" stroke-width="1.5" opacity=".7"/></g>`;
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${renderWidth}" height="${renderHeight}" viewBox="0 0 ${width} ${height}">
        <defs>
          <radialGradient id="backdrop" cx="50%" cy="42%" r="78%"><stop offset="0" stop-color="#492832"/><stop offset=".58" stop-color="#26151f"/><stop offset="1" stop-color="#100d16"/></radialGradient>
          <radialGradient id="halo"><stop offset="0" stop-color="#ffca62" stop-opacity=".28"/><stop offset="1" stop-color="#ffca62" stop-opacity="0"/></radialGradient>
          <radialGradient id="gold" cx="32%" cy="26%" r="78%"><stop offset="0" stop-color="#fffbe0"/><stop offset=".14" stop-color="#f8e6a2"/><stop offset=".34" stop-color="#d69b36"/><stop offset=".58" stop-color="#f4ce68"/><stop offset=".79" stop-color="#ad6b17"/><stop offset="1" stop-color="#f3d477"/></radialGradient>
          <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0b6"/><stop offset=".3" stop-color="#a66c1c"/><stop offset=".62" stop-color="#ffe6a0"/><stop offset="1" stop-color="#8a5717"/></linearGradient>
          <linearGradient id="edge3d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff4c9"/><stop offset=".18" stop-color="#805017"/><stop offset=".4" stop-color="#f4ce71"/><stop offset=".62" stop-color="#7d4b12"/><stop offset=".82" stop-color="#ffe8a5"/><stop offset="1" stop-color="#734610"/></linearGradient>
          <linearGradient id="skin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f2c29a"/><stop offset=".48" stop-color="#d99572"/><stop offset="1" stop-color="#9d5e4d"/></linearGradient>
          <linearGradient id="skinLight" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f5c8a5"/><stop offset=".55" stop-color="#dc9d7d"/><stop offset="1" stop-color="#aa6955"/></linearGradient>
        </defs>
        <rect width="100%" height="100%" rx="22" fill="url(#backdrop)"/>
        <rect x="7" y="7" width="346" height="246" rx="18" fill="none" stroke="#785469" stroke-width="1.5"/>
        <ellipse cx="${centerX}" cy="119" rx="130" ry="115" fill="url(#halo)" opacity="${liftGlow.toFixed(2)}"/>
        <text x="${centerX}" y="31" text-anchor="middle" font-family="Arial,sans-serif" font-size="10" font-weight="800" letter-spacing="4" fill="#f5dfba">COIN FLIP</text>
        <text x="${centerX}" y="49" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" font-weight="600" letter-spacing="2" fill="#ba9baa">FAIR 50 / 50</text>
        <ellipse cx="${centerX}" cy="219" rx="${shadowWidth}" ry="8" fill="#08060b" opacity="${shadowOpacity.toFixed(2)}"/>
        <ellipse cx="${centerX}" cy="217" rx="${shadowWidth * 0.72}" ry="3" fill="#d7a54b" opacity="${(0.13 - 0.08 * liftGlow).toFixed(2)}"/>
        ${hand}
        ${coin}
        <text x="${centerX}" y="246" text-anchor="middle" font-family="Arial,sans-serif" font-size="7" font-weight="600" letter-spacing="2" fill="#aa8798">THUMB-FLICK TOSS · SECURE RANDOM RESULT</text>
      </svg>`;
    frames.push(await sharp(Buffer.from(svg)).png().toBuffer());
  }

  return sharp(frames, { join: { animated: true } })
    .gif({
      loop: 1,
      delay: frames.map((_, index) => (index > 29 ? 110 : 65)),
      colours: 128,
      dither: 0.15,
      interFrameMaxError: 0,
      effort: 8,
    })
    .toBuffer();
}

async function createBlackjackGif(game, revealDealer = false) {
  const width = 360;
  const height = 230;
  const renderWidth = 1080;
  const renderHeight = 690;
  const frames = [];
  const frameCount = 14;
  const cardWidth = 44;
  const cardHeight = 64;
  const displayCards = (cards, y, visibleCount, hideHole = false) => {
    const shown = cards.slice(0, 5);
    const cardsSvg = shown
      .slice(0, visibleCount)
      .map((card, index) => {
        const x = 48 + index * 53;
        const red = ['♥️', '♦️'].includes(card.suit);
        return `<g><rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}" rx="6" fill="#fbf5e8" stroke="#d5b76c" stroke-width="2"/><text x="${x + 5}" y="${y + 17}" font-family="Arial,sans-serif" font-size="12" font-weight="700" fill="${red ? '#c34447' : '#24252a'}">${card.rank}</text><text x="${x + 22}" y="${y + 46}" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" fill="${red ? '#c34447' : '#24252a'}">${card.suit}</text></g>`;
      })
      .join('');
    let backSvg = '';
    if (hideHole) {
      const x = 48 + (shown.length > 1 ? 53 : 0);
      backSvg = `<g><rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}" rx="6" fill="#3d2852" stroke="#d5b76c" stroke-width="2"/><rect x="${x + 5}" y="${y + 5}" width="${cardWidth - 10}" height="${cardHeight - 10}" rx="4" fill="none" stroke="#c39cde" stroke-width="2"/><text x="${x + 22}" y="${y + 41}" text-anchor="middle" font-family="Arial,sans-serif" font-size="20" fill="#f3e9ff">✦</text></g>`;
    }
    const overflow =
      cards.length > shown.length
        ? `<text x="${48 + shown.length * 53}" y="${y + 37}" font-family="Arial,sans-serif" font-size="14" font-weight="700" fill="#f2dfb1">+${cards.length - shown.length}</text>`
        : '';
    return cardsSvg + backSvg + overflow;
  };

  for (let frame = 0; frame < frameCount; frame++) {
    const progress = frame / (frameCount - 1);
    const playerVisible = Math.min(game.player.length, Math.ceil(progress * game.player.length));
    const dealerVisible = revealDealer
      ? Math.min(game.dealer.length, Math.ceil(progress * game.dealer.length))
      : 1;
    const dealerCards = displayCards(game.dealer, 53, dealerVisible, !revealDealer);
    const playerCards = displayCards(game.player, 143, playerVisible);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${renderWidth}" height="${renderHeight}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" rx="18" fill="#201217"/><text x="20" y="27" font-family="Arial,sans-serif" font-size="17" font-weight="800" fill="#f4e2c2">♠ BLACKJACK</text><text x="340" y="27" text-anchor="end" font-family="Arial,sans-serif" font-size="12" fill="#e0cda9">BET ${game.bet} POINTS</text><text x="20" y="47" font-family="Arial,sans-serif" font-size="11" font-weight="700" fill="#c7b394">DEALER ${revealDealer ? handValue(game.dealer) : '· ·'}</text>${dealerCards}<text x="20" y="137" font-family="Arial,sans-serif" font-size="11" font-weight="700" fill="#c7b394">YOU ${handValue(game.player)}</text>${playerCards}</svg>`;
    frames.push(await sharp(Buffer.from(svg)).png().toBuffer());
  }

  return sharp(frames, { join: { animated: true } })
    .gif({
      loop: 1,
      delay: frames.map((_, index) => (index === frameCount - 1 ? 180 : 75)),
      colours: 128,
      dither: 0.15,
      interFrameMaxError: 0,
      effort: 8,
    })
    .toBuffer();
}

async function createMinesGif(game, revealAllMines = false) {
  const size = 1080;
  const gap = 18;
  const tileSize = 150;
  const boardSize = tileSize * 5 + gap * 4;
  const origin = (size - boardSize) / 2;
  const frames = [];
  const frameCount = 10;

  for (let frame = 0; frame < frameCount; frame++) {
    const progress = frame / (frameCount - 1);
    const glow = (0.18 + 0.16 * Math.sin(progress * Math.PI * 2)).toFixed(2);
    const tiles = Array.from({ length: 25 }, (_, index) => {
      const row = Math.floor(index / 5);
      const column = index % 5;
      const x = origin + column * (tileSize + gap);
      const y = 160 + row * (tileSize + gap);
      const state = game.revealed.get(index);
      const showMine = state === 'mine' || (revealAllMines && game.minePositions.has(index));
      const safe = state === 'safe';
      const fill = showMine ? '#7e2633' : safe ? '#145c43' : '#29212c';
      const symbol = showMine
        ? `<circle cx="${x + tileSize / 2}" cy="${y + tileSize / 2}" r="38" fill="#e44e59"/><path d="M ${x + 75} ${y + 91} l -27 28 14 14 27 -28 28 28 14 -14 -28 -28 28 -28 -14 -14 -28 27 -27 -27 -14 14z" fill="#ffe5c4"/>`
        : safe
          ? `<path d="M ${x + 75} ${y + 38} L ${x + 111} ${y + 75} L ${x + 75} ${y + 112} L ${x + 39} ${y + 75} Z" fill="#5ee3a8" stroke="#c1ffe3" stroke-width="6"/><path d="M ${x + 75} ${y + 51} L ${x + 99} ${y + 75} L ${x + 75} ${y + 99} L ${x + 51} ${y + 75} Z" fill="#e6fff5"/>`
          : `<rect x="${x + 18}" y="${y + 18}" width="${tileSize - 36}" height="${tileSize - 36}" rx="20" fill="none" stroke="#a784bb" stroke-opacity="${glow}" stroke-width="5"/>`;
      return `<g><rect x="${x}" y="${y}" width="${tileSize}" height="${tileSize}" rx="22" fill="${fill}" stroke="${safe ? '#57d79e' : showMine ? '#ef6b74' : '#55475d'}" stroke-width="6"/><rect x="${x + 8}" y="${y + 8}" width="${tileSize - 16}" height="${tileSize - 16}" rx="16" fill="none" stroke="white" stroke-opacity=".06" stroke-width="3"/>${symbol}</g>`;
    }).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#301923"/><stop offset="1" stop-color="#110d15"/></linearGradient></defs><rect width="100%" height="100%" rx="36" fill="url(#bg)"/><text x="540" y="86" text-anchor="middle" font-family="Arial,sans-serif" font-size="46" font-weight="800" fill="#ffe7c4">MINES</text><text x="540" y="130" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="#d4c3d8">${game.minesCount} mines · ${game.revealed.size} safe tiles</text>${tiles}<text x="540" y="1030" text-anchor="middle" font-family="Arial,sans-serif" font-size="20" fill="#d7c5b1">CHOOSE A TILE · CASH OUT ANY TIME</text></svg>`;
    frames.push(await sharp(Buffer.from(svg)).png().toBuffer());
  }

  return sharp(frames, { join: { animated: true } })
    .gif({
      loop: 1,
      delay: frames.map((_, index) => (index === frameCount - 1 ? 180 : 80)),
      colours: 96,
      dither: 0.1,
      interFrameMaxError: 0,
      effort: 8,
    })
    .toBuffer();
}

const questions = [
  {
    question: 'Which mob drops blaze rods?',
    answer: 'Blaze',
    wrong: ['Ghast', 'Magma Cube', 'Wither Skeleton'],
  },
  {
    question: 'What material is needed to build a Nether portal?',
    answer: 'Obsidian',
    wrong: ['Bedrock', 'Crying obsidian', 'Blackstone'],
  },
  {
    question: 'Which tool is best for mining stone?',
    answer: 'Pickaxe',
    wrong: ['Axe', 'Shovel', 'Hoe'],
  },
  {
    question: 'What do you feed a wolf to tame it?',
    answer: 'Bones',
    wrong: ['Wheat', 'Fish', 'Carrots'],
  },
  {
    question: 'Which dimension contains End cities?',
    answer: 'The End',
    wrong: ['The Nether', 'The Overworld', 'The Deep Dark'],
  },
  {
    question: 'What do you need to brew a potion?',
    answer: 'Brewing stand',
    wrong: ['Loom', 'Cartography table', 'Grindstone'],
  },
  {
    question: 'Which ore is used to craft a beacon?',
    answer: 'None; a beacon is crafted with glass, obsidian, and a Nether star',
    wrong: ['Diamond', 'Emerald', 'Ancient debris'],
  },
  {
    question: 'What item helps you breathe underwater?',
    answer: 'Turtle shell',
    wrong: ['Elytra', 'Totem of Undying', 'Phantom membrane'],
  },
  {
    question: 'Which villager profession trades in tools?',
    answer: 'Toolsmith',
    wrong: ['Cartographer', 'Cleric', 'Fletcher'],
  },
  {
    question: 'What do you use to make a map?',
    answer: 'Paper and a compass',
    wrong: ['Book and quill', 'Paper and a clock', 'Compass and a banner'],
  },
  {
    question: 'Which block makes a villager a librarian?',
    answer: 'Lectern',
    wrong: ['Bookshelf', 'Composter', 'Barrel'],
  },
  {
    question: 'What is the rare blue ore found deep underground?',
    answer: 'Diamond',
    wrong: ['Lapis lazuli', 'Sapphire', 'Amethyst'],
  },
];

export const activityCommands = [
  new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Claim your daily Ferlis points')
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('trivia')
    .setDescription('Start a quick Minecraft trivia round')
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('Guess the coin toss and win a few Ferlis points')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('guess')
        .setDescription('Choose heads or tails')
        .setRequired(true)
        .addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' }),
    ),
  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('See this server’s activity leaderboard')
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('blackjack')
    .setDescription('Play blackjack with virtual Ferlis points')
    .setDMPermission(false)
    .addIntegerOption((option) =>
      option
        .setName('bet')
        .setDescription(`Bet 5–${maxBet} points`)
        .setMinValue(5)
        .setMaxValue(maxBet)
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('roulette')
    .setDescription('Spin the roulette wheel with virtual Ferlis points')
    .setDMPermission(false)
    .addIntegerOption((option) =>
      option
        .setName('bet')
        .setDescription(`Bet 5–${maxBet} points`)
        .setMinValue(5)
        .setMaxValue(maxBet)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('color')
        .setDescription('Choose your roulette color')
        .setRequired(true)
        .addChoices(
          { name: 'Red (1:1)', value: 'red' },
          { name: 'Black (1:1)', value: 'black' },
          { name: 'Green (35:1)', value: 'green' },
        ),
    ),
  new SlashCommandBuilder()
    .setName('mines')
    .setDescription('Pick safe tiles and cash out your virtual points')
    .setDMPermission(false)
    .addIntegerOption((option) =>
      option
        .setName('bet')
        .setDescription(`Bet 5–${maxBet} points`)
        .setMinValue(5)
        .setMaxValue(maxBet)
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('mines')
        .setDescription('Number of mines on the 5×5 board')
        .setMinValue(1)
        .setMaxValue(12)
        .setRequired(true),
    ),
];

export function installActivity(client, db) {
  db.exec(`CREATE TABLE IF NOT EXISTS activity_users (
    user TEXT PRIMARY KEY,
    points INTEGER NOT NULL DEFAULT 0,
    streak INTEGER NOT NULL DEFAULT 0,
    last_daily TEXT,
    trivia_wins INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS activity_games (
    id TEXT PRIMARY KEY,
    user TEXT NOT NULL UNIQUE,
    bet INTEGER NOT NULL,
    kind TEXT NOT NULL,
    created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS activity_gamble_uses (
    user TEXT NOT NULL,
    created INTEGER NOT NULL
  );`);

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const game of db
      .prepare('SELECT user, SUM(bet) AS refund FROM activity_games GROUP BY user')
      .all()) {
      db.prepare('UPDATE activity_users SET points=points+? WHERE user=?').run(
        game.refund,
        game.user,
      );
    }
    db.exec('DELETE FROM activity_games; COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const pending = new Map();
  const ensureUser = db.prepare('INSERT OR IGNORE INTO activity_users(user) VALUES (?)');
  const getUser = db.prepare('SELECT * FROM activity_users WHERE user=?');
  const addPoints = db.prepare('UPDATE activity_users SET points=points+? WHERE user=?');
  const blackjacks = new Map();
  const minesGames = new Map();
  const gameTimeouts = new Map();

  function clearGameTimeout(id) {
    const timeout = gameTimeouts.get(id);
    if (timeout) clearTimeout(timeout);
    gameTimeouts.delete(id);
  }

  function gambleLimitFor(interaction) {
    const member = interaction.member;
    const roleCache = member?.roles?.cache;
    const roleIds = roleCache
      ? [...roleCache.keys()]
      : Array.isArray(member?.roles)
        ? member.roles
        : [];
    const premiumRoleId = db
      .prepare("SELECT value FROM settings WHERE key='role:Ferlis+'")
      .get()?.value;
    const adminRoleNames = new Set([
      'admin',
      'administrator',
      'administrators',
      'development team',
    ]);
    const hasAdminPermission =
      interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
      roleCache?.some(
        (role) =>
          role.permissions.has(PermissionFlagsBits.Administrator) ||
          adminRoleNames.has(role.name.trim().toLowerCase()),
      ) ||
      (Array.isArray(member?.roles) &&
        interaction.guild?.roles.cache.some(
          (role) =>
            adminRoleNames.has(role.name.trim().toLowerCase()) && member.roles.includes(role.id),
        ));
    const hasPremiumRole =
      (premiumRoleId && roleIds.includes(premiumRoleId)) ||
      roleCache?.some((role) => ['chrisp+', 'ferlis+'].includes(role.name.trim().toLowerCase())) ||
      (Array.isArray(member?.roles) &&
        interaction.guild?.roles.cache.some(
          (role) =>
            ['chrisp+', 'ferlis+'].includes(role.name.trim().toLowerCase()) &&
            member.roles.includes(role.id),
        ));
    return hasAdminPermission || hasPremiumRole
      ? privilegedHourlyGambleLimit
      : standardHourlyGambleLimit;
  }

  function recordGamble(user, limit) {
    const cutoff = Date.now() - hour;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM activity_gamble_uses WHERE created<=?').run(cutoff);
      const used = db
        .prepare('SELECT COUNT(*) AS count FROM activity_gamble_uses WHERE user=? AND created>?')
        .get(user, cutoff).count;
      if (used >= limit) {
        db.exec('COMMIT');
        return false;
      }
      db.prepare('INSERT INTO activity_gamble_uses(user,created) VALUES (?,?)').run(
        user,
        Date.now(),
      );
      db.exec('COMMIT');
      return true;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function gambleLimitMessage(limit, betReturned = false) {
    return `You’ve reached the limit of **${limit} gambles per hour**.${betReturned ? ' Your bet was returned.' : ' Try again later.'}`;
  }

  function reserveBet(user, bet, kind) {
    ensureUser.run(user);
    const id = randomInt(0, 0x7fffffff).toString(36);
    db.exec('BEGIN IMMEDIATE');
    try {
      const updated = db
        .prepare('UPDATE activity_users SET points=points-? WHERE user=? AND points>=?')
        .run(bet, user, bet);
      if (!updated.changes) {
        db.exec('ROLLBACK');
        return { error: 'You do not have enough points for that bet.' };
      }
      db.prepare('INSERT INTO activity_games(id,user,bet,kind,created) VALUES (?,?,?,?,?)').run(
        id,
        user,
        bet,
        kind,
        Date.now(),
      );
      db.exec('COMMIT');
      return { id, balance: getUser.get(user).points };
    } catch (error) {
      db.exec('ROLLBACK');
      if (String(error.message).includes('UNIQUE'))
        return { error: 'Finish your current game first.' };
      throw error;
    }
  }

  function settleBet(id, payout) {
    const game = db.prepare('SELECT user FROM activity_games WHERE id=?').get(id);
    if (!game) return null;
    clearGameTimeout(id);
    db.exec('BEGIN IMMEDIATE');
    try {
      if (payout) addPoints.run(payout, game.user);
      db.prepare('DELETE FROM activity_games WHERE id=?').run(id);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return getUser.get(game.user).points;
  }

  function makeDeck() {
    const cards = [];
    for (const suit of ['♠️', '♥️', '♦️', '♣️']) {
      for (const rank of ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']) {
        cards.push({
          rank,
          suit,
          value: rank === 'A' ? 11 : ['J', 'Q', 'K'].includes(rank) ? 10 : Number(rank),
        });
      }
    }
    for (let index = cards.length - 1; index > 0; index--) {
      const swap = randomInt(index + 1);
      [cards[index], cards[swap]] = [cards[swap], cards[index]];
    }
    return cards;
  }

  function handValue(cards) {
    let total = cards.reduce((sum, card) => sum + card.value, 0);
    let aces = cards.filter((card) => card.rank === 'A').length;
    while (total > 21 && aces > 0) {
      total -= 10;
      aces--;
    }
    return total;
  }

  function renderBlackjack(game, revealDealer = false, status = '') {
    const dealerCards = revealDealer
      ? game.dealer.map((card) => `**${card.rank}${card.suit}**`).join('  ')
      : `**${game.dealer[0].rank}${game.dealer[0].suit}**  🂠`;
    const dealerTotal = revealDealer ? ` (${handValue(game.dealer)})` : '';
    return new EmbedBuilder()
      .setColor(
        status.startsWith('You win') ? 0x36c275 : status.startsWith('Push') ? 0xffc247 : 0xe34b4b,
      )
      .setTitle('♠️ Blackjack')
      .setDescription(
        `**Virtual points only • Bet ${game.bet} • max ${maxBet}**\n\n**Dealer${dealerTotal}**\n${dealerCards}\n\n**${game.owner === game.lastPlayer ? 'Your' : 'Player'} hand (${handValue(game.player)})**\n${game.player.map((card) => `**${card.rank}${card.suit}**`).join('  ')}${status ? `\n\n${status}` : ''}`,
      );
  }

  async function blackjackMessage(game, revealDealer = false, status = '') {
    const animation = await renderGif(() => createBlackjackGif(game, revealDealer));
    const embed = renderBlackjack(game, revealDealer, status).setImage(
      'attachment://blackjack.gif',
    );
    return {
      embeds: [embed],
      files: [new AttachmentBuilder(animation, { name: 'blackjack.gif' })],
    };
  }

  function minesMultiplier(game) {
    if (game.revealed.size === 0) return 1;
    let safeProbability = 1;
    for (let index = 0; index < game.revealed.size; index++) {
      safeProbability *= (25 - game.minesCount - index) / (25 - index);
    }
    return safeProbability > 0 ? 0.97 / safeProbability : 0;
  }

  function minesComponents(id, game, disabled = false, revealAllMines = false) {
    return Array.from({ length: 5 }, (_, rowIndex) =>
      new ActionRowBuilder().addComponents(
        Array.from({ length: 5 }, (_, columnIndex) => {
          const index = rowIndex * 5 + columnIndex;
          const state =
            game.revealed.get(index) ||
            (revealAllMines && game.minePositions.has(index) ? 'mine' : null);
          const button = new ButtonBuilder()
            .setCustomId(`mines:tile:${id}:${index}`)
            .setLabel(String(index + 1))
            .setStyle(
              state === 'safe'
                ? ButtonStyle.Success
                : state === 'mine'
                  ? ButtonStyle.Danger
                  : ButtonStyle.Secondary,
            )
            .setDisabled(disabled || Boolean(state));
          if (state) button.setEmoji(state === 'safe' ? '💎' : '💥');
          return button;
        }),
      ),
    );
  }

  function minesEmbed(game, status = '') {
    const multiplier = minesMultiplier(game);
    const payout = Math.floor(game.bet * multiplier);
    return new EmbedBuilder()
      .setColor(
        status.startsWith('Mine')
          ? 0xe34b4b
          : status.startsWith('Round timed out')
            ? 0xffc247
            : status
              ? 0x36c275
              : 0x8d7548,
      )
      .setTitle('💎 Mines')
      .setDescription(
        `Bet: **${game.bet} points** · Mines: **${game.minesCount}**\nSafe tiles: **${game.revealed.size}** · Cash-out: **${payout} points** (${multiplier.toFixed(2)}×)${status ? `\n\n${status}` : '\n\nChoose another tile or cash out.'}\n\n*Virtual points only; no purchase, transfer, or cash-out.*`,
      )
      .setImage('attachment://mines-board.gif');
  }

  async function updateMinesBoard(message, game, id, status = '', revealAll = false) {
    let image;
    try {
      image = await renderGif(() => createMinesGif(game, revealAll));
    } catch (error) {
      console.error('Mines GIF generation failed; refunding the active bet.', error);
      const active = minesGames.has(id);
      const balance = active ? settleBet(id, game.bet) : null;
      minesGames.delete(id);
      return message.edit({
        embeds: [
          minesEmbed(
            game,
            active
              ? `The board animation failed. Your bet was returned; balance: **${balance} points**.`
              : status || 'The board animation could not be updated.',
          ),
        ],
        components: [],
      });
    }
    return message.edit({
      embeds: [minesEmbed(game, status)],
      files: [new AttachmentBuilder(image, { name: 'mines-board.gif' })],
      attachments: [],
      components: minesComponents(id, game, Boolean(status), revealAll),
      allowedMentions: { parse: [] },
    });
  }

  function scheduleGameTimeout(id, game, kind, delay = gameTimeoutMs) {
    clearGameTimeout(id);
    const timeout = setTimeout(async () => {
      gameTimeouts.delete(id);
      const activeGames = kind === 'blackjack' ? blackjacks : minesGames;
      if (!activeGames.has(id)) return;
      if (game.busy) {
        scheduleGameTimeout(id, game, kind, 1000);
        return;
      }

      game.busy = true;
      const balance = settleBet(id, game.bet);
      activeGames.delete(id);
      if (balance === null) return;

      try {
        const channel = await client.channels.fetch(game.channelId).catch(() => null);
        const message = channel
          ? await channel.messages.fetch(game.messageId).catch(() => null)
          : null;
        if (!message) return;
        if (kind === 'blackjack') {
          await message.edit({
            ...(await blackjackMessage(
              game,
              true,
              `Round timed out after 5 minutes. Your bet was returned. Balance: **${balance} points**.`,
            )),
            components: [],
            allowedMentions: { parse: [] },
          });
          return;
        }
        await updateMinesBoard(
          message,
          game,
          id,
          `Round timed out after 5 minutes. Your bet was returned. Balance: **${balance} points**.`,
          true,
        );
      } catch (error) {
        console.error(`Unable to update timed-out ${kind} game ${id}.`, error);
      }
    }, delay);
    timeout.unref();
    gameTimeouts.set(id, timeout);
  }

  async function finishBlackjack(interaction, id, game, result, payout) {
    if (!interaction.deferred && !interaction.replied) {
      if (interaction.isButton()) await interaction.deferUpdate();
      else await interaction.deferReply();
    }
    const balance = settleBet(id, payout);
    blackjacks.delete(id);
    let payload;
    try {
      payload = await blackjackMessage(game, true, `${result}\nBalance: **${balance} points**`);
    } catch (error) {
      console.error('Blackjack result animation failed.', error);
      payload = {
        embeds: [renderBlackjack(game, true, `${result}\nBalance: **${balance} points**`)],
        files: [],
      };
    }
    return interaction.editReply({
      ...payload,
      components: [],
      allowedMentions: { parse: [] },
    });
  }

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.guildId || !interaction.isChatInputCommand()) return;
    if (interaction.commandName === 'daily') {
      ensureUser.run(interaction.user.id);
      const current = getUser.get(interaction.user.id);
      if (current.last_daily === today()) {
        return interaction.reply({
          content: `You already claimed today’s reward. Your streak is **${current.streak} days**—come back tomorrow!`,
          flags: MessageFlags.Ephemeral,
        });
      }
      const streak = current.last_daily === yesterday() ? current.streak + 1 : 1;
      const reward = 10 + Math.min(streak, 7) + randomInt(6);
      db.prepare(
        'UPDATE activity_users SET points=points+?, streak=?, last_daily=? WHERE user=?',
      ).run(reward, streak, today(), interaction.user.id);
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff8a00)
            .setTitle('Daily reward')
            .setDescription(
              `You earned **${reward} points**!\n🔥 Daily streak: **${streak} day${streak === 1 ? '' : 's'}**`,
            )
            .setFooter({ text: 'Play /trivia or /coinflip to climb the leaderboard.' }),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.commandName === 'coinflip') {
      ensureUser.run(interaction.user.id);
      const gambleLimit = gambleLimitFor(interaction);
      if (!recordGamble(interaction.user.id, gambleLimit)) {
        return interaction.reply({
          content: gambleLimitMessage(gambleLimit),
        });
      }
      const guess = interaction.options.getString('guess', true);
      const result = randomInt(2) === 0 ? 'heads' : 'tails';
      const won = guess === result;
      await interaction.deferReply();
      let animation;
      try {
        animation = await renderGif(() => createCoinGif(result));
      } catch (error) {
        console.error('Coin flip GIF generation failed.', error);
      }
      const spinEmbed = new EmbedBuilder()
        .setColor(0x8d7548)
        .setTitle('🪙 Coin flipping…')
        .setDescription(`Your guess: **${guess}**\n*Fair 50/50 toss • secure random result*`);
      if (animation) spinEmbed.setImage('attachment://coin-flip.gif');
      await interaction.editReply({
        embeds: [spinEmbed],
        ...(animation && { files: [new AttachmentBuilder(animation, { name: 'coin-flip.gif' })] }),
      });
      if (animation) await new Promise((resolve) => setTimeout(resolve, 3000));
      if (won) addPoints.run(4, interaction.user.id);
      const resultEmbed = new EmbedBuilder()
        .setColor(won ? 0x36c275 : 0xe34b4b)
        .setTitle(won ? 'Nice guess!' : 'So close!')
        .setDescription(
          `It landed on **${result}**. ${won ? 'You earned **4 points**.' : 'Try again with **/coinflip**.'}`,
        )
        .setFooter({ text: 'Fair 50/50 toss • secure random result' });
      return interaction.followUp({
        embeds: [resultEmbed],
        allowedMentions: { parse: [] },
      });
    }

    if (interaction.commandName === 'trivia') {
      const source = pick(questions);
      const options = shuffle([...source.wrong, source.answer]);
      const key = randomInt(0, 0x7fffffff).toString(36);
      const correctIndex = options.indexOf(source.answer);
      pending.set(key, {
        question: source.question,
        answer: source.answer,
        correctIndex,
        answered: false,
      });
      setTimeout(() => pending.delete(key), 2 * 60 * 1000).unref();
      const row = new ActionRowBuilder().addComponents(
        options.map((option, index) =>
          new ButtonBuilder()
            .setCustomId(`trivia:${key}:${index}`)
            .setLabel(option)
            .setStyle(ButtonStyle.Secondary),
        ),
      );
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff8a00)
            .setTitle('Minecraft Trivia')
            .setDescription(`**${source.question}**\n\nFirst correct answer wins **15 points**!`),
        ],
        components: [row],
      });
    }

    if (interaction.commandName === 'leaderboard') {
      const leaders = db
        .prepare(
          'SELECT user, points, trivia_wins, streak FROM activity_users WHERE points>0 ORDER BY points DESC, trivia_wins DESC LIMIT 10',
        )
        .all();
      const description = leaders.length
        ? leaders
            .map(
              (entry, index) => `**${index + 1}.** <@${entry.user}> — **${entry.points}** points`,
            )
            .join('\n')
        : 'No scores yet. Claim **/daily** or start a round with **/trivia**!';
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff8a00)
            .setTitle('Chrisp Addon Activity Leaderboard')
            .setDescription(description),
        ],
        allowedMentions: { parse: [] },
      });
    }

    if (interaction.commandName === 'blackjack') {
      const bet = interaction.options.getInteger('bet', true);
      const reservation = reserveBet(interaction.user.id, bet, 'blackjack');
      if (reservation.error)
        return interaction.reply({ content: reservation.error, flags: MessageFlags.Ephemeral });
      const gambleLimit = gambleLimitFor(interaction);
      if (!recordGamble(interaction.user.id, gambleLimit)) {
        settleBet(reservation.id, bet);
        return interaction.reply({
          content: gambleLimitMessage(gambleLimit, true),
        });
      }
      const deck = makeDeck();
      const game = {
        owner: interaction.user.id,
        lastPlayer: interaction.user.id,
        bet,
        deck,
        player: [deck.pop(), deck.pop()],
        dealer: [deck.pop(), deck.pop()],
      };
      blackjacks.set(reservation.id, game);
      const playerTotal = handValue(game.player);
      const dealerNatural = handValue(game.dealer) === 21;
      if (playerTotal === 21) {
        if (dealerNatural)
          return finishBlackjack(
            interaction,
            reservation.id,
            game,
            'Push — both have blackjack.',
            bet,
          );
        return finishBlackjack(
          interaction,
          reservation.id,
          game,
          'You win with blackjack! Payout: **2.5×**.',
          Math.floor(bet * 2.5),
        );
      }
      if (dealerNatural)
        return finishBlackjack(
          interaction,
          reservation.id,
          game,
          'Dealer has blackjack. Your bet is lost.',
          0,
        );
      await interaction.deferReply();
      try {
        await interaction.editReply({
          ...(await blackjackMessage(game)),
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`bj:${reservation.id}:hit`)
                .setLabel('Hit')
                .setStyle(ButtonStyle.Success),
              new ButtonBuilder()
                .setCustomId(`bj:${reservation.id}:stand`)
                .setLabel('Stand')
                .setStyle(ButtonStyle.Danger),
            ),
          ],
        });
        const gameMessage = await interaction.fetchReply();
        game.channelId = gameMessage.channelId;
        game.messageId = gameMessage.id;
        scheduleGameTimeout(reservation.id, game, 'blackjack');
      } catch (error) {
        blackjacks.delete(reservation.id);
        settleBet(reservation.id, bet);
        console.error('Blackjack could not be opened; the bet was refunded.', error);
        return interaction.editReply({
          content: 'The hand could not be opened, so your bet was returned.',
          embeds: [],
          files: [],
          components: [],
        });
      }
      return;
    }

    if (interaction.commandName === 'mines') {
      const bet = interaction.options.getInteger('bet', true);
      const minesCount = interaction.options.getInteger('mines', true);
      const reservation = reserveBet(interaction.user.id, bet, 'mines');
      if (reservation.error)
        return interaction.reply({ content: reservation.error, flags: MessageFlags.Ephemeral });
      const gambleLimit = gambleLimitFor(interaction);
      if (!recordGamble(interaction.user.id, gambleLimit)) {
        settleBet(reservation.id, bet);
        return interaction.reply({
          content: gambleLimitMessage(gambleLimit, true),
        });
      }

      const minePositions = new Set(
        shuffle(Array.from({ length: 25 }, (_, index) => index)).slice(0, minesCount),
      );
      const game = {
        owner: interaction.user.id,
        bet,
        minesCount,
        minePositions,
        revealed: new Map(),
      };
      minesGames.set(reservation.id, game);
      await interaction.deferReply();
      let image;
      try {
        image = await renderGif(() => createMinesGif(game));
      } catch (error) {
        minesGames.delete(reservation.id);
        settleBet(reservation.id, bet);
        console.error('Mines GIF generation failed; the bet was refunded.', error);
        return interaction.editReply({
          content: 'The board could not be rendered, so your bet was refunded.',
        });
      }
      const boardMessage = await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x8d7548)
            .setTitle('💎 Mines')
            .setDescription(
              `Bet: **${bet} points** · Mines: **${minesCount}**\nChoose a tile, then cash out whenever you like. Virtual points only.`,
            )
            .setImage('attachment://mines-board.gif'),
        ],
        files: [new AttachmentBuilder(image, { name: 'mines-board.gif' })],
        components: minesComponents(reservation.id, game),
        allowedMentions: { parse: [] },
      });
      game.channelId = boardMessage.channelId;
      game.messageId = boardMessage.id;
      scheduleGameTimeout(reservation.id, game, 'mines');
      return interaction.followUp({
        content: 'Cash out whenever you want:',
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`mines:cash:${reservation.id}`)
              .setLabel('Cash out')
              .setStyle(ButtonStyle.Success),
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.commandName === 'roulette') {
      const bet = interaction.options.getInteger('bet', true);
      const target = interaction.options.getString('color', true);
      const reservation = reserveBet(interaction.user.id, bet, 'roulette');
      if (reservation.error)
        return interaction.reply({ content: reservation.error, flags: MessageFlags.Ephemeral });
      const gambleLimit = gambleLimitFor(interaction);
      if (!recordGamble(interaction.user.id, gambleLimit)) {
        settleBet(reservation.id, bet);
        return interaction.reply({
          content: gambleLimitMessage(gambleLimit, true),
        });
      }
      const result = randomInt(37);
      const landed = rouletteColor(result);
      const won = landed === target;
      const payout = won ? bet * (target === 'green' ? 36 : 2) : 0;
      await interaction.deferReply();
      let animation;
      try {
        animation = await renderGif(() => createRouletteGif(result));
      } catch (error) {
        settleBet(reservation.id, bet);
        console.error('Roulette GIF generation failed; the bet was refunded.', error);
        return interaction.editReply({
          content: 'The wheel could not be rendered, so your bet was refunded.',
        });
      }
      const spinEmbed = new EmbedBuilder()
        .setColor(0x8d7548)
        .setTitle('🎡 Roulette is spinning…')
        .setDescription(
          `Bet: **${bet} points** on ${colorEmoji(target)} **${target}**\n*Virtual points only; no cash value.*`,
        )
        .setImage('attachment://roulette-spin.gif');
      await interaction.editReply({
        embeds: [spinEmbed],
        files: [new AttachmentBuilder(animation, { name: 'roulette-spin.gif' })],
      });
      await new Promise((resolve) => setTimeout(resolve, 3100));
      const balance = settleBet(reservation.id, payout);
      const resultEmbed = new EmbedBuilder()
        .setColor(won ? 0x36c275 : 0xe34b4b)
        .setTitle(`${colorEmoji(landed)} Roulette — ${result} ${landed.toUpperCase()}`)
        .setDescription(
          `Your pick: ${colorEmoji(target)} **${target}**\n${won ? `You won **${payout} points** (including your stake).` : `You lost **${bet} points**.`}\nBalance: **${balance} points**\n\n*Virtual points only; no purchase, transfer, or cash-out.*`,
        )
        .setFooter({
          text: 'European wheel: 18 red, 18 black, 1 green • result drawn fairly with a secure random source',
        });
      return interaction.followUp({ embeds: [resultEmbed], allowedMentions: { parse: [] } });
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton() && interaction.customId.startsWith('mines:tile:')) {
      const [, , id, tileText] = interaction.customId.split(':');
      const game = minesGames.get(id);
      if (!game)
        return interaction.reply({
          content: 'That Mines round has ended. Start another with **/mines**.',
          flags: MessageFlags.Ephemeral,
        });
      if (interaction.user.id !== game.owner)
        return interaction.reply({
          content: 'This Mines board belongs to another player.',
          flags: MessageFlags.Ephemeral,
        });
      if (game.busy)
        return interaction.reply({
          content: 'Your board is updating—try again in a moment.',
          flags: MessageFlags.Ephemeral,
        });
      const tile = Number(tileText);
      if (!Number.isInteger(tile) || tile < 0 || tile > 24 || game.revealed.has(tile))
        return interaction.reply({
          content: 'That tile is unavailable. Choose another one.',
          flags: MessageFlags.Ephemeral,
        });
      game.busy = true;
      await interaction.deferUpdate();
      if (game.minePositions.has(tile)) {
        game.revealed.set(tile, 'mine');
        settleBet(id, 0);
        minesGames.delete(id);
        return updateMinesBoard(
          interaction.message,
          game,
          id,
          'Mine hit — your bet is lost.',
          true,
        );
      }
      game.revealed.set(tile, 'safe');
      const cleared = game.revealed.size === 25 - game.minesCount;
      if (cleared) {
        const payout = Math.floor(game.bet * minesMultiplier(game));
        const balance = settleBet(id, payout);
        minesGames.delete(id);
        return updateMinesBoard(
          interaction.message,
          game,
          id,
          `Board cleared! You won **${payout} points**. Balance: **${balance} points**.`,
          true,
        );
      }
      try {
        return await updateMinesBoard(interaction.message, game, id);
      } finally {
        if (minesGames.has(id)) game.busy = false;
      }
    }
    if (interaction.isButton() && interaction.customId.startsWith('mines:cash:')) {
      const id = interaction.customId.split(':')[2];
      const game = minesGames.get(id);
      if (!game)
        return interaction.reply({
          content: 'That Mines round has ended. Start another with **/mines**.',
          flags: MessageFlags.Ephemeral,
        });
      if (interaction.user.id !== game.owner)
        return interaction.reply({
          content: 'This Mines board belongs to another player.',
          flags: MessageFlags.Ephemeral,
        });
      if (game.busy)
        return interaction.reply({
          content: 'Your board is updating—try again in a moment.',
          flags: MessageFlags.Ephemeral,
        });
      game.busy = true;
      await interaction.deferUpdate();
      const payout = Math.floor(game.bet * minesMultiplier(game));
      const balance = settleBet(id, payout);
      minesGames.delete(id);
      const channel = await client.channels.fetch(game.channelId).catch(() => null);
      const board = channel ? await channel.messages.fetch(game.messageId).catch(() => null) : null;
      if (board)
        await updateMinesBoard(
          board,
          game,
          id,
          `Cashed out **${payout} points**. Balance: **${balance} points**.`,
        );
      return interaction.message.edit({
        content: `Cashed out **${payout} points**. Balance: **${balance} points**.`,
        components: [],
        allowedMentions: { parse: [] },
      });
    }
    if (interaction.isButton() && interaction.customId.startsWith('bj:')) {
      const [, id, action] = interaction.customId.split(':');
      const game = blackjacks.get(id);
      if (!game)
        return interaction.reply({
          content: 'That blackjack hand ended. Start a new one with **/blackjack**.',
          flags: MessageFlags.Ephemeral,
        });
      if (interaction.user.id !== game.owner)
        return interaction.reply({
          content: 'This hand belongs to another player.',
          flags: MessageFlags.Ephemeral,
        });
      if (game.busy)
        return interaction.reply({
          content: 'Your hand is updating—try again in a moment.',
          flags: MessageFlags.Ephemeral,
        });
      game.busy = true;
      game.lastPlayer = interaction.user.id;
      await interaction.deferUpdate();
      if (action === 'hit') {
        game.player.push(game.deck.pop());
        if (handValue(game.player) > 21)
          return finishBlackjack(interaction, id, game, 'Bust — your bet is lost.', 0);
        try {
          const payload = await blackjackMessage(game);
          const updated = await interaction.editReply({
            ...payload,
            components: interaction.message.components,
          });
          game.busy = false;
          return updated;
        } catch (error) {
          game.busy = false;
          console.error('Blackjack hand animation update failed.', error);
          return interaction.editReply({
            embeds: [
              renderBlackjack(game, false, 'Animation unavailable; your hand is still active.'),
            ],
            components: interaction.message.components,
            files: [],
          });
        }
      }
      while (handValue(game.dealer) < 17) game.dealer.push(game.deck.pop());
      const playerTotal = handValue(game.player);
      const dealerTotal = handValue(game.dealer);
      if (dealerTotal > 21 || playerTotal > dealerTotal)
        return finishBlackjack(interaction, id, game, 'You win! Payout: **2×**.', game.bet * 2);
      if (playerTotal === dealerTotal)
        return finishBlackjack(interaction, id, game, 'Push — your bet is returned.', game.bet);
      return finishBlackjack(interaction, id, game, 'Dealer wins. Your bet is lost.', 0);
    }
    if (!interaction.isButton() || !interaction.customId.startsWith('trivia:')) return;
    const [, key, picked] = interaction.customId.split(':');
    const round = pending.get(key);
    if (!round || round.answered) {
      return interaction.reply({
        content: 'That trivia round has ended. Start another with **/trivia**!',
        flags: MessageFlags.Ephemeral,
      });
    }
    if (Number(picked) !== round.correctIndex) {
      return interaction.reply({
        content: 'Not quite—try another answer!',
        flags: MessageFlags.Ephemeral,
      });
    }
    round.answered = true;
    pending.delete(key);
    ensureUser.run(interaction.user.id);
    addPoints.run(15, interaction.user.id);
    db.prepare('UPDATE activity_users SET trivia_wins=trivia_wins+1 WHERE user=?').run(
      interaction.user.id,
    );
    return interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(0x36c275)
          .setTitle('Correct answer!')
          .setDescription(
            `<@${interaction.user.id}> got it: **${round.answer}**\n**15 points** added to the leaderboard. Try **/daily** for your daily reward.`,
          ),
      ],
      components: [],
      allowedMentions: { users: [interaction.user.id], parse: [] },
    });
  });
}
