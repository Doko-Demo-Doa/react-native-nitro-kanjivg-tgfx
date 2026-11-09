import * as React from 'react';
import { View } from 'react-native';
import {
  cancelAnimation,
  Easing,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Canvas, Group, Path } from 'react-native-tgfx';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import type { StyleProp, ViewStyle } from 'react-native';
import type { Transform as GroupTransform } from 'react-native-tgfx';

import { loadKanjiSvg, resolveKanjiAsset } from './assets';
import { parseViewBox } from './parse';
import type {
  KanjiFileInput,
  KanjiSource,
  KanjiStrokeTiming,
  LoadedKanji,
} from './assets';
import type { KanjiSvg, ViewBox } from './parse';

export interface KanjiStrokeStyle {
  /** Stroke color; defaults to `#000`. */
  color?: string;
  /** Stroke width in viewBox units (KanjiVG uses 3 on a 109 unit box). */
  width?: number;
  strokeCap?: 'butt' | 'round' | 'square';
  strokeJoin?: 'miter' | 'round' | 'bevel';
  /** Overall stroke opacity 0..1. */
  opacity?: number;
}

/** Imperative write-on animation control (requires the `animated` prop). */
export interface KanjiHandle {
  /** Start or resume writing; restarts from the top when already finished. */
  play(): void;
  /** Freeze mid-stroke at the current progress. */
  pause(): void;
  /** Jump to empty and play. */
  restart(): void;
  /** Jump to a global progress in 0..1 and pause there. */
  seekTo(progress: number): void;
  isPlaying(): boolean;
}

export interface KanjiProps {
  /**
   * A required KanjiVG SVG: `require('./kanji/魂.kanji.svg')` (raw text or
   * `{ body }` — see the asset setup in the README). Mutually exclusive with
   * `character`.
   */
  file?: KanjiFileInput;
  /**
   * Character (or codepoint spelling / file basename) looked up through a
   * `source` created with `createKanjiSource(require.context(...))`.
   */
  character?: string;
  /** Directory source backing `character` lookups. */
  source?: KanjiSource;
  /** Paint style applied to every stroke. */
  stroke?: KanjiStrokeStyle;
  /** Faint "ghost" copy rendered under the strokes (KanjiVG style-guide look). */
  background?: KanjiStrokeStyle | false;
  /** Per-stroke overrides, keyed by 1-based stroke number. */
  strokes?: Record<number, KanjiStrokeStyle | undefined>;
  /** Rendered size; the glyph is letterboxed to fit. Defaults to 100 x 100. */
  width?: number;
  height?: number;
  /** Layout styles for the wrapping view. */
  style?: StyleProp<ViewStyle>;

  /**
   * Enable write-on animation: the glyph starts empty and strokes draw in
   * stroke order, each taking a share of the total duration proportional to
   * its length. Driven entirely on the UI thread (Reanimated shared values
   * feeding tgfx path trims — no JS re-render while writing).
   */
  animated?: boolean;
  /** Begin writing as soon as the glyph is loaded. */
  autoPlay?: boolean;
  /** Keep rewriting the glyph after each completed pass. */
  loop?: boolean;
  /** Duration of one full writing pass, ms. Defaults to ~260ms per stroke. */
  animationDuration?: number;
  /** Called (JS thread) after each completed pass — also between loops. */
  onAnimationEnd?: () => void;
  /** Imperative animation control (`play`/`pause`/`restart`/`seekTo`). */
  ref?: React.Ref<KanjiHandle>;
}

/** Handle exposed by the glyph to the outer component's `KanjiHandle`. */
interface GlyphHandle {
  play(): void;
  pause(): void;
  restart(): void;
  seekTo(progress: number): void;
  isPlaying(): boolean;
}

type Paint = Record<string, unknown>;

/**
 * One stroke, optionally trimmed against the shared handwriting clock. Lives
 * in a child component so every stroke gets its own derived value legally.
 */
function StrokePath({
  d,
  paint,
  segment,
  progress,
}: {
  d: string;
  paint: Paint;
  segment: KanjiStrokeTiming | undefined;
  progress: { value: number };
}) {
  // Map the global 0..1 clock onto this stroke's segment.
  // Reanimated 4 auto-tracks deps; an explicit deps array is deprecated.
  const end = useDerivedValue(() => {
    'worklet';
    if (segment == null) return 1;
    const p = progress.value;
    if (p <= segment.start) return 0;
    if (p >= segment.end) return 1;
    return (p - segment.start) / (segment.end - segment.start);
  });

  if (segment == null) {
    return <Path {...paint} path={d} />;
  }
  return <Path {...paint} path={d} start={0} end={end} />;
}

