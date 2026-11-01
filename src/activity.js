import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';

const day = 24 * 60 * 60 * 1000;
const today = () => new Date().toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() - day).toISOString().slice(0, 10);

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
];

export function installActivity(client, db) {
  db.exec(`CREATE TABLE IF NOT EXISTS activity_users (
    user TEXT PRIMARY KEY,
    points INTEGER NOT NULL DEFAULT 0,
    streak INTEGER NOT NULL DEFAULT 0,
    last_daily TEXT,
    trivia_wins INTEGER NOT NULL DEFAULT 0
  );`);

  const pending = new Map();
  const ensureUser = db.prepare('INSERT OR IGNORE INTO activity_users(user) VALUES (?)');
  const getUser = db.prepare('SELECT * FROM activity_users WHERE user=?');
  const addPoints = db.prepare('UPDATE activity_users SET points=points+? WHERE user=?');

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
      const reward = 10 + Math.min(streak, 7) + Math.floor(Math.random() * 6);
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
      const guess = interaction.options.getString('guess', true);
      const result = Math.random() < 0.5 ? 'heads' : 'tails';
      const won = guess === result;
      if (won) addPoints.run(4, interaction.user.id);
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(won ? 0x36c275 : 0xe34b4b)
            .setTitle(won ? 'Nice guess!' : 'So close!')
            .setDescription(
              `It landed on **${result}**. ${won ? 'You earned **4 points**.' : 'Try again with **/coinflip**.'}`,
            ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.commandName === 'trivia') {
      const source = questions[Math.floor(Math.random() * questions.length)];
      const options = [...source.wrong, source.answer].sort(() => Math.random() - 0.5);
      const key = Math.random().toString(36).slice(2, 9);
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
  });

  client.on(Events.InteractionCreate, async (interaction) => {
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
