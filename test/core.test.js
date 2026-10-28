import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEntry } from '../src/index.js';

function fields(obj) {
  const { id, title, link, summary, updated } = obj;
  return { id, title, link, summary, updated };
}

test('rss item basic', () => {
  const xml = `<rss><channel>
    <item>
      <title>Post One</title>
      <link>https://example.org/posts/one</link>
      <description>The first post.</description>
      <guid>urn:uuid:1111</guid>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    </item>
  </channel></rss>`;
  const got = normalizeEntry(xml);
  assert.deepEqual(fields(got), {
    id: 'urn:uuid:1111',
    title: 'Post One',
    link: 'https://example.org/posts/one',
    summary: 'The first post.',
    updated: 'Mon, 01 Jan 2024 00:00:00 GMT',
  });
});

test('atom entry basic', () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
    <entry>
      <id>urn:uuid:2222</id>
      <title>Entry Two</title>
      <link href="https://example.org/entries/two" rel="alternate"/>
      <summary>Second entry.</summary>
      <updated>2024-02-02T00:00:00Z</updated>
    </entry>
  </feed>`;
  const got = normalizeEntry(xml);
  assert.deepEqual(fields(got), {
    id: 'urn:uuid:2222',
    title: 'Entry Two',
    link: 'https://example.org/entries/two',
    summary: 'Second entry.',
    updated: '2024-02-02T00:00:00Z',
  });
});

test('atom entry uses content when no summary', () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
    <entry>
      <id>urn:uuid:3333</id>
      <title>Entry Three</title>
      <link href="https://example.org/entries/three"/>
      <content>Body text.</content>
      <updated>2024-03-03T00:00:00Z</updated>
    </entry>
  </feed>`;
  const got = normalizeEntry(xml);
  assert.equal(got.summary, 'Body text.');
});

test('atom link prefers alternate rel', () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
    <entry>
      <id>urn:uuid:4444</id>
      <title>Entry Four</title>
      <link href="https://example.org/enclosure" rel="enclosure"/>
      <link href="https://example.org/entries/four" rel="alternate"/>
      <summary>x</summary>
      <updated>2024-04-04T00:00:00Z</updated>
    </entry>
  </feed>`;
  const got = normalizeEntry(xml);
  assert.equal(got.link, 'https://example.org/entries/four');
});

test('atom falls back to first link href when no alternate', () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
    <entry>
      <id>urn:uuid:5555</id>
      <title>Entry Five</title>
      <link href="https://example.org/entries/five" rel="self"/>
      <summary>y</summary>
      <updated>2024-05-05T00:00:00Z</updated>
    </entry>
  </feed>`;
  const got = normalizeEntry(xml);
  assert.equal(got.link, 'https://example.org/entries/five');
});

test('missing fields become empty strings', () => {
  const xml = `<rss><channel>
    <item><title>Minimal</title></item>
  </channel></rss>`;
  const got = normalizeEntry(xml);
  assert.deepEqual(fields(got), {
    id: '',
    title: 'Minimal',
    link: '',
    summary: '',
    updated: '',
  });
});

test('rss uses link as id when no guid', () => {
  const xml = `<rss><channel>
    <item>
      <title>No Guid</title>
      <link>https://example.org/no-guid</link>
    </item>
  </channel></rss>`;
  const got = normalizeEntry(xml);
  assert.equal(got.id, 'https://example.org/no-guid');
});

test('cdata is preserved', () => {
  const xml = `<rss><channel>
    <item>
      <title><![CDATA[CDATA Title]]></title>
      <link>https://example.org/cdata</link>
      <description><![CDATA[<p>HTML body</p>]]></description>
    </item>
  </channel></rss>`;
  const got = normalizeEntry(xml);
  assert.equal(got.title, 'CDATA Title');
  assert.equal(got.summary, '<p>HTML body</p>');
});

test('entities are decoded', () => {
  const xml = `<rss><channel>
    <item>
      <title>A &amp; B</title>
      <link>https://example.org/entities?x=1&amp;y=2</link>
      <description>3 &lt; 4 &amp; 5 &gt; 2</description>
    </item>
  </channel></rss>`;
  const got = normalizeEntry(xml);
  assert.equal(got.title, 'A & B');
  assert.equal(got.link, 'https://example.org/entities?x=1&y=2');
  assert.equal(got.summary, '3 < 4 & 5 > 2');
});

test('namespaced tags are handled by local name', () => {
  const xml = `<feed xmlns:atom="http://www.w3.org/2005/Atom">
    <atom:entry>
      <atom:id>urn:uuid:6666</atom:id>
      <atom:title>Namespaced</atom:title>
      <atom:link href="https://example.org/ns" rel="alternate"/>
      <atom:summary>NS body</atom:summary>
      <atom:updated>2024-06-06T00:00:00Z</atom:updated>
    </atom:entry>
  </feed>`;
  const got = normalizeEntry(xml);
  assert.equal(got.id, 'urn:uuid:6666');
  assert.equal(got.title, 'Namespaced');
  assert.equal(got.link, 'https://example.org/ns');
});

test('numeric character references', () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
    <entry>
      <id>urn:uuid:7777</id>
      <title>&#65;&#x42;</title>
      <link href="https://example.org/refs"/>
      <summary>ok</summary>
      <updated>2024-07-07T00:00:00Z</updated>
    </entry>
  </feed>`;
  const got = normalizeEntry(xml);
  assert.equal(got.title, 'AB');
});

test('throws when no entry present', () => {
  const xml = `<rss><channel><title>Feed</title></channel></rss>`;
  assert.throws(() => normalizeEntry(xml), /no entry or item/);
});

test('throws on unbalanced tags', () => {
  const xml = `<rss><channel><item><title>Broken</channel></rss>`;
  assert.throws(() => normalizeEntry(xml));
});

test('rdf rss 1.0 entry is found', () => {
  const xml = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
    xmlns="http://purl.org/rss/1.0/">
    <item>
      <title>RDF Item</title>
      <link>https://example.org/rdf</link>
      <description>RDF body</description>
    </item>
  </rdf:RDF>`;
  const got = normalizeEntry(xml);
  assert.equal(got.title, 'RDF Item');
  assert.equal(got.link, 'https://example.org/rdf');
});