function KanjiGlyph({
  svg,
  timings,
  animated,
  autoPlay,
  loop,
  durationMs,
  onAnimationEnd,
  glyphHandle,
  width,
  height,
  box,
  stroke,
  strokes,
  background,
}: {
  svg: KanjiSvg;
  timings: readonly KanjiStrokeTiming[];
  animated: boolean;
  autoPlay: boolean;
  loop: boolean;
  durationMs: number;
  onAnimationEnd: (() => void) | undefined;
  glyphHandle: React.RefObject<GlyphHandle | null>;
  width: number;
  height: number;
  box: ViewBox;
  stroke: KanjiStrokeStyle | undefined;
  strokes: Record<number, KanjiStrokeStyle | undefined> | undefined;
  background: KanjiStrokeStyle | undefined;
}) {
  const progress = useSharedValue(0);
  const playingSv = useSharedValue(false);
  // Duration must live in a shared value for UI worklets.
  const durationSv = useSharedValue(durationMs);
  const loopSv = useSharedValue(loop);
  // JS-side mirror of play state (decisions originate in JS).
  const playingRef = React.useRef(false);
  const loopRef = React.useRef(loop);
  const onEndRef = React.useRef(onAnimationEnd);

  // Fires per completed pass, not per loop restart (withRepeat loops
  // in-driver, avoiding the JS round trip that caused flashing).
  const handlePassEnded = React.useCallback(() => {
    // pause() during the flight to JS already cleared this; loops keep it.
    if (!(loopRef.current && playingRef.current)) playingRef.current = false;
    onEndRef.current?.();
  }, []);

  const play = React.useCallback(() => {
    if (playingRef.current) return;
    playingRef.current = true;
    scheduleOnUI(() => {
      'worklet';
      playingSv.set(true);
      let remain = Math.max(0, 1 - progress.value);
      if (remain < 0.001) {
        progress.set(0);
        remain = 1; // fresh pass gets full duration
      }
      const ms = Math.max(80, Math.round(remain * durationSv.value));
      const timing = withTiming(
        1,
        { duration: ms, easing: Easing.linear },
        (finished?: boolean) => {
          'worklet';
          // Cancels are handled by pause()/seekTo(); fires once per pass.
          if (!finished) return;
          if (!loopSv.value) playingSv.set(false);
          scheduleOnRN(handlePassEnded);
        }
      );
      progress.set(loopSv.value ? withRepeat(timing, -1, false) : timing);
    });
  }, [progress, playingSv, durationSv, loopSv, handlePassEnded]);

  const pause = React.useCallback(() => {
    playingRef.current = false;
    scheduleOnUI(() => {
      'worklet';
      playingSv.set(false);
      cancelAnimation(progress);
    });
  }, [progress, playingSv]);

  const restart = React.useCallback(() => {
    playingRef.current = false;
    scheduleOnUI(() => {
      'worklet';
      cancelAnimation(progress);
      progress.set(0);
    });
    // UI queue is FIFO; play()'s worklet sees the reset.
    play();
  }, [play, progress]);

  const seekTo = React.useCallback(
    (target: number) => {
      const p = Math.min(1, Math.max(0, target));
      playingRef.current = false;
      scheduleOnUI(() => {
        'worklet';
        playingSv.set(false);
        cancelAnimation(progress);
        progress.set(p);
      });
    },
    [progress, playingSv]
  );

  const isPlaying = React.useCallback(() => playingRef.current, []);

  const methods = React.useMemo<GlyphHandle>(
    () => ({ play, pause, restart, seekTo, isPlaying }),
    [play, pause, restart, seekTo, isPlaying]
  );

  // Refs synced in effects only; shared values sync via a worklet.
  React.useEffect(() => {
    loopRef.current = loop;
    onEndRef.current = onAnimationEnd;
    scheduleOnUI(() => {
      'worklet';
      durationSv.set(durationMs);
      loopSv.set(loop);
    });
  });

  // `loop` is baked in at pass start, so a mid-write toggle re-arms the driver.
  const loopModeRef = React.useRef(loop);
  React.useEffect(() => {
    const changed = loopModeRef.current !== loop;
    loopModeRef.current = loop;
    if (changed && playingRef.current) {
      pause();
      play();
    }
  }, [loop, pause, play]);

  // Publish the handle for the parent's `KanjiHandle` ref.
  React.useImperativeHandle(glyphHandle, () => methods, [methods]);

  // Glyph remounts per character, so autoPlay is once-per-instance.
  const didAutoPlay = React.useRef(false);
  React.useEffect(() => {
    if (animated && autoPlay && !didAutoPlay.current) {
      didAutoPlay.current = true;
      play();
    }
  }, [animated, autoPlay, play]);

  const scale = Math.min(width / box.width, height / box.height);
  const offsetX = (width - box.width * scale) / 2 - box.x * scale;
  const offsetY = (height - box.height * scale) / 2 - box.y * scale;

  const shared: Paint = {
    style: 'stroke',
    strokeWidth: (stroke?.width ?? 3) * scale,
    strokeCap: stroke?.strokeCap ?? 'round',
    strokeJoin: stroke?.strokeJoin ?? 'round',
    color: stroke?.color ?? '#000000',
    opacity: stroke?.opacity ?? 1,
  };

  const transform: GroupTransform = [
    { translateX: offsetX },
    { translateY: offsetY },
    { scale },
  ];

  // No trims unless the glyph animates.
  const segments = animated ? timings : null;

  return (
    <Canvas style={{ width, height }}>
      <Group transform={transform}>
        {background ? (
          <Path
            {...shared}
            strokeWidth={(background.width ?? stroke?.width ?? 3) * scale}
            color={background.color ?? '#d0d0d0'}
            opacity={background.opacity ?? 1}
            path={svg.strokes.join(' ')}
          />
        ) : null}
        {svg.strokes.map((d, i) => {
          const override = strokes?.[i + 1];
          const paint: Paint = {
            ...shared,
            color: override?.color ?? shared.color,
            strokeWidth: (override?.width ?? stroke?.width ?? 3) * scale,
            strokeCap: override?.strokeCap ?? shared.strokeCap,
            strokeJoin: override?.strokeJoin ?? shared.strokeJoin,
            opacity: override?.opacity ?? shared.opacity,
          };
          return (
            <StrokePath
              key={i}
              d={d}
              paint={paint}
              segment={segments != null ? segments[i] : undefined}
              progress={progress}
            />
          );
        })}
      </Group>
    </Canvas>
  );
}

