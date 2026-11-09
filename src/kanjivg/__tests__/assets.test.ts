import { describe, expect, it, jest } from '@jest/globals';

import {
  createKanjiSource,
  loadKanjiSvg,
  readSvgModule,
  resolveKanjiAsset,
} from '../assets';

const svg = (d: string) =>
  `<svg viewBox="0 0 108 108"><g id="kvg:StrokePaths_09b42"><path d="${d}"/></g></svg>`;

describe('createKanjiSource', () => {
  const source = createKanjiSource({
    './漢.svg': svg('M1,1'),
    './9b42.svg': svg('M2,2'),
    './kanji/U6771.svg': svg('M3,3'),
    './kanji/語.kanji.svg': svg('M4,4'),
    './app.svg': 'not-an-svg',
  });

  it('indexes every codepoint spelling', () => {
    for (const key of ['漢', 'U6F22', 'U6f22', '6f22', './漢.svg']) {
      expect(source.resolve(key)).toBe(svg('M1,1'));
    }
    for (const key of ['魂', '9b42', 'U9B42', 'U9b42']) {
      expect(source.resolve(key)).toBe(svg('M2,2'));
    }
    for (const key of ['東', 'U6771', '6771', './kanji/U6771.svg']) {
      expect(source.resolve(key)).toBe(svg('M3,3'));
    }
  });

  it('handles .kanji.svg files with character and codepoint names', () => {
    expect(source.resolve('語')).toBe(svg('M4,4'));
    expect(source.resolve('8A9E')).toBe(svg('M4,4'));
    expect(source.resolve('8a9e')).toBe(svg('M4,4'));
  });

  it('falls back to lowercased lookups for ASCII names', () => {
    expect(source.resolve('App')).toBe('not-an-svg');
  });

  it('returns undefined for unknown keys and reports size', () => {
    expect(source.resolve('麺')).toBeUndefined();
    expect(source.size).toBe(5);
  });

  it('requires lazily through require.context, only once per entry', () => {
    const requireFn = jest.fn((id: string) => svg(id));
    const context = Object.assign(requireFn, {
      keys: () => ['./a.svg', './b.svg'],
    });
    const lazy = createKanjiSource(context as never);
    expect(requireFn).not.toHaveBeenCalled();
    expect(lazy.resolve('a')).toBe(svg('./a.svg'));
    expect(lazy.resolve('a')).toBe(svg('./a.svg'));
    expect(requireFn).toHaveBeenCalledTimes(1);
  });
});

describe('readSvgModule', () => {
  it('accepts raw text and wrapper shapes', () => {
    expect(readSvgModule('x', 'a.svg')).toBe('x');
    expect(readSvgModule({ body: 'b' }, 'a.svg')).toBe('b');
    expect(readSvgModule({ default: 'd' }, 'a.svg')).toBe('d');
  });

  it('rejects numeric asset ids with guidance', () => {
    expect(() => readSvgModule(1, 'a.svg')).toThrow(/raw text/);
  });

  it('rejects other shapes', () => {
    expect(() => readSvgModule(null, 'a.svg')).toThrow(/unexpected SVG module/);
    expect(() => readSvgModule(42n as unknown, 'a.svg')).toThrow(/unexpected/);
  });
});

describe('resolveKanjiAsset', () => {
  it('prefers an explicit file', () => {
    const source = createKanjiSource({ './漢.svg': 'from-source' });
    expect(resolveKanjiAsset('from-file', '漢', source)).toEqual({
      mod: 'from-file',
      name: 'from-file',
    });
  });

  it('looks characters up through the source', () => {
    const source = createKanjiSource({ './漢.svg': 'from-source' });
    expect(resolveKanjiAsset(undefined, '漢', source).mod).toBe('from-source');
  });

  it('fails with helpful messages', () => {
    expect(() => resolveKanjiAsset(undefined, '漢', undefined)).toThrow(
      /createKanjiSource/
    );
    const source = createKanjiSource({ './漢.svg': 'x' });
    expect(() => resolveKanjiAsset(undefined, '麺', source)).toThrow(
      /no SVG found/
    );
    expect(() => resolveKanjiAsset(undefined, undefined, undefined)).toThrow(
      /either `file` or `character`/
    );
  });
});

describe('loadKanjiSvg', () => {
  it('parses raw strings', async () => {
    const parsed = await loadKanjiSvg(svg('M9,9'));
    expect(parsed.svg.strokes).toEqual(['M9,9']);
    expect(parsed.timings).toEqual([{ start: 0, end: 1 }]);
  });

  it('parses modules and memoizes per cache key', async () => {
    const first = await loadKanjiSvg({
      mod: svg('M1,1'),
      name: 'a',
      cacheKey: 'cache-a',
    });
    const second = await loadKanjiSvg({
      mod: svg('M1,1'),
      name: 'a',
      cacheKey: 'cache-a',
    });
    expect(second).toBe(first);
  });

  it('surfaces parse errors as rejections', async () => {
    await expect(
      loadKanjiSvg({ mod: 'nope', name: 'bad.svg' })
    ).rejects.toThrow(/bad\.svg/);
  });
});
