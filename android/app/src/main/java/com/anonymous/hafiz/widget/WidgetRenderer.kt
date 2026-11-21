package com.anonymous.hafiz.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.SizeF
import android.view.View
import android.widget.RemoteViews
import com.anonymous.hafiz.MainActivity
import com.anonymous.hafiz.R
import java.util.Locale

/**
 * Builds the widget's RemoteViews (spec 3.3, 3.4 and 9.2). Both providers share five layouts, each
 * used in three modes: the scene with Zayt, and the plain card in a fixed app theme or in the
 * launcher's day or night colors. From Android 12 each widget gets every size at once, so the
 * launcher switches layouts on resize without waking the app; before that the renderer picks one
 * from the size the launcher reports.
 */
object WidgetRenderer {
  private enum class Bucket(
    val scene: Int,
    val plain: Int,
    val plainSystem: Int,
    val width: Float,
    val height: Float,
    /** The wide crop of the sky; the tile uses the square one. */
    val wideScene: Boolean,
    /** The layout has the note and week row views, shown from 190 dp tall. */
    val noteView: Boolean,
    val note: Boolean,
  ) {
    WIDE(R.layout.hafiz_widget_wide, R.layout.hafiz_widget_wide_plain, R.layout.hafiz_widget_wide_plain_system, 250f, 190f, wideScene = true, noteView = true, note = true),
    WIDE_SHORT(R.layout.hafiz_widget_wide_short, R.layout.hafiz_widget_wide_short_plain, R.layout.hafiz_widget_wide_short_plain_system, 250f, 110f, wideScene = true, noteView = true, note = false),
    TILE(R.layout.hafiz_widget_tile, R.layout.hafiz_widget_tile_plain, R.layout.hafiz_widget_tile_plain_system, 110f, 100f, wideScene = false, noteView = false, note = false),
    SHORT(R.layout.hafiz_widget_short, R.layout.hafiz_widget_short_plain, R.layout.hafiz_widget_short_plain_system, 150f, 64f, wideScene = true, noteView = false, note = false),
    STRIP(R.layout.hafiz_widget_strip, R.layout.hafiz_widget_strip_plain, R.layout.hafiz_widget_strip_plain_system, 150f, 40f, wideScene = true, noteView = false, note = false),
    TINY(R.layout.hafiz_widget_tiny, R.layout.hafiz_widget_tiny_plain, R.layout.hafiz_widget_tiny_plain_system, 100f, 40f, wideScene = true, noteView = false, note = false),
  }

  /** What may move: nothing, the idle blink, or the blink after a one-shot clip earned this session. */
  enum class Motion { NONE, IDLE, CELEBRATE }

  private val WEEK_LABELS = intArrayOf(
    R.id.widget_week_label_0, R.id.widget_week_label_1, R.id.widget_week_label_2, R.id.widget_week_label_3,
    R.id.widget_week_label_4, R.id.widget_week_label_5, R.id.widget_week_label_6,
  )
  private val WEEK_MARKS = intArrayOf(
    R.id.widget_week_mark_0, R.id.widget_week_mark_1, R.id.widget_week_mark_2, R.id.widget_week_mark_3,
    R.id.widget_week_mark_4, R.id.widget_week_mark_5, R.id.widget_week_mark_6,
  )

  private const val REQUEST_TAP_WIRD = 2001
  private const val REQUEST_TAP_HOME = 2002

  /** Renders every placed widget. Each id is separate, so one failure leaves the others correct. */
  fun renderAll(
    context: Context,
    manager: AppWidgetManager,
    ids: IntArray,
    timeline: WidgetTimeline?,
    selection: WidgetSelection,
    appearance: WidgetAppearance?,
    motion: Motion = Motion.NONE,
  ) {
    for (id in ids) {
      try {
        manager.updateAppWidget(id, viewsFor(context, manager.getAppWidgetOptions(id), timeline, selection, appearance, motion))
      } catch (error: Exception) {
        // The neutral view failed too: the widget keeps its previous view.
        WidgetLog.failure("render", error)
      }
    }
  }

  /** The add-widget dialog's preview: today's state in the layout the widget starts with, still. */
  fun buildPreview(context: Context, kind: String): RemoteViews {
    val timeline = WidgetStore.readTimeline(context)
    val selection = timeline?.let { WidgetSelector.select(it, System.currentTimeMillis(), java.util.TimeZone.getDefault()) }
    if (timeline != null && selection is WidgetSelection.Entry) {
      try {
        return entryViews(context, if (kind == "medium") Bucket.WIDE else Bucket.TILE, timeline, selection.entry, Motion.NONE)
      } catch (error: Exception) {
        WidgetLog.failure("preview", error)
      }
    }
    return neutralViews(context, WidgetStore.readAppearance(context))
  }

