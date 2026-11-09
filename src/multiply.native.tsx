import { NitroModules } from 'react-native-nitro-modules';
import type { KanjivgTgfx } from './KanjivgTgfx.nitro';

const KanjivgTgfxHybridObject =
  NitroModules.createHybridObject<KanjivgTgfx>('KanjivgTgfx');

export function multiply(a: number, b: number): number {
  return KanjivgTgfxHybridObject.multiply(a, b);
}
