package com.margelo.nitro.kanjivgtgfx
  
import com.facebook.proguard.annotations.DoNotStrip

@DoNotStrip
class KanjivgTgfx : HybridKanjivgTgfxSpec() {
  override fun multiply(a: Double, b: Double): Double {
    return a * b
  }
}
