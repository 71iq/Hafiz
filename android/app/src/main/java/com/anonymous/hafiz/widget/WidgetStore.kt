package com.anonymous.hafiz.widget

import android.content.Context
import android.util.AtomicFile
import org.json.JSONObject
import java.io.File

/** What the neutral state needs from the last accepted timeline: its language and colors. */
data class WidgetAppearance(val language: String, val colors: WidgetColors?)

/**
 * The last accepted timeline and its appearance, in no-backup storage so they are never copied to
 * another device. The timeline is validated again on every read, so a corrupt file renders the
 * neutral state. Call only from the WidgetWork executor.
 */
object WidgetStore {
  private fun directory(context: Context): File = File(context.noBackupFilesDir, "hafiz-widget").apply { mkdirs() }

  private fun timelineFile(context: Context) = AtomicFile(File(directory(context), "timeline.json"))

  private fun appearanceFile(context: Context) = AtomicFile(File(directory(context), "appearance.json"))

  private fun write(file: AtomicFile, text: String) {
    val stream = file.startWrite()
    try {
      stream.write(text.toByteArray(Charsets.UTF_8))
      file.finishWrite(stream)
    } catch (error: Exception) {
      file.failWrite(stream)
      throw error
    }
  }

  private fun read(file: AtomicFile): String? =
    try {
      String(file.readFully(), Charsets.UTF_8)
    } catch (_: Exception) {
      null
    }

  /** Stores an accepted timeline's JSON and the appearance the neutral state keeps after it. */
  fun save(context: Context, json: String, timeline: WidgetTimeline) {
    write(timelineFile(context), json)
    val appearance = JSONObject().apply {
      put("language", timeline.language)
      put("colorMode", if (timeline.colors == null) "system" else "fixed")
      timeline.colors?.let { colors ->
        put(
          "colors",
          JSONObject().apply {
            put("surface", colors.surface)
            put("textPrimary", colors.textPrimary)
            put("textSecondary", colors.textSecondary)
            put("accent", colors.accent)
            put("accentText", colors.accentText)
          },
        )
      }
    }
    write(appearanceFile(context), appearance.toString())
  }

  /** Removes the timeline and keeps the appearance, so the neutral state keeps the app's language and theme. */
  fun deleteTimeline(context: Context) {
    timelineFile(context).delete()
  }

  /** The stored timeline, re-validated, or null when there is none or it does not pass. */
  fun readTimeline(context: Context): WidgetTimeline? {
    val json = read(timelineFile(context)) ?: return null
    return try {
      WidgetTimelineParser.parse(json)
    } catch (error: InvalidTimelineException) {
      WidgetLog.reason("stored", error.reason)
      null
    }
  }

  fun readAppearance(context: Context): WidgetAppearance? {
    val text = read(appearanceFile(context)) ?: return null
    return try {
      val json = JSONObject(text)
      val language = json.getString("language").takeIf { it == "en" || it == "ar" } ?: return null
      val colors = if (json.optString("colorMode") == "fixed") {
        val value = json.getJSONObject("colors")
        WidgetColors(
          value.getInt("surface"),
          value.getInt("textPrimary"),
          value.getInt("textSecondary"),
          value.getInt("accent"),
          value.getInt("accentText"),
        )
      } else {
        null
      }
      WidgetAppearance(language, colors)
    } catch (_: Exception) {
      null
    }
  }
}
