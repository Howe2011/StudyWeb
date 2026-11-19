import dns from 'dns/promises';
import net from 'net';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import type { Express, Request, Response } from 'express';

export interface WebImportedCard {
  q: string;
  a: string;
  sectionName: string;
}

export interface WebImportResponse {
  url: string;
  domain: string;
  kind: 'notes' | 'flashcards';
  title: string;
  markdown: string;
  cards: WebImportedCard[];
}

function isPrivateIpAddress(ip: string): boolean {
  const clean = ip.replace(/^::ffff:/i, '');
  if (!net.isIP(clean)) return true;
  if (clean === '127.0.0.1' || clean === '::1' || clean === '0.0.0.0') return true;
  if (clean.startsWith('10.') || clean.startsWith('192.168.') || clean.startsWith('169.254.')) {
    return true;
  }
  const parts = clean.split('.').map(Number);
  if (parts.length === 4 && parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
    return true;
  }
  if (/^(?:fc|fd|fe80)/i.test(clean)) return true;
  return false;
}

async function assertSafeExternalUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Please enter a valid web URL starting with https:// or http://.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only http:// and https:// URLs are supported.');
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === '0.0.0.0' ||
    host === '127.0.0.1' ||
    host === '[::1]'
  ) {
    throw new Error('Local or internal URLs cannot be fetched.');
  }
  if (net.isIP(host) && isPrivateIpAddress(host)) {
    throw new Error('Private network addresses are not allowed.');
  }
  try {
    const records = await dns.lookup(host, { all: true });
    if (records.some((r) => isPrivateIpAddress(r.address))) {
      throw new Error('This host resolves to a restricted private address.');
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('restricted')) throw err;
    const code = (err as { code?: string } | null)?.code;
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ENODATA') {
      throw new Error(`Could not find website "${host}". Check the URL spelling and try again.`);
    }
  }
  return parsed;
}

function extractInlineText($: cheerio.CheerioAPI, el: Element): string {
  const parts: string[] = [];

  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const n = node as {
      type?: string;
      data?: string;
      tagName?: string;
      attribs?: Record<string, string>;
      children?: unknown[];
    };
    if (n.type === 'text') {
      parts.push(n.data || '');
      return;
    }
    if (n.type !== 'tag') return;
    const tag = (n.tagName || '').toLowerCase();
    const cls = (n.attribs?.class || '').toLowerCase();
    if (
      tag === 'script' ||
      tag === 'style' ||
      tag === 'noscript' ||
      tag === 'svg' ||
      tag === 'button' ||
      tag === 'nav'
    ) {
      return;
    }
    if (tag === 'sup' && (cls.includes('reference') || cls.includes('noprint'))) {
      return;
    }
    if (tag === 'span' && cls.includes('mw-editsection')) {
      return;
    }
    if (tag === 'br') {
      parts.push(' ');
      return;
    }

    const before = parts.length;
    for (const child of n.children || []) {
      walk(child);
    }
    const inner = parts.splice(before).join('').replace(/\s+/g, ' ');

    if (tag === 'strong' || tag === 'b') {
      const t = inner.trim();
      if (t) parts.push(` **${t}** `);
    } else if (tag === 'em' || tag === 'i') {
      const t = inner.trim();
      if (t) parts.push(` *${t}* `);
    } else if (tag === 'code') {
      const t = inner.trim();
      if (t) parts.push(` \`${t}\` `);
    } else {
      parts.push(inner);
    }
  };

  walk(el);
  return parts
    .join('')
    .replace(/\[(?:\d+|[a-z]|citation needed|edit|update|clarification needed)\]/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\*\*([^*]+?)\*\*\s+\*\*([^*]+?)\*\*/g, '**$1 $2**')
    .trim();
}

