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
import { Canvas, Group, Path, Text } from 'react-native-tgfx';
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
  /**
   * Hide this stroke entirely (only meaningful in per-stroke `strokes`
   * overrides). Hidden strokes drop out of the ghost layer and consume no
   * writing time in animation.
   */
  visible?: boolean;
}

/** Per-label override for a stroke-order number (1-based key). */
export interface KanjiStrokeNumberStyle {
  /** Show/hide this label. Defaults to following its stroke's visibility. */
  visible?: boolean;
  /** Label colour; defaults to `strokeNumberColor`. */
  color?: string;
  /** Label opacity; defaults to `strokeNumberOpacity`. */
  opacity?: number;
  /** Label size in viewBox units; defaults to KanjiVG's 8. */
  fontSize?: number;
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
  /**
   * Global pen-speed multiplier (1 = normal, 2 = twice as fast). Applies
   * immediately, even mid-write, resuming from the current pen position.
   */
  setSpeed(speed: number): void;
  /**
   * Speed multiplier for one stroke (1-based number; 2 = that stroke draws
   * twice as fast, shortening the rest of the pass accordingly).
   */
  setStrokeSpeed(strokeNumber: number, speed: number): void;
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
  /** Global pen-speed multiplier: 1 = normal, 2 = twice as fast. */
  speed?: number;
  /** Called (JS thread) after each completed pass — also between loops. */
  onAnimationEnd?: () => void;
  /** Imperative animation control (`play`/`pause`/`restart`/`seekTo`). */
  ref?: React.Ref<KanjiHandle>;

  /**
   * Draw KanjiVG's stroke-order number labels (1, 2, 3, …) at each stroke's
   * official label position. Requires the SVG to carry a `StrokeNumbers`
   * group (plain KanjiVG files do).
   */
  showStrokeNumbers?: boolean;
  /** Label colour. Defaults to KanjiVG's `#808080`. */
  strokeNumberColor?: string;
  /** Label opacity. Defaults to 1. */
  strokeNumberOpacity?: number;
  /** Per-label overrides (show/hide, colour, size), keyed by stroke number. */
  strokeNumbers?: Record<number, KanjiStrokeNumberStyle | undefined>;
}

/** Handle exposed by the glyph to the outer component's `KanjiHandle`. */
interface GlyphHandle {
  play(): void;
  pause(): void;
  restart(): void;
  seekTo(progress: number): void;
  isPlaying(): boolean;
  setSpeed(speed: number): void;
  setStrokeSpeed(strokeNumber: number, speed: number): void;
}

const clampSpeed = (n: number) =>
  Number.isFinite(n) ? Math.min(100, Math.max(0.01, n)) : 1;

/**
 * Lay out the handwriting timeline from per-stroke length shares, per-stroke
 * speed multipliers and visibility. Hidden strokes drop out; faster strokes
 * give their saved time back to the pass. Pure + exported for tests.
 */
