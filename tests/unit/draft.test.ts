import { describe, expect, it } from 'vitest';
import { gunzipSync } from 'node:zlib';

import { buildPreviewUrl, encodeDraft } from '../../src/server/draft.js';

describe('draft encoding', () => {
  it('encodes a payload into a url-safe, gunzip-decodable string', () => {
    const payload = {
      content: '<h1>{{title}}</h1>',
      variables: { title: 'Selam — 🧠' },
      width: 1080,
      height: 1080,
    };

    const encoded = encodeDraft(payload);

    expect(encoded).not.toMatch(/[+/=]/);
    const decoded = JSON.parse(
      gunzipSync(Buffer.from(encoded, 'base64url')).toString('utf-8')
    );
    expect(decoded).toEqual(payload);
  });

  it('builds a /preview#draft= URL on the given base without a double slash', () => {
    const url = buildPreviewUrl('https://ojo.so/', { content: '<p>x</p>' });

    expect(url.startsWith('https://ojo.so/preview#draft=')).toBe(true);
  });
});
