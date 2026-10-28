# Community systems

Support remains free (`AI_PROVIDER=off`): local common answers plus approved `/teach` facts. Paid OpenAI chat replies are disabled. Image moderation is configured independently.

Chrisp Utility and Chrisp AI use the supplied CHRISP CLIENT banner. Jerry keeps his existing profile art. Jerry uses supported Online presence. Discord's documented bot presence API does not expose a mobile-status switch.

Join **Join to Create** to get a personal voice room and **voice-access**. The role exposes **voice-controls**. Its compact panel has lock/unlock, rename, member limit, room info, kick, mute/unmute, deafen/undeafen, member ID and claim. Every action checks current ownership and room membership. Staff, bots and the server owner are protected. Leaving removes access; ownership transfers to another occupant. Empty temporary rooms are automatically deleted. Panel-applied mute/deafen effects are tracked and cleared on leaving where Discord permits it. Staff-applied effects cannot be removed by this panel. Restart reconciliation restores active ownership.

STAFF channels: staff-chat, staff-commands, automod-bans, automod-mutes, role-assingments (requested spelling), logs and media-review. Moderator has Manage Messages, Moderate Members, Kick Members and Ban Members; no new Administrator grant. Commands: `/warn`, `/mute`, `/unmute`, `/kick`, `/ban`, `/unban`. Native permissions and role hierarchy are checked. Bans preserve message history. Cases use unique UUIDs with user mention/ID, moderator, reason, date and duration. External Discord punishments are recorded from audit events. `/blocked-words` lists all configured words ephemerally for Administrators only.

Actual boost-start events send thank-you embeds to the existing boosts channel. Setup does not create fake boost announcements.

**media-applications** has a Start application button. Utility asks the six questions in DMs, one at a time, persists drafts through restarts, validates an HTTPS video link and asks for final confirmation. Only confirmation sends answers to private **media-review**. Drafts can be cancelled and expire after seven days; database draft answers are removed after submission. Staff review is manual.

Config-sharing threads and base-finds also reject executable/script uploads and role/everyone mentions for non-staff. Basefind descriptions are filtered before publication and still images are checked by the configured image moderator. Existing spam, language and image checks remain active. GIF-only messages remain exempt.

29 local tests pass. Live voice creation, lock/unlock, rename and member-limit changes were observed. The application flow reached final confirmation and its setup draft was cancelled without submission. Actual mute/deafen, new-member welcomes and boosts require real Discord events; they are not simulated by impersonating user activity.

References: https://bleed.bot/ and https://docs.discord.com/developers/events/gateway-events#update-presence

# October 22 panel and moderation update

VoiceMaster and ticket action buttons use 18 original white custom server emojis. VoiceMaster includes an embed guide matching each icon to its action; its buttons remain icon-only. Ticket category labels stay visible because Discord requires labels on select options. Existing confirmation buttons retain clear choices.

Join and departure logs include avatars, user IDs, relative account/join dates, roles on departure, and member counts. Positive notifications use green; punishments, departures and failures use red.

Free support now recognizes informal greetings, ordinary help requests, purchase questions, account delivery, installation, and ticket errors. Account questions cannot match unrelated client download knowledge. The ten-second silent reply cooldown was removed. This is local matching, not paid generative AI.

Jerry now samples up to eight evenly spaced frames from each of at most two GIF sources per message, sending PNG frames to the previously authorized OpenAI moderation endpoint. Trusted media hosts only; 8 MB download, 500-frame and 4-megapixel limits. Large, unsupported or failed checks are reported for staff review without automatic punishment. Sampling can miss short scenes. Harmless GIFs remain exempt from spam penalties. Staff with Manage Messages or Administrator remain exempt from automatic content moderation.