export function computeWriteTiming(
  timings: readonly KanjiStrokeTiming[],
  strokeVisible: readonly boolean[],
  strokeSpeed: readonly number[],
  baseMs: number,
  speed: number
): {
  segments: (KanjiStrokeTiming | undefined)[] | null;
  totalMs: number;
} {
  const weights: number[] = [];
  let totalW = 0;
  for (let i = 0; i < timings.length; i += 1) {
    const w = strokeVisible[i]
      ? Math.max(timings[i]!.end - timings[i]!.start, 1e-6) /
        Math.min(100, Math.max(0.01, strokeSpeed[i] || 1))
      : 0;
    weights.push(w);
    totalW += w;
  }
  const totalMs =
    totalW > 0
      ? (baseMs * totalW) / Math.min(100, Math.max(0.01, speed))
      : baseMs;
  if (totalW <= 0) return { segments: null, totalMs: baseMs };
  const segments: (KanjiStrokeTiming | undefined)[] = [];
  let cursor = 0;
  for (const w of weights) {
    segments.push(
      w > 0 ? { start: cursor / totalW, end: (cursor + w) / totalW } : undefined
    );
    cursor += w;
  }
  return { segments, totalMs };
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
  showStrokeNumbers,
  strokeNumberColor,
  strokeNumberOpacity,
  strokeNumbers,
  speed,
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
  showStrokeNumbers: boolean;
  strokeNumberColor: string;
  strokeNumberOpacity: number;
  strokeNumbers: Record<number, KanjiStrokeNumberStyle | undefined> | undefined;
  speed: number;
}) {
  // Imperative speed overrides (JS state; feeding the recomputed plan).
  const [speedOverrides, setSpeedOverrides] = React.useState<{
    global?: number;
    perStroke: Record<number, number>;
  }>({ perStroke: {} });

  const progress = useSharedValue(0);
  const playingSv = useSharedValue(false);
  // Duration must live in a shared value for UI worklets.
  const durationSv = useSharedValue(durationMs);
  const loopSv = useSharedValue(loop);

  const isVisible = (strokeNo: number) =>
    strokes?.[strokeNo]?.visible !== false;
  const shownIdx: number[] = [];
  for (let i = 0; i < svg.strokes.length; i += 1) {
    if (isVisible(i + 1)) shownIdx.push(i);
  }

  // One plan for the handwriting timeline: visibility + per-stroke and
  // global speed multipliers. Re-derived on the JS thread; cheap.
  const globalSpeed = clampSpeed(speedOverrides.global ?? speed);
  const plan = computeWriteTiming(
    timings,
    svg.strokes.map((_, i) => isVisible(i + 1)),
    svg.strokes.map((_, i) => speedOverrides.perStroke[i + 1] ?? 1),
    durationMs,
    globalSpeed
  );
  const segments = animated ? plan.segments : null;
  const planKey = animated
    ? `${plan.totalMs.toFixed(1)}|${plan.segments?.map((seg) => seg && seg.start.toFixed(4)).join(',')}`
    : '';

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

  const setSpeed = React.useCallback(
    (multiplier: number) =>
      setSpeedOverrides((prev) => ({
        ...prev,
        global: clampSpeed(multiplier),
      })),
    []
  );
  const setStrokeSpeed = React.useCallback(
    (strokeNumber: number, multiplier: number) =>
      setSpeedOverrides((prev) => ({
        ...prev,
        perStroke: {
          ...prev.perStroke,
          [strokeNumber]: clampSpeed(multiplier),
        },
      })),
    []
  );

  const methods = React.useMemo<GlyphHandle>(
    () => ({
      play,
      pause,
      restart,
      seekTo,
      isPlaying,
      setSpeed,
      setStrokeSpeed,
    }),
    [play, pause, restart, seekTo, isPlaying, setSpeed, setStrokeSpeed]
  );

  // Refs synced in effects only; shared values sync via a worklet.
  React.useEffect(() => {
    loopRef.current = loop;
    onEndRef.current = onAnimationEnd;
    scheduleOnUI(() => {
      'worklet';
      durationSv.set(plan.totalMs);
      loopSv.set(loop);
    });
  });

  // Speed/visibility changes re-arm the driver at the current pen position.
  const planKeyRef = React.useRef(planKey);
  React.useEffect(() => {
    const changed = planKeyRef.current !== planKey;
    planKeyRef.current = planKey;
    if (changed && playingRef.current) {
      pause();
      play();
    }
  }, [planKey, pause, play]);

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

  return (
    <Canvas style={{ width, height }}>
      <Group transform={transform}>
        {background ? (
          <Path
            {...shared}
            strokeWidth={(background.width ?? stroke?.width ?? 3) * scale}
            color={background.color ?? '#d0d0d0'}
            opacity={background.opacity ?? 1}
            path={shownIdx.map((i) => svg.strokes[i]).join(' ')}
          />
        ) : null}
        {svg.strokes.map((d, i) => {
          const override = strokes?.[i + 1];
          if (override?.visible === false) return null;
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
        {showStrokeNumbers
          ? svg.strokeNumbers.map((n) => {
              const label = strokeNumbers?.[n.number];
              // Labels follow their stroke unless the override says otherwise.
              if ((label?.visible ?? isVisible(n.number)) === false) {
                return null;
              }
              return (
                <Text
                  key={n.number}
                  x={n.x}
                  y={n.y}
                  text={String(n.number)}
                  fontSize={label?.fontSize ?? 8}
                  color={label?.color ?? strokeNumberColor}
                  opacity={label?.opacity ?? strokeNumberOpacity}
                />
              );
            })
          : null}
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
  speed = 1,
  onAnimationEnd,
  ref,
  showStrokeNumbers = false,
  strokeNumberColor = '#808080',
  strokeNumberOpacity = 1,
  strokeNumbers,
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
      setSpeed: (multiplier: number) =>
        glyphHandle.current?.setSpeed(multiplier),
      setStrokeSpeed: (strokeNumber: number, multiplier: number) =>
        glyphHandle.current?.setStrokeSpeed(strokeNumber, multiplier),
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
        speed={speed}
        glyphHandle={glyphHandle}
        width={width}
        height={height}
        box={parseViewBox(svg.viewBox)}
        stroke={stroke}
        strokes={strokes}
        background={background === false ? undefined : background}
        showStrokeNumbers={showStrokeNumbers}
        strokeNumberColor={strokeNumberColor}
        strokeNumberOpacity={strokeNumberOpacity}
        strokeNumbers={strokeNumbers}
      />
    </View>
  );
}
