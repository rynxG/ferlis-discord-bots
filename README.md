# Ferlis Discord bots

Source for **Jerry**, **Ferlis Utility**, and **Ferlis Support**.

- Jerry: text, image and sampled GIF moderation; escalation, staff commands, case review, join/leave and boost logs.
- Utility: private tickets, purchase forms, rich transcripts, staff dashboard, media applications and temporary voice rooms.
- Support: free built-in answers, approved knowledge, ticket topic memory and staff corrections. Paid generation is disabled by default.
- Shared: SQLite persistence, backups, retention controls and process health supervision.

## Setup

Requires Node.js 24. Run `npm ci`, copy `.env.example` to `.env`, fill in your own bot credentials and server identifiers, then run `npm test` and `npm start`.

Enable the Discord privileged intents required by the features you use. Keep credentials in environment variables. Never commit `.env`, databases, transcripts, applications, moderation records or backups.

This source was developed for one server and includes server-specific channel identifiers. Review those identifiers and permissions before using it elsewhere. Some administrative scripts are one-time tools; do not run them as startup commands. The live permission update has been applied and audited: the bots run without Administrator, private staff channels are restricted, and posting-only channels deny message/thread bypasses. See SECURITY.md for the scope and limitations. Do not rerun the one-time hardening script on a customized server; use targeted repairs.

The moderation service optionally uses OpenAI image moderation. Support replies can remain entirely local. GIF scanning samples frames and is not a guarantee of detection. Health monitoring cannot send alerts while its hosting provider is entirely offline. Keep an independent backup.

Run `npm test` for the automated checks. See `STAFF-GUIDE.md` and `COMMUNITY.md` for operational details; historical deployment details in those documents may need updating.
