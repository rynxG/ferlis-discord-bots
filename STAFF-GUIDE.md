# FERLIS staff systems

The bots display as **Jerry**, **Ferlis Utility**, and **Ferlis Support**. Panel titles and new bot embeds use FERLIS branding.

Open **#staff-dashboard** or `/staff-dashboard`. The channel is private to the existing staff teams. Each click checks your current server permissions. Approved answers, settings, privacy and backup download require Administrator.

## Support memory and corrections

Free support remembers the current ticket's topic for 30 minutes by default. Follow-ups such as “how much?” use that topic; another ticket or owner cannot access its memory. Client/account topics are separate. Memory and per-ticket answer references expire automatically.

Right-click a FERLIS Support answer → **Apps → Correct support answer**. Staff with Manage Messages can enter the question and replacement answer. The correction applies only inside that ticket. An administrator can use **Publish as approved answer** to add it to global knowledge. Dashboard → **Approved answers** also adds or edits global answers. This remains local matching rather than a generative LLM.

## Tickets

Use the information icon inside the ticket, or Dashboard → Tickets. Staff can claim/release a ticket, transfer it to Support Team, Development Team or Moderator, and mark it resolved. Transfers preserve the owner and bot access and restrict the channel to the receiving team. Resolving locks the channel and requests a 1–5 satisfaction rating from its owner, in the channel and by DM when possible. The owner may rate once. Ordinary Close and transcript-backed Delete Request remain available.

## Applications

Dashboard → Applications lists submissions, links to their private review message, and allows staff to mark one reviewed. Staff make any selection decisions themselves; no automatic acceptance, rejection or eligibility scoring is performed. Recent existing submissions are linked on upgrade when their review message remains available.

## Moderation review and protection

New case embeds include Review reason, Undo punishment and False positive. Dashboard → Moderation review opens the same controls. A false-positive mark does not lift a punishment or change the word list. Undo requires the appropriate native moderation permission and role hierarchy. An old case cannot undo a later punishment; a timeout reversal must match the recorded timeout and preserves an earlier timeout. Historical cases without reversal snapshots require manual moderation commands. Kicks cannot be undone by a bot.

Dashboard → Moderation settings adjusts raid and spam thresholds. Defaults: 8 joins in 10 seconds (staff alert), 5 mentions per message, 3 distinct accounts posting the same unapproved link within 30 seconds, 6 messages or 3 identical messages within 8 seconds. Join bursts do not automatically ban people. Existing advertising/moderation rules remove offending messages and record cases. Staff exemptions remain unchanged.

## Voice rooms

The last button row provides ownership transfer, trusted member access, removal of trusted access, and Save preferences. Transfer requires a human member currently inside the room. Trusted members can join your locked rooms. Save preferences records your room name, member limit and locked state for the next room you create. Actions are checked against the current room owner every time; ownership transfer removes the previous owner's control role. Staff mutes/deafens remain protected.

## Backups and health

A consistent, integrity-checked SQLite backup is made on startup when needed and every 12 hours. Gzip snapshots are kept in `data/backups`, normally for 7 days, capped at 14 copies. These cover ticket metadata, knowledge, settings and bot records. They do not contain bot/API environment secrets or all Discord message history. Transcripts still have their staff archive and owner copies. Administrators can create/download a database backup from the dashboard and should store a copy outside the host. A pre-upgrade database copy was also made.

The parent supervisor watches worker heartbeats and the three Discord connections. It restarts crashed or persistently disconnected workers with bounded backoff and posts failure/recovery alerts to #logs. Five crashes in ten minutes stop recovery to avoid a restart loop. This cannot send alerts if the entire hosting service is offline, and same-host backups do not survive loss of the entire hosting account. Independent outage monitoring/off-host backups need a separate running service or an administrator's downloaded copy.

## Privacy

Dashboard → Privacy supports configurable transcript, application and moderation-case retention. **0 keeps records**, and these cleanup periods start disabled. Configuration requires an explicit administrator confirmation explaining deletion. Preview cleanup is read-only. Enabled rules run hourly; drafts retain their existing seven-day expiry. Active punishment enforcement state is retained separately from expired case records.

Cleanup removes local transcripts, relevant database records, and tracked bot archive/review messages when permissions allow. It cannot recall people's downloads, backups they saved, messages from before tracking, or unrelated Discord logs. Backups age out separately, so deleted records can remain in a snapshot until its retention expires. Restoration is a deliberate maintenance operation: stop the bots, decompress a trusted SQLite snapshot, validate it, replace the database and restart. No one-click destructive restore is exposed.
