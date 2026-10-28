# Developer guide

## Code map

| Module                                            | Purpose                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| `main.js`                                         | Process startup, client lifecycle and Discord event wiring          |
| `branding.js`                                     | Public bot names, avatar/banner assets and profile bios             |
| `brand-text.js`                                   | Safe product-name replacement in bot-written message templates      |
| `core.js`                                         | SQLite storage, text normalization, matching and offence escalation |
| `features.js`, `transcript.js`                    | Ticket infrastructure, pricing and rich HTML transcripts            |
| `community.js`                                    | Temporary voice rooms, applications and community events            |
| `operations.js`, `operations-store.js`            | Staff dashboard, support memory and operational settings            |
| `staff-moderation.js`, `moderation-review.js`     | Staff commands, cases and safe punishment review                    |
| `raid.js`, `image-moderation.js`, `gif-frames.js` | Raid alerts and image/GIF checks                                    |
| `maintenance.js`, `supervisor.js`                 | Backups, retention and process recovery                             |
| `test/`                                           | Behavior and permission regression checks                           |

## Local workflow

Use Node.js 24, run `npm ci --ignore-scripts`, and provide your own private `.env`. Use a separate test server for development. The production startup command is `npm start`; the supervisor forks the worker and restarts it after failures.

Run `npm run format`, `npm run format:check` and `npm test` before publishing. Formatting uses the pinned Prettier development dependency and the repository configuration. Generated icon data, runtime data, credentials and the dependency lockfile are excluded from formatting.

## Bot identities and intents

The legacy internal labels `Feris Utility` and `Ferlis Support` select different clients, tokens and handlers. Keep them stable even though the public profiles are Chrisp Utility and Chrisp AI. The legacy setting `role:Ferlis+` stores the premium role ID; its public role name is Chrisp+.

Jerry needs Message Content and Server Members intents. Support needs Message Content. Utility uses voice-state events and direct messages for applications. Do not grant Administrator to make an error disappear; check the operation's exact permission and channel overwrite.

## Persistence and migrations

SQLite tables store tickets, approved knowledge, case metadata, application progress and settings. Backups use SQLite's backup API before compression. Never edit live database files with ordinary text tools.

Maintenance scripts must be reviewed before execution. `migrate-chirsp.js --apply` updates existing bot-authored branding while preserving ticket/application answers, player descriptions, component identifiers and user messages. It makes a database backup first and reports counts without printing private message contents. Running it again skips already-updated text.

## Review boundaries

Keep security-sensitive checks close to their action: verify guild, actor, ticket owner, role hierarchy and target channel before changing permissions or applying punishments. Avoid unrelated changes in formatting commits. Preserve tests for these boundaries when refactoring.