function cleanBoilerplateLine(line: string): boolean {
  const s = line.replace(/\*\*/g, '').trim();
  if (!s) return true;
  if (
    /^(?:advertisement|sponsored|did this page help you\??|yes\s*no|test yourself|join now|sign up|log in|cookie preferences|next topic|previous topic|back to top|download pdf|view all topics|jump to|table of contents|print this page|more guides on this topic|related links?|external links|references|further reading|see also|notes)$/i.test(
      s
    )
  ) {
    return true;
  }
  if (/^author:\s*.{2,40}$/i.test(s) && s.length < 48) return true;
  return false;
}

function extractCardsFromJsonTree(
  root: unknown,
  defaultSection = 'Imported Deck'
): WebImportedCard[] {
  const cards: WebImportedCard[] = [];
  const seen = new Set<string>();

  const pushCard = (qRaw: unknown, aRaw: unknown, secRaw?: unknown) => {
    const q = String(qRaw || '').replace(/\s+/g, ' ').trim();
    const a = String(aRaw || '').replace(/\s+/g, ' ').trim();
    if (!q || !a || q.length > 500 || a.length > 1500) return;
    if (q.toLowerCase() === a.toLowerCase()) return;
    const key = `${q.toLowerCase()}::${a.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    cards.push({
      q,
      a,
      sectionName: String(secRaw || '').trim() || defaultSection,
    });
  };

  const visit = (node: unknown, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 14) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;

    // Quizlet studiableItem cardSides shape
    if (Array.isArray(obj.cardSides) && obj.cardSides.length >= 2) {
      const sideText = (side: unknown): string => {
        if (!side || typeof side !== 'object') return '';
        const s = side as { media?: Array<{ plainText?: string }>; label?: string };
        if (Array.isArray(s.media)) {
          const texts = s.media.map((m) => String(m?.plainText || '').trim()).filter(Boolean);
          if (texts.length) return texts.join(' ');
        }
        return '';
      };
      const front = sideText(obj.cardSides[0]);
      const back = sideText(obj.cardSides[1]);
      if (front && back) pushCard(front, back, defaultSection);
    }

    // Standard Quizlet / Gizmo term-definition or question-answer object shapes
    const qCand =
      obj.word ??
      obj.term ??
      obj.question ??
      obj.prompt ??
      obj.front ??
      (typeof obj.q === 'string' ? obj.q : undefined);
    const aCand =
      obj.definition ??
      obj.def ??
      obj.answer ??
      obj.back ??
      (typeof obj.a === 'string' ? obj.a : undefined);

    if (typeof qCand === 'string' && typeof aCand === 'string') {
      pushCard(qCand, aCand, obj.section || obj.topic || defaultSection);
    }

    for (const val of Object.values(obj)) {
      if (val && typeof val === 'object') visit(val, depth + 1);
    }
  };

  visit(root);
  return cards;
}

function extractQuizletOrGizmoFromHtml(
  $: cheerio.CheerioAPI,
  domain: string,
  title: string
): WebImportedCard[] {
  const cards: WebImportedCard[] = [];
  const seen = new Set<string>();

  const add = (q: string, a: string) => {
    const cq = q.replace(/\s+/g, ' ').trim();
    const ca = a.replace(/\s+/g, ' ').trim();
    if (!cq || !ca) return;
    const key = `${cq.toLowerCase()}::${ca.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    cards.push({ q: cq, a: ca, sectionName: title || 'Imported Deck' });
  };

  // 1. Scan Next.js __NEXT_DATA__ or JSON script payloads
  $('script#__NEXT_DATA__, script[type="application/json"], script[type="application/ld+json"]').each(
    (_idx, el) => {
      const raw = $(el).html() || '';
      if (!raw.trim()) return;
      try {
        const json = JSON.parse(raw) as unknown;
        for (const c of extractCardsFromJsonTree(json, title || 'Imported Deck')) {
          add(c.q, c.a);
        }
      } catch {
        // ignore invalid script JSON
      }
    }
  );

  // 2. Quizlet DOM selectors fallback
  if (domain.includes('quizlet')) {
    $('.SetPageTerms-term, [data-testid="set-page-card"], .SetPageTerm-content').each(
      (_idx, el) => {
        const sides = $(el).find('.SetPageTerm-wordText, .SetPageTerm-definitionText, .TermText');
        if (sides.length >= 2) {
          add($(sides[0]).text(), $(sides[1]).text());
        }
      }
    );
  }

  // 3. Gizmo DOM selectors fallback
  if (domain.includes('gizmo')) {
    $('[data-testid*="card"], [class*="flashcard"], [class*="Card"]').each((_idx, el) => {
      const parts = $(el).find(
        '[class*="front"], [class*="question"], [class*="prompt"], [class*="back"], [class*="answer"]'
      );
      if (parts.length >= 2) {
        add($(parts[0]).text(), $(parts[1]).text());
      }
    });
  }

  return cards;
}

function htmlFragmentToMarkdown(fragment: string, domain: string): string {
  const $frag = cheerio.load(`<div id="__sd_root__">${fragment}</div>`);
  return extractArticleMarkdownFromRoot($frag, $frag('#__sd_root__').first() as cheerio.Cheerio<Element>, domain);
}

function extractNotesFromEmbeddedJson(
  $: cheerio.CheerioAPI,
  domain: string
): { title?: string; markdown: string } {
  const chunks: string[] = [];
  let discoveredTitle = '';

  const visitJson = (node: unknown, depth = 0) => {
    if (!node || depth > 14) return;
    if (Array.isArray(node)) {
      for (const item of node) visitJson(item, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;

    if (!discoveredTitle && typeof obj.headline === 'string' && obj.headline.trim().length > 4) {
      discoveredTitle = obj.headline.trim();
    }
    if (typeof obj.articleBody === 'string' && obj.articleBody.trim().length > 120) {
      chunks.push(obj.articleBody.trim());
    }
    if (typeof obj.markdown === 'string' && obj.markdown.trim().length > 120) {
      chunks.push(obj.markdown.trim());
    }
    if (typeof obj.html === 'string' && obj.html.includes('<p>') && obj.html.length > 200) {
      const md = htmlFragmentToMarkdown(obj.html, domain);
      if (md.length > 100) chunks.push(md);
    }
    if (typeof obj.bodyHtml === 'string' && obj.bodyHtml.includes('<p>') && obj.bodyHtml.length > 200) {
      const md = htmlFragmentToMarkdown(obj.bodyHtml, domain);
      if (md.length > 100) chunks.push(md);
    }

    for (const val of Object.values(obj)) {
      if (val && typeof val === 'object') visitJson(val, depth + 1);
    }
  };

  $('script#__NEXT_DATA__, script[type="application/ld+json"], script[type="application/json"]').each(
    (_idx, el) => {
      const raw = $(el).html() || '';
      if (!raw.trim() || raw.length > 1_500_000) return;
      try {
        visitJson(JSON.parse(raw));
      } catch {
        // ignore invalid script JSON
      }
    }
  );

  const uniqueChunks = Array.from(new Set(chunks));
  return {
    title: discoveredTitle || undefined,
    markdown: uniqueChunks.join('\n\n').trim(),
  };
}

function scoreContentCandidate($: cheerio.CheerioAPI, el: Element): number {
  const $el = $(el);
  let studyChars = 0;
  $el.find('p, h1, h2, h3, h4, li, dt, dd, td, th').each((_i, child) => {
    const t = $(child).text().replace(/\s+/g, ' ').trim();
    if (t.length > 12) {
      studyChars += t.length;
    }
  });
  const totalChars = $el.text().replace(/\s+/g, ' ').trim().length;
  let linkChars = 0;
  $el.find('a').each((_i, a) => {
    linkChars += $(a).text().replace(/\s+/g, ' ').trim().length;
  });
  // Penalize link-farm / navigation promo containers
  const linkRatio = totalChars > 0 ? linkChars / totalChars : 0;
  const penalty = linkRatio > 0.55 ? 0.25 : 1;
  return Math.round((studyChars + totalChars * 0.2) * penalty);
}

function extractArticleMarkdownFromRoot(
  $: cheerio.CheerioAPI,
  root: cheerio.Cheerio<Element>,
  _domain: string
): string {
  const lines: string[] = [];
  const seenLines = new Set<string>();

  const pushLine = (txt: string, allowRepeat = false) => {
    const clean = txt.trim();
    if (!clean || cleanBoilerplateLine(clean)) return;
    if (!allowRepeat && seenLines.has(clean.toLowerCase()) && clean.length < 90) return;
    seenLines.add(clean.toLowerCase());
    lines.push(clean);
  };

  const walkList = (listEl: Element, ordered: boolean, depth: number) => {
    const indent = depth > 0 ? '  '.repeat(Math.min(3, depth)) : '';
    let idx = 1;
    $(listEl)
      .children('li')
      .each((_i, li) => {
        const clone = $(li).clone();
        clone.children('ul, ol').remove();
        const text = extractInlineText($, clone[0] as Element);
        if (text) {
          pushLine(`${indent}${ordered ? `${idx++}. ` : '- '}${text}`);
        }
        $(li)
          .children('ul, ol')
          .each((_j, subList) => {
            walkList(subList, subList.tagName.toLowerCase() === 'ol', depth + 1);
          });
      });
  };

  const walkBlock = (el: Element) => {
    const tag = el.tagName?.toLowerCase() || '';
    const cls = ($(el).attr('class') || '').toLowerCase();

    if (tag === 'h1') {
      const t = extractInlineText($, el).replace(/\*\*/g, '').trim();
      if (t) pushLine(`# ${t}`);
      return;
    }
    if (tag === 'h2') {
      const t = extractInlineText($, el).replace(/\*\*/g, '').trim();
      if (t) pushLine(`## ${t}`);
      return;
    }
    if (tag === 'h3' || tag === 'h4') {
      const t = extractInlineText($, el).replace(/\*\*/g, '').trim();
      if (t) pushLine(`### ${t}`);
      return;
    }

    if (tag === 'ul' || tag === 'ol') {
      walkList(el, tag === 'ol', 0);
      return;
    }

    if (tag === 'table') {
      const rows: string[][] = [];
      $(el)
        .find('tr')
        .each((_i, tr) => {
          const cells: string[] = [];
          $(tr)
            .children('th, td')
            .each((_j, cell) => {
              cells.push(extractInlineText($, cell).replace(/\|/g, '/').trim());
            });
          if (cells.some(Boolean)) rows.push(cells);
        });
      if (rows.length > 0) {
        const cols = rows.reduce((m, r) => Math.max(m, r.length), 1);
        if (cols >= 2) {
          const pad = (r: string[]) =>
            `| ${Array.from({ length: cols }, (_, i) => r[i] || '').join(' | ')} |`;
          pushLine(pad(rows[0]), true);
          pushLine(`| ${Array.from({ length: cols }, () => '---').join(' | ')} |`, true);
          for (let r = 1; r < rows.length; r++) pushLine(pad(rows[r]), true);
        } else {
          rows.forEach((r) => {
            if (r[0]) pushLine(`- ${r[0]}`);
          });
        }
      }
      return;
    }

    // Detect Save My Exams / Revision callout boxes
    if (
      (cls.includes('examiner') && cls.includes('tip')) ||
      cls.includes('exam-tip') ||
      cls.includes('callout-tip')
    ) {
      const txt = extractInlineText($, el).replace(/^exam(?:iner)?\s*tip\s*[:–—-]?\s*/i, '');
      if (txt) pushLine(`Examiner Tip: ${txt}`);
      return;
    }
    if (cls.includes('worked') && cls.includes('example')) {
      const txt = extractInlineText($, el).replace(/^worked\s*example\s*[:–—-]?\s*/i, '');
      if (txt) pushLine(`Worked Example: ${txt}`);
      return;
    }

    if (tag === 'p' || tag === 'blockquote') {
      const txt = extractInlineText($, el);
      if (txt && txt.length > 2) pushLine(txt);
      return;
    }

    if (tag === 'dl') {
      let currentTerm = '';
      $(el)
        .children('dt, dd')
        .each((_i, item) => {
          const t = item.tagName.toLowerCase();
          const txt = extractInlineText($, item).replace(/\*\*/g, '').trim();
          if (t === 'dt') currentTerm = txt;
          else if (t === 'dd' && currentTerm && txt) {
            pushLine(`- **${currentTerm}**: ${txt}`);
            currentTerm = '';
          }
        });
      return;
    }

    // Container element: recurse into children
    $(el)
      .children()
      .each((_i, child) => {
        walkBlock(child);
      });
  };

  root.children().each((_i, child) => {
    walkBlock(child);
  });

  // Fallback if nested structure had direct text nodes or wrapped blocks
  if (lines.length === 0) {
    root.find('h1, h2, h3, h4, p, li, table').each((_i, el) => {
      walkBlock(el);
    });
  }

  return lines.join('\n').trim();
}

function extractArticleMarkdown($: cheerio.CheerioAPI, domain: string): {
  title: string;
  markdown: string;
} {
  // Check embedded JSON BEFORE removing script tags
  const embeddedNotes = extractNotesFromEmbeddedJson($, domain);

  const firstH1 = $('h1').first();
  const h1Text =
    firstH1.length && firstH1[0]?.type === 'tag'
      ? extractInlineText($, firstH1[0] as Element).replace(/\*\*/g, '').trim()
      : '';

  const rawTitle =
    h1Text ||
    embeddedNotes.title ||
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('title').first().text().trim() ||
    domain;

  const title = rawTitle
    .replace(/\s*\|\s*(?:Save My Exams|BBC Bitesize|Wikipedia|Seneca|Google Docs).*$/i, '')
    .replace(/\s*-\s*(?:Revision Notes|Google Docs).*$/i, '')
    .trim();

  // Strip site chrome & noise (never delete layout grid wrappers containing main content)
  $(
    [
      'script',
      'style',
      'noscript',
      'svg',
      'nav',
      'header',
      'footer',
      'aside',
      'form',
      'button',
      'iframe',
      '[role="navigation"]',
      '[role="banner"]',
      '[aria-label*="breadcrumb" i]',
      '[class*="breadcrumb" i]',
      '[class*="cookie" i]',
      '[class*="advert" i]',
      '[class*="promo" i]',
      '[class*="upsell" i]',
      '[class*="paywall" i]',
      '[class*="feedback" i]',
      '[class*="newsletter" i]',
      '[class*="more-guides" i]',
      '[class*="related-links" i]',
      '.mw-editsection',
      'sup.reference',
      '.hatnote',
      '.ambox',
      '.infobox',
      '#toc',
      '.toc',
      '.navbox',
      '.reflist',
      '#catlinks',
    ].join(', ')
  ).remove();

  $('[class*="sidebar" i], [role="complementary"]').each((_i, el) => {
    const $el = $(el);
    if (
      $el.is('main, article, body') ||
      $el.find('main, article, [data-component="text-block"]').length > 0
    ) {
      return;
    }
    if ($el.find('p').length <= 3) {
      $el.remove();
    }
  });

  // Score ALL candidate elements rather than stopping at the first small <article> promo
  const candidateSelectors = [
    '#mw-content-text .mw-parser-output',
    '[class*="RevisionNotes" i]',
    '[class*="revision-notes" i]',
    '[class*="study-guide" i]',
    '[class*="article-body" i]',
    'main',
    '[role="main"]',
    'article',
    '.content',
    'body',
  ];

  let bestRoot: cheerio.Cheerio<Element> | null = null;
  let bestScore = 0;

  for (const sel of candidateSelectors) {
    $(sel).each((_idx, el) => {
      if (el.type !== 'tag') return;
      const score = scoreContentCandidate($, el as Element);
      if (score > bestScore) {
        bestScore = score;
        bestRoot = $(el) as cheerio.Cheerio<Element>;
      }
    });
  }

  if (!bestRoot) bestRoot = $('body').first() as cheerio.Cheerio<Element>;
  const domMarkdown = extractArticleMarkdownFromRoot($, bestRoot, domain);

  const markdown =
    domMarkdown.length >= 250 || domMarkdown.length >= embeddedNotes.markdown.length
      ? domMarkdown
      : embeddedNotes.markdown;

  return {
    title,
    markdown,
  };
}

function extractGoogleDocIdFromUrl(url: URL): string | null {
  if (!url.hostname.toLowerCase().includes('docs.google.com')) return null;
  const match = url.pathname.match(/\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]{15,})/);
  return match ? match[1] : null;
}

function describeFetchError(err: unknown, domain: string): { status: number; message: string } {
  if (err instanceof Error) {
    if (err.message.includes('restricted') || err.message.includes('Private')) {
      return { status: 400, message: err.message };
    }
    if (err.name === 'TimeoutError' || err.name === 'AbortError' || /timed out/i.test(err.message)) {
      return {
        status: 422,
        message: `${domain} took too long to respond (timeout). Copy the text from your browser and paste it into the "Paste Text" tab.`,
      };
    }
  }
  return {
    status: 422,
    message: `Could not connect to ${domain}. Check the URL, or copy the study text directly into the "Paste Text" tab.`,
  };
}

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
};

