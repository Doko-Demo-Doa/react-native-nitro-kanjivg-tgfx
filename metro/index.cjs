/**
 * Metro helpers so that `require('./kanji/9b42.svg')` (and `require.context`)
 * return the **raw SVG text** instead of a numeric asset id.
 *
 * Usage in the app's `metro.config.js`:
 *
 *   const { withKanjiSvgMetroConfig } = require('react-native-kanjivg-tgfx/metro');
 *   const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
 *
 *   const config = mergeConfig(getDefaultConfig(__dirname), {
 *     // ...your config
 *   });
 *
 *   module.exports = withKanjiSvgMetroConfig(config);
 *
 * If your app already uses a custom transformer, pass its path explicitly:
 *
 *   module.exports = withKanjiSvgMetroConfig(config, {
 *     downstreamTransformerPath: require.resolve('my-custom-transformer'),
 *   });
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

/**
 * Detect the upstream transformer the way react-native-svg-transformer does:
 * Expo first (its transformer wraps the RN one), then React Native's. Falls
 * back to resolving from the app's working directory, which matters when this
 * package is installed inside a strict (non-hoisted) node_modules tree.
 */
function getDefaultTransformer() {
  const names = [
    '@expo/metro-config/babel-transformer',
    '@react-native/metro-babel-transformer',
    'metro-react-native-babel-transformer',
  ];
  for (const name of names) {
    try {
      return require(name);
    } catch {
      /* try next */
    }
    try {
      const fromApp = Module.createRequire(
        path.join(process.cwd(), 'index.js')
      );
      return fromApp(name);
    } catch {
      /* try next */
    }
  }
  throw new Error(
    'react-native-kanjivg-tgfx/metro: could not resolve the default Metro ' +
      'transformer. Pass { downstreamTransformerPath } to ' +
      'withKanjiSvgMetroConfig() explicitly.'
  );
}

/** True for KanjiVG/SVG files, including the `.kanji.svg` convention. */
function isSvg(filename) {
  return /\.svg$/i.test(filename);
}

/**
 * Wrap a downstream transformer with raw-SVG inlining: `.svg` files become
 * `module.exports = "<file text>"` modules, everything else passes through.
 * The returned object carries all of the downstream transformer's exports so
 * Metro sees the same interface it would natively.
 */
function createTransformer(downstream) {
  const target =
    typeof downstream === 'string' ? require(downstream) : downstream;
  return Object.assign(Object.create(Object.getPrototypeOf(target)), target, {
    async transform(input) {
      if (isSvg(input.filename)) {
        const code = 'module.exports = ' + JSON.stringify(String(input.src));
        return target.transform({ ...input, src: code });
      }
      return target.transform(input);
    },
  });
}

// Used when this file is loaded directly as Metro's `babelTransformerPath`;
// detection is lazy so requiring this module never fails on its own.
async function transform(input) {
  if (isSvg(input.filename)) {
    const code = 'module.exports = ' + JSON.stringify(String(input.src));
    return getDefaultTransformer().transform({ ...input, src: code });
  }
  return getDefaultTransformer().transform(input);
}

function writeDownstreamShim(downstreamTransformerPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanjisvg-'));
  const file = path.join(dir, 'transformer.cjs');
  fs.writeFileSync(
    file,
    'module.exports = require(' +
      JSON.stringify(path.resolve(__dirname, 'index.cjs')) +
      ').createTransformer(' +
      JSON.stringify(path.resolve(downstreamTransformerPath)) +
      ');\n'
  );
  return file;
}

/**
 * Point Metro at this package's transformer and move `svg` from the asset
 * extensions to the source extensions so SVGs are bundled as text.
 */
function withKanjiSvgMetroConfig(config, { downstreamTransformerPath } = {}) {
  const assetExts = (config.resolver && config.resolver.assetExts) || [];
  const sourceExts = (config.resolver && config.resolver.sourceExts) || [];
  return {
    ...config,
    resolver: {
      ...config.resolver,
      assetExts: assetExts.filter((ext) => ext !== 'svg'),
      sourceExts: sourceExts.includes('svg')
        ? sourceExts
        : [...sourceExts, 'svg'],
    },
    transformer: {
      ...config.transformer,
      babelTransformerPath:
        downstreamTransformerPath != null
          ? writeDownstreamShim(downstreamTransformerPath)
          : path.resolve(__dirname, 'index.cjs'),
    },
  };
}

module.exports = {
  transform,
  createTransformer,
  withKanjiSvgMetroConfig,
  isSvg,
};
