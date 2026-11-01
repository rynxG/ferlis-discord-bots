import {
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import { randomInt } from 'node:crypto';
import sharp from 'sharp';

const day = 24 * 60 * 60 * 1000;
const today = () => new Date().toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() - day).toISOString().slice(0, 10);
const maxBet = 100;
const hourlyGambleLimit = 15;
const hour = 60 * 60 * 1000;
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

async function createRouletteGif(result) {
  const size = 440;
  const center = size / 2;
  const step = 360 / rouletteNumbers.length;
  const resultIndex = rouletteNumbers.indexOf(result);
  const finalRotation = -resultIndex * step;
  const frames = [];
  const frameCount = 40;

  for (let frame = 0; frame < frameCount; frame++) {
    const progress = frame / (frameCount - 1);
    const eased = 1 - (1 - progress) ** 3;
    const rotation = finalRotation - 8 * 360 * (1 - eased);
    const ballRotation = finalRotation - 10 * 360 * (1 - eased);
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
        const labelAngle = -90 + index * step;
        return `<path d="M ${x1} ${y1} A ${outer} ${outer} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${inner} ${inner} 0 0 0 ${x4} ${y4} Z" fill="${fill}" stroke="#d2aa53" stroke-width="1.5"/><text x="${center}" y="${center - 160}" transform="rotate(${labelAngle} ${center} ${center})" fill="white" font-size="11" font-weight="700" text-anchor="middle" dominant-baseline="middle">${number}</text>`;
      })
      .join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><defs><radialGradient id="felt"><stop offset="0" stop-color="#127548"/><stop offset="1" stop-color="#064327"/></radialGradient><linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe59a"/><stop offset=".5" stop-color="#856021"/><stop offset="1" stop-color="#f3d378"/></linearGradient></defs><rect width="100%" height="100%" rx="24" fill="#171316"/><circle cx="${center}" cy="${center}" r="211" fill="url(#rim)" stroke="#f6df9a" stroke-width="3"/><circle cx="${center}" cy="${center}" r="198" fill="#674b1a" stroke="#a5833e" stroke-width="2"/><g transform="rotate(${rotation} ${center} ${center})">${slots}<circle cx="${center}" cy="${center}" r="130" fill="url(#felt)" stroke="#e0c16a" stroke-width="4"/><circle cx="${center}" cy="${center}" r="117" fill="none" stroke="#72c78a" stroke-opacity=".35" stroke-width="2"/><text x="${center}" y="${center + 12}" fill="#69d58e" font-family="Arial,sans-serif" font-size="52" font-weight="800" text-anchor="middle">C</text></g><g transform="rotate(${ballRotation} ${center} ${center})"><circle cx="${center}" cy="${center - 202}" r="8" fill="#fff8da" stroke="#70521e" stroke-width="3"/><circle cx="${center}" cy="${center - 202}" r="3" fill="white"/></g><path d="M ${center - 15} 6 L ${center + 15} 6 L ${center} 40 Z" fill="#fff1bd" stroke="#59451e" stroke-width="2"/><circle cx="${center}" cy="${center}" r="12" fill="#e9d184" stroke="#fff0bc" stroke-width="3"/></svg>`;
    frames.push(await sharp(Buffer.from(svg)).png().toBuffer());
  }

  return sharp(frames, { join: { animated: true } })
    .gif({ loop: 1, delay: frames.map((_, index) => (index > 29 ? 105 : 55)), effort: 5 })
    .toBuffer();
}

async function createCoinGif(result) {
  const width = 340;
  const height = 220;
  const centerX = width / 2;
  const centerY = 103;
  const radius = 70;
  const frames = [];
  const frameCount = 24;
  const finalAngle = result === 'heads' ? Math.PI * 8 : Math.PI * 9;

  for (let frame = 0; frame < frameCount; frame++) {
    const progress = frame / (frameCount - 1);
    const eased = 1 - (1 - progress) ** 3;
    const angle = finalAngle * eased;
    const face = Math.cos(angle) >= 0 ? 'HEADS' : 'TAILS';
    const scaleX = Math.max(0.08, Math.abs(Math.cos(angle)));
    const coin =
      scaleX < 0.22
        ? `<ellipse cx="${centerX}" cy="${centerY}" rx="${radius * 0.22}" ry="${radius}" fill="#c78219" stroke="#ffe39a" stroke-width="5"/><path d="M ${centerX - 5} ${centerY - 48} v 96 M ${centerX + 5} ${centerY - 48} v 96" stroke="#f8d277" stroke-width="3" opacity=".75"/>`
        : `<g transform="translate(${centerX} ${centerY}) scale(${scaleX} 1)"><circle r="${radius}" fill="url(#gold)" stroke="#fff0b6" stroke-width="6"/><circle r="${radius - 11}" fill="none" stroke="#9c5d13" stroke-width="3"/><text x="0" y="-4" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-size="25" font-weight="800" fill="#5e390e">${face}</text><text x="0" y="27" text-anchor="middle" font-family="Arial,sans-serif" font-size="27" font-weight="800" fill="#73470f">C</text></g>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0aa"/><stop offset=".45" stop-color="#edba50"/><stop offset="1" stop-color="#b97118"/></linearGradient></defs><rect width="100%" height="100%" rx="20" fill="#201217"/><ellipse cx="${centerX}" cy="182" rx="58" ry="9" fill="#090609" opacity=".75"/>${coin}<text x="${centerX}" y="207" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" font-weight="700" letter-spacing="2" fill="#e7c995">FAIR 50 / 50 FLIP</text></svg>`;
    frames.push(await sharp(Buffer.from(svg)).png().toBuffer());
  }

  return sharp(frames, { join: { animated: true } })
    .gif({ loop: 1, delay: frames.map((_, index) => (index > 17 ? 130 : 65)), effort: 5 })
    .toBuffer();
}

