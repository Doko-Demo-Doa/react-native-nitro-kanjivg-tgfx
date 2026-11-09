# react-native-nitro-kanjivg-tgfx

Animated Kanji (CJK glyph) viewer for React Native, powered by
[react-native-tgfx](https://tgfx.margelo.com) and
[KanjiVG](https://kanjivg.tagaini.net) stroke data.

- 📂 **Zero codegen** — drop KanjiVG `.svg` files in a folder of your app and render them directly
- 🔎 Look glyphs up **by character** (`<Kanji character="漢" … />`) via a directory source
- 🎨 Per-stroke styling (ghost layer, colors, widths) today — imperative stroke-draw animation on the roadmap
- ⚡ GPU-rendered through tgfx (Skia-class), parsing memoized per glyph

## Installation

```sh
pnpm add react-native-nitro-kanjivg-tgfx react-native-nitro-modules react-native-tgfx
```

`react-native-tgfx` also expects its animation peers when installed (peer resolution):

```sh
pnpm add react-native-reanimated react-native-worklets
```

For Expo, install the **Expo Go-incompatible** Nitro modules as above and use a dev client.

## Setup: put KanjiVG files in your app

1. Download the KanjiVG dataset from <https://kanjivg.tagaini.net> (CC BY-SA — see
   [DATA-LICENSE.md](./DATA-LICENSE.md)). Each character is one small `.svg` file
   named by its codepoint (e.g. `06f22.svg` = 漢). Copy the ones you need:

   ```
   your-app/
   └── assets/
       └── kanji/
           ├── 06f22.svg   # 漢
           ├── 09b42.svg   # 魂
           └── …
   ```

2. Tell Metro to bundle SVGs as **raw text** (instead of numeric asset ids) by
   wrapping your Metro config with the helper this package ships:

   ```js
   // metro.config.js
   const {
     withKanjiSvgMetroConfig,
   } = require('react-native-nitro-kanjivg-tgfx/metro');
   const {
     getDefaultConfig,
     mergeConfig,
   } = require('@react-native/metro-config');

   const config = mergeConfig(getDefaultConfig(__dirname), {
     // ...your existing config
   });

   module.exports = withKanjiSvgMetroConfig(config);
   ```

   Expo apps do the same with `@expo/metro-config`; if your app already chains a
   custom transformer, pass it explicitly:
   `withKanjiSvgMetroConfig(config, { downstreamTransformerPath: require.resolve('your-transformer') })`.

   > If you can't touch the Metro config, keep SVGs working as image assets out of

> the way by naming files `漢.kanji.svg` and using a transformer of your choice —
> `react-native-nitro-kanjivg-tgfx` accepts raw strings, `{ body }` and `{ default }` modules.

## Usage

### Look glyphs up by character

```tsx
import { Kanji, createKanjiSource } from 'react-native-nitro-kanjivg-tgfx';

// require.context must be called from app code — the folder path has to be a
// static literal Metro can see at build time.
const kanjis = createKanjiSource(
  require.context('./assets/kanji', true, /\.svg$/)
);

export function Glyph() {
  // Works with the character itself or any codepoint spelling of the file:
  // '漢', 'U6F22', 'U6f22', '6f22', '06f22' (padded) and the bare file basename.
  return <Kanji character="漢" source={kanjis} width={96} height={96} />;
}
```

### Or point at a single file

```tsx
import { Kanji } from 'react-native-nitro-kanjivg-tgfx';

export function Glyph() {
  return (
    <Kanji file={require('./assets/kanji/09b42.svg')} width={96} height={96} />
  );
}
```

### Styling

```tsx
<Kanji
  character="東"
  source={kanjis}
  width={120}
  height={120}
  stroke={{ color: '#227093', width: 4 }} // every stroke
  background={{ color: '#ececec' }} // faint ghost layer (default on)
  strokes={{ 3: { color: '#d63031' } }} // per-stroke overrides, 1-based
/>
```

The glyph is always letterboxed to fit `width × height`, whatever viewBox the
SVG declares (KanjiVG uses `0 0 109 109`).

### Write-on animation

Pass `animated` and the glyph starts empty; strokes then draw in KanjiVG order,
each taking a share of the total duration proportional to its length. The
animation runs entirely on the UI thread (Reanimated shared values drive tgfx
path trims — no JS re-renders while writing).

```tsx
import { useRef } from 'react';
import { Kanji, type KanjiHandle } from 'react-native-nitro-kanjivg-tgfx';

const kanjiRef = useRef<KanjiHandle>(null);

// auto-playing, looping rewrite:
<Kanji character="魂" source={kanjis} animated autoPlay loop width={120} height={120} />

// imperative control (starts empty, waits for you):
<Kanji
  ref={kanjiRef}
  file={requiredSvg}
  animated
  animationDuration={3000} // one full pass, ms (default ~260ms per stroke)
  speed={1.5}               // global pen-speed multiplier (imperative: setSpeed / setStrokeSpeed)
  onAnimationEnd={() => console.log('done writing')}
  width={200}
  height={200}
/>;

kanjiRef.current?.play(); // start/resume (restarts when already finished)
kanjiRef.current?.pause(); // freeze mid-stroke
kanjiRef.current?.seekTo(0.5); // jump to 50% of the timeline and pause
kanjiRef.current?.restart(); // jump to empty and play
```

Animation requires `react-native-reanimated` and `react-native-worklets`
(peer dependencies; included in every Expo SDK ≥ 54 template).

### Per-stroke and per-label control

```tsx
<Kanji
  character="漢"
  source={kanjis}
  stroke={{ color: '#227093' }}
  strokes={{
    3: { color: '#d63031', width: 5 }, // style one stroke
    7: { visible: false }, // hide one (also drops it from the
    // ghost layer + animation timeline)
  }}
  showStrokeNumbers
  strokeNumbers={{
    3: { color: '#d63031' }, // style a label (labels follow hidden strokes)
    13: { visible: false }, // hide a label
  }}
/>
```

## API

| Export                                                                   | What it does                                                                                |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `<Kanji />`                                                              | Renders one KanjiVG glyph with tgfx, optionally animated write-on                           |
| `showStrokeNumbers` prop                                                 | Draws KanjiVG's stroke-order number labels (1, 2, 3, ...) at each stroke                    |
| `strokes={{ n: { visible: false, ... } }}`                               | Per-stroke show/hide + styling (colour, width, cap/join, opacity) keyed by stroke no.       |
| `strokeNumbers={{ n: { visible: false, ... } }}`                         | Per-label show/hide + styling (colour, opacity, size) for the stroke-order numbers          |
| `KanjiHandle` (type)                                                     | Imperative animation control: `play`/`pause`/`restart`/`seekTo`/`setSpeed`/`setStrokeSpeed` |
| `createKanjiSource(ctx)`                                                 | Character ⇄ asset lookup over a `require.context` of your kanji folder                      |
| `loadKanjiSvg(input)`                                                    | Parse (memoized) a bundled SVG module or raw text yourself — e.g. for custom rendering      |
| `parseKanjiSvg(xml)`                                                     | Low-level KanjiVG parser (`{ viewBox, strokes }`)                                           |
| `withKanjiSvgMetroConfig` (from `react-native-nitro-kanjivg-tgfx/metro`) | Metro wiring so `.svg` files bundle as text                                                 |

## Troubleshooting

### iOS: crash `RCTViewComponentView subclasses … must setup _props`

If you hit:

```
NSInternalInconsistencyException: `RCTViewComponentView` subclasses (and
`HybridTgfxViewComponent` particularly) must setup `_props` instance variable
with a default value in the constructor.
```

this is [react-native-tgfx](https://github.com/margelo/react-native-tgfx)`@0.2.0`
shipping nitrogen-generated iOS code from before nitrogen's default-props fix,
which React Native 0.88 now asserts on. This repository patches it via
[`patches/react-native-tgfx@0.2.0.patch`](./patches/react-native-tgfx@0.2.0.patch)
(pnpm applies it automatically through `pnpm.patchedDependencies`). If you use
this library in an app on React Native ≥ 0.88 and tgfx ≥ 0.2.0 and the upstream
package hasn't regenerated its view component yet, add the equivalent patch to
your app and remove it once a tgfx release includes the fix.

## Roadmap

Stroke-by-stroke write-on animation with imperative control (`play()`,
`pause()`, `restart()`, `seekTo(progress)`, `loop`, `onAnimationEnd`) is shipping. Next up: preload/cache APIs (`preloadKanji`), radical decomposition
overlays and stroke-type metadata — see [KANJIVG_PLAN.md](./KANJIVG_PLAN.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT (code) · KanjiVG stroke data is CC BY-SA 4.0 — see [DATA-LICENSE.md](./DATA-LICENSE.md).

---

Made with [create-react-native-library](https://github.com/callstack/react-native-builder-bob)
