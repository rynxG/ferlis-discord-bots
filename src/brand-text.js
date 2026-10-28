/** Replace obsolete public branding while keeping bot routing IDs and ticket answers intact. */
export function brandText(value) {
  return String(value)
    .replace(/\b(?:Ferlis|Felris|Feris|Chrisp|Chirsp)\s+(?:Utility|Support|AI)\b/gi, (label) =>
      /Utility/i.test(label) ? 'Chrisp Utility' : 'Chrisp AI',
    )
    .replace(/\b(?:Ferlis|Felris|Feris|Chrisp)\s+AI\b/gi, 'Chrisp AI')
    .replace(/\b(?:Ferlis|Felris|Feris|Chrisp|Chirsp)\b/g, 'Chrisp')
    .replace(/\b(?:FERLIS|FELRIS|FERIS|CHRISP|CHIRSP)\s+(UTILITY|SUPPORT|AI)\b/g, (_all, role) =>
      role === 'UTILITY' ? 'CHRISP UTILITY' : 'CHRISP AI',
    )
    .replace(/\b(?:FERLIS|FELRIS|FERIS|CHRISP|CHIRSP)\b/g, 'CHRISP');
}

/** Build a minimal edit for bot-written text; preserve ticket/application answers. */
export function brandedMessageEdit(message) {
  const body = {};
  if (message.content && brandText(message.content) !== message.content)
    body.content = brandText(message.content);
  const embeds = (message.embeds || []).map((original) => {
    const embed = structuredClone(original);
    if (embed.type && embed.type !== 'rich') return embed;
    const userDescription = /base find|media application (?:submission|review)/i.test(
      embed.title || '',
    );
    for (const key of ['title', ...(!userDescription ? ['description'] : [])])
      if (embed[key]) embed[key] = brandText(embed[key]);
    if (embed.footer?.text) embed.footer.text = brandText(embed.footer.text);
    if (
      embed.author?.name &&
      /^(?:FERLIS|Ferlis|Felris|Feris|Chrisp|Chrisp)(?:\b| •)/.test(embed.author.name)
    )
      embed.author.name = brandText(embed.author.name);
    for (const field of embed.fields || []) {
      field.name = brandText(field.name);
      if (/^(?:Donut Cash|Real money|Pricing|Ticket Info|Payment Methods)$/i.test(field.name))
        field.value = brandText(field.value);
    }
    return embed;
  });
  if (JSON.stringify(embeds) !== JSON.stringify(message.embeds || [])) body.embeds = embeds;
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