async function createBlackjackGif(game, revealDealer = false) {
  const width = 360;
  const height = 230;
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
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" rx="18" fill="#201217"/><text x="20" y="27" font-family="Arial,sans-serif" font-size="17" font-weight="800" fill="#f4e2c2">♠ BLACKJACK</text><text x="340" y="27" text-anchor="end" font-family="Arial,sans-serif" font-size="12" fill="#e0cda9">BET ${game.bet} POINTS</text><text x="20" y="47" font-family="Arial,sans-serif" font-size="11" font-weight="700" fill="#c7b394">DEALER ${revealDealer ? handValue(game.dealer) : '· ·'}</text>${dealerCards}<text x="20" y="137" font-family="Arial,sans-serif" font-size="11" font-weight="700" fill="#c7b394">YOU ${handValue(game.player)}</text>${playerCards}</svg>`;
    frames.push(await sharp(Buffer.from(svg)).png().toBuffer());
  }

  return sharp(frames, { join: { animated: true } })
    .gif({
      loop: 1,
      delay: frames.map((_, index) => (index === frameCount - 1 ? 180 : 75)),
      effort: 5,
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

  function recordGamble(user) {
    const cutoff = Date.now() - hour;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM activity_gamble_uses WHERE created<=?').run(cutoff);
      const used = db
        .prepare('SELECT COUNT(*) AS count FROM activity_gamble_uses WHERE user=? AND created>?')
        .get(user, cutoff).count;
      if (used >= hourlyGambleLimit) {
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
        return { error: 'Finish your current blackjack or roulette game first.' };
      throw error;
    }
  }

  function settleBet(id, payout) {
    const game = db.prepare('SELECT user FROM activity_games WHERE id=?').get(id);
    if (!game) return null;
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
    const animation = await createBlackjackGif(game, revealDealer);
    const embed = renderBlackjack(game, revealDealer, status).setImage(
      'attachment://blackjack.gif',
    );
    return {
      embeds: [embed],
      files: [new AttachmentBuilder(animation, { name: 'blackjack.gif' })],
    };
  }

  async function finishBlackjack(interaction, id, game, result, payout) {
    const balance = settleBet(id, payout);
    blackjacks.delete(id);
    return interaction.update({
      ...(await blackjackMessage(game, true, `${result}\nBalance: **${balance} points**`)),
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
      if (!recordGamble(interaction.user.id)) {
        return interaction.reply({
          content: 'You’ve reached the limit of **15 gambles per hour**. Try again later.',
        });
      }
      const guess = interaction.options.getString('guess', true);
      const result = randomInt(2) === 0 ? 'heads' : 'tails';
      const won = guess === result;
      if (won) addPoints.run(4, interaction.user.id);
      let animation;
      try {
        animation = await createCoinGif(result);
      } catch (error) {
        console.error('Coin flip GIF generation failed.', error);
      }
      const embed = new EmbedBuilder()
        .setColor(won ? 0x36c275 : 0xe34b4b)
        .setTitle(won ? 'Nice guess!' : 'So close!')
        .setDescription(
          `It landed on **${result}**. ${won ? 'You earned **4 points**.' : 'Try again with **/coinflip**.'}`,
        )
        .setFooter({ text: 'Fair 50/50 toss • secure random result' });
      if (animation) embed.setImage('attachment://coin-flip.gif');
      return interaction.reply({
        embeds: [embed],
        ...(animation && { files: [new AttachmentBuilder(animation, { name: 'coin-flip.gif' })] }),
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
            .setTitle('Ferlis Activity Leaderboard')
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
      if (!recordGamble(interaction.user.id)) {
        settleBet(reservation.id, bet);
        return interaction.reply({
          content: 'You’ve reached the limit of **15 gambles per hour**. Your bet was returned.',
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
      return interaction.reply({
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
    }

    if (interaction.commandName === 'roulette') {
      const bet = interaction.options.getInteger('bet', true);
      const target = interaction.options.getString('color', true);
      const reservation = reserveBet(interaction.user.id, bet, 'roulette');
      if (reservation.error)
        return interaction.reply({ content: reservation.error, flags: MessageFlags.Ephemeral });
      if (!recordGamble(interaction.user.id)) {
        settleBet(reservation.id, bet);
        return interaction.reply({
          content: 'You’ve reached the limit of **15 gambles per hour**. Your bet was returned.',
        });
      }
      const result = randomInt(37);
      const landed = rouletteColor(result);
      const won = landed === target;
      const payout = won ? bet * (target === 'green' ? 36 : 2) : 0;
      await interaction.deferReply();
      let animation;
      try {
        animation = await createRouletteGif(result);
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
      await new Promise((resolve) => setTimeout(resolve, 2850));
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
      game.lastPlayer = interaction.user.id;
      if (action === 'hit') {
        game.player.push(game.deck.pop());
        if (handValue(game.player) > 21)
          return finishBlackjack(interaction, id, game, 'Bust — your bet is lost.', 0);
        return interaction.update({
          ...(await blackjackMessage(game)),
          components: interaction.message.components,
        });
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