export function registerWebImportRoutes(app: Express): void {
  app.post('/api/import/url', async (req: Request, res: Response) => {
    const rawUrl = String((req.body as { url?: string })?.url || '').trim();
    if (!rawUrl) {
      res.status(400).json({ error: 'Please paste a study webpage, Quizlet, Gizmo, or Google Docs URL.' });
      return;
    }

    let safeUrl: URL;
    try {
      safeUrl = await assertSafeExternalUrl(rawUrl);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid URL.' });
      return;
    }

    const domain = safeUrl.hostname.replace(/^www\./, '').toLowerCase();
    const isDeckSite = domain.includes('quizlet') || domain.includes('gizmo');

    try {
      // Special path: Public / link-shared Google Docs URLs export cleanly without OAuth
      const gDocId = extractGoogleDocIdFromUrl(safeUrl);
      if (gDocId) {
        const exportHtmlUrl = `https://docs.google.com/document/d/${encodeURIComponent(gDocId)}/export?format=html`;
        const gRes = await fetch(exportHtmlUrl, {
          method: 'GET',
          redirect: 'follow',
          signal: AbortSignal.timeout(12000),
          headers: BROWSER_HEADERS,
        });

        const redirectedToLogin = gRes.url.includes('accounts.google.com');
        if (redirectedToLogin || gRes.status === 401 || gRes.status === 403) {
          res.status(422).json({
            blocked: true,
            error:
              'This Google Doc is private. Either set Share → "Anyone with the link (Viewer)" and retry, sign in above with Google Docs access, or click File → Download → Word (.docx) / Markdown (.md) and upload it.',
          });
          return;
        }
        if (!gRes.ok) {
          res.status(422).json({
            error: `Could not export Google Doc (HTTP ${gRes.status}). Verify the link or download it as .docx / .md.`,
          });
          return;
        }

        const gHtml = await gRes.text();
        if (gHtml.includes('accounts.google.com/ServiceLogin') || gHtml.includes('Sign in - Google Accounts')) {
          res.status(422).json({
            blocked: true,
            error:
              'This Google Doc requires sign-in. Share it as "Anyone with the link" to fetch via URL, or download it as .docx / .md and upload it.',
          });
          return;
        }

        const $g = cheerio.load(gHtml);
        const docTitle =
          $g('title').first().text().trim() ||
          $g('h1').first().text().trim() ||
          'Google Doc';
        const gMarkdown = extractArticleMarkdownFromRoot(
          $g,
          $g('body').first() as cheerio.Cheerio<Element>,
          'docs.google.com'
        );

        if (!gMarkdown || gMarkdown.length < 10) {
          res.status(422).json({
            error: 'This Google Doc appears to be empty or could not be parsed.',
          });
          return;
        }

        const payload: WebImportResponse = {
          url: safeUrl.toString(),
          domain: 'docs.google.com',
          kind: 'notes',
          title: docTitle,
          markdown: gMarkdown,
          cards: [],
        };
        res.json(payload);
        return;
      }

      const fetchRes = await fetch(safeUrl.toString(), {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
        headers: BROWSER_HEADERS,
      });

      if (fetchRes.url) {
        await assertSafeExternalUrl(fetchRes.url);
      }

      if (fetchRes.status === 401 || fetchRes.status === 403 || fetchRes.status === 429) {
        const hint = isDeckSite
          ? `${domain} blocked automated page fetching (HTTP ${fetchRes.status}). Open the set in your browser, copy its cards (in Quizlet click ··· → Export → Copy text), and paste them into the "Quizlet & Gizmo" tab!`
          : `${domain} blocked automated fetching (HTTP ${fetchRes.status}). Copy the page text from your browser and paste it into the "Paste Text" tab — the autoformatter will structure it cleanly.`;
        res.status(422).json({ error: hint, blocked: true });
        return;
      }

      if (!fetchRes.ok) {
        res.status(422).json({
          error: `Could not load ${domain} (HTTP ${fetchRes.status}). Check the URL or paste the study text directly.`,
        });
        return;
      }

      const contentType = (fetchRes.headers.get('content-type') || '').toLowerCase();
      const rawBody = await fetchRes.text();
      if (rawBody.length > 5_000_000) {
        res.status(413).json({ error: 'Web page is too large to import (>5MB).' });
        return;
      }

      if (
        /cloudflare|just a moment|enable javascript and cookies|attention required|checking your browser/i.test(
          rawBody.slice(0, 4500)
        )
      ) {
        const hint = isDeckSite
          ? `${domain} uses a browser security check. Copy the flashcards directly (Quizlet: ··· → Export → Copy text) and paste them into the "Quizlet & Gizmo" tab.`
          : `${domain} requires interactive browser verification. Highlight & copy the notes from that page and paste them into the "Paste Text" tab.`;
        res.status(422).json({ error: hint, blocked: true });
        return;
      }

      // Plain text or Markdown URLs
      if (contentType.includes('text/plain') || contentType.includes('text/markdown')) {
        const fallbackTitle = safeUrl.pathname.split('/').filter(Boolean).pop() || domain;
        const payload: WebImportResponse = {
          url: safeUrl.toString(),
          domain,
          kind: 'notes',
          title: fallbackTitle,
          markdown: rawBody.trim(),
          cards: [],
        };
        res.json(payload);
        return;
      }

      const $ = cheerio.load(rawBody);
      const { title, markdown } = extractArticleMarkdown($, domain);

      if (isDeckSite) {
        const $raw = cheerio.load(rawBody);
        const cards = extractQuizletOrGizmoFromHtml($raw, domain, title);
        if (cards.length > 0) {
          const formattedCardsText = cards
            .map((c) => `Q: ${c.q} | A: ${c.a}`)
            .join('\n');
          const payload: WebImportResponse = {
            url: safeUrl.toString(),
            domain,
            kind: 'flashcards',
            title: title || `${domain} Deck`,
            markdown: formattedCardsText,
            cards,
          };
          res.json(payload);
          return;
        }
        if (!markdown || markdown.length < 40) {
          res.status(422).json({
            blocked: true,
            error: `No readable cards were exposed in the ${domain} page HTML (likely login-gated or dynamic). Copy-paste the cards or Quizlet Export into the "Quizlet & Gizmo" tab instead!`,
          });
          return;
        }
      }

      if (!markdown || markdown.length < 30) {
        res.status(422).json({
          error:
            'Could not extract readable study content from this URL (the page may require sign-in or render dynamically). Try copying the page text into the Paste Text tab.',
        });
        return;
      }

      const payload: WebImportResponse = {
        url: safeUrl.toString(),
        domain,
        kind: 'notes',
        title,
        markdown,
        cards: [],
      };
      res.json(payload);
    } catch (err) {
      const info = describeFetchError(err, domain);
      res.status(info.status).json({ error: info.message });
    }
  });
}
