const { describe, expect, it } = require('@jest/globals');
const fs = require('fs');
const os = require('os');
const path = require('path');
require('os');
const {
  createTransformer,
  withKanjiSvgMetroConfig,
  isSvg,
} = require('../index.cjs'); // eslint-disable-line @typescript-eslint/no-require-imports

describe('isSvg', () => {
  it('matches .svg and .kanji.svg', () => {
    expect(isSvg('/app/kanji/魂.svg')).toBe(true);
    expect(isSvg('/app/kanji/9b42.kanji.svg')).toBe(true);
    expect(isSvg('/app/App.tsx')).toBe(false);
  });
});

describe('createTransformer', () => {
  const downstream = {
    extraExport: 1,
    transform: async ({ filename, src }) => ({
      type: 'module',
      filename,
      code: src,
    }),
  };

  it('inlines SVG text as a module', async () => {
    const t = createTransformer(downstream);
    const out = await t.transform({
      filename: '/x/a.svg',
      src: '<svg a="1&amp;2"/>',
    });
    expect(out.code.startsWith('module.exports = "<svg')).toBe(true);
    // eslint-disable-next-line no-eval
    const loaded = (0, eval)(
      `(function(){const module={exports:{}};${out.code};return module.exports})()`
    );
    expect(loaded).toBe('<svg a="1&amp;2"/>');
  });

  it('passes everything else through untouched', async () => {
    const t = createTransformer(downstream);
    const out = await t.transform({
      filename: '/x/App.tsx',
      src: 'const a=1;',
    });
    expect(out.code).toBe('const a=1;');
  });

  it('keeps downstream exports', () => {
    expect(createTransformer(downstream).extraExport).toBe(1);
  });
});

describe('withKanjiSvgMetroConfig', () => {
  it('moves svg from assetExts to sourceExts and wires the transformer', () => {
    const out = withKanjiSvgMetroConfig({
      resolver: { assetExts: ['png', 'svg'], sourceExts: ['js', 'ts'] },
      transformer: { other: true },
    });
    expect(out.resolver.assetExts).toEqual(['png']);
    expect(out.resolver.sourceExts).toEqual(['js', 'ts', 'svg']);
    expect(out.transformer.other).toBe(true);
    expect(fs.existsSync(out.transformer.babelTransformerPath)).toBe(true);
  });

  it('does not duplicate svg in sourceExts', () => {
    const out = withKanjiSvgMetroConfig({
      resolver: { assetExts: [], sourceExts: ['js', 'svg'] },
      transformer: {},
    });
    expect(out.resolver.sourceExts).toEqual(['js', 'svg']);
  });

  it('generates a shim for an explicit downstream transformer', () => {
    const downstreamPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'kanjisvg-test-')),
      'downstream.cjs'
    );
    fs.writeFileSync(
      downstreamPath,
      'module.exports = { transform: async () => ({}) };'
    );
    const out = withKanjiSvgMetroConfig(
      { resolver: { assetExts: [], sourceExts: [] }, transformer: {} },
      { downstreamTransformerPath: downstreamPath }
    );
    expect(
      fs.readFileSync(out.transformer.babelTransformerPath, 'utf8')
    ).toContain('createTransformer');
    // The shim must load and expose our wrapped interface.
    const shim = require(out.transformer.babelTransformerPath);
    expect(typeof shim.transform).toBe('function');
  });
});
