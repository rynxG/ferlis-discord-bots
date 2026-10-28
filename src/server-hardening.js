import {Client,GatewayIntentBits as I,ChannelType,PermissionFlagsBits as P,PermissionsBitField,EmbedBuilder,AttachmentBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle} from 'discord.js';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {openStore,defaultBlockedWords} from './core.js';
import {normalPermissions,botPermissions,readOnlyDeny,staffNames,readOnlyPublicIds} from './security-policy.js';
import {createBackup} from './maintenance.js';
if(!process.argv.includes('--apply'))throw Error('Review the policy and run with --apply to configure this server.');
const client=new Client({intents:[I.Guilds]}),db=openStore(process.env.DATA_DIR||'./data'),results={roles:[],channels:[],automod:[],pending:[]};
const get=key=>db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value;
const put=(key,value)=>db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,String(value));
const reason='Owner requested completed server roles, permissions, branding and security';
try{
 await client.login(process.env.UTILITY_TOKEN);const guild=await client.guilds.fetch(process.env.GUILD_ID);await guild.roles.fetch();await guild.channels.fetch();
 const bots={moderation:'1562505463747317880',utility:'1562505750884913274',support:'1562506122638794832'};
 const members=Object.fromEntries(await Promise.all(Object.entries(bots).map(async([kind,id])=>[kind,await guild.members.fetch(id)])));
 await createBackup(db,process.env.DATA_DIR||'./data');
 await mkdir(join(process.env.DATA_DIR||'./data','security'),{recursive:true});
 await writeFile(join(process.env.DATA_DIR||'./data','security','before-hardening.json'),JSON.stringify({at:new Date().toISOString(),roles:guild.roles.cache.map(r=>({id:r.id,name:r.name,permissions:String(r.permissions.bitfield),position:r.position,color:r.color})),channels:guild.channels.cache.map(c=>({id:c.id,name:c.name,parent:c.parentId,overwrites:c.permissionOverwrites?.cache.map(o=>({id:o.id,type:o.type,allow:String(o.allow.bitfield),deny:String(o.deny.bitfield)}))})),verification:guild.verificationLevel,contentFilter:guild.explicitContentFilter},null,2));
 const styles=[['Owner',0xf1c40f,true],['Moderator',0xe74c3c,true],['Development Team',0x9b59b6,true],['Support Team',0x3498db,true],['Media Team',0x1abc9c,true],['Ferlis+',0xf39c12,true],['Server Booster',0xff73fa,true],['Member',0x95a5a6,false],['voice-access',0,false]];
 const roles={};
 for(const[name,color,hoist]of styles){let role=guild.roles.cache.find(r=>r.name===name);if(!role)role=await guild.roles.create({name,permissions:[],reason});const permissions=name==='Moderator'?[P.ManageMessages,P.ModerateMembers,P.KickMembers,P.BanMembers]:[];await role.edit({color,hoist,mentionable:false,permissions,reason});roles[name]=role;put('role:'+name,role.id);results.roles.push(name);}
 try{await guild.roles.setPositions(['voice-access','Member','Server Booster','Ferlis+','Media Team','Support Team','Development Team','Moderator','Owner'].map((name,n)=>({role:roles[name].id,position:n+1})));}catch(e){results.pending.push('Owner role-order adjustment: '+e.message);}
 const owner=await guild.members.fetch(guild.ownerId);if(!owner.roles.cache.has(roles.Owner.id))await owner.roles.add(roles.Owner,reason);
 await guild.roles.everyone.setPermissions(normalPermissions,reason);
 await guild.edit({name:'Ferlis Client',verificationLevel:2,explicitContentFilter:2,defaultMessageNotifications:1,reason});
 const information=guild.channels.cache.get('1562498816714997770');
 const botRules=Object.values(bots).map(id=>({id,type:1,allow:[P.ViewChannel,P.SendMessages,P.ReadMessageHistory,P.EmbedLinks,P.AttachFiles]}));
 const staffRules=staffNames.map(name=>({id:roles[name].id,type:0,allow:[P.ViewChannel,P.SendMessages,P.ReadMessageHistory]}));
 const readonly=()=>[{id:guild.id,type:0,allow:[P.ViewChannel,P.ReadMessageHistory],deny:readOnlyDeny},...staffRules.filter(r=>r.id===roles.Moderator.id),...botRules];
 const privateRules=(teams=staffNames,ticket=false)=>[{id:guild.id,type:0,deny:[P.ViewChannel]},...teams.map(name=>({id:roles[name].id,type:0,allow:[P.ViewChannel,P.SendMessages,P.ReadMessageHistory,...(ticket?[P.ManageMessages]:[])]})),...botRules.filter(r=>ticket||r.id!==bots.support).map(r=>ticket&&r.id===bots.utility?{...r,allow:[...r.allow,P.MentionEveryone]}:r)];
 async function ensure(key,name){let channel=get(key)?await guild.channels.fetch(get(key)).catch(()=>null):null;if(!channel)channel=await guild.channels.create({name,type:ChannelType.GuildText,parent:information?.id,permissionOverwrites:readonly(),reason});put(key,channel.id);return channel;}
 const start=await ensure('channel:start-here','📌│start-here'),rules=await ensure('channel:rules','📜│rules');
 const tickets=guild.channels.cache.get('1562512417542635584'),invite=get('server-invite');
 async function panel(channel,key,payload){const old=get(key)?await channel.messages.fetch(get(key)).catch(()=>null):null;if(old)await old.edit(payload);else put(key,(await channel.send(payload)).id);}
 await panel(rules,'rules:panel',{embeds:[new EmbedBuilder().setColor(0x2b2d31).setTitle('FERLIS • Server Rules').setDescription('**1. Respect people.** No harassment, hate, threats, doxxing or explicit content.\n\n**2. No spam or scams.** No unsolicited advertising, mass mentions, impersonation or suspicious links.\n\n**3. Keep accounts safe.** Never post passwords, login tokens, API keys, verification codes or full payment details.\n\n**4. Use the right channel.** Submit base finds through /basefind and configurations through config-sharing. Executables and scripts are blocked in sharing channels.\n\n**5. Keep tickets sensible.** One ticket per issue. Explain the problem and avoid repeated staff pings; staff may be busy or sleeping.\n\n**6. Staff review disputes.** Use an Appeal ticket if you believe a punishment was mistaken. Do not evade a timeout or ban.').setFooter({text:'FERLIS • Community rules'})],allowedMentions:{parse:[]}});
 const banner=await readFile(new URL('../assets/felris-banner.png',import.meta.url));
 await panel(start,'start:panel',{embeds:[new EmbedBuilder().setColor(0x2b2d31).setTitle('FERLIS • Start Here').setDescription('Welcome to **Ferlis Client**.\n\nRead the rules, use the ticket panel for support or purchases, and find media applications under Content & Media.\n\n**Staff will never need your password or login token.** Only follow purchase or download instructions confirmed through the official server.').setImage('attachment://ferlis-banner.png').setFooter({text:'FERLIS • Support, community and updates'})],files:[new AttachmentBuilder(banner,{name:'ferlis-banner.png'})],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Rules').setURL(`https://discord.com/channels/${guild.id}/${rules.id}`).setStyle(ButtonStyle.Link),new ButtonBuilder().setLabel('Open a ticket').setURL(`https://discord.com/channels/${guild.id}/${tickets.id}`).setStyle(ButtonStyle.Link))],allowedMentions:{parse:[]}});
 for(const channel of guild.channels.cache.values()){
  if(!channel.permissionOverwrites)continue;
  if(readOnlyPublicIds.has(channel.id)||channel.id===start.id||channel.id===rules.id){
   const existingPrivate=channel.id==='1562499367292768336';
   await channel.permissionOverwrites.set(existingPrivate?privateRules():readonly(),reason);
   if(existingPrivate)await channel.permissionOverwrites.edit(guild.id,{SendMessages:false,SendMessagesInThreads:false,CreatePublicThreads:false,CreatePrivateThreads:false});
   results.channels.push(channel.name+': read-only');
  }else if(channel.id==='1562538429076602971'){
   await channel.permissionOverwrites.set([{id:guild.id,type:0,allow:[P.ViewChannel,P.SendMessages,P.SendMessagesInThreads,P.CreatePublicThreads,P.ReadMessageHistory,P.AttachFiles,P.EmbedLinks],deny:[P.CreatePrivateThreads,P.MentionEveryone,P.ManageChannels,P.ManageWebhooks]},...staffRules,...botRules],reason);await channel.setRateLimitPerUser(15,reason);results.channels.push(channel.name+': moderated sharing');
  }else if(channel.id===get('voice:controls')){
   await channel.permissionOverwrites.set([{id:guild.id,type:0,deny:[P.ViewChannel,...readOnlyDeny]},{id:roles['voice-access'].id,type:0,allow:[P.ViewChannel,P.ReadMessageHistory],deny:readOnlyDeny},...staffRules,...botRules],reason);
  }else if(channel.id===get('category:staff-tools')||['staff-chat','staff-commands','staff-dashboard','automod-bans','automod-mutes','role-assingments','logs','media-review'].includes(channel.name)){
   const teams=['automod-bans','automod-mutes','logs','role-assingments'].includes(channel.name)?['Moderator']:staffNames;await channel.permissionOverwrites.set(privateRules(teams),reason);results.channels.push(channel.name+': private');
  }else if(channel.id===get('transcript-channel')){
   await channel.permissionOverwrites.set(privateRules(['Support Team','Moderator']),reason);await channel.setParent(get('category:staff-tools'),{lockPermissions:false,reason});
  }else if(['support','purchase','appeal','something-else'].some(kind=>channel.id===get('category:'+kind))){
   await channel.permissionOverwrites.set(privateRules(['Support Team','Moderator'],true),reason);
  }
 }
 if(guild.features.includes('BANNER'))await guild.setBanner(banner,reason);else results.pending.push('Server header banner requires Discord banner eligibility; information banner installed.');
 results.pending.push('Join raid alerts and local message checks retained; no automatic join quarantine was enabled.');
 for(const[kind,member]of Object.entries(members)){
  const role=member.roles.botRole;if(!role)throw Error('Missing managed role for '+kind);
  try{await role.setPermissions(botPermissions[kind],reason);results.roles.push(kind+': limited bot permissions');}catch(e){results.pending.push(kind+' managed role needs owner update: '+e.message);}
 }
 const wise=guild.roles.cache.find(r=>r.name==='The Wise Ones');if(wise){try{await wise.edit({permissions:[],color:0xffffff,hoist:true,mentionable:false,reason});}catch(e){results.pending.push('Owner must remove Administrator from The Wise Ones: '+e.message);}}
 put('security:hardened',1);put('security:member-role-mode','after-first-message');put('security:last-hardening',Date.now());
 console.log('HARDENING_RESULT_V1 '+JSON.stringify(results));
}finally{db.close();client.destroy();}
