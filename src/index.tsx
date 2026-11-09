export { multiply } from './multiply';

export { Kanji } from './kanjivg/Kanji';
export type {
  KanjiHandle,
  KanjiProps,
  KanjiStrokeNumberStyle,
  KanjiStrokeStyle,
} from './kanjivg/Kanji';

export {
  createKanjiSource,
  loadKanjiSvg,
  readSvgModule,
  resolveKanjiAsset,
} from './kanjivg/assets';
export type {
  KanjiFileInput,
  KanjiSource,
  RequireContext,
} from './kanjivg/assets';

export { parseKanjiSvg, parseViewBox } from './kanjivg/parse';
export type { KanjiSvg, ViewBox } from './kanjivg/parse';
