import { fork } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export function restartDelay(attempt) {
  return Math.min(60000, 5000 * 2 ** Math.min(attempt, 4));
}
export async function supervise(env = process.env) {
  let child,
    lastHeartbeat = Date.now(),
    unhealthySince = 0,
    stopping = false,
    restarting = false,
    wasDown = false,
    attempt = 0;
  const exits = [],
    pending = [];
  async function notify(text, good = false) {
    let db;
    try {
      db = new DatabaseSync(resolve(env.DATA_DIR || './data', 'bots.sqlite'), { readOnly: true });
      const channel = db
        .prepare("SELECT value FROM settings WHERE key='channel:logs'")
        .get()?.value;
      if (!channel) return false;
      const response = await fetch(`https://discord.com/api/v10/channels/${channel}/messages`, {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: { Authorization: 'Bot ' + env.UTILITY_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [
            {
              title: good ? 'CHRISP • Service recovered' : 'CHRISP • Health alert',
              description: text,
              color: good ? 0x57f287 : 0xed4245,
              timestamp: new Date().toISOString(),
            },
          ],
          allowed_mentions: { parse: [] },
        }),
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      db?.close();
    }
  }
  async function queue(text, good = false) {
    if (!(await notify(text, good))) pending.push([text, good]);
    if (pending.length > 10) pending.shift();
  }
  return await new Promise((done) => {
    function launch() {
      if (stopping) return;
      lastHeartbeat = Date.now();
      unhealthySince = 0;
      restarting = false;
      child = fork(fileURLToPath(new URL('./main.js', import.meta.url)), ['--worker'], {
        env,
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      });
      child.on('message', (status) => {
        if (status?.type !== 'health') return;
        lastHeartbeat = Date.now();
        if (status.ready) {
          unhealthySince = 0;
          attempt = 0;
          if (wasDown) {
            wasDown = false;
            queue('All three bots are connected again.', true).catch(() => {});
          }
        } else if (!unhealthySince) unhealthySince = Date.now();
      });
      child.on('error', (e) => {
        console.error('Bot worker could not start:', e.code || e.name);
      });
      child.on('exit', (code, signal) => {
        if (stopping) {
          done(0);
          return;
        }
        wasDown = true;
        const now = Date.now();
        exits.push(now);
        while (exits.length && now - exits[0] > 600000) exits.shift();
        queue(
          `Bot worker stopped (${signal || 'exit ' + code}). ${exits.length >= 5 ? 'Automatic recovery paused after five failures in ten minutes. Check hosting logs.' : 'Restarting automatically.'}`,
        ).catch(() => {});
        if (exits.length >= 5) {
          stopping = true;
          clearInterval(timer);
          done(1);
          return;
        }
        setTimeout(launch, restartDelay(attempt++)).unref();
      });
    }
    const timer = setInterval(async () => {
      if (stopping) return;
      if (pending.length) {
        const [text, good] = pending[0];
        if (await notify(text, good)) pending.shift();
      }
      if (!child || restarting) return;
      if (
        Date.now() - lastHeartbeat > 180000 ||
        (unhealthySince && Date.now() - unhealthySince > 120000)
      ) {
        restarting = true;
        wasDown = true;
        queue(
          'The bot worker stopped responding or a bot stayed disconnected. Restarting the service.',
        ).catch(() => {});
        child.kill('SIGTERM');
        const target = child;
        setTimeout(() => {
          if (target.exitCode === null && target.signalCode === null) target.kill('SIGKILL');
        }, 10000).unref();
      }
    }, 15000);
    function stop() {
      stopping = true;
      clearInterval(timer);
      if (child) {
        child.kill('SIGTERM');
        setTimeout(() => {
          child.kill('SIGKILL');
          done(0);
        }, 8000).unref();
      } else done(0);
    }
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    launch();
  });
}
