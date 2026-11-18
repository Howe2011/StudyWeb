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
  }
  return parsed;
}

function extractInlineText($: cheerio.CheerioAPI, el: Element): string {
  const parts: string[] = [];

  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; data?: string; tagName?: string; children?: unknown[] };
    if (n.type === 'text') {
      parts.push(n.data || '');
      return;
    }
    if (n.type !== 'tag') return;
    const tag = (n.tagName || '').toLowerCase();
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
    .replace(/\s+/g, ' ')
    .replace(/\*\*([^*]+?)\*\*\s+\*\*([^*]+?)\*\*/g, '**$1 $2**')
    .trim();
}

function cleanBoilerplateLine(line: string): boolean {
  const s = line.replace(/\*\*/g, '').trim();
  if (!s) return true;
  if (
    /^(?:advertisement|sponsored|did this page help you\??|yes\s*no|test yourself|join now|sign up|log in|cookie preferences|next topic|previous topic|back to top|download pdf|view all topics|jump to|table of contents|print this page)$/i.test(
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
      const parts = $(el).find('[class*="front"], [class*="question"], [class*="prompt"], [class*="back"], [class*="answer"]');
      if (parts.length >= 2) {
        add($(parts[0]).text(), $(parts[1]).text());
      }
    });
  }

  return cards;
}

function extractArticleMarkdown($: cheerio.CheerioAPI, domain: string): {
  title: string;
  markdown: string;
} {
  const rawTitle =
    $('h1').first().text().trim() ||
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('title').first().text().trim() ||
    domain;

  const title = rawTitle
    .replace(/\s*\|\s*(?:Save My Exams|BBC Bitesize|Wikipedia|Seneca).*$/i, '')
    .replace(/\s*-\s*Revision Notes.*$/i, '')
    .trim();

  // Strip site chrome & noise
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
      '[class*="sidebar" i]',
      '[class*="breadcrumb" i]',
      '[class*="cookie" i]',
      '[class*="advert" i]',
      '[class*="promo" i]',
      '[class*="upsell" i]',
      '[class*="paywall" i]',
      '[class*="feedback" i]',
      '[class*="newsletter" i]',
      '.mw-editsection',
      '#toc',
      '.toc',
      '.navbox',
      '.reflist',
    ].join(', ')
  ).remove();

  // Pick richest content root
  const candidates = [
    'article',
    'main',
    '#mw-content-text .mw-parser-output',
    '[class*="RevisionNotes" i]',
    '[class*="revision-notes" i]',
    '[class*="study-guide" i]',
    '.content',
    'body',
  ];

  let root: cheerio.Cheerio<Element> | null = null;
  for (const sel of candidates) {
    const found = $(sel).first();
    if (found.length && found.text().trim().length > 180) {
      root = found as cheerio.Cheerio<Element>;
      break;
    }
  }
  if (!root) root = $('body').first() as cheerio.Cheerio<Element>;

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

  // Fallback if nested structure had direct text nodes only
  if (lines.length === 0) {
    root.find('h1, h2, h3, p, li').each((_i, el) => {
      walkBlock(el);
    });
  }

  return {
    title,
    markdown: lines.join('\n').trim(),
  };
}

export function registerWebImportRoutes(app: Express): void {
  app.post('/api/import/url', async (req: Request, res: Response) => {
    const rawUrl = String((req.body as { url?: string })?.url || '').trim();
    if (!rawUrl) {
      res.status(400).json({ error: 'Please paste a study webpage, Quizlet, or Gizmo URL.' });
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
      const fetchRes = await fetch(safeUrl.toString(), {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
        },
      });

      if (fetchRes.status === 401 || fetchRes.status === 403 || fetchRes.status === 429) {
        const hint = isDeckSite
          ? `${domain} blocked automated page fetching (HTTP ${fetchRes.status}). Open the set in your browser, copy its cards (in Quizlet click ··· → Export → Copy text), and paste them into the "Quizlet & Gizmo" tab!`
          : `${domain} blocked automated fetching (HTTP ${fetchRes.status}). Copy the page text from your browser and paste it into the "Paste Text" tab — the autoformatter will structure it cleanly.`;
        res.status(422).json({ error: hint, blocked: true });
        return;
      }

      if (!fetchRes.ok) {
        res.status(fetchRes.status).json({
          error: `Could not load URL (HTTP ${fetchRes.status}).`,
        });
        return;
      }

      const contentType = (fetchRes.headers.get('content-type') || '').toLowerCase();
      const rawBody = await fetchRes.text();
      if (rawBody.length > 5_000_000) {
        res.status(413).json({ error: 'Web page is too large to import (>5MB).' });
        return;
      }

      if (/cloudflare|just a moment|enable javascript and cookies|attention required/i.test(rawBody.slice(0, 4000))) {
        const hint = isDeckSite
          ? `${domain} uses a browser security challenge. Copy the flashcards directly (Quizlet: ··· → Export → Copy text) and paste them into the "Quizlet & Gizmo" tab.`
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
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : 'Failed to fetch webpage. You can always copy and paste the text directly.',
      });
    }
  });
}
