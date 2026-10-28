import { REST, Routes, PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
const rest = new REST({ version: '10' }).setToken(process.env.PARTIK_TOKEN);
const roles = await rest.get(Routes.guildRoles(process.env.GUILD_ID));
console.log(
  JSON.stringify(
    roles.map((r) => ({
      id: r.id,
      name: r.name,
      position: r.position,
      admin: new PermissionsBitField(BigInt(r.permissions)).has(P.Administrator),
      permissions: new PermissionsBitField(BigInt(r.permissions)).toArray(),
    })),
  ),
);
