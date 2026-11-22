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
  data class Ink(val primary: Int, val secondary: Int, val lit: Int) {
    /** Light text on a dark sky; picks the white-outlined ember frames. */
    val light: Boolean get() = Color.luminance(primary) > 0.5f
  }

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
      "dawn_rose" -> Ink(color("#34232B"), color("#50313C"), color("#9A3412"))
      "dawn_red" -> Ink(color("#FFF8E8"), color("#FAE6D9"), color("#FFC94D"))
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
      "dawn_rose" -> if (wide) R.drawable.hafiz_widget_scene_dawn_rose_wide else R.drawable.hafiz_widget_scene_dawn_rose_sq
      "dawn_red" -> if (wide) R.drawable.hafiz_widget_scene_dawn_red_wide else R.drawable.hafiz_widget_scene_dawn_red_sq
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
      "eager" -> R.drawable.hafiz_widget_zayt_eager
      "impatient" -> R.drawable.hafiz_widget_zayt_impatient
      "worried" -> R.drawable.hafiz_widget_zayt_worried
      "anxious" -> R.drawable.hafiz_widget_zayt_anxious
      "panicked" -> R.drawable.hafiz_widget_zayt_panicked
      "relieved" -> R.drawable.hafiz_widget_zayt_relieved
      "lonely" -> R.drawable.hafiz_widget_zayt_lonely
      "worried_halo" -> R.drawable.hafiz_widget_zayt_worried_halo
      "anxious_halo" -> R.drawable.hafiz_widget_zayt_anxious_halo
      "panicked_halo" -> R.drawable.hafiz_widget_zayt_panicked_halo
      "relieved_halo" -> R.drawable.hafiz_widget_zayt_relieved_halo
      "fretful" -> R.drawable.hafiz_widget_zayt_fretful
      "nervous" -> R.drawable.hafiz_widget_zayt_nervous
      "frantic" -> R.drawable.hafiz_widget_zayt_frantic
      "nervous_halo" -> R.drawable.hafiz_widget_zayt_nervous_halo
      "frantic_halo" -> R.drawable.hafiz_widget_zayt_frantic_halo
      else -> R.drawable.hafiz_widget_zayt_wave
    }

  /**
   * A pose's idle loop, as a layout whose ProgressBar runs the frame list: the urgency faces' own
   * movement (a bounce, a foot tap, a drip, a tremble) or the slow blink of the calm poses. Seated
   * and celebrating stills have none.
   */
  fun idle(pose: String): Int? =
    when (pose) {
      "rest" -> R.layout.hafiz_widget_motion_blink_rest
      "warm" -> R.layout.hafiz_widget_motion_blink_warm
      "wave" -> R.layout.hafiz_widget_motion_blink_wave
      "glow" -> R.layout.hafiz_widget_motion_blink_glow
      "open" -> R.layout.hafiz_widget_motion_blink_open
      "glow_halo" -> R.layout.hafiz_widget_motion_blink_glow_halo
      "open_halo" -> R.layout.hafiz_widget_motion_blink_open_halo
      "warm_halo" -> R.layout.hafiz_widget_motion_blink_warm_halo
      "eager" -> R.layout.hafiz_widget_motion_loop_eager
      "impatient" -> R.layout.hafiz_widget_motion_loop_impatient
      "worried" -> R.layout.hafiz_widget_motion_loop_worried
      "anxious" -> R.layout.hafiz_widget_motion_loop_anxious
      "panicked" -> R.layout.hafiz_widget_motion_loop_panicked
      "lonely" -> R.layout.hafiz_widget_motion_loop_lonely
      "worried_halo" -> R.layout.hafiz_widget_motion_loop_worried_halo
      "anxious_halo" -> R.layout.hafiz_widget_motion_loop_anxious_halo
      "panicked_halo" -> R.layout.hafiz_widget_motion_loop_panicked_halo
      "fretful" -> R.layout.hafiz_widget_motion_loop_fretful
      "nervous" -> R.layout.hafiz_widget_motion_loop_nervous
      "frantic" -> R.layout.hafiz_widget_motion_loop_frantic
      "nervous_halo" -> R.layout.hafiz_widget_motion_loop_nervous_halo
      "frantic_halo" -> R.layout.hafiz_widget_motion_loop_frantic_halo
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
      "relieved_halo" -> R.layout.hafiz_widget_motion_done_relieved_halo
      else -> null
    }

  /** The waiting flame: what to draw, whether to tint it like the text, and its loop if any. */
  data class Waiting(val drawable: Int, val tinted: Boolean, val loop: Int?)

  /**
   * The ember frames' outline: white on dark skies and cards, dark on light ones, and the System
   * theme's own text color on its plain card, which follows the launcher's day or night.
   */
  enum class Outline { LIGHT, DARK, SYSTEM }

  /**
   * Spec 4.6: while today waits, the flame's ember grows with the urgency, with Zayt or without.
   * Calm days show the outline with a small ember, tinted like the text; from the nudge the ember
   * glows warm, from two to four hours left it pulses, and in the last hour it pulses red. The ember
   * frames carry their own colors, since frame lists cannot be tinted on every Android version.
   */
  fun waiting(urgency: String, outline: Outline): Waiting =
    when (urgency) {
      "nudge" ->
        Waiting(
          when (outline) {
            Outline.LIGHT -> R.drawable.hafiz_widget_flame_ember_light_dim
            Outline.DARK -> R.drawable.hafiz_widget_flame_ember_dark_dim
            Outline.SYSTEM -> R.drawable.hafiz_widget_flame_ember_system_dim
          },
          false,
          null,
        )
      "urgent", "critical" ->
        when (outline) {
          Outline.LIGHT -> Waiting(R.drawable.hafiz_widget_flame_ember_light_bright, false, R.layout.hafiz_widget_flame_ember_light)
          Outline.DARK -> Waiting(R.drawable.hafiz_widget_flame_ember_dark_bright, false, R.layout.hafiz_widget_flame_ember_dark)
          Outline.SYSTEM -> Waiting(R.drawable.hafiz_widget_flame_ember_system_bright, false, R.layout.hafiz_widget_flame_ember_system)
        }
      "last" ->
        when (outline) {
          Outline.LIGHT -> Waiting(R.drawable.hafiz_widget_flame_ember_red_light_bright, false, R.layout.hafiz_widget_flame_ember_red_light)
          Outline.DARK -> Waiting(R.drawable.hafiz_widget_flame_ember_red_dark_bright, false, R.layout.hafiz_widget_flame_ember_red_dark)
          Outline.SYSTEM -> Waiting(R.drawable.hafiz_widget_flame_ember_red_system_bright, false, R.layout.hafiz_widget_flame_ember_red_system)
        }
      else -> Waiting(R.drawable.hafiz_widget_flame_unlit, true, null)
    }

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
