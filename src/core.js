/**
 * universal feed entry normalizer — core implementation.
 *
 * Single design decision: a normalized entry has exactly five fields —
 * id, title, link, summary, updated — and every field is a string. When a
 * feed does not provide a value we return an empty string rather than null
 * or undefined, so downstream code can treat every field uniformly without
 * null-checks. This is the trade-off: callers cannot distinguish "the feed
 * omitted this" from "the feed sent an empty element". We consider that an
 * acceptable cost for a predictable, always-string shape.
 */

/**
 * Minimal platform XML parser. We cannot pull in a third-party DOM parser,
 * so we hand-roll a tiny parser that handles exactly the subset of XML that
 * feeds use: elements with optional attributes, character data, and CDATA.
 * It does not support namespaces in a general way; callers resolve prefixes
 * by matching local names during extraction, which is how feeds are actually
 * consumed in practice.
 */

/**
 * Parse XML text into a tree of { tag, attrs, children, text }.
 * Throws on malformed XML (unbalanced tags). CDATA and attributes are
 * supported; comments, processing instructions, and DOCTYPE are skipped.
 */
function parseXml(xml) {
  const root = { tag: '', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  const len = xml.length;

  while (i < len) {
    if (xml[i] === '<') {
      if (xml.startsWith('<!--', i)) {
        const end = xml.indexOf('-->', i + 4);
        if (end === -1) break;
        i = end + 3;
        continue;
      }
      if (xml.startsWith('<?', i)) {
        const end = xml.indexOf('?>', i + 2);
        if (end === -1) break;
        i = end + 2;
        continue;
      }
      if (xml.startsWith('<!', i)) {
        const end = xml.indexOf('>', i + 2);
        if (end === -1) break;
        i = end + 1;
        continue;
      }
      if (xml[i + 1] === '/') {
        const end = xml.indexOf('>', i + 2);
        if (end === -1) throw new Error('unterminated end tag');
        const name = xml.slice(i + 2, end).trim();
        const top = stack.pop();
        if (top.tag !== name) throw new Error(`mismatched end tag: ${name}`);
        i = end + 1;
        continue;
      }
      let j = i + 1;
      while (j < len && xml[j] !== '>' && !(xml[j] === '/' && xml[j + 1] === '>')) j++;
      const raw = xml.slice(i + 1, j).trim();
      let selfClose = false;
      if (j < len && xml[j] === '/' && xml[j + 1] === '>') {
        selfClose = true;
        j++;
      }
      if (j < len && xml[j] !== '>') throw new Error('malformed tag');
      const firstSpace = raw.indexOf(' ');
      const tag = firstSpace === -1 ? raw : raw.slice(0, firstSpace);
      const attrStr = firstSpace === -1 ? '' : raw.slice(firstSpace + 1).trim();
      const attrs = parseAttrs(attrStr);
      const node = { tag, attrs, children: [], text: '' };
      if (selfClose) {
        stack[stack.length - 1].children.push(node);
        i = j + 1;
        continue;
      }
      i = j + 1;
      // CDATA support within this element's direct text.
      const before = i;
      i = consumeTextAndCdata(xml, i, node);
      void before;
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    } else {
      i = consumeTextAndCdata(xml, i, stack[stack.length - 1]);
    }
  }
  if (stack.length !== 1) throw new Error('unbalanced tags');
  return root;
}

function consumeTextAndCdata(xml, i, node) {
  const len = xml.length;
  let text = '';
  while (i < len) {
    if (xml.startsWith('<![CDATA[', i)) {
      const end = xml.indexOf(']]>', i + 9);
      if (end === -1) throw new Error('unterminated CDATA');
      text += xml.slice(i + 9, end);
      i = end + 3;
      continue;
    }
    if (xml[i] === '<') break;
    text += xml[i];
    i++;
  }
  if (text) node.text += decodeEntities(text);
  return i;
}

function parseAttrs(s) {
  const attrs = {};
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    const eq = s.indexOf('=', i);
    if (eq === -1) break;
    const name = s.slice(i, eq).trim();
    let j = eq + 1;
    while (j < s.length && /\s/.test(s[j])) j++;
    const q = s[j];
    if (q !== '"' && q !== "'") break;
    const close = s.indexOf(q, j + 1);
    if (close === -1) break;
    attrs[name] = decodeEntities(s.slice(j + 1, close));
    i = close + 1;
  }
  return attrs;
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function findChildren(node, localName) {
  return node.children.filter((c) => localPart(c.tag) === localName);
}

function findChild(node, localName) {
  return findChildren(node, localName).find((c) => true) || null;
}

function localPart(tag) {
  const idx = tag.indexOf(':');
  return idx === -1 ? tag : tag.slice(idx + 1);
}

function textOf(node) {
  return node ? node.text.trim() : '';
}

/**
 * Find the entry element anywhere in the tree. RSS wraps entries in
 * <rss><channel> or RDF; Atom wraps them directly in <feed>.
 */
function findEntry(root) {
  const search = (n) => {
    if (localPart(n.tag) === 'item' || localPart(n.tag) === 'entry') return n;
    for (const c of n.children) {
      const found = search(c);
      if (found) return found;
    }
    return null;
  };
  return search(root);
}

/**
 * For Atom <link> elements the URL is in the href attribute. A feed may
 * contain multiple <link> siblings with different rel values; we prefer the
 * alternate link, then the first link with an href, then the link's text.
 */
function atomLink(entry) {
  const links = findChildren(entry, 'link');
  const alternate = links.find((l) => l.attrs.rel === 'alternate' && l.attrs.href);
  if (alternate) return alternate.attrs.href;
  const withHref = links.find((l) => l.attrs.href);
  if (withHref) return withHref.attrs.href;
  if (links.length) return textOf(links[0]);
  return '';
}

/**
 * RSS uses <link>text</link> for the URL and <guid> for the id.
 * Atom uses <id> and <link href=...>.
 * Titles and summaries are <title>/<description> in RSS, <title>/<summary>
 * or <content> in Atom. We prefer summary over content for the summary
 * field, because the brief asks for a "summary" specifically.
 */
function normalizeRss(entry) {
  const id = textOf(findChild(entry, 'guid')) || textOf(findChild(entry, 'link'));
  const title = textOf(findChild(entry, 'title'));
  const link = textOf(findChild(entry, 'link'));
  const summary = textOf(findChild(entry, 'description'));
  const updated = textOf(findChild(entry, 'pubDate'));
  return { id, title, link, summary, updated };
}

function normalizeAtom(entry) {
  const id = textOf(findChild(entry, 'id'));
  const title = textOf(findChild(entry, 'title'));
  const link = atomLink(entry);
  const summary = textOf(findChild(entry, 'summary')) || textOf(findChild(entry, 'content'));
  const updated = textOf(findChild(entry, 'updated')) || textOf(findChild(entry, 'published'));
  return { id, title, link, summary, updated };
}

/**
 * Normalize a single feed entry from raw XML.
 * @param {string} xml - raw RSS or Atom XML containing one entry/item.
 * @returns {{id:string,title:string,link:string,summary:string,updated:string}}
 */
export function normalizeEntry(xml) {
  if (typeof xml !== 'string') throw new TypeError('xml must be a string');
  const root = parseXml(xml);
  const entry = findEntry(root);
  if (!entry) throw new Error('no entry or item element found');
  if (localPart(entry.tag) === 'item') return normalizeRss(entry);
  return normalizeAtom(entry);
}