  private fun viewsFor(
    context: Context,
    options: Bundle,
    timeline: WidgetTimeline?,
    selection: WidgetSelection,
    appearance: WidgetAppearance?,
    motion: Motion,
  ): RemoteViews {
    if (timeline != null && selection is WidgetSelection.Entry) {
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          return RemoteViews(Bucket.entries.associate { SizeF(it.width, it.height) to entryViews(context, it, timeline, selection.entry, motion) })
        }
        return entryViews(context, bucketFor(context, options), timeline, selection.entry, motion)
      } catch (error: Exception) {
        WidgetLog.failure("entry", error)
      }
    }
    return neutralViews(context, appearance)
  }

  /** Before Android 12: the first bucket that fits the reported size, in the spec's order, else tiny. */
  private fun bucketFor(context: Context, options: Bundle): Bucket {
    val landscape = context.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
    val width = options.getInt(if (landscape) AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH else AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH)
    val height = options.getInt(if (landscape) AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT else AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT)
    return Bucket.entries.firstOrNull { width >= it.width && height >= it.height } ?: Bucket.TINY
  }

  private fun entryViews(context: Context, bucket: Bucket, timeline: WidgetTimeline, entry: WidgetEntry, motion: Motion): RemoteViews {
    val pose = entry.pose
    val colors = timeline.colors
    val layout = when {
      pose != null -> bucket.scene
      colors != null -> bucket.plain
      else -> bucket.plainSystem
    }
    val views = RemoteViews(context.packageName, layout)
    views.setInt(android.R.id.background, "setLayoutDirection", if (timeline.rtl) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR)

    // Unlit and zero flames are one color, tinted like the text; a lit flame keeps its own colors.
    // A color filter of 0 leaves the drawable as it is, clearing a tint from a reapplied view.
    var flameTint = 0
    // Week row colors: label, open-day flame, kept and empty dots. 0 keeps the System theme's own.
    var weekColors = intArrayOf(0, 0, 0)
    if (pose != null) {
      val ink = WidgetArt.ink(entry.scene)
      views.setImageViewResource(R.id.widget_scene, WidgetArt.scene(entry.scene, bucket.wideScene))
      views.setTextColor(R.id.widget_count, if (entry.flame == "lit") ink.lit else ink.primary)
      views.setTextColor(R.id.widget_line, ink.primary)
      if (bucket.noteView) views.setTextColor(R.id.widget_note, ink.secondary)
      if (entry.flame != "lit") flameTint = if (entry.flame == "out") ink.secondary else ink.primary
      weekColors = intArrayOf(ink.secondary, ink.primary, ink.secondary)
    } else if (colors != null) {
      views.setInt(R.id.widget_scene, "setColorFilter", colors.surface)
      views.setTextColor(R.id.widget_count, colors.accentText)
      views.setTextColor(R.id.widget_line, colors.textPrimary)
      if (bucket.noteView) views.setTextColor(R.id.widget_note, colors.textSecondary)
      if (entry.flame != "lit") flameTint = if (entry.flame == "out") colors.textSecondary else colors.accent
      weekColors = intArrayOf(colors.textSecondary, colors.accent, colors.textSecondary)
    }
    views.setImageViewResource(R.id.widget_flame, WidgetArt.flame(entry))
    // The System theme's unlit drawables carry the launcher's day or night color themselves.
    if (pose != null || colors != null) views.setInt(R.id.widget_flame, "setColorFilter", flameTint)
    // On the night skies the waiting flame's ember glows and settles as the day ends.
    views.removeAllViews(R.id.widget_flame_motion)
    val ember = motion != Motion.NONE && pose != null && WidgetArt.emberGlows(entry)
    if (ember) views.addView(R.id.widget_flame_motion, RemoteViews(context.packageName, R.layout.hafiz_widget_flame_ember))
    views.setViewVisibility(R.id.widget_flame_motion, if (ember) View.VISIBLE else View.GONE)
    views.setViewVisibility(R.id.widget_flame, if (ember) View.INVISIBLE else View.VISIBLE)

    showText(views, R.id.widget_count, entry.count)
    // The tiny layout has room for the count or the line, not both.
    showText(views, R.id.widget_line, if (bucket == Bucket.TINY && entry.count != null) null else entry.line)
    if (bucket.noteView) {
      showText(views, R.id.widget_note, if (bucket.note) entry.note else null)
      showWeek(views, if (bucket.note) entry.week else emptyList(), weekColors)
    }

    views.setViewVisibility(R.id.widget_art, if (pose == null) View.GONE else View.VISIBLE)
    if (pose != null) showZayt(context, views, entry, pose, motion)

    views.setContentDescription(android.R.id.background, entry.contentDescription)
    views.setOnClickPendingIntent(android.R.id.background, tapIntent(context, entry.tap))
    return views
  }

  /** The 4 by 2 widget's last seven days, oldest at the start; Arabic runs them right to left. */
  private fun showWeek(views: RemoteViews, week: List<WidgetDay>, colors: IntArray) {
    views.setViewVisibility(R.id.widget_week, if (week.size == WEEK_LABELS.size) View.VISIBLE else View.GONE)
    if (week.size != WEEK_LABELS.size) return
    val (label, open, dot) = colors.toList()
    for ((index, day) in week.withIndex()) {
      views.setTextViewText(WEEK_LABELS[index], day.label)
      if (label != 0) views.setTextColor(WEEK_LABELS[index], label)
      views.setImageViewResource(WEEK_MARKS[index], WidgetArt.day(day.mark))
      val tint = when (day.mark) {
        "lit" -> 0
        "open" -> open
        else -> dot
      }
      // Only the System theme leaves the drawables' own day or night colors.
      if (label != 0) views.setInt(WEEK_MARKS[index], "setColorFilter", tint)
    }
  }

  /**
   * The still always sizes the art box. A moving frame list plays over it in widget_motion, with the
   * still hidden so two semi-transparent halos never stack. The host runs the frames itself, so
   * Hafiz never wakes to animate.
   */
  private fun showZayt(context: Context, views: RemoteViews, entry: WidgetEntry, pose: String, motion: Motion) {
    views.setImageViewResource(R.id.widget_zayt, WidgetArt.pose(pose))
    views.removeAllViews(R.id.widget_motion)
    val moving = when (motion) {
      Motion.NONE -> null
      Motion.IDLE -> WidgetArt.blink(pose)
      Motion.CELEBRATE -> WidgetArt.celebration(entry) ?: WidgetArt.blink(pose)
    }
    if (moving == null) {
      views.setViewVisibility(R.id.widget_motion, View.GONE)
      views.setViewVisibility(R.id.widget_zayt, View.VISIBLE)
    } else {
      views.addView(R.id.widget_motion, RemoteViews(context.packageName, moving))
      views.setViewVisibility(R.id.widget_motion, View.VISIBLE)
      views.setViewVisibility(R.id.widget_zayt, View.INVISIBLE)
    }
  }

  /**
   * "Open Hafiz to see today's wird", with no numbers, in the language and colors of the last
   * accepted timeline, or the system's before any.
   */
  private fun neutralViews(context: Context, appearance: WidgetAppearance?): RemoteViews {
    val localized = appearance?.let { localizedContext(context, it.language) } ?: context
    val layout = if (appearance?.colors == null) R.layout.hafiz_widget_message_system else R.layout.hafiz_widget_message
    val views = RemoteViews(context.packageName, layout)
    if (appearance != null) {
      views.setInt(
        android.R.id.background,
        "setLayoutDirection",
        if (appearance.language == "ar") View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR,
      )
    }
    appearance?.colors?.let { colors ->
      views.setInt(R.id.widget_bg, "setColorFilter", colors.surface)
      views.setTextColor(R.id.widget_headline, colors.textPrimary)
    }
    views.setTextViewText(R.id.widget_headline, localized.getString(R.string.hafiz_widget_open_app))
    views.setContentDescription(android.R.id.background, localized.getString(R.string.hafiz_widget_open_app_description))
    views.setOnClickPendingIntent(android.R.id.background, tapIntent(context, "home"))
    return views
  }

  private fun localizedContext(context: Context, language: String): Context {
    val configuration = Configuration(context.resources.configuration)
    configuration.setLocale(Locale.forLanguageTag(language))
    return context.createConfigurationContext(configuration)
  }

  private fun showText(views: RemoteViews, id: Int, text: String?) {
    if (text == null) {
      views.setViewVisibility(id, View.GONE)
    } else {
      views.setTextViewText(id, text)
      views.setViewVisibility(id, View.VISIBLE)
    }
  }

  /** Opens MainActivity with hafiz://widget?to=wird or ?to=home, which +native-intent routes. */
  private fun tapIntent(context: Context, tap: String): PendingIntent {
    val target = if (tap == "wird") "wird" else "home"
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("hafiz://widget?to=$target"))
      .setClass(context, MainActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return PendingIntent.getActivity(
      context,
      if (target == "wird") REQUEST_TAP_WIRD else REQUEST_TAP_HOME,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }
}
