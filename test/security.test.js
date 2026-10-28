import test from 'node:test';
import assert from 'node:assert/strict';
import {PermissionsBitField,PermissionFlagsBits as P} from 'discord.js';
import {normalPermissions,botPermissions,readOnlyDeny} from '../src/security-policy.js';
test('ordinary members have no administrative, mass mention or content management permissions',()=>{
 const permissions=new PermissionsBitField(normalPermissions);
 for(const name of ['Administrator','ManageGuild','ManageChannels','ManageRoles','ManageWebhooks','ManageMessages','BanMembers','KickMembers','ModerateMembers','MentionEveryone','CreateGuildExpressions','CreateEvents'])assert.equal(permissions.has(P[name]),false,name);
 assert.equal(permissions.has(P.UseApplicationCommands),true);
});
test('bot permissions are purpose scoped and none includes Administrator',()=>{
 for(const permissions of Object.values(botPermissions))assert.equal(new PermissionsBitField(permissions).has(P.Administrator),false);
 const support=new PermissionsBitField(botPermissions.support);
 for(const name of ['ManageRoles','ManageChannels','ManageMessages','KickMembers','BanMembers','ModerateMembers'])assert.equal(support.has(P[name]),false,name);
 assert.equal(new PermissionsBitField(botPermissions.utility).has(P.BanMembers),false);
 assert.equal(new PermissionsBitField(botPermissions.moderation).has(P.ManageChannels),false);
});
test('read-only channels prevent message and thread bypasses',()=>{
 const deny=new PermissionsBitField(readOnlyDeny);
 for(const name of ['SendMessages','SendMessagesInThreads','CreatePublicThreads','CreatePrivateThreads','SendVoiceMessages','SendPolls'])assert.equal(deny.has(P[name]),true,name);
});
