/**
 * Universal symbol representation & normalization utilities for StudyDeck.
 *
 * External websites (Save My Exams, Quizlet, Notion, ChatGPT, Wikipedia, Google Docs, Word, PDFs)
 * emit many different representations for arrows, reversible reactions, bullets, HTML entities,
 * LaTeX commands, and math/science operators. This module normalizes them cleanly into the
 * canonical symbols StudyDeck parses and renders, while protecting URLs, HTML tags, and code spans.
 */

export const BULLET_GLYPH_CLASS = '[-*•▪▫◦‣●○■□◆◇❖⁃∙▸▹►▻➢➣–—]';
export const SUB_BULLET_GLYPH_CLASS = '[↳└├]';

/**
 * Matches an optional indented bullet marker (including Word/Notion/PDF wingding bullets).
 */
export const LINE_BULLET_PREFIX_RE =
  /^(?:[-*•▪▫◦‣●○■□◆◇❖⁃∙▸▹►▻➢➣↳–—]|\[[ xX✓✔]?\]|[☐☑✓✔✅]|\d+[.)])\s+/;

/**
 * Matches any right-pointing arrow variant used across markdown, Word, Notion, web exports, or LaTeX.
 */
export const RIGHT_ARROW_VARIANTS_RE =
  /(?:--->|-->|->|===>|==>|(?<!<)=>|[→⟶⟹➜➔➝➞➟➠➡➤➥➦↦⇢⇥⇾►▶▸▹▻▷➣➢])/g;

const RIGHT_ARROW_SEPARATOR_RE =
  /\s*(?:--->|-->|->|===>|==>|(?<!<)=>|[→⟶⟹➜➔➝➞➟➠➡➤➥➦↦⇢⇥⇾►▶▸▹▻▷➣➢])\s*/g;

const TRIANGLE_BULLET_GLYPHS_RE = /[►▶▸▹▻▷➣➢◄◀◂◁◃◅]/;

/**
 * Normalizes variant external symbols (arrows, bidirectional/reversible arrows, HTML entities,
 * simple LaTeX symbol commands, tree/sub-bullet markers, and math operators) into StudyDeck's
 * canonical symbol set while keeping URLs, HTML tags, comments, and `inline code` untouched.
 */
