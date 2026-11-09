const path = require('path');
const { getDefaultConfig } = require('@expo/metro-config');
const { withMetroConfig } = require('react-native-monorepo-config');
// In-app usage would be `require('react-native-nitro-kanjivg-tgfx/metro')`; the
// monorepo example requires the source file directly.
const { withKanjiSvgMetroConfig } = require('../metro/index.cjs');

const root = path.resolve(__dirname, '..');

/**
 * Metro configuration
 * https://facebook.github.io/metro/docs/configuration
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = withMetroConfig(getDefaultConfig(__dirname), {
  root,
  dirname: __dirname,
  conditions: ['react-native-nitro-kanjivg-tgfx-source'],
});

// Bundles `example/assets/kanji/*.svg` as raw text so the Kanji component can
// parse KanjiVG files directly from the app folder.
module.exports = withKanjiSvgMetroConfig(config);
