import katex from 'katex';
import 'katex/contrib/mhchem';

/**
 * Safe, robust KaTeX rendering helper.
 * Never throws; strict mode disabled for maximum compatibility; trust=false for XSS safety.
 */
export function renderKatexToHtml(latex: string, displayMode = false): string {
  const clean = String(latex || '').trim();
  if (!clean) return '';
  try {
    return katex.renderToString(clean, {
      displayMode,
      throwOnError: false,
      errorColor: '#cc0000',
      strict: false,
      trust: false,
    });
  } catch (err) {
    const safeMsg = String(err instanceof Error ? err.message : err).replace(/[<>&]/g, '');
    return `<span class="katex-error" title="${safeMsg}">${displayMode ? '$$\n' : '$'}${escapeHtmlForLatex(clean)}${displayMode ? '\n$$' : '$'}</span>`;
  }
}

function escapeHtmlForLatex(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Currency vs Math Guard:
 * Returns true if a single-dollar match like "$100" or "$50 to $60" is likely money rather than LaTeX math.
 */
export function isLikelyCurrency(text: string): boolean {
  const trimmed = text.trim();
  // Simple numeric prices: $10, $19.99, $1,000, $5m, $20k
  if (/^\$?\d+(?:,\d{3})*(?:\.\d+)?\s*(?:m|k|bn|billion|million|trillion|usd|aud|gbp|cad|eur)?$/i.test(trimmed)) {
    return true;
  }
  // Price ranges: "$10 - $20", "$50 to $100"
  if (/^\$?\d+(?:\.\d+)?\s*(?:-|to)\s*\$?\d+(?:\.\d+)?$/i.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * Checks whether an inline $...$ expression is genuine LaTeX math.
 */
export function isValidInlineMath(expr: string): boolean {
  const inner = expr.trim();
  if (!inner || inner.length > 500) return false;
  if (inner.includes('\n')) return false;
  // If it's just pure numbers/currency words
  if (/^\d+(?:,\d{3})*(?:\.\d+)?\s*(?:m|k|bn|billion|million)?$/i.test(inner)) return false;
  // LaTeX indicator characters or commands
  if (
    /\\(?:[a-zA-Z]+|[,\s!#%&_{}])/i.test(inner) || // has backslash command
    /[=<>±×÷·√∫∑∏∂∇≈≠≤≥∞∈∉⊂⊆∪∩∧∨¬⇒→⇔↔]/.test(inner) || // math symbol
    /^[a-zA-Z_]\w*\s*(?:[+\-*/^=<>~]|\([a-zA-Z0-9_,.\s]*\))/.test(inner) || // algebraic expr like "x + y", "f(x)"
    /\^[0-9a-zA-Z{]/.test(inner) || // superscript like x^2
    /_[0-9a-zA-Z{]/.test(inner) || // subscript like x_1
    /\{.*\}/.test(inner) // braces like \frac{a}{b}
  ) {
    return true;
  }
  // Single variable like $x$ or $T_0$
  if (/^[a-zA-Z]$/.test(inner)) return true;
  // Common math formulas without backslash: "a^2 + b^2 = c^2", "E = mc^2", "y = mx + b"
  if (/^[a-zA-Z0-9\s()+\-*/^=.,]+$/.test(inner) && /[+\-*/^=]/.test(inner)) return true;
  return false;
}

export interface MathSegment {
  type: 'text' | 'inline-math' | 'display-math';
  content: string;
  raw: string;
}

/**
 * Tokenizes a string into text and LaTeX math segments.
 * Supports:
 * - Display math: $$...$$, \[...\], \begin{env}...\end{env}
 * - Inline math: $...$, \(...\)
 * Respects escaped \$ and code blocks.
 */
export function parseMathSegments(input: string): MathSegment[] {
  if (!input) return [];

  const segments: MathSegment[] = [];
  const len = input.length;
  let cursor = 0;
  let textBuffer = '';

  const flushText = () => {
    if (textBuffer) {
      segments.push({ type: 'text', content: textBuffer, raw: textBuffer });
      textBuffer = '';
    }
  };

  while (cursor < len) {
    // 1. Check for escaped dollar: \$
    if (input[cursor] === '\\' && cursor + 1 < len && input[cursor + 1] === '$') {
      textBuffer += '$';
      cursor += 2;
      continue;
    }

    // 2. Check for display math: $$...$$
    if (input.startsWith('$$', cursor)) {
      const endIdx = input.indexOf('$$', cursor + 2);
      if (endIdx !== -1) {
        flushText();
        const content = input.slice(cursor + 2, endIdx);
        segments.push({
          type: 'display-math',
          content: content.trim(),
          raw: input.slice(cursor, endIdx + 2),
        });
        cursor = endIdx + 2;
        continue;
      }
    }

    // 3. Check for display math: \[...\]
    if (input.startsWith('\\[', cursor)) {
      const endIdx = input.indexOf('\\]', cursor + 2);
      if (endIdx !== -1) {
        flushText();
        const content = input.slice(cursor + 2, endIdx);
        segments.push({
          type: 'display-math',
          content: content.trim(),
          raw: input.slice(cursor, endIdx + 2),
        });
        cursor = endIdx + 2;
        continue;
      }
    }

    // 4. Check for LaTeX math environments: \begin{equation|align|gather|cases|pmatrix|bmatrix|matrix|split}...
    const envMatch = input.slice(cursor).match(/^\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|flalign\*?|alignat\*?|split|cases|matrix|pmatrix|bmatrix|vmatrix|Vmatrix|aligned|gathered)\}/);
    if (envMatch) {
      const envName = envMatch[1];
      const endPattern = `\\end{${envName}}`;
      const endIdx = input.indexOf(endPattern, cursor + envMatch[0].length);
      if (endIdx !== -1) {
        flushText();
        const fullRaw = input.slice(cursor, endIdx + endPattern.length);
        segments.push({
          type: 'display-math',
          content: fullRaw.trim(),
          raw: fullRaw,
        });
        cursor = endIdx + endPattern.length;
        continue;
      }
    }

    // 5. Check for inline math: \(...\)
    if (input.startsWith('\\(', cursor)) {
      const endIdx = input.indexOf('\\)', cursor + 2);
      if (endIdx !== -1) {
        flushText();
        const content = input.slice(cursor + 2, endIdx);
        segments.push({
          type: 'inline-math',
          content: content.trim(),
          raw: input.slice(cursor, endIdx + 2),
        });
        cursor = endIdx + 2;
        continue;
      }
    }

    // 6. Check for inline math: $...$
    if (input[cursor] === '$') {
      // Find closing unescaped $
      let endIdx = -1;
      for (let i = cursor + 1; i < len; i++) {
        if (input[i] === '\n') break; // Inline math does not span newlines
        if (input[i] === '\\' && i + 1 < len) {
          i++; // skip escaped char
          continue;
        }
        if (input[i] === '$') {
          endIdx = i;
          break;
        }
      }

      if (endIdx !== -1) {
        const candidate = input.slice(cursor + 1, endIdx);
        // Ensure not empty and not currency
        if (candidate.trim() && !isLikelyCurrency(candidate) && isValidInlineMath(candidate)) {
          flushText();
          segments.push({
            type: 'inline-math',
            content: candidate.trim(),
            raw: input.slice(cursor, endIdx + 1),
          });
          cursor = endIdx + 1;
          continue;
        }
      }
    }

    // Normal character
    textBuffer += input[cursor];
    cursor++;
  }

  flushText();
  return segments;
}

/**
 * Replaces LaTeX math in raw sanitized HTML text nodes with rendered KaTeX markup.
 * Operates client-side using DOMParser; preserves all existing HTML tags and attributes.
 */
export function renderDocumentHtmlWithLatex(html: string): string {
  if (!html || typeof window === 'undefined' || !html.includes('$') && !html.includes('\\(') && !html.includes('\\[') && !html.includes('\\begin{')) {
    return html;
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<!DOCTYPE html><html><body>${html}</body></html>`, 'text/html');
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const nodesToReplace: Array<{ node: Text; segments: MathSegment[] }> = [];

    let current: Node | null = walker.nextNode();
    while (current) {
      const textNode = current as Text;
      const parent = textNode.parentElement;
      const tag = parent?.tagName.toLowerCase();

      // Skip code blocks, pre tags, and already rendered KaTeX elements
      if (
        tag !== 'pre' &&
        tag !== 'code' &&
        tag !== 'script' &&
        tag !== 'style' &&
        !parent?.closest('.katex') &&
        !parent?.closest('.katex-display')
      ) {
        const text = textNode.nodeValue || '';
        if (text.includes('$') || text.includes('\\(') || text.includes('\\[') || text.includes('\\begin{')) {
          const segs = parseMathSegments(text);
          if (segs.some((s) => s.type !== 'text')) {
            nodesToReplace.push({ node: textNode, segments: segs });
          }
        }
      }
      current = walker.nextNode();
    }

    for (const { node, segments } of nodesToReplace) {
      const parent = node.parentNode;
      if (!parent) continue;

      const frag = doc.createDocumentFragment();
      for (const seg of segments) {
        if (seg.type === 'text') {
          frag.appendChild(doc.createTextNode(seg.content));
        } else {
          const isDisplay = seg.type === 'display-math';
          const renderedHtml = renderKatexToHtml(seg.content, isDisplay);
          const span = doc.createElement('span');
          span.className = isDisplay ? 'sd-math-block my-2 block overflow-x-auto text-center' : 'sd-inline-math inline-block align-middle';
          span.innerHTML = renderedHtml;
          frag.appendChild(span);
        }
      }
      parent.replaceChild(frag, node);
    }

    return doc.body.innerHTML;
  } catch {
    return html;
  }
}

/**
 * Word OMML (Office Open XML Math) to LaTeX converter.
 * Converts `<m:oMath>` and `<m:oMathPara>` XML elements into standard LaTeX expressions.
 */
export function convertOmmlElementToLatex(mathEl: Element): string {
  const isDisplay = mathEl.localName === 'oMathPara';

  const walkOmml = (el: Element): string => {
    const name = el.localName;

    // Plain text / numbers / variables
    if (name === 't') {
      const txt = el.textContent || '';
      return txt
        .replace(/×/g, '\\times ')
        .replace(/÷/g, '\\div ')
        .replace(/±/g, '\\pm ')
        .replace(/·/g, '\\cdot ')
        .replace(/≠/g, '\\neq ')
        .replace(/≤/g, '\\leq ')
        .replace(/≥/g, '\\geq ')
        .replace(/≈/g, '\\approx ')
        .replace(/∞/g, '\\infty ')
        .replace(/α/g, '\\alpha ')
        .replace(/β/g, '\\beta ')
        .replace(/γ/g, '\\gamma ')
        .replace(/δ/g, '\\delta ')
        .replace(/Δ/g, '\\Delta ')
        .replace(/θ/g, '\\theta ')
        .replace(/λ/g, '\\lambda ')
        .replace(/μ/g, '\\mu ')
        .replace(/π/g, '\\pi ')
        .replace(/σ/g, '\\sigma ')
        .replace(/Σ/g, '\\Sigma ')
        .replace(/ω/g, '\\omega ')
        .replace(/Ω/g, '\\Omega ');
    }

    // Fraction: <m:f> <m:num>...</m:num> <m:den>...</m:den> </m:f>
    if (name === 'f') {
      const numEl = Array.from(el.children).find((c) => c.localName === 'num');
      const denEl = Array.from(el.children).find((c) => c.localName === 'den');
      const num = numEl ? walkChildren(numEl) : '';
      const den = denEl ? walkChildren(denEl) : '';
      return `\\frac{${num}}{${den}}`;
    }

    // Superscript: <m:sSup> <m:e>base</m:e> <m:sup>power</m:sup> </m:sSup>
    if (name === 'sSup') {
      const baseEl = Array.from(el.children).find((c) => c.localName === 'e');
      const supEl = Array.from(el.children).find((c) => c.localName === 'sup');
      const base = baseEl ? walkChildren(baseEl) : '';
      const sup = supEl ? walkChildren(supEl) : '';
      return `{${base}}^{${sup}}`;
    }

    // Subscript: <m:sSub> <m:e>base</m:e> <m:sub>idx</m:sub> </m:sSub>
    if (name === 'sSub') {
      const baseEl = Array.from(el.children).find((c) => c.localName === 'e');
      const subEl = Array.from(el.children).find((c) => c.localName === 'sub');
      const base = baseEl ? walkChildren(baseEl) : '';
      const sub = subEl ? walkChildren(subEl) : '';
      return `{${base}}_{${sub}}`;
    }

    // Sub-Superscript: <m:sSubSup> <m:e>base</m:e> <m:sub>idx</m:sub> <m:sup>pow</m:sup> </m:sSubSup>
    if (name === 'sSubSup') {
      const baseEl = Array.from(el.children).find((c) => c.localName === 'e');
      const subEl = Array.from(el.children).find((c) => c.localName === 'sub');
      const supEl = Array.from(el.children).find((c) => c.localName === 'sup');
      const base = baseEl ? walkChildren(baseEl) : '';
      const sub = subEl ? walkChildren(subEl) : '';
      const sup = supEl ? walkChildren(supEl) : '';
      return `{${base}}_{${sub}}^{${sup}}`;
    }

    // Radical (square root / nth root): <m:rad> <m:deg>n</m:deg> <m:e>x</m:e> </m:rad>
    if (name === 'rad') {
      const degEl = Array.from(el.children).find((c) => c.localName === 'deg');
      const baseEl = Array.from(el.children).find((c) => c.localName === 'e');
      const deg = degEl ? walkChildren(degEl).trim() : '';
      const base = baseEl ? walkChildren(baseEl) : '';
      return deg ? `\\sqrt[${deg}]{${base}}` : `\\sqrt{${base}}`;
    }

    // Delimiter / Parentheses: <m:d> <m:e>...</m:e> </m:d>
    if (name === 'd') {
      const dPr = Array.from(el.children).find((c) => c.localName === 'dPr');
      const begCh = dPr ? Array.from(dPr.children).find((c) => c.localName === 'begCh')?.getAttribute('m:val') ?? '(' : '(';
      const endCh = dPr ? Array.from(dPr.children).find((c) => c.localName === 'endCh')?.getAttribute('m:val') ?? ')' : ')';
      const body = walkChildren(el, ['dPr']);
      return `\\left${begCh}${body}\\right${endCh}`;
    }

    // N-ary / Sum / Integral: <m:nary> <m:sub>...</m:sub> <m:sup>...</m:sup> <m:e>...</m:e> </m:nary>
    if (name === 'nary') {
      const naryPr = Array.from(el.children).find((c) => c.localName === 'naryPr');
      const chr = naryPr ? Array.from(naryPr.children).find((c) => c.localName === 'chr')?.getAttribute('m:val') || '∑' : '∑';
      const subEl = Array.from(el.children).find((c) => c.localName === 'sub');
      const supEl = Array.from(el.children).find((c) => c.localName === 'sup');
      const baseEl = Array.from(el.children).find((c) => c.localName === 'e');

      let sym = '\\sum';
      if (chr === '∫') sym = '\\int';
      else if (chr === '∏') sym = '\\prod';

      const sub = subEl ? walkChildren(subEl).trim() : '';
      const sup = supEl ? walkChildren(supEl).trim() : '';
      const body = baseEl ? walkChildren(baseEl) : '';

      let op = sym;
      if (sub) op += `_{${sub}}`;
      if (sup) op += `^{${sup}}`;
      return `${op} ${body}`;
    }

    // Matrix: <m:m> <m:mr> <m:e>...</m:e> </m:mr> </m:m>
    if (name === 'm') {
      const rows = Array.from(el.children).filter((c) => c.localName === 'mr');
      const rowLatex = rows.map((r) =>
        Array.from(r.children)
          .filter((c) => c.localName === 'e')
          .map((c) => walkChildren(c))
          .join(' & ')
      );
      return `\\begin{matrix} ${rowLatex.join(' \\\\ ')} \\end{matrix}`;
    }

    // Bar / Hat / Accent: <m:acc> <m:e>...</m:e> </m:acc>
    if (name === 'acc') {
      const accPr = Array.from(el.children).find((c) => c.localName === 'accPr');
      const chr = accPr ? Array.from(accPr.children).find((c) => c.localName === 'chr')?.getAttribute('m:val') || '^' : '^';
      const baseEl = Array.from(el.children).find((c) => c.localName === 'e');
      const base = baseEl ? walkChildren(baseEl) : '';
      if (chr === '¯' || chr === '—') return `\\overline{${base}}`;
      if (chr === '^') return `\\hat{${base}}`;
      if (chr === '→') return `\\vec{${base}}`;
      return `\\bar{${base}}`;
    }

    return walkChildren(el);
  };

  const walkChildren = (parent: Element, skipLocalNames: string[] = []): string => {
    let out = '';
    for (const ch of Array.from(parent.children)) {
      if (skipLocalNames.includes(ch.localName)) continue;
      out += walkOmml(ch);
    }
    return out;
  };

  const rawLatex = walkOmml(mathEl).trim();
  if (!rawLatex) return '';
  return isDisplay ? `$$${rawLatex}$$` : `$${rawLatex}$`;
}

/**
 * LaTeX Document to Markdown Converter:
 * Parses full `.tex` documents or pasted LaTeX code (sections, formatting, math, lists, tables).
 */
export function parseLatexDocumentToMarkdown(rawTex: string): {
  title?: string;
  markdown: string;
  hasLatexDoc: boolean;
} {
  const trimmed = rawTex.trim();
  const hasLatexDoc =
    /\\documentclass/i.test(trimmed) ||
    /\\begin\{document\}/i.test(trimmed) ||
    (/\\section\{/i.test(trimmed) && /\\begin\{/i.test(trimmed));

  if (!hasLatexDoc && !/\\(?:section|subsection|subsubsection|textbf|textit|begin\{)/.test(trimmed)) {
    return { markdown: rawTex, hasLatexDoc: false };
  }

  // Extract document title: \title{...}
  const titleMatch = trimmed.match(/\\title\{([^}]+)\}/);
  const title = titleMatch ? titleMatch[1].trim() : undefined;

  let body = trimmed;

  // Extract body between \begin{document} and \end{document} if present
  const docBodyMatch = body.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/);
  if (docBodyMatch) {
    body = docBodyMatch[1];
  } else {
    // Strip preamble up to \begin{document}
    body = body.replace(/^[\s\S]*?\\begin\{document\}/, '');
  }

  // Remove LaTeX comments (% ...) except escaped \%
  body = body.replace(/(^|[^\\])%.*$/gm, '$1');

  // Strip author, date, maketitle, tableofcontents
  body = body
    .replace(/\\maketitle/g, '')
    .replace(/\\tableofcontents/g, '')
    .replace(/\\newpage|\\clearpage/g, '\n---\n')
    .replace(/\\author\{[^}]*\}/g, '')
    .replace(/\\date\{[^}]*\}/g, '');

  // Protect all display math blocks before converting text
  const displayMathTokens: string[] = [];
  const mathTokenKey = (i: number) => `@@LATEX_DISPLAY_MATH_${i}@@`;

  body = body.replace(
    /\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|cases|pmatrix|bmatrix|matrix|split)\}([\s\S]*?)\\end\{\1\}/g,
    (m) => {
      const idx = displayMathTokens.length;
      displayMathTokens.push(m.trim());
      return `\n\n${mathTokenKey(idx)}\n\n`;
    }
  );

  body = body.replace(/\\\[([\s\S]*?)\\\]/g, (_, inner) => {
    const idx = displayMathTokens.length;
    displayMathTokens.push(`$$${inner.trim()}$$`);
    return `\n\n${mathTokenKey(idx)}\n\n`;
  });

  body = body.replace(/\$\$([\s\S]*?)\$\$/g, (_, inner) => {
    const idx = displayMathTokens.length;
    displayMathTokens.push(`$$${inner.trim()}$$`);
    return `\n\n${mathTokenKey(idx)}\n\n`;
  });

  // Convert Theorem / Definition / Proof / Example / Callout environments to styled callouts
  body = body.replace(
    /\\begin\{(theorem|definition|lemma|proposition|corollary|example|proof|remark|note)\}(?:\[([^\]]+)\])?([\s\S]*?)\\end\{\1\}/gi,
    (_, env, customTitle, content) => {
      const capEnv = env.charAt(0).toUpperCase() + env.slice(1);
      const calloutTag =
        /theorem|proposition|lemma|corollary/i.test(env)
          ? '[!IMPORTANT]'
          : /example/i.test(env)
          ? '[!EXAMPLE]'
          : /proof/i.test(env)
          ? '[!NOTE]'
          : '[!TIP]';
      const label = customTitle ? `${capEnv}: ${customTitle}` : capEnv;
      const cleanLines = content.trim().split('\n').map((l: string) => `> ${l}`).join('\n');
      return `\n\n> ${calloutTag} **${label}**\n${cleanLines}\n\n`;
    }
  );

  // Convert tabular to Markdown table
  body = body.replace(/\\begin\{tabular\}\{[^}]*\}([\s\S]*?)\\end\{tabular\}/g, (_, tableBody) => {
    const rawRows = tableBody
      .replace(/\\hline/g, '')
      .split(/\\\\/)
      .map((r: string) => r.trim())
      .filter((r: string) => r.length > 0 && !r.startsWith('\\'));

    if (rawRows.length === 0) return '';
    const parsedRows = rawRows.map((r: string) =>
      r.split('&').map((c: string) => c.trim().replace(/\n+/g, ' '))
    );
    const maxCols = parsedRows.reduce((m: number, r: string[]) => Math.max(m, r.length), 1);
    const pad = (cols: string[]) =>
      `| ${Array.from({ length: maxCols }, (_, ci) => cols[ci] || '').join(' | ')} |`;

    const mdLines = [
      pad(parsedRows[0]),
      `| ${Array.from({ length: maxCols }, () => '---').join(' | ')} |`,
      ...parsedRows.slice(1).map(pad),
    ];
    return `\n\n${mdLines.join('\n')}\n\n`;
  });

  // Convert lists: itemize -> bullets, enumerate -> numbered
  body = body.replace(/\\begin\{itemize\}([\s\S]*?)\\end\{itemize\}/g, (_, inner) => {
    const items = inner.split(/\\item\b/).map((x: string) => x.trim()).filter(Boolean);
    return `\n\n${items.map((it: string) => `- ${it.replace(/\n\s+/g, ' ')}`).join('\n')}\n\n`;
  });

  body = body.replace(/\\begin\{enumerate\}([\s\S]*?)\\end\{enumerate\}/g, (_, inner) => {
    const items = inner.split(/\\item\b/).map((x: string) => x.trim()).filter(Boolean);
    return `\n\n${items.map((it: string, i: number) => `${i + 1}. ${it.replace(/\n\s+/g, ' ')}`).join('\n')}\n\n`;
  });

  // Convert quote environment
  body = body.replace(/\\begin\{quote\}([\s\S]*?)\\end\{quote\}/g, (_, inner) => {
    const lines = inner.trim().split('\n').map((l: string) => `> ${l.trim()}`).join('\n');
    return `\n\n${lines}\n\n`;
  });

  // Convert Section Headings
  body = body.replace(/\\section\*?\{([^}]+)\}/g, '\n\n## $1\n\n');
  body = body.replace(/\\subsection\*?\{([^}]+)\}/g, '\n\n### $1\n\n');
  body = body.replace(/\\subsubsection\*?\{([^}]+)\}/g, '\n\n#### $1\n\n');
  body = body.replace(/\\paragraph\*?\{([^}]+)\}/g, '\n\n**$1** ');

  // Convert basic inline text formatting
  body = body
    .replace(/\\textbf\{([^}]+)\}/g, '**$1**')
    .replace(/\\textit\{([^}]+)\}/g, '*$1*')
    .replace(/\\emph\{([^}]+)\}/g, '*$1*')
    .replace(/\\texttt\{([^}]+)\}/g, '`$1`')
    .replace(/\\underline\{([^}]+)\}/g, '<u>$1</u>')
    .replace(/\\sout\{([^}]+)\}/g, '~~$1~~')
    .replace(/\\url\{([^}]+)\}/g, '[$1]($1)')
    .replace(/\\href\{([^}]+)\}\{([^}]+)\}/g, '[$2]($1)');

  // Clean unescaped special LaTeX characters
  body = body
    .replace(/\\%/g, '%')
    .replace(/\\&/g, '&')
    .replace(/\\#/g, '#')
    .replace(/\\_/g, '_')
    .replace(/\\\$/g, '$');

  // Restore display math tokens
  displayMathTokens.forEach((token, idx) => {
    body = body.replace(mathTokenKey(idx), token);
  });

  // Clean up excessive blank lines
  const markdown = body.replace(/\n{3,}/g, '\n\n').trim();

  return {
    title,
    markdown,
    hasLatexDoc,
  };
}
