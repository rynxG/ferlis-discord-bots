/** Remove the decorative brand prefix without changing the rest of the text. */
export function removeBrandPrefix(value) {
  return String(value).replace(/\b(?:FERLIS|FELRIS|FERIS|CHRISP|CHIRSP)\s*[•·]\s*/gi, '');
}

/** Replace obsolete public branding while keeping bot routing IDs and ticket answers intact. */
export function brandText(value) {
  return removeBrandPrefix(
    String(value)
      .replace(/\b(?:Ferlis|Felris|Feris|Chrisp|Chirsp)\s+(?:Utility|Support|AI)\b/gi, (label) =>
        /Utility/i.test(label) ? 'Chrisp Utility' : 'Chrisp AI',
      )
      .replace(/\b(?:Ferlis|Felris|Feris|Chrisp)\s+AI\b/gi, 'Chrisp AI')
      .replace(/\b(?:Ferlis|Felris|Feris|Chrisp|Chirsp)\b/g, 'Chrisp')
      .replace(/\b(?:FERLIS|FELRIS|FERIS|CHRISP|CHIRSP)\s+(UTILITY|SUPPORT|AI)\b/g, (_all, role) =>
        role === 'UTILITY' ? 'CHRISP UTILITY' : 'CHRISP AI',
      )
      .replace(/\b(?:FERLIS|FELRIS|FERIS|CHRISP|CHIRSP)\b/g, 'CHRISP'),
  );
}

/** Build a minimal edit for bot-written text; preserve ticket/application answers. */
export function brandedMessageEdit(message) {
  const body = {};
  const embeds = message.embeds || [];
  const welcome = embeds.find((embed) =>
    /^\s*(?:CHRISP\s*[•·]\s*)?Welcome\b/i.test(embed.title || ''),
  );
  const welcomeMention =
    welcome &&
    `${welcome.description || ''} ${(welcome.fields || []).map((field) => field.value).join(' ')}`.match(
      /<@!?(\d+)>/,
    );
  const startHere = embeds.find(
    (embed) =>
      /^\s*(?:CHRISP\s*[•·]\s*)?Start Here\b/i.test(embed.title || '') &&
      /welcome to/i.test(embed.description || ''),
  );
  if (welcomeMention) {
    body.content = `Welcome <@${welcomeMention[1]}> to Chrisp Client!`;
    body.embeds = [];
  } else if (startHere) {
    body.content = brandText(startHere.description);
    body.embeds = [];
  }
  if (
    !welcomeMention &&
    !startHere &&
    message.content &&
    brandText(message.content) !== message.content
  )
    body.content = brandText(message.content);
  const updatedEmbeds = embeds.map((original) => {
    const embed = structuredClone(original);
    if (embed.type && embed.type !== 'rich') return embed;
    const userDescription = /base find|media application (?:submission|review)/i.test(
      embed.title || '',
    );
    if (embed.title) embed.title = brandText(embed.title);
    if (embed.description)
      embed.description = userDescription
        ? removeBrandPrefix(embed.description)
        : brandText(embed.description);
    if (embed.footer?.text) embed.footer.text = brandText(embed.footer.text);
    if (
      embed.author?.name &&
      /^(?:FERLIS|Ferlis|Felris|Feris|Chrisp|Chrisp)(?:\b| •)/.test(embed.author.name)
    )
      embed.author.name = brandText(embed.author.name);
    for (const field of embed.fields || []) {
      field.name = brandText(field.name);
      field.value = removeBrandPrefix(field.value);
      if (/^(?:Donut Cash|Real money|Pricing|Ticket Info|Payment Methods)$/i.test(field.name))
        field.value = brandText(field.value);
    }
    return embed;
  });
  if (!welcomeMention && !startHere && JSON.stringify(updatedEmbeds) !== JSON.stringify(embeds))
    body.embeds = updatedEmbeds;
  const components = structuredClone(message.components || []);
  function visit(component) {
    for (const key of ['label', 'placeholder', 'description'])
      if (component[key]) component[key] = brandText(component[key]);
    for (const child of [...(component.components || []), ...(component.options || [])])
      visit(child);
  }
  components.forEach(visit);
  if (JSON.stringify(components) !== JSON.stringify(message.components || []))
    body.components = components;
  return Object.keys(body).length ? body : null;
}
