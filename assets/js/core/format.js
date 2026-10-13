const fmtTime = (d) => {
  if (!d) return '—';
  const date = new Date(d);
  return Number.isNaN(+date)
    ? String(d).slice(0, 14)
    : date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

/**
 * Unix timestamp for a feed date string (RSS, Atom, compact ISO).
 * Returns 0 when unparseable so sorting stays deterministic.
 */
function newsTimestamp(raw) {
  if (!raw) return 0;
  let d = new Date(raw);
  if (!Number.isNaN(+d)) return +d;
  const m = String(raw).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : 0;
}
function timeAgo(raw) {
  if (!raw) return 'TIME N/A';
  let d = new Date(raw);
  if (Number.isNaN(+d)) {
    const m = String(raw).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
    if (m) d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
  }
  if (Number.isNaN(+d)) return 'TIME N/A';
  const min = Math.max(0, Math.floor((Date.now() - d) / 60000));
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h`;
}
function ageLabel(sec) {
  if (sec == null || !Number.isFinite(Number(sec))) return '—';
  const s = Math.max(0, Number(sec));
  return s < 3600 ? `${Math.floor(s / 60)}m`
    : s < 86400 ? `${Math.floor(s / 3600)}h`
    : `${Math.floor(s / 86400)}d`;
}

function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render a subset of Markdown to HTML for the chat log.
 *
 * Model output is untrusted: it can echo headlines, vessel names, and listing
 * titles pulled from third-party feeds. So the text is escaped *first* and the
 * markup rules are applied to the escaped string. Nothing that arrives here
 * can introduce a tag or an attribute; the only tags in the output are the
 * ones written below.
 *
 * Supports headings, bold/italic, inline and fenced code, links, bullet and
 * numbered lists, blockquotes, and horizontal rules. Fenced blocks and inline
 * code spans are lifted out before any other rule runs so their contents are
 * never reinterpreted as markup.
 */
function renderMarkdown(source) {
  const text = String(source ?? '');

  const blocks = [];
  let work = text.replace(/```([\w.+-]*)\n?([\s\S]*?)```/g, (_, lang, body) => {
    blocks.push(
      `<pre class="md-pre">${body.endsWith('\n') ? body.slice(0, -1) : body}</pre>`,
    );
    return `%%RIALTO_BLOCK_${blocks.length - 1}%%`;
  });

  const spans = [];
  work = work.replace(/`([^`\n]+)`/g, (match, code) => {
    spans.push(`<code class="md-code">${code}</code>`);
    return `%%RIALTO_SPAN_${spans.length - 1}%%`;
  });

  let html = escHtml(work);

  // Only http(s) and mailto survive. The href is already escaped, so these
  // tests cannot be bypassed with encoded scheme characters.
  const safeLink = (href, label) => {
    const probe = href.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    if (!/^(https?:\/\/|mailto:)/i.test(probe)) return label;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  };

  const inline = (s) => s
    .replace(/\[([^\]]+)]\(([^)\s]+)\)/g, (_, label, href) => safeLink(href, label))
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');

  const out = [];
  let para = [];
  let list = null;

  const flushPara = () => {
    if (para.length) { out.push(`<p>${para.join('<br>')}</p>`); para = []; }
  };
  const closeList = () => {
    if (list) { out.push(`</${list}>`); list = null; }
  };

  const splitRow = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  // A GFM delimiter row: pipes and dashes only, with optional colons.
  const isDelimiter = (row) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(row) && row.includes('|');

  const lines = html.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) { flushPara(); closeList(); continue; }
    // A fenced block is block-level: it must not be folded into a <p>, or
    // the browser closes the paragraph early and re-parents the <pre>.
    const block = line.match(/^%%RIALTO_BLOCK_(\d+)%%$/);
    if (block) {
      flushPara(); closeList();
      out.push(`%%RIALTO_BLOCK_${block[1]}%%`);
      continue;
    }
    // Models emit pipe tables often. Without this they fall through to the
    // paragraph branch and render as literal "| a | b |" text.
    if (line.includes('|') && lines[i + 1] && isDelimiter(lines[i + 1])) {
      flushPara(); closeList();
      const header = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((cell) => (
        /^:-+:$/.test(cell) ? 'center' : /-+:$/.test(cell) ? 'right' : 'left'
      ));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      i -= 1;
      const pad = (cells) => header.map((_, c) => inline(cells[c] || ''));
      const align = (c) => (aligns[c] ? ` style="text-align:${aligns[c]}"` : '');
      out.push(
        `<table class="md-table"><thead><tr>${header.map((cell, c) => `<th${align(c)}>${inline(cell)}</th>`).join('')}</tr></thead>`
        + `<tbody>${rows.map((row) => `<tr>${pad(row).map((cell, c) => `<td${align(c)}>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
      );
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara(); closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^\s*(?:---|\*\*\*|___)\s*$/.test(line)) {
      flushPara(); closeList(); out.push('<hr>');
      continue;
    }
    const quote = line.match(/^&gt;\s?(.*)$/);
    if (quote) {
      flushPara(); closeList();
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) {
      flushPara();
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (numbered) {
      flushPara();
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(numbered[1])}</li>`);
      continue;
    }
    flushPara(); closeList();
    para.push(inline(line));
  }
  flushPara();
  closeList();

  return out.join('')
    // `?? match` keeps the sentinel as literal text when model output
    // happens to contain one that we never created, instead of rendering
    // the string "undefined" into the transcript.
    .replace(/%%RIALTO_BLOCK_(\d+)%%/g, (match, i) => blocks[Number(i)] ?? match)
    .replace(/%%RIALTO_SPAN_(\d+)%%/g, (match, i) => spans[Number(i)] ?? match);
}

export { fmtTime, newsTimestamp, timeAgo, ageLabel, escHtml, renderMarkdown };
