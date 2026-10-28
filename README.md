# universal-feed-entry-normalizer

Parses raw RSS and Atom XML entries into a single normalized object shape with common fields.

```js
import { normalizeEntry } from 'universal-feed-entry-normalizer';

const entry = normalizeEntry(`<rss><channel>
  <item>
    <title>Post One</title>
    <link>https://example.org/posts/one</link>
    <description>The first post.</description>
    <guid>urn:uuid:1111</guid>
    <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
  </item>
</channel></rss>`);
// { id, title, link, summary, updated }  — all strings
```

## Why

RSS and Atom disagree on element names, ID locations, and how links are represented. This library reads either format and returns one shape: `{ id, title, link, summary, updated }`. It exists so callers can write one code path instead of two.

The trade-off: every field is a string. When a feed omits a value you get `''`, not `null`. You cannot distinguish "missing" from "empty". That is deliberate — a predictable type beats nullable plumbing for the common case of rendering a list of entries.

## Edge you will hit

The parser is hand-rolled with zero dependencies, so it handles the XML subset that feeds actually use: elements, attributes, CDATA, character references. It does not resolve XML namespaces programmatically; instead it matches on local tag names (the part after `:`), which works for every real-world feed but means a `<media:title>` would be picked up as a `title`. Feeds that put alien titles in extension namespaces will collide with the real title. If you need strict namespace handling, this is not the right tool.

Atom entries may contain multiple `<link>` siblings. The library prefers `rel="alternate"`, then the first link with an `href`, then link text — in that order.

## Exports

- `normalizeEntry(xml: string): { id: string, title: string, link: string, summary: string, updated: string }`

Throws if the XML contains no `<item>` or `<entry>` element, or if the XML is malformed (unbalanced tags, unterminated CDATA).
