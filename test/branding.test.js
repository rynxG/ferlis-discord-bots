import test from 'node:test';
import assert from 'node:assert/strict';
import { brandText, brandedMessageEdit } from '../src/brand-text.js';
import { displayBotName } from '../src/branding.js';

test('Chrisp display names retain distinct internal routing and Jerry identity', () => {
  assert.equal(displayBotName('Jerry'), 'Jerry');
  assert.equal(displayBotName('Feris Utility'), 'Chrisp Utility');
  assert.equal(displayBotName('Ferlis Support'), 'Chrisp AI');
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
          { name: 'Details', value: 'Ferlis is the name I typed' },
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
  assert.equal(edited.embeds[0].title, 'CHRISP • Support ticket');
  assert.equal(edited.embeds[0].fields[0].value, original.embeds[0].fields[0].value);
  assert.equal(edited.components[0].components[0].custom_id, 'legacy:ferlis:action');
  assert.equal(original.embeds[0].title, 'FERLIS • Support ticket');
  assert.equal(brandedMessageEdit({ ...original, ...edited }), null);
});

test('base-find descriptions remain the original player text', () => {
  const edit = brandedMessageEdit({
    embeds: [{ title: 'FERLIS • Anonymous Base Find', description: 'Ferlis was what I wrote' }],
  });
  assert.equal(edit.embeds[0].description, 'Ferlis was what I wrote');
  assert.equal(brandText('FERLIS+'), 'CHRISP+');
});
