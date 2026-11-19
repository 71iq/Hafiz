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
 * Builds the widget's RemoteViews (spec 3.3, 3.4 and 9.2). Both providers share five content layouts.
 * From Android 12 each widget gets all five keyed by size, so the launcher switches layouts on resize
 * without waking the app; before that the renderer picks one from the size the launcher reports.
 */
object WidgetRenderer {
  private enum class Bucket(
    val layout: Int,
    val width: Float,
    val height: Float,
    val caption: Boolean,
    val detail: Boolean,
    val zayt: Boolean,
  ) {
    MEDIUM(R.layout.hafiz_widget_medium, 250f, 190f, caption = true, detail = true, zayt = true),
    MEDIUM_SHORT(R.layout.hafiz_widget_medium_short, 250f, 110f, caption = true, detail = false, zayt = true),
    COMPACT(R.layout.hafiz_widget_compact, 110f, 96f, caption = true, detail = false, zayt = false),
    STRIP(R.layout.hafiz_widget_strip, 200f, 40f, caption = false, detail = false, zayt = false),
    TINY(R.layout.hafiz_widget_tiny, 110f, 40f, caption = false, detail = false, zayt = false),
  }

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
  ) {
    for (id in ids) {
      try {
        manager.updateAppWidget(id, viewsFor(context, manager.getAppWidgetOptions(id), timeline, selection, appearance))
      } catch (error: Exception) {
        // The neutral view failed too: the widget keeps its previous view.
        WidgetLog.failure("render", error)
      }
    }
  }

  /** The add-widget dialog's preview: today's state in the layout the widget starts with. */
  fun buildPreview(context: Context, kind: String): RemoteViews {
    val timeline = WidgetStore.readTimeline(context)
    val selection = timeline?.let { WidgetSelector.select(it, System.currentTimeMillis(), java.util.TimeZone.getDefault()) }
    if (timeline != null && selection is WidgetSelection.Entry) {
      try {
        return entryViews(context, if (kind == "medium") Bucket.MEDIUM else Bucket.COMPACT, timeline, selection.entry)
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
  ): RemoteViews {
    if (timeline != null && selection is WidgetSelection.Entry) {
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          return RemoteViews(Bucket.entries.associate { SizeF(it.width, it.height) to entryViews(context, it, timeline, selection.entry) })
        }
        return entryViews(context, bucketFor(context, options), timeline, selection.entry)
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

  private fun entryViews(context: Context, bucket: Bucket, timeline: WidgetTimeline, entry: WidgetEntry): RemoteViews {
    val views = RemoteViews(context.packageName, bucket.layout)
    views.setInt(android.R.id.background, "setLayoutDirection", if (timeline.rtl) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR)
    timeline.colors?.let { colors ->
      views.setInt(R.id.widget_bg, "setColorFilter", colors.surface)
      views.setInt(R.id.widget_marker, "setColorFilter", colors.accent)
      views.setTextColor(R.id.widget_count, colors.accentText)
      views.setTextColor(R.id.widget_headline, colors.textPrimary)
      if (bucket.caption) views.setTextColor(R.id.widget_caption, colors.textSecondary)
      if (bucket.detail) {
        views.setTextColor(R.id.widget_detail, colors.textSecondary)
        views.setTextColor(R.id.widget_note, colors.textSecondary)
      }
    }
    views.setImageViewResource(R.id.widget_marker, markerResource(entry.marker))
    showText(views, R.id.widget_count, entry.count)
    if (bucket.caption) showText(views, R.id.widget_caption, entry.countCaption)
    views.setTextViewText(R.id.widget_headline, entry.headline)
    // The tiny layout has room for the count or the headline, not both.
    if (bucket == Bucket.TINY) views.setViewVisibility(R.id.widget_headline, if (entry.count == null) View.VISIBLE else View.GONE)
    if (bucket.detail) {
      showText(views, R.id.widget_detail, entry.detail)
      showText(views, R.id.widget_note, entry.note)
    }
    if (bucket.zayt) {
      val image = entry.image?.let(::zaytResource)
      if (image == null) {
        views.setViewVisibility(R.id.widget_zayt, View.GONE)
      } else {
        views.setImageViewResource(R.id.widget_zayt, image)
        views.setViewVisibility(R.id.widget_zayt, View.VISIBLE)
      }
    }
    views.setContentDescription(android.R.id.background, entry.contentDescription)
    views.setOnClickPendingIntent(android.R.id.background, tapIntent(context, entry.tap))
    return views
  }

  /**
   * "Open Hafiz to see today's wird", with no numbers, in the language and colors of the last
   * accepted timeline, or the system's before any.
   */
  private fun neutralViews(context: Context, appearance: WidgetAppearance?): RemoteViews {
    val localized = appearance?.let { localizedContext(context, it.language) } ?: context
    val views = RemoteViews(context.packageName, R.layout.hafiz_widget_message)
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

  private fun markerResource(marker: String): Int =
    when (marker) {
      "begin" -> R.drawable.hafiz_widget_marker_begin
      "done" -> R.drawable.hafiz_widget_marker_done
      "kept" -> R.drawable.hafiz_widget_marker_kept
      "paused" -> R.drawable.hafiz_widget_marker_paused
      else -> R.drawable.hafiz_widget_marker_open
    }

  private fun zaytResource(image: String): Int? =
    when (image) {
      "rest" -> R.drawable.hafiz_widget_zayt_rest
      "warm" -> R.drawable.hafiz_widget_zayt_warm
      "glow" -> R.drawable.hafiz_widget_zayt_glow
      "sit" -> R.drawable.hafiz_widget_zayt_sit
      else -> null
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
