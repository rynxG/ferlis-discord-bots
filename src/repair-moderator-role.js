import {Client,GatewayIntentBits as I,PermissionFlagsBits as P} from 'discord.js';
import {openStore} from './core.js';
import {readOnlyPublicIds} from './security-policy.js';
const client=new Client({intents:[I.Guilds]}),db=openStore(process.env.DATA_DIR||'./data');
try{
 await client.login(process.env.PARTIK_TOKEN);
 const guild=await client.guilds.fetch(process.env.GUILD_ID);await guild.roles.fetch();await guild.channels.fetch();
 const key='role:Moderator',old=db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value;
 let role=guild.roles.cache.find(r=>r.name==='Moderator');
 if(!role)role=await guild.roles.create({name:'Moderator',color:0x3498db,hoist:true,permissions:[P.ManageMessages,P.ModerateMembers,P.KickMembers,P.BanMembers],reason:'Restore moderator role after owner role edits; no Administrator'});
 db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,role.id);
 for(const channel of guild.channels.cache.values()){
  const overwrite=channel.permissionOverwrites?.cache.get(old);
  const configured=db.prepare("SELECT 1 FROM settings WHERE value=? AND (key LIKE 'category:%' OR key LIKE 'channel:%' OR key IN ('transcript-channel','voice:controls'))").get(channel.id);
  if((overwrite&&old!==role.id)||configured||readOnlyPublicIds.has(channel.id))await channel.permissionOverwrites.edit(role,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true},'Restore existing moderator channel access');
 }
 try{const member=guild.roles.cache.find(r=>r.name==='Member');if(member&&role.position<=member.position)await role.setPosition(member.position+1);}catch(e){console.log('Moderator order needs owner adjustment: '+e.message);}
 console.log('MODERATOR_ROLE_RESTORED '+role.id);
}finally{db.close();client.destroy();}