export function normalizeStudySymbols(
  input: string,
  opts?: { preserveLeadingFlowMarker?: boolean }
): string {
  let s = String(input || '');
  if (!s) return '';

  // 1. Normalize invisible / weird whitespace
  s = s
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u00A0\u202F\u2009]/g, ' ')
    .replace(/\r/g, '');

  // 2. Protect inline code, URLs, HTML comments, and rich-text HTML tags
  const protectedTokens: string[] = [];
  const protect = (raw: string) => {
    const idx = protectedTokens.length;
    protectedTokens.push(raw);
    return `\uE000SDPROT_${idx}\uE001`;
  };

  s = s.replace(
    /(@image:\{[^\n]+\}|`[^`\n]+`|<!--[\s\S]*?-->|<\/?(?:span|mark|u|strong|em|b|i|code|br|a|sub|sup|p|div|table|thead|tbody|tr|th|td|ul|ol|li|h[1-6]|blockquote)\b[^>]*>|https?:\/\/[^\s)>\]"']+)/gi,
    (m) => protect(m)
  );

  // 3. Decode common HTML entities that appear in web scrapes, Quizlet/Anki exports, or docs
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&(?:rarr|Rarr|rArr|longrightarrow|Longrightarrow|rightarrow|Rightarrow|rtrif|blacktriangleright);|&#0*8594;|&#x0*2192;|&#0*10230;|&#0*9658;|&#x0*25ba;|&#0*9654;|&#x0*25b6;|&#0*9656;|&#x0*25b8;/gi, '→')
    .replace(/&(?:larr|Larr|lArr|longleftarrow|Longleftarrow|leftarrow|Leftarrow|ltrif|blacktriangleleft);|&#0*8592;|&#x0*2190;|&#0*10229;|&#0*9668;|&#x0*25c4;|&#0*9664;|&#x0*25c0;|&#0*9666;|&#x0*25c2;/gi, '←')
    .replace(/&(?:harr|hArr|leftrightarrow|Longleftrightarrow|Leftrightarrow);|&#0*8596;|&#x0*2194;/gi, '↔')
    .replace(/&(?:rlarr|harpoons|rightleftharpoons);|&#0*8652;|&#x0*21cc;/gi, '⇌')
    .replace(/&times;|&#0*215;|&#x0*d7;/gi, '×')
    .replace(/&divide;|&#0*247;|&#x0*f7;/gi, '÷')
    .replace(/&plusmn;|&#0*177;|&#x0*b1;/gi, '±')
    .replace(/&(?:le|leq);|&#0*8804;|&#x0*2264;/gi, '≤')
    .replace(/&(?:ge|geq);|&#0*8805;|&#x0*2265;/gi, '≥')
    .replace(/&(?:ne|neq);|&#0*8800;|&#x0*2260;/gi, '≠')
    .replace(/&(?:approx|asymp);|&#0*8776;|&#x0*2248;/gi, '≈')
    .replace(/&deg;|&#0*176;|&#x0*b0;/gi, '°')
    .replace(/&middot;|&#0*183;/gi, '·')
    .replace(/&bull;|&#0*8226;/gi, '•')
    .replace(/&mdash;|&#0*8212;/gi, '—')
    .replace(/&ndash;|&#0*8211;/gi, '–')
    .replace(/&hellip;|&#0*8230;/gi, '…')
    .replace(/&amp;/gi, '&');

  // 4. Normalize common LaTeX symbol commands (outside code)
  s = s
    .replace(/\\(?:rightleftharpoons|leftrightharpoons)\b/g, '⇌')
    .replace(/\\(?:Longleftrightarrow|longleftrightarrow|leftrightarrow|Leftrightarrow|iff)\b/g, '↔')
    .replace(/\\(?:longrightarrow|Longrightarrow|rightarrow|Rightarrow|implies|mapsto|to)\b/g, '→')
    .replace(/\\(?:longleftarrow|Longleftarrow|leftarrow|Leftarrow)\b/g, '←')
    .replace(/\\leq?\b/g, '≤')
    .replace(/\\geq?\b/g, '≥')
    .replace(/\\neq?\b/g, '≠')
    .replace(/\\approx\b/g, '≈')
    .replace(/\\times\b/g, '×')
    .replace(/\\div\b/g, '÷')
    .replace(/\\pm\b/g, '±')
    .replace(/\\infty\b/g, '∞')
    .replace(/\\degree\b|\^\\circ/g, '°')
    .replace(/\\Delta\b/g, 'Δ')
    .replace(/\\alpha\b/g, 'α')
    .replace(/\\beta\b/g, 'β')
    .replace(/\\gamma\b/g, 'γ')
    .replace(/\\theta\b/g, 'θ')
    .replace(/\\lambda\b/g, 'λ')
    .replace(/\\mu\b/g, 'μ')
    .replace(/\\pi\b/g, 'π')
    .replace(/\\sigma\b/g, 'σ')
    .replace(/\\omega\b/g, 'ω');

  // Unwrap inline $...$ only when it contains converted science/arrow unicode (never currency like $50)
  s = s.replace(
    /\$([^$\n]{1,48}[→←↔⇌≤≥≠≈×÷±°Δαβγθλμπσω∞][^$\n]{0,48})\$/g,
    '$1'
  );

  // 5. Preserve StudyDeck's leading flow marker `⇒ ` at line start, while converting mid-line `⇒`
  const preserveFlowMarker = opts?.preserveLeadingFlowMarker !== false;
  const FLOW_LEAD_TOKEN = '\uE000SDFLOWLEAD\uE001';
  if (preserveFlowMarker) {
    s = s.replace(/^([ \t]*)⇒[ \t]+/gm, `$1${FLOW_LEAD_TOKEN}`);
  }

  // 6. Bidirectional / reversible arrows BEFORE single-direction arrows
  s = s
    .replace(/[ \t]*(?:<===>|<==>|<=+>|<--->|<-->|<->|<=>|[⟷⟺⇔])[ \t]*/g, ' ↔ ')
    .replace(/[ \t]*⇌[ \t]*/g, ' ⇌ ');

  // 7. Left arrows (avoid math `x < -5` which has a space between `<` and `-`; keep line-start triangles as bullets)
  s = s.replace(
    /[ \t]*(?:<---|<--|(?<!<)<-(?![->])|[←⟵⟸⬅⇦⇠◄◀◂◁◃◅])[ \t]*/g,
    (m, offset: number, full: string) => {
      const atLineStart = offset === 0 || full[offset - 1] === '\n';
      const nextChar = full[offset + m.length];
      if (atLineStart) {
        if (TRIANGLE_BULLET_GLYPHS_RE.test(m)) return m;
        const leadingWs = m.match(/^[ \t]*/)?.[0] ?? '';
        return !nextChar || nextChar === '\n' ? `${leadingWs}←` : `${leadingWs}← `;
      }
      if (!nextChar || nextChar === '\n') return ' ←';
      return ' ← ';
    }
  );

  // 8. Forward / right arrows (all external ASCII, Unicode, & mid-line triangle pointers -> `→`)
  s = s.replace(
    /[ \t]*(?:--->|-->|->|===>|==>|(?<!<)=>|[→⇒⟶⟹➜➔➝➞➟➠➡➤➥➦↦⇢⇥⇾►▶▸▹▻▷➣➢])[ \t]*/g,
    (m, offset: number, full: string) => {
      const atLineStart = offset === 0 || full[offset - 1] === '\n';
      const nextChar = full[offset + m.length];
      if (atLineStart) {
        // Keep triangle glyphs at the start of a line intact as bullet markers (e.g. `► Point`)
        if (TRIANGLE_BULLET_GLYPHS_RE.test(m)) return m;
        const leadingWs = m.match(/^[ \t]*/)?.[0] ?? '';
        return !nextChar || nextChar === '\n' ? `${leadingWs}→` : `${leadingWs}→ `;
      }
      if (!nextChar || nextChar === '\n') return ' →';
      return ' → ';
    }
  );

  if (preserveFlowMarker) {
    s = s.replaceAll(FLOW_LEAD_TOKEN, '⇒ ');
  }

  // 9. Normalize unambiguous math/tree shorthand outside code
  s = s
    .replace(/(^|\s)\+\/-(?=\s|\d|$)/gm, '$1±')
    .replace(/(\d)\s*\+\/-\s*(\d)/g, '$1 ± $2')
    .replace(/[ \t]*!=[ \t]*/g, ' ≠ ')
    .replace(/^[ \t]*(?:└──?|├──?|└)[ \t]+/gm, '↳ ');

  // Collapse accidental double spaces introduced around arrows (preserving leading indentation)
  s = s.replace(/([^\s])[ \t]{2,}(→|←|↔|⇌)/g, '$1 $2').replace(/(→|←|↔|⇌)[ \t]{2,}/g, '$1 ');

  // 10. Restore protected tokens
  s = s.replace(/\uE000SDPROT_(\d+)\uE001/g, (_m, idxStr) => {
    const idx = Number(idxStr);
    return protectedTokens[idx] ?? '';
  });

  return s;
}

/**
 * Counts how many forward flow-step separators (`→` or variants) exist in a line.
 */
export function countRightArrows(line: string): number {
  const normalized = normalizeStudySymbols(line, { preserveLeadingFlowMarker: true });
  return (normalized.match(/\s*→\s*/g) || []).length;
}

/**
 * Splits a flow line on any right arrow variant (`→`, `->`, `=>`, `➜`, etc.).
 */
export function splitRightArrowSteps(body: string): string[] {
  const normalized = normalizeStudySymbols(body, { preserveLeadingFlowMarker: false });
  return normalized
    .split(RIGHT_ARROW_SEPARATOR_RE)
    .map((step) => step.trim())
    .filter(Boolean);
}