let nextAssetId = 0;
const assetIds = new WeakMap<object, number>();
function assetKey(mod: unknown): string {
  if (typeof mod === 'string') return `s:${mod.length}:${mod.slice(0, 64)}`;
  if (typeof mod === 'object' && mod != null) {
    let id = assetIds.get(mod);
    if (id == null) {
      id = nextAssetId += 1;
      assetIds.set(mod, id);
    }
    return `o:${id}`;
  }
  return `n:${String(mod)}`;
}

/**
 * Renders one KanjiVG character from an SVG file that lives in the app (or via
 * a `source` directory lookup keyed by `character`).
 *
 * Parsing is memoized per file/character, so remounts (lists, navigation) are
 * cheap; first render resolves the SVG on the JS thread before painting.
 * Pass `animated` for sequential stroke write-on, controlled via `autoPlay`
 * or a {@link KanjiHandle} ref.
 */
export function Kanji({
  file,
  character,
  source,
  stroke,
  strokes,
  background = { color: '#d0d0d0' },
  width = 100,
  height = 100,
  style,
  animated = false,
  autoPlay = false,
  loop = false,
  animationDuration,
  onAnimationEnd,
  ref,
}: KanjiProps): React.JSX.Element | null {
  const glyphHandle = React.useRef<GlyphHandle | null>(null);

  React.useImperativeHandle(
    ref,
    () => ({
      play: () => glyphHandle.current?.play(),
      pause: () => glyphHandle.current?.pause(),
      restart: () => glyphHandle.current?.restart(),
      seekTo: (progress: number) => glyphHandle.current?.seekTo(progress),
      isPlaying: () => glyphHandle.current?.isPlaying() ?? false,
    }),
    []
  );

  const { mod, name } = resolveKanjiAsset(file, character, source);
  // Keyed on asset identity, not `character`, to avoid cross-source leaks.
  const key = React.useMemo(() => assetKey(mod), [mod]);

  // Keyed state avoids flashing the previous glyph on character switch.
  const [resolved, setResolved] = React.useState<
    | { key: string; loaded: LoadedKanji }
    | { key: string; error: unknown }
    | undefined
  >(undefined);

  React.useEffect(() => {
    let current = true;
    loadKanjiSvg({ mod, name, cacheKey: key }).then(
      (loaded) => {
        if (current) setResolved({ key, loaded });
      },
      (e: unknown) => {
        if (current) setResolved({ key, error: e });
      }
    );
    return () => {
      current = false;
    };
  }, [mod, name, key]);

  if (resolved != null && resolved.key === key && 'error' in resolved) {
    throw resolved.error;
  }

  const loaded =
    resolved != null && resolved.key === key && 'loaded' in resolved
      ? resolved.loaded
      : undefined;

  if (loaded == null) {
    return <View style={[style, { width, height }]} />;
  }

  const { svg, timings } = loaded;

  return (
    <View style={[style, { width, height }]}>
      <KanjiGlyph
        svg={svg}
        timings={timings}
        animated={animated}
        autoPlay={autoPlay}
        loop={loop}
        durationMs={
          animationDuration ?? Math.max(600, svg.strokes.length * 260)
        }
        onAnimationEnd={onAnimationEnd}
        glyphHandle={glyphHandle}
        width={width}
        height={height}
        box={parseViewBox(svg.viewBox)}
        stroke={stroke}
        strokes={strokes}
        background={background === false ? undefined : background}
      />
    </View>
  );
}
