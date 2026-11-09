# KanjiVG Data License

This repository's source code is [MIT licensed](./LICENSE).

Stroke data derived from **KanjiVG** is licensed separately:

- **Source:** [KanjiVG](https://kanjivg.tagaini.net/) — release
  [`r20260714`](https://github.com/KanjiVG/kanjivg/releases/tag/r20260714)
- **Author:** Ulrich Apel
- **License:** [Creative Commons Attribution-ShareAlike 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
  (KanjiVG mentions CC BY-SA 4.0 in some places; ship under the version stated
  in the dataset files themselves — CC BY-SA 3.0)

Where such data appears in this repository, it is only in the example app
(`example/assets/kanji/*.svg`, a small demo subset), and it stays under
CC BY-SA 4.0.

## Your app's KanjiVG files

This library does **not** bundle or ship stroke data. You download the KanjiVG
dataset yourself and drop the `.svg` files you need into your app — so your
app's copy is your responsibility:

1. Keep the dataset's CC BY-SA 4.0 license and attribution in your app/about
   screen.
2. If you remix/adapt the stroke data (e.g. recoloring bundled files), distribute
   your version under CC BY-SA as well.

Required attribution text:

> This product includes KanjiVG stroke data, © Ulrich Apel,
> <https://kanjivg.tagaini.net>, licensed under CC BY-SA 4.0.
