import test from 'node:test';
import assert from 'node:assert/strict';
import { brandText, brandedMessageEdit } from '../src/brand-text.js';
import { displayBotName } from '../src/branding.js';
import { brandTitle } from '../src/ui.js';

test('Chrisp display names retain distinct internal routing and Jerry identity', () => {
  assert.equal(displayBotName('Jerry'), 'Jerry');
  assert.equal(displayBotName('Feris Utility'), 'Chrisp Utility');
  assert.equal(displayBotName('Ferlis Support'), 'Chrisp AI');
  assert.equal(brandText('Ferlis Support'), 'Chrisp AI');
  assert.equal(brandText('Feris Utility'), 'Chrisp Utility');
  assert.equal(brandTitle('CHRISP • Support ticket'), 'Support ticket');
});

test('existing bot embeds update branding without rewriting ticket answers or control IDs', () => {
  const original = {
    content: 'Ferlis Utility is here.',
    embeds: [
      {
        title: 'FERLIS • Support ticket',
        footer: { text: 'FERLIS • Support Team' },
        fields: [
          { name: 'Subject', value: 'I used Ferlis yesterday' },
          { name: 'Details', value: 'FERLIS • is the label I want removed' },
        ],
      },
    ],
    components: [
      {
        type: 1,
        components: [{ type: 2, label: 'Ferlis Support', custom_id: 'legacy:ferlis:action' }],
      },
    ],
  };
  const edited = brandedMessageEdit(original);
  assert.equal(edited.content, 'Chrisp Utility is here.');
  assert.equal(edited.embeds[0].title, 'Support ticket');
  assert.equal(edited.embeds[0].footer.text, 'Support Team');
  assert.equal(edited.embeds[0].fields[0].value, original.embeds[0].fields[0].value);
  assert.equal(edited.embeds[0].fields[1].value, 'is the label I want removed');
  assert.equal(edited.components[0].components[0].custom_id, 'legacy:ferlis:action');
  assert.equal(original.embeds[0].title, 'FERLIS • Support ticket');
  assert.equal(brandedMessageEdit({ ...original, ...edited }), null);
});

test('existing member welcome embeds become plain welcome messages', () => {
  const edit = brandedMessageEdit({
    content: '',
    embeds: [{ title: 'Welcome to CHRISP!', description: 'Welcome <@123456789012345678>!' }],
  });
  assert.equal(edit.content, 'Welcome <@123456789012345678> to Chrisp Client!');
  assert.deepEqual(edit.embeds, []);
});

test('the Start Here welcome panel uses regular message text, not an embed', () => {
  const edit = brandedMessageEdit({
    content: '',
    embeds: [
      {
        title: 'CHRISP • Start Here',
        description: 'Welcome to **Ferlis Client**. Read the rules.',
      },
    ],
    components: [{ type: 1, components: [{ type: 2, label: 'Rules', custom_id: 'keep' }] }],
  });
  assert.equal(edit.content, 'Welcome to **Chrisp Client**. Read the rules.');
  assert.deepEqual(edit.embeds, []);
  assert.equal(edit.components[0].components[0].custom_id, 'keep');
});

test('base-find descriptions remain the original player text', () => {
  const edit = brandedMessageEdit({
    embeds: [{ title: 'FERLIS • Anonymous Base Find', description: 'Ferlis was what I wrote' }],
  });
  assert.equal(edit.embeds[0].description, 'Ferlis was what I wrote');
  assert.equal(brandText('FERLIS+'), 'CHRISP+');
});
