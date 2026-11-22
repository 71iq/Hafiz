package com.anonymous.hafiz.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
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
 * Builds the widget's RemoteViews (spec 3.3, 3.4 and 9.2). Both providers share the same sized
 * layouts, each used in three modes: the scene with Zayt, and the plain card in a fixed app theme or
 * in the launcher's day or night colors. From Android 12 each widget gets every size at once, so the
 * launcher switches layouts on resize without waking the app; before that the renderer picks one
 * from the size the launcher reports.
 */
object WidgetRenderer {
  /**
   * The layouts with their ideal sizes in dp. From Android 12 the launcher picks the closest ideal
   * size that fits the widget; [bucketFor] applies the same rule before that, so a size gets the same
   * layout on every version. Each minimum leaves room for a three-digit count beside the flame.
   */
  private enum class Bucket(
    val scene: Int,
    val plain: Int,
    val plainSystem: Int,
    val width: Float,
    val height: Float,
    /** The wide crop of the sky; the tile uses the square one. */
    val wideScene: Boolean,
    /** The layout has the week row. */
    val weekView: Boolean,
    /** Zayt has room here; the tiny layout keeps its width for the count or the line. */
    val art: Boolean,
    /** The line shows beside a count; where it does not, only a missing count brings it back. */
    val lineWithCount: Boolean,
    /** The smallest tile has no room for a line beside Zayt without cutting its face; without Zayt it does. */
    val lineBesideZayt: Boolean = true,
  ) {
    // Both width bands switch to the tall composition at the same height on a resizing launcher.
    TALL_ROOMY(R.layout.hafiz_widget_wide_tall, R.layout.hafiz_widget_wide_roomy_plain, R.layout.hafiz_widget_wide_roomy_plain_system, 320f, 210f, wideScene = true, weekView = true, art = true, lineWithCount = true),
    TALL(R.layout.hafiz_widget_wide_tall, R.layout.hafiz_widget_wide_plain, R.layout.hafiz_widget_wide_plain_system, 250f, 210f, wideScene = true, weekView = true, art = true, lineWithCount = true),
    WIDE_ROOMY(R.layout.hafiz_widget_wide_roomy, R.layout.hafiz_widget_wide_roomy_plain, R.layout.hafiz_widget_wide_roomy_plain_system, 320f, 170f, wideScene = true, weekView = true, art = true, lineWithCount = true),
    WIDE(R.layout.hafiz_widget_wide, R.layout.hafiz_widget_wide_plain, R.layout.hafiz_widget_wide_plain_system, 250f, 170f, wideScene = true, weekView = true, art = true, lineWithCount = true),
    // A 4 x 2 on a launcher with short rows keeps its week row (the provider's minimum is 130 dp).
    WIDE_LOW(R.layout.hafiz_widget_wide_low, R.layout.hafiz_widget_wide_low_plain, R.layout.hafiz_widget_wide_low_plain_system, 250f, 130f, wideScene = true, weekView = true, art = true, lineWithCount = true),
    TILE(R.layout.hafiz_widget_tile, R.layout.hafiz_widget_tile_plain, R.layout.hafiz_widget_tile_plain_system, 130f, 130f, wideScene = false, weekView = false, art = true, lineWithCount = true),
    // Below 130 dp a line would cut Zayt's face, so the smallest tile with Zayt keeps the flame, count
    // and Zayt; the plain tile keeps its line.
    TILE_SMALL(R.layout.hafiz_widget_tile, R.layout.hafiz_widget_tile_plain, R.layout.hafiz_widget_tile_plain_system, 110f, 100f, wideScene = false, weekView = false, art = true, lineWithCount = true, lineBesideZayt = false),
    // A wide, short widget looks like a long 2 x 1: Zayt looks up from the bottom edge.
    WIDE_SHORT(R.layout.hafiz_widget_short, R.layout.hafiz_widget_short_plain, R.layout.hafiz_widget_short_plain_system, 250f, 64f, wideScene = true, weekView = false, art = true, lineWithCount = true),
    SHORT(R.layout.hafiz_widget_short, R.layout.hafiz_widget_short_plain, R.layout.hafiz_widget_short_plain_system, 170f, 64f, wideScene = true, weekView = false, art = true, lineWithCount = true),
    STRIP(R.layout.hafiz_widget_strip, R.layout.hafiz_widget_strip_plain, R.layout.hafiz_widget_strip_plain_system, 210f, 40f, wideScene = true, weekView = false, art = true, lineWithCount = true),
    // A short 2 x 1, as on five-column launchers: the flame and count with Zayt at the end and no line.
    // Without Zayt it is the strip's plain card, with the count or, with Show numbers off, the line.
    COMPACT(R.layout.hafiz_widget_compact, R.layout.hafiz_widget_strip_plain, R.layout.hafiz_widget_strip_plain_system, 130f, 48f, wideScene = true, weekView = false, art = true, lineWithCount = false, lineBesideZayt = false),
    TINY(R.layout.hafiz_widget_tiny, R.layout.hafiz_widget_tiny_plain, R.layout.hafiz_widget_tiny_plain_system, 100f, 40f, wideScene = true, weekView = false, art = false, lineWithCount = false),
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

  /**
   * The add-widget dialog's preview: today's state, still. From Android 12 the launcher picks the
   * layout for the preview's size, as it will for the placed widget; before that, the typical one.
   */
  fun buildPreview(context: Context, kind: String): RemoteViews {
    val timeline = WidgetStore.readTimeline(context)
    val selection = timeline?.let { WidgetSelector.select(it, System.currentTimeMillis(), java.util.TimeZone.getDefault()) }
    if (timeline != null && selection is WidgetSelection.Entry) {
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          return RemoteViews(Bucket.entries.associate { SizeF(it.width, it.height) to entryViews(context, it, timeline, selection.entry, Motion.NONE) })
        }
        val bucket = if (kind == "medium") Bucket.WIDE_ROOMY else Bucket.TILE
        return entryViews(context, bucket, timeline, selection.entry, Motion.NONE, SizeF(bucket.width, bucket.height))
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
        val size = reportedSize(context, options)
        return entryViews(context, bucketFor(size), timeline, selection.entry, motion, size)
      } catch (error: Exception) {
        WidgetLog.failure("entry", error)
      }
    }
    return neutralViews(context, appearance)
  }

  /**
   * Before Android 12, from the size the launcher reports: the bucket whose ideal size fits and lies
   * closest, as RemoteViews chooses among sized layouts from Android 12; with none fitting, tiny.
   */
  private fun bucketFor(size: SizeF): Bucket {
    val width = size.width
    val height = size.height
    return Bucket.entries
      .filter { it.width <= width && it.height <= height }
      .minByOrNull { (width - it.width) * (width - it.width) + (height - it.height) * (height - it.height) }
      ?: Bucket.TINY
  }

  /** The widget's size in dp as the launcher reports it before Android 12, for the current orientation. */
  private fun reportedSize(context: Context, options: Bundle): SizeF {
    val landscape = context.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
    val width = options.getInt(if (landscape) AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH else AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH)
    val height = options.getInt(if (landscape) AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT else AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT)
    return SizeF(width.toFloat(), height.toFloat())
  }

  /**
   * Before Android 12 launchers do not round a widget's corners, and a full-bleed sky would show square
   * ones. The sky is then drawn at the widget's reported size with the card's radius, at 2 px per dp:
   * the soft gradients need no more, and the update stays small. Null keeps the plain resource.
   */
  private fun roundedScene(context: Context, resource: Int, size: SizeF?): Bitmap? {
    if (size == null || size.width < 1f || size.height < 1f) return null
    val scale = 2f
    val width = (size.width * scale).toInt()
    val height = (size.height * scale).toInt()
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeResource(context.resources, resource, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    val sample = maxOf(1, minOf(bounds.outWidth / width, bounds.outHeight / height))
    val source = BitmapFactory.decodeResource(context.resources, resource, BitmapFactory.Options().apply { inSampleSize = sample })
      ?: return null
    // Centre-crop the sky to the widget's shape, as the layout's centerCrop would.
    val target = width.toFloat() / height
    val crop = if (source.width.toFloat() / source.height > target) {
      val cropWidth = (source.height * target).toInt()
      Rect((source.width - cropWidth) / 2, 0, (source.width + cropWidth) / 2, source.height)
    } else {
      val cropHeight = (source.width / target).toInt()
      Rect(0, (source.height - cropHeight) / 2, source.width, (source.height + cropHeight) / 2)
    }
    val cropped = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    Canvas(cropped).drawBitmap(source, crop, Rect(0, 0, width, height), Paint(Paint.FILTER_BITMAP_FLAG))
    source.recycle()
    val radius = context.resources.getDimension(R.dimen.hafiz_widget_radius) / context.resources.displayMetrics.density * scale
    val rounded = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { shader = BitmapShader(cropped, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP) }
    Canvas(rounded).drawRoundRect(RectF(0f, 0f, width.toFloat(), height.toFloat()), radius, radius, paint)
    cropped.recycle()
    return rounded
  }

  private fun entryViews(
    context: Context,
    bucket: Bucket,
    timeline: WidgetTimeline,
    entry: WidgetEntry,
    motion: Motion,
    size: SizeF? = null,
  ): RemoteViews {
    val pose = entry.pose
    val colors = timeline.colors
    val layout = when {
      pose != null -> bucket.scene
      colors != null -> bucket.plain
      else -> bucket.plainSystem
    }
    val views = RemoteViews(context.packageName, layout)
    views.setInt(android.R.id.background, "setLayoutDirection", if (timeline.rtl) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR)

    // A lit flame keeps its own colors; zero and calm waiting flames are one color, tinted like the
    // text. A color filter of 0 leaves the drawable as it is, clearing a tint from a reapplied view.
    var flame = WidgetArt.flame(entry)
    var flameTint = 0
    var flameLoop: Int? = null
    // The one-color flames' tints, at 0 and while waiting calmly; 0 keeps the System theme's own.
    var outTint = 0
    var waitTint = 0
    var outline = WidgetArt.Outline.SYSTEM
    // Week row colors: label, open-day flame, kept and empty dots. 0 keeps the System theme's own.
    var weekColors = intArrayOf(0, 0, 0)
    if (pose != null) {
      val ink = WidgetArt.ink(entry.scene)
      val scene = WidgetArt.scene(entry.scene, bucket.wideScene)
      val rounded = if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) roundedScene(context, scene, size) else null
      if (rounded != null) views.setImageViewBitmap(R.id.widget_scene, rounded) else views.setImageViewResource(R.id.widget_scene, scene)
      views.setTextColor(R.id.widget_count, if (entry.flame == "lit") ink.lit else ink.primary)
      views.setTextColor(R.id.widget_line, ink.primary)
      outTint = ink.secondary
      waitTint = ink.primary
      outline = if (ink.light) WidgetArt.Outline.LIGHT else WidgetArt.Outline.DARK
      weekColors = intArrayOf(ink.secondary, ink.primary, ink.secondary)
    } else if (colors != null) {
      views.setInt(R.id.widget_scene, "setColorFilter", colors.surface)
      views.setTextColor(R.id.widget_count, colors.accentText)
      views.setTextColor(R.id.widget_line, colors.textPrimary)
      outTint = colors.textSecondary
      waitTint = colors.accent
      outline = if (Color.luminance(colors.textPrimary) > 0.5f) WidgetArt.Outline.LIGHT else WidgetArt.Outline.DARK
      weekColors = intArrayOf(colors.textSecondary, colors.accent, colors.textSecondary)
    }
    when (entry.flame) {
      "out" -> flameTint = outTint
      "unlit" -> {
        // The ember grows with the time running out (spec 4.6), with Zayt or without.
        val waiting = WidgetArt.waiting(entry.urgency, outline)
        flame = waiting.drawable
        if (waiting.tinted) flameTint = waitTint
        if (motion != Motion.NONE) flameLoop = waiting.loop
      }
    }
    views.setImageViewResource(R.id.widget_flame, flame)
    // The System theme's unlit drawables carry the launcher's day or night color themselves.
    if (pose != null || colors != null) views.setInt(R.id.widget_flame, "setColorFilter", flameTint)
    views.removeAllViews(R.id.widget_flame_motion)
    flameLoop?.let { views.addView(R.id.widget_flame_motion, RemoteViews(context.packageName, it)) }
    views.setViewVisibility(R.id.widget_flame_motion, if (flameLoop != null) View.VISIBLE else View.GONE)
    views.setViewVisibility(R.id.widget_flame, if (flameLoop != null) View.INVISIBLE else View.VISIBLE)

    showText(views, R.id.widget_count, entry.count)
    val zayt = if (bucket.art) pose else null
    val lineShown = (bucket.lineWithCount || entry.count == null) && (bucket.lineBesideZayt || zayt == null)
    showText(views, R.id.widget_line, if (lineShown) entry.line else null)
    // The plan or grace note is spoken in the label only; the widget stays minimal (owner, 2026-11-21).
    if (bucket.weekView) showWeek(views, entry.week, weekColors)

    views.setViewVisibility(R.id.widget_art, if (zayt == null) View.GONE else View.VISIBLE)
    if (zayt != null) showZayt(context, views, entry, zayt, motion)

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
      Motion.IDLE -> WidgetArt.idle(pose)
      Motion.CELEBRATE -> WidgetArt.celebration(entry) ?: WidgetArt.idle(pose)
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
