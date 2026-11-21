package com.anonymous.hafiz.widget

import android.graphics.Color
import com.anonymous.hafiz.R

/**
 * The widget's art (spec 4.6): one sky per scene in a square and a wide crop, Zayt's stills, the
 * idle blink loops and the one-shot clips. Every resource is named here, not looked up by string, so
 * release resource shrinking keeps them. The names match WIDGET_SCENES and WIDGET_POSES in
 * lib/widget/types.ts; tests/unit/widget-resources.test.ts checks both lists against this file.
 */
object WidgetArt {
  /**
   * Text colors per scene from the studio export's manifest, measured against the text areas of both
   * crops: at least 7.6:1 for the primary ink and 4.7:1 for the secondary. `lit` is the count once
   * today counts, in the flame's color family; the digits are large and bold, so it needs 3:1.
   */
  data class Ink(val primary: Int, val secondary: Int, val lit: Int)

  private fun color(hex: String): Int = Color.parseColor(hex)

  fun ink(scene: String): Ink =
    when (scene) {
      "dawn" -> Ink(color("#182C30"), color("#293E3E"), color("#9A3412"))
      "morning" -> Ink(color("#173039"), color("#263E40"), color("#9A3412"))
      "golden" -> Ink(color("#34251C"), color("#473327"), color("#9A3412"))
      "dusk" -> Ink(color("#FFF9EF"), color("#F9E9EA"), color("#FFC94D"))
      "night" -> Ink(color("#FFF9ED"), color("#F2EAF7"), color("#FFC94D"))
      "midnight" -> Ink(color("#FFFAED"), color("#D6DBEA"), color("#FFC94D"))
      "sunrise" -> Ink(color("#32232F"), color("#44333C"), color("#9A3412"))
      "radiant" -> Ink(color("#342B19"), color("#443723"), color("#9A3412"))
      "radiant_night" -> Ink(color("#FFF8E5"), color("#F4E6D1"), color("#FFC94D"))
      "milestone" -> Ink(color("#302317"), color("#44321F"), color("#9A3412"))
      "calm" -> Ink(color("#272D3A"), color("#373D49"), color("#9A3412"))
      else -> Ink(color("#142D35"), color("#203E45"), color("#9A3412"))
    }

  fun scene(scene: String, wide: Boolean): Int =
    when (scene) {
      "dawn" -> if (wide) R.drawable.hafiz_widget_scene_dawn_wide else R.drawable.hafiz_widget_scene_dawn_sq
      "morning" -> if (wide) R.drawable.hafiz_widget_scene_morning_wide else R.drawable.hafiz_widget_scene_morning_sq
      "golden" -> if (wide) R.drawable.hafiz_widget_scene_golden_wide else R.drawable.hafiz_widget_scene_golden_sq
      "dusk" -> if (wide) R.drawable.hafiz_widget_scene_dusk_wide else R.drawable.hafiz_widget_scene_dusk_sq
      "night" -> if (wide) R.drawable.hafiz_widget_scene_night_wide else R.drawable.hafiz_widget_scene_night_sq
      "midnight" -> if (wide) R.drawable.hafiz_widget_scene_midnight_wide else R.drawable.hafiz_widget_scene_midnight_sq
      "sunrise" -> if (wide) R.drawable.hafiz_widget_scene_sunrise_wide else R.drawable.hafiz_widget_scene_sunrise_sq
      "radiant" -> if (wide) R.drawable.hafiz_widget_scene_radiant_wide else R.drawable.hafiz_widget_scene_radiant_sq
      "radiant_night" -> if (wide) R.drawable.hafiz_widget_scene_radiant_night_wide else R.drawable.hafiz_widget_scene_radiant_night_sq
      "milestone" -> if (wide) R.drawable.hafiz_widget_scene_milestone_wide else R.drawable.hafiz_widget_scene_milestone_sq
      "calm" -> if (wide) R.drawable.hafiz_widget_scene_calm_wide else R.drawable.hafiz_widget_scene_calm_sq
      else -> if (wide) R.drawable.hafiz_widget_scene_day_wide else R.drawable.hafiz_widget_scene_day_sq
    }

