export const normalPermissions = [
  'ViewChannel',
  'SendMessages',
  'SendMessagesInThreads',
  'ReadMessageHistory',
  'AddReactions',
  'EmbedLinks',
  'AttachFiles',
  'Connect',
  'Speak',
  'Stream',
  'UseVAD',
  'ChangeNickname',
  'UseApplicationCommands',
  'UseExternalEmojis',
  'UseExternalStickers',
  'UseEmbeddedActivities',
];
const botCommon = [
  'ViewChannel',
  'SendMessages',
  'ReadMessageHistory',
  'EmbedLinks',
  'AttachFiles',
  'AddReactions',
  'UseExternalEmojis',
  'ChangeNickname',
  'SendMessagesInThreads',
];
export const botPermissions = {
  moderation: [
    ...botCommon,
    'ManageRoles',
    'ManageMessages',
    'ModerateMembers',
    'KickMembers',
    'BanMembers',
    'ViewAuditLog',
  ],
  utility: [
    ...botCommon,
    'ManageChannels',
    'ManageRoles',
    'ManageMessages',
    'Connect',
    'MoveMembers',
    'MuteMembers',
    'DeafenMembers',
  ],
  support: [...botCommon],
};
export const readOnlyDeny = [
  'SendMessages',
  'SendMessagesInThreads',
  'CreatePublicThreads',
  'CreatePrivateThreads',
  'SendVoiceMessages',
  'SendPolls',
];
export const staffNames = ['Support Team', 'Development Team', 'Moderator'];
export const readOnlyPublicIds = new Set([
  '1562498816714997772',
  '1562499119803535371',
  '1562499159095910553',
  '1562499165332967605',
  '1562499172152643624',
  '1562512417542635584',
  '1562499501262901431',
  '1562499367292768336',
  '1562499373206601789',
  '1562499378965381211',
  '1562499396653027450',
  '1562797568981991494',
  '1562824347880521821',
]);
export function ticketAdmission(db, { user, staff = false, created, joined }, now = Date.now()) {
  if (staff) return null;
  db.exec(
    'CREATE TABLE IF NOT EXISTS ticket_admissions(user TEXT PRIMARY KEY,created INTEGER NOT NULL)',
  );
  if (created && now - created < 300000)
    return 'Your Discord account must be at least five minutes old before opening a ticket.';
  const raid = Number(
    db.prepare("SELECT value FROM settings WHERE key='security:raid-until'").get()?.value || 0,
  );
  if (raid > now && joined && now - joined < 600000)
    return 'New ticket creation is temporarily limited after a join surge. Please try again in a few minutes.';
  const last = db.prepare('SELECT created FROM ticket_admissions WHERE user=?').get(user)?.created;
  if (last && now - last < 300000)
    return 'Please wait five minutes between creating tickets. Keep using your existing ticket for the same issue.';
  if (
    Number(
      db.prepare('SELECT count(*) AS n FROM ticket_admissions WHERE created>?').get(now - 60000).n,
    ) >= 5
  )
    return 'The ticket system is handling a burst of requests. Please try again in a minute.';
  db.prepare(
    'INSERT INTO ticket_admissions VALUES(?,?) ON CONFLICT(user) DO UPDATE SET created=excluded.created',
  ).run(user, now);
  return null;
}
