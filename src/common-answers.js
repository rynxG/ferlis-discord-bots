// Free, local answers for general etiquette; server facts still come from /teach.
function normalizeQuestion(question) {
  return question
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^a-z0-9\s?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function supportLanguage(question) {
  const q = normalizeQuestion(question);
  const hints = [
    'ich',
    'mochte',
    'herunterladen',
    'herunterlade',
    'kannst',
    'konnen',
    'nicht',
    'bitte',
    'danke',
    'warum',
    'wann',
    'brauche',
    'euch',
    'habe',
    'hast',
    'hilfe',
    'mitarbeiter',
    'anfordern',
    'kostet',
    'kaufen',
  ];
  const words = new Set(q.split(' '));
  const hits = hints.filter((word) => words.has(word)).length;
  return (
    hits >= 2 ||
    /\b(?:ich|mochte|herunterladen|herunterlade|anfordern)\b/.test(q) ||
    /\b(?:kannst|konnen|nicht|bitte|danke|warum|wann|brauche|euch|hilfe|mitarbeiter|kostet|kaufen|wo)\b/.test(
      q,
    )
  )
    ? 'de'
    : 'en';
}

export function commonAnswer(question) {
  const q = normalizeQuestion(question).replace(/\bhi+\b/g, 'hi');
  if (supportLanguage(question) === 'de') {
    const germanRules = [
      [
        /\b(client|chirsp|chrisp|ferlis|felris|feris)\b.*\b(herunterladen|herunterlade|downloaden|download|installieren)\b|\b(herunterladen|herunterlade|downloaden|download|installieren)\b.*\b(client|chirsp|chrisp|ferlis|felris|feris)\b/,
        'Der Client ist noch nicht offiziell veröffentlicht. Bitte lade keine geleakte Version herunter; sie könnte deine Geräte- oder Kontoinformationen gefährden. Warte auf einen Download-Link in den offiziellen Ankündigungen und nutze nur diesen.',
      ],
      [
        /\b(client|chirsp|chrisp|ferlis|felris|feris)\b.*\b(preis|kostet|kosten|teuer|preislich)\b|\b(preis|kostet|kosten|teuer|preislich)\b.*\b(client|chirsp|chrisp|ferlis|felris|feris)\b/,
        '**Basic Edition ist kostenlos. CHRISP+ kostet 7,99 €** oder den entsprechenden Betrag in deiner Landeswährung. Bitte bestätige Bestellungen über ein Purchase-Ticket mit dem Team.',
      ],
      [
        /\b(kaufen|bestellen|zahlung|bezahlen|purchase)\b/,
        'Öffne das Ticket-Panel und wähle **Purchase**. Wähle anschließend **Client**, **Accounts** oder **Something else** und nenne dein Budget. Das Team bestätigt Verfügbarkeit, Preis und Zahlungsdetails im privaten Ticket.',
      ],
      [
        /\b(personal|mitarbeiter|team|staff)\b.*\b(anfordern|fordere|fordern|sprechen|kontakt|erreichen|hilfe|antworten)\b|\b(anfordern|fordere|sprechen|kontakt|erreichen)\b.*\b(personal|mitarbeiter|team|staff)\b/,
        'Für persönliche Hilfe öffne ein Support-Ticket und nutze dort **Request staff**. Beschreibe dein Anliegen einmal und warte auf eine Antwort; das Team kann beschäftigt oder offline sein.',
      ],
      [
        /\b(ticket|support)\b.*\b(eroffnen|offnen|erstellen|machen|geht nicht|funktioniert nicht|fehler)\b/,
        'Wähle im Ticket-Panel **Support** und beschreibe dein Anliegen. Falls das Erstellen fehlschlägt, prüfe, ob du bereits ein offenes Ticket hast. Wenn die Fehlermeldung bleibt, bitte das Team um Hilfe.',
      ],
      [
        /\b(staff|mitarbeiter|support|team)\b.*\b(ping|pingen|markieren|erwahnen|spam)|\b(ping|pingen|markieren|erwahnen)\b.*\b(staff|mitarbeiter|support|team)\b/,
        'Bitte pinge das Team nicht wiederholt. Sende deine Frage einmal mit den nötigen Informationen und warte. Nutze in einem Ticket **Request staff**, wenn du persönliche Hilfe brauchst.',
      ],
      [
        /\b(konto|konten|account|accounts|token)\b.*\b(preis|kostet|kosten|kaufen)\b|\b(preis|kostet|kosten|kaufen)\b.*\b(konto|konten|account|accounts|token)\b/,
        'Für Konten: **24h Java Token — 20M** oder **0,25 €**; **3d Token — 80M** oder **0,70 €**. Bei Echtgeldkäufen gilt eine Mindestmenge von **5 Accounts**. Bitte bestätige Verfügbarkeit und Zahlungsdetails in einem Purchase-Ticket.',
      ],
      [
        /\b(hallo|hi|hey|guten morgen|guten abend|danke|vielen dank)\b/,
        'Hallo! Wobei kann ich dir helfen? Stelle deine Frage gern direkt hier. Für persönliche Hilfe nutze **Request staff** in deinem Ticket.',
      ],
    ];
    for (const [match, answer] of germanRules) if (match.test(q)) return answer;
    return null;
  }
  const rules = [
    [
      /\b(accounts?|tokens?)\b.*\b(price|cost|much)|\b(price|cost|much)\b.*\b(accounts?|tokens?)\b/,
      'Account prices: **24h Java Token — 20M** or **€0.25**; **3d Token — 80M** or **€0.70**. Real-money orders have a minimum of **5 accounts**. Staff must confirm availability and payment details in your Purchase ticket.',
    ],
    [
      /\b(client|chirsp|chrisp|ferlis|felris|feris)\b.*\b(price|cost|much)|\b(price|cost|much)\b.*\b(client|chirsp|chrisp|ferlis|felris|feris)\b/,
      '**Basic Edition is free. CHRISP+ is €7.99** or the local-currency equivalent. Donut Cash pricing is **1B Lifetime / 400M Monthly**. Ask staff in a Purchase ticket to confirm your purchase details.',
    ],
    [
      /\b(refund|chargeback|payment failed|payment issue)\b/,
      'Staff need to review this in a **Purchase** ticket. Include a non-sensitive order reference and explain what went wrong. Don’t send card details or passwords. I can’t approve a refund or promise an outcome.',
    ],
    [
      /\b(account|accounts|token|tokens)\b.*\b(download|receive|delivery|delivered|redeem|use)|\b(download|receive|redeem)\b.*\b(account|accounts|token|tokens)\b/,
      'Accounts are separate from the client download. Open a **Purchase** ticket, choose **Accounts**, and ask staff for the delivery or usage instructions for your order. Never post an account password or token here.',
    ],
    [
      /\b(buy|purchase|order|payment|pay)\b/,
      'Open the ticket panel, choose **Purchase**, then select **Client**, **Accounts**, or **Something else** and enter your budget. Staff will confirm availability, the price, and payment instructions in the private ticket.',
    ],
    [
      /\b(get|need|want|contact|reach)\b.*\b(support|help|staff)\b/,
      'Tell me what you need help with here. For a person, use the **Request staff** control in your ticket and wait for a reply. If you haven’t opened a ticket yet, choose **Support** in the ticket panel.',
    ],
    [
      /\b(ping|mention|tag)\b.*\b(staff|support|admin|much|spam)|\b(staff|support|admin)\b.*\b(ping|mention|tag)/,
      'Please don’t repeatedly ping staff. Send your question once, include the useful details, and wait. Staff may be busy or sleeping. Use **Request staff** in your ticket when you need a person, rather than tagging everyone.',
    ],
    [
      /\b(staff|support|admin)\b.*\b(wait|long|slow|answer|respond|online|sleep|busy)|\b(no one|nobody)\b.*\b(answer|respond)/,
      'Staff may be busy, offline, or sleeping. Keep the details in one ticket and give them time to reply. Repeated pings or duplicate tickets usually make it harder to help.',
    ],
    [
      /\b(ticket|support)\b.*\b(rule|etiquette|behav|common sense|spam)/,
      'Keep tickets clear and respectful: explain the issue, include relevant screenshots or error text, and avoid spam, repeated staff pings, or duplicate tickets. Never post passwords or login tokens.',
    ],
    [
      /\b(hello|hi|hey|good morning|good evening)\b/,
      'Hi! What can I help you with? Describe your question and I’ll try to help. If you need a staff member, use **Request staff**.',
    ],
    [/\b(thank|thanks|ty)\b/, 'You’re welcome! Let me know if you have another question.'],
    [
      /\b(install|installation|setup)\b/,
      'What are you trying to install, and what happens when you try? Tell me your operating system and the exact error, if there is one. Only use download links confirmed in official announcements or by staff.',
    ],
    [
      /\b(not received|haven t received|didn t receive|missing order|where is my order)\b/,
      'Keep this in your **Purchase** ticket and send staff the order reference and approximate purchase time. Don’t post payment credentials. Staff can check delivery; I can’t see your order status.',
    ],
    [
      /\b(can t|cannot|unable to)\b.*\b(open|join|create)\b.*\bticket\b/,
      'Tell me the exact message you see when choosing a ticket category. Check whether you already have an open ticket—you can only have one at a time. If the panel says the action failed, staff need to check the bot’s permissions and logs.',
    ],
    [
      /^\s*(how|what|why|where|huh|what do you mean)\s*[? ]*$/,
      'Which part do you mean? Tell me what you’re trying to do, and I’ll explain the next step.',
    ],
    [
      /\b(password|2fa|verification code|login token|api key)\b.*\b(share|send|give|post)|\b(share|send|give|post)\b.*\b(password|token|code|api key)/,
      'Don’t share passwords, login tokens, API keys, or verification codes—even in a ticket. If you exposed one, reset it through the official service and tell staff what happened without posting the secret again.',
    ],
    [
      /\b(error|crash|broken|not work|doesn t work|wont work|won t work|bug)\b/,
      'Tell me what you were trying to do, what happened instead, and the exact error message. Include your version and a screenshot if useful. Remove passwords, tokens, and personal information before sharing logs.',
    ],
    [
      /\b(screenshot|screen shot)\b.*\b(send|take|attach)|\b(attach|upload)\b.*\b(picture|image|screenshot)/,
      'Use Discord’s **+** button beside the message box to attach a screenshot. Make the error visible, and hide private information before sending it.',
    ],
    [
      /\b(scam|phish|suspicious|fake link|malware|virus)\b/,
      'Don’t open suspicious links or download unexpected files. Use official announcements for trusted links, don’t send payment or login details, and ask staff to check anything you’re unsure about.',
    ],
    [
      /\b(refund|chargeback|payment failed|payment issue)\b/,
      'A staff member needs to review payment or refund questions. Use a **Purchase** ticket and include a non-sensitive order reference and a clear description. Don’t send full card details or passwords. I can’t approve refunds or promise an outcome.',
    ],
    [
      /\b(appeal|unban|unmute|banned|muted|timeout)\b/,
      'If you think a punishment was a mistake, use an **Appeal** ticket. Explain what happened calmly, include relevant context, and wait for staff to review it. I can’t remove punishments or promise that an appeal will be accepted.',
    ],
    [
      /\b(basefind|base find|anonymous)\b/,
      'Use **/basefind** with a description and picture. It requires **CHRISP+**. The **anonymous** option hides your name in the public post; server administrators may still have access to audit information.',
    ],
    [
      /\b(voice|vc)\b.*\b(own|create|control|room|channel|kick|mute)/,
      'Join **Join to Create** to get a personal voice room. While you own it, the **voice-access** role opens **voice-controls**. Its buttons only control members in your own room. Leaving removes your access; ownership passes to someone still there, or the room disappears when empty.',
    ],
    [
      /\b(media|application|apply)\b/,
      'Open **media-applications** and press **Start application**. The bot asks one question at a time in DMs, then asks you to confirm before sending your answers to staff. Enable DMs from server members if nothing arrives.',
    ],
    [
      /\b(another|duplicate|two|multiple)\b.*\bticket|\bticket\b.*\b(another|duplicate|multiple)/,
      'Keep one ticket for the same issue. Add new details there instead of opening duplicates. If the topic is unrelated, explain that to staff first.',
    ],
    [
      /\b(ticket)\b.*\b(close|delete|transcript)/,
      '**Close ticket** locks the conversation. **Delete Request** asks for confirmation, then sends a transcript to staff and the owner’s DMs before removing the channel. If delivery fails, the ticket is kept.',
    ],
    [
      /\b(dm|dms|direct message)\b.*\b(closed|enable|allow|work|receive)|\b(not getting|no)\b.*\bdm/,
      'Check the server’s privacy settings and allow direct messages from server members. Also check Message Requests and whether the bot is blocked. Then retry the action.',
    ],
    [
      /\b(who are you|what can you do|help me|help)\b/,
      'I can help with common Discord questions, ticket etiquette, basic troubleshooting, and approved server information. Ask one specific question at a time. For account decisions, payments, appeals, or anything uncertain, use **Request staff**.',
    ],
  ];
  for (const [match, answer] of rules) if (match.test(q)) return answer;
  return null;
}