  fun pose(pose: String): Int =
    when (pose) {
      "rest" -> R.drawable.hafiz_widget_zayt_rest
      "warm" -> R.drawable.hafiz_widget_zayt_warm
      "glow" -> R.drawable.hafiz_widget_zayt_glow
      "open" -> R.drawable.hafiz_widget_zayt_open
      "shimmer" -> R.drawable.hafiz_widget_zayt_shimmer
      "milestone" -> R.drawable.hafiz_widget_zayt_milestone
      "sit" -> R.drawable.hafiz_widget_zayt_sit
      "glow_halo" -> R.drawable.hafiz_widget_zayt_glow_halo
      "open_halo" -> R.drawable.hafiz_widget_zayt_open_halo
      "warm_halo" -> R.drawable.hafiz_widget_zayt_warm_halo
      "shimmer_halo" -> R.drawable.hafiz_widget_zayt_shimmer_halo
      else -> R.drawable.hafiz_widget_zayt_wave
    }

  /**
   * The looping slow blink for a pose, as a layout whose ProgressBar runs the frame list. Seated and
   * celebrating poses have none: closed eyes there read as a doze or as basking (Zayt spec 5.6).
   */
  fun blink(pose: String): Int? =
    when (pose) {
      "rest" -> R.layout.hafiz_widget_motion_blink_rest
      "warm" -> R.layout.hafiz_widget_motion_blink_warm
      "wave" -> R.layout.hafiz_widget_motion_blink_wave
      "glow" -> R.layout.hafiz_widget_motion_blink_glow
      "open" -> R.layout.hafiz_widget_motion_blink_open
      "glow_halo" -> R.layout.hafiz_widget_motion_blink_glow_halo
      "open_halo" -> R.layout.hafiz_widget_motion_blink_open_halo
      "warm_halo" -> R.layout.hafiz_widget_motion_blink_warm_halo
      else -> null
    }

  /**
   * The one-shot clip for an event earned in this app session, chosen by the entry now showing:
   * the A07 turn on a milestone, the A06 hop on any other day that counts. Each ends on the entry's
   * own still.
   */
  fun celebration(entry: WidgetEntry): Int? =
    when (entry.pose) {
      "milestone" -> R.layout.hafiz_widget_motion_milestone
      "shimmer" -> R.layout.hafiz_widget_motion_done
      "shimmer_halo" -> R.layout.hafiz_widget_motion_done_halo
      else -> null
    }

  /** The night skies use white ink, which the fixed-color ember frames are drawn for. */
  fun emberGlows(entry: WidgetEntry): Boolean = entry.flame == "unlit" && (entry.scene == "night" || entry.scene == "midnight")

  fun day(mark: String): Int =
    when (mark) {
      "lit" -> R.drawable.hafiz_widget_flame_lit_t1
      "open" -> R.drawable.hafiz_widget_flame_unlit
      "kept" -> R.drawable.hafiz_widget_day_kept
      else -> R.drawable.hafiz_widget_day_empty
    }

  fun flame(entry: WidgetEntry): Int =
    when (entry.flame) {
      "lit" ->
        when (entry.tier) {
          0 -> R.drawable.hafiz_widget_flame_lit_t0
          1 -> R.drawable.hafiz_widget_flame_lit_t1
          2 -> R.drawable.hafiz_widget_flame_lit_t2
          3 -> R.drawable.hafiz_widget_flame_lit_t3
          4 -> R.drawable.hafiz_widget_flame_lit_t4
          5 -> R.drawable.hafiz_widget_flame_lit_t5
          else -> R.drawable.hafiz_widget_flame_lit_t6
        }
      "out" -> R.drawable.hafiz_widget_flame_out
      else -> R.drawable.hafiz_widget_flame_unlit
    }
}
