import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/core.js';
import { supportAnswer } from '../src/ai.js';

test('AI sends only the question and approved evidence, disables storage, and enforces daily cap', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'farex-privacy-test-'));
  const db = openStore(dir);
  const original = globalThis.fetch;
  let calls = 0;
  try {
    db.prepare('INSERT INTO knowledge(question,answer,author) VALUES(?,?,?)').run(
      'How do tickets work?',
      'Choose a category.',
      'private-admin-id',
    );
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const body = JSON.parse(options.body);
      assert.equal(body.store, false);
      assert.equal(body.max_output_tokens, 600);
      assert.ok(!options.body.includes('private-admin-id'));
      assert.deepEqual(Object.keys(JSON.parse(body.input)).sort(), [
        'approved_support_facts',
        'user_question',
      ]);
      return {
        ok: true,
        json: async () => ({
          output: [
            { type: 'reasoning', content: [] },
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'Choose a category. [#1]' }],
            },
          ],
        }),
      };
    };
    const env = {
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'test-not-real',
      OPENAI_MODEL: 'test-model',
      AI_DAILY_LIMIT: '1',
    };
    assert.match(await supportAnswer(db, 'tickets', env), /Choose a category/);
    assert.match(await supportAnswer(db, 'tickets', env), /daily AI limit/);
    assert.equal(calls, 1);
    await supportAnswer(db, 'tickets', { ...env, AI_PROVIDER: 'off' });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
