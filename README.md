# Chrisp community bots

Three Discord bots share one Node.js process and a SQLite database:

| Bot profile        | Responsibility                                                                |
| ------------------ | ----------------------------------------------------------------------------- |
| **Chrisp Utility** | Tickets, transcripts, media applications, voice rooms and staff dashboard     |
| **Chrisp AI**      | Free common answers, approved knowledge, ticket context and staff corrections |
| **Jerry**          | Text/image/GIF moderation, moderation commands, raid alerts and member logs   |

Chrisp Utility handles server tools; Chrisp AI handles ticket support. Their internal roles and credentials remain separate.

## Getting started

Requires **Node.js 24**.

1. Run `npm ci --ignore-scripts`.
2. Copy `.env.example` to `.env` and enter your own credentials and server IDs privately.
3. Configure the Discord intents described in [CONTRIBUTING.md](CONTRIBUTING.md).
4. Run `npm test`, then `npm start`.

Never commit credentials, databases, ticket transcripts, application answers or backups. The optional generative support integration is disabled by default; local support answers work without a paid LLM.

## Development

- `npm test` — run the test suite.
- `npm run format` — format source, tests and documentation.
- `npm run format:check` — verify formatting without modifying files.
- `npm run check` — check the entry point's JavaScript syntax.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the code map and development workflow, [STAFF-GUIDE.md](STAFF-GUIDE.md) for staff features, and [SECURITY.md](SECURITY.md) for the permission model and limits.

This project was built for a specific server and still contains server-specific channel identifiers. Review configuration before using it elsewhere. Files such as `server-hardening.js`, `repair-moderator-role.js` and `migrate-chirsp.js` are manual maintenance tools, **not startup commands**. Historical transcripts remain records of their original conversations.
