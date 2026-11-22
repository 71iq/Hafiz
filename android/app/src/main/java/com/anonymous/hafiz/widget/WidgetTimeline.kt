package com.anonymous.hafiz.widget

import android.util.JsonReader
import android.util.JsonToken
import java.io.StringReader
import java.math.BigDecimal
import java.util.TimeZone

/**
 * The widget timeline contract, mirroring lib/widget/types.ts and lib/widget/schema.ts (spec 7). Both
 * sides enforce the same rules, so a timeline JavaScript accepts is one this parser accepts. A new
 * field needs a version bump on both sides.
 */
data class WidgetColors(
  val surface: Int,
  val textPrimary: Int,
  val textSecondary: Int,
  val accent: Int,
  val accentText: Int,
)

/** One day of the 4 by 2 widget's week row. */
data class WidgetDay(val mark: String, val label: String)

data class WidgetEntry(
  val startsAt: Long,
  val state: String,
  /** Time left before the streak is at stake, "none" when nothing is; drives the waiting flame. */
  val urgency: String,
  val scene: String,
  /** Null when Show Zayt is off. */
  val pose: String?,
  val flame: String,
  val tier: Int,
  val count: String?,
  val line: String?,
  val note: String?,
  /** Seven days, oldest first, or empty for a version 1 timeline. */
  val week: List<WidgetDay>,
  val contentDescription: String,
  val tap: String,
)

data class WidgetTimeline(
  val generatedAt: Long,
  val expiresAt: Long,
  val timeZone: String,
  val language: String,
  val rtl: Boolean,
  /** Null for the app's System theme: the layouts' resource colors then follow the launcher. */
  val colors: WidgetColors?,
  val entries: List<WidgetEntry>,
)

/** A reason code only, never content from the timeline. */
class InvalidTimelineException(val reason: String) : Exception(reason)

object WidgetLimits {
  const val VERSION = 2
  /** A version 1 timeline stored before an upgrade still renders until Hafiz next publishes. */
  const val LEGACY_VERSION = 1
  const val MAX_TIER = 6
  const val MAX_ENTRIES = 64
  const val MAX_BYTES = 65_536
  const val MAX_SPAN_MS = 7L * 86_400_000L + 2L * 3_600_000L
  const val MIN_INSTANT = 1_577_836_800_000L
  const val MAX_INSTANT = 4_102_444_800_000L
  val STATES = setOf(
    "begin", "fresh_start", "open_day", "open_evening", "make_up", "earn_back_open",
    "earn_back_done", "done", "safe", "milestone", "kept", "paused",
  )
  val SCENES = setOf(
    "dawn", "morning", "day", "golden", "dusk", "night", "midnight", "sunrise", "radiant", "radiant_night", "milestone", "calm",
    "dawn_rose", "dawn_red",
  )
  val POSES = setOf(
    "rest", "warm", "wave", "glow", "open", "shimmer", "milestone", "sit", "glow_halo", "open_halo", "warm_halo", "shimmer_halo",
    "eager", "impatient", "worried", "anxious", "panicked", "relieved", "lonely",
    "worried_halo", "anxious_halo", "panicked_halo", "relieved_halo",
    "fretful", "nervous", "frantic", "nervous_halo", "frantic_halo",
  )
  val URGENCIES = setOf("none", "calm", "steady", "nudge", "urgent", "critical", "last")
  val FLAMES = setOf("lit", "unlit", "out")
  val DAY_MARKS = setOf("lit", "kept", "open", "empty")
  const val WEEK_DAYS = 7
  val TAPS = setOf("wird", "home")
  val LIT_STATES = setOf("earn_back_done", "done", "safe", "milestone", "kept")
}

object WidgetTimelineParser {
  private val TOP_KEYS = setOf("version", "generatedAt", "expiresAt", "timeZone", "language", "direction", "colorMode", "colors", "entries")
  private val ENTRY_KEYS = setOf(
    "startsAt", "state", "urgency", "scene", "pose", "flame", "tier", "count", "line", "note", "week", "contentDescription", "tap",
  )
  private val DAY_KEYS = setOf("mark", "label")
  private val LEGACY_ENTRY_KEYS = setOf(
    "startsAt", "state", "marker", "count", "countCaption", "headline", "detail", "note", "image", "contentDescription", "tap",
  )
  private val LEGACY_MARKERS = setOf("begin", "open", "done", "kept", "paused")
  private val LEGACY_IMAGES = setOf("rest", "warm", "glow", "sit")
  private val COLOR_KEYS = setOf("surface", "textPrimary", "textSecondary", "accent", "accentText")
  private val COLOR = Regex("^#[0-9A-F]{6}$")
  private val TIME_ZONE = Regex("^[A-Za-z0-9_+\\-/:]+$")

  /** Rules 7.4. Throws InvalidTimelineException with a reason code. */
  fun parse(json: String): WidgetTimeline {
    // Rule 10.
    if (json.toByteArray(Charsets.UTF_8).size > WidgetLimits.MAX_BYTES) fail("size")
    val root = readJson(json) as? Map<*, *> ?: fail("shape")
    exactKeys(root, TOP_KEYS, "keys")

    // Rule 1.
    val version = integer(root["version"], "version")
    if (version != WidgetLimits.VERSION.toLong() && version != WidgetLimits.LEGACY_VERSION.toLong()) fail("version")
    val legacy = version == WidgetLimits.LEGACY_VERSION.toLong()
    // Rule 2.
    val generatedAt = instant(root["generatedAt"])
    val expiresAt = instant(root["expiresAt"])
    // Rule 4.
    val timeZone = root["timeZone"] as? String ?: fail("zone")
    if (timeZone.isEmpty() || timeZone.length > 64 || !TIME_ZONE.matches(timeZone)) fail("zone")
    // Rule 5.
    val language = root["language"] as? String ?: fail("language")
    if (language != "en" && language != "ar") fail("language")
    val direction = root["direction"] as? String ?: fail("direction")
    if (direction != (if (language == "ar") "rtl" else "ltr")) fail("direction")
    // Rule 6.
    val colorMode = root["colorMode"] as? String ?: fail("colorMode")
    if (colorMode != "fixed" && colorMode != "system") fail("colorMode")
    val colorsValue = root["colors"]
    val colors = if (colorMode == "fixed") {
      parseColors(colorsValue as? Map<*, *> ?: fail("colors"))
    } else {
      if (colorsValue != null) fail("colors")
      null
    }
    // Rules 3, 7, 8 and 9.
    val list = root["entries"] as? List<*> ?: fail("entries")
    if (list.isEmpty() || list.size > WidgetLimits.MAX_ENTRIES) fail("entries")
    val entries = list.map {
      val map = it as? Map<*, *> ?: fail("entry")
      if (legacy) parseLegacyEntry(map) else parseEntry(map)
    }
    if (entries[0].startsAt != generatedAt) fail("first")
    for (index in 1 until entries.size) {
      if (entries[index].startsAt <= entries[index - 1].startsAt) fail("order")
    }
    if (expiresAt <= entries.last().startsAt) fail("expiry")
    if (expiresAt - generatedAt > WidgetLimits.MAX_SPAN_MS) fail("span")

    return WidgetTimeline(generatedAt, expiresAt, timeZone, language, language == "ar", colors, entries)
  }

  private fun parseColors(map: Map<*, *>): WidgetColors {
    exactKeys(map, COLOR_KEYS, "colors")
    fun color(key: String): Int {
      val value = map[key] as? String ?: fail("colors")
      if (!COLOR.matches(value)) fail("colors")
      return (0xFF000000L or value.substring(1).toLong(16)).toInt()
    }
    return WidgetColors(color("surface"), color("textPrimary"), color("textSecondary"), color("accent"), color("accentText"))
  }

  private fun parseEntry(map: Map<*, *>): WidgetEntry {
    exactKeys(map, ENTRY_KEYS, "entryKeys")
    val tier = integer(map["tier"], "tier")
    if (tier < 0 || tier > WidgetLimits.MAX_TIER) fail("tier")
    val count = text(map["count"], 12, nullable = true, reason = "count")
    val line = text(map["line"], 48, nullable = true, reason = "line")
    if (count == null && line == null) fail("line")
    return WidgetEntry(
      startsAt = instant(map["startsAt"]),
      state = enumValue(map["state"], WidgetLimits.STATES, "state"),
      urgency = enumValue(map["urgency"], WidgetLimits.URGENCIES, "urgency"),
      scene = enumValue(map["scene"], WidgetLimits.SCENES, "scene"),
      pose = if (map["pose"] == null) null else enumValue(map["pose"], WidgetLimits.POSES, "pose"),
      flame = enumValue(map["flame"], WidgetLimits.FLAMES, "flame"),
      tier = tier.toInt(),
      count = count,
      line = line,
      note = text(map["note"], 80, nullable = true, reason = "note"),
      week = parseWeek(map["week"]),
      contentDescription = text(map["contentDescription"], 400, nullable = false, reason = "description")!!,
      tap = enumValue(map["tap"], WidgetLimits.TAPS, "tap"),
    )
  }

  private fun parseWeek(value: Any?): List<WidgetDay> {
    val list = value as? List<*> ?: fail("week")
    if (list.size != WidgetLimits.WEEK_DAYS) fail("week")
    return list.map {
      val day = it as? Map<*, *> ?: fail("week")
      exactKeys(day, DAY_KEYS, "week")
      WidgetDay(enumValue(day["mark"], WidgetLimits.DAY_MARKS, "week"), text(day["label"], 3, nullable = false, reason = "week")!!)
    }
  }

  /**
   * A version 1 entry, validated by its own rules and shown in the version 2 look. It has no time of
   * day, so open days get the midday sky until Hafiz publishes again.
   */
  private fun parseLegacyEntry(map: Map<*, *>): WidgetEntry {
    exactKeys(map, LEGACY_ENTRY_KEYS, "entryKeys")
    val state = enumValue(map["state"], WidgetLimits.STATES, "state")
    enumValue(map["marker"], LEGACY_MARKERS, "marker")
    val image = if (map["image"] == null) null else enumValue(map["image"], LEGACY_IMAGES, "image")
    val count = text(map["count"], 12, nullable = true, reason = "count")
    val caption = text(map["countCaption"], 24, nullable = true, reason = "caption")
    if ((count == null) != (caption == null)) fail("caption")
    text(map["detail"], 120, nullable = true, reason = "detail")
    val (scene, pose) = when (state) {
      "begin", "fresh_start", "make_up" -> "dawn" to "wave"
      "open_evening" -> "dusk" to "glow"
      "earn_back_done" -> "sunrise" to "open"
      "done" -> "radiant" to "shimmer"
      "safe" -> "radiant" to "warm"
      "milestone" -> "milestone" to "milestone"
      "kept", "paused" -> "calm" to "sit"
      else -> "day" to "wave"
    }
    return WidgetEntry(
      startsAt = instant(map["startsAt"]),
      state = state,
      urgency = "none",
      scene = scene,
      pose = if (image == null) null else pose,
      flame = when {
        state == "begin" || state == "fresh_start" -> "out"
        state in WidgetLimits.LIT_STATES -> "lit"
        else -> "unlit"
      },
      tier = 0,
      count = count,
      line = text(map["headline"], 48, nullable = false, reason = "headline"),
      note = text(map["note"], 80, nullable = true, reason = "note"),
      week = emptyList(),
      contentDescription = text(map["contentDescription"], 400, nullable = false, reason = "description")!!,
      tap = enumValue(map["tap"], WidgetLimits.TAPS, "tap"),
    )
  }

  private fun exactKeys(map: Map<*, *>, keys: Set<String>, reason: String) {
    if (map.keys != keys) fail(reason)
  }

  private fun enumValue(value: Any?, allowed: Set<String>, reason: String): String {
    val text = value as? String ?: fail(reason)
    if (text !in allowed) fail(reason)
    return text
  }

  /** Rules 8 and 9: lengths in UTF-16 units, as JavaScript counts them, and no control characters. */
  private fun text(value: Any?, max: Int, nullable: Boolean, reason: String): String? {
    if (value == null) {
      if (nullable) return null
      fail(reason)
    }
    val text = value as? String ?: fail(reason)
    if (text.isEmpty() || text.length > max) fail(reason)
    if (text.any { it.code <= 0x1F || it.code == 0x7F }) fail("control")
    return text
  }

  /** A JSON number with an integer value, as zod's int() accepts it (1, 1.0 or 1e3). */
  private fun integer(value: Any?, reason: String): Long {
    val number = value as? BigDecimal ?: fail(reason)
    return try {
      number.stripTrailingZeros().let { if (it.scale() > 0) fail(reason) else it.longValueExact() }
    } catch (_: ArithmeticException) {
      fail(reason)
    }
  }

  private fun instant(value: Any?): Long {
    val instant = integer(value, "instant")
    if (instant < WidgetLimits.MIN_INSTANT || instant > WidgetLimits.MAX_INSTANT) fail("instant")
    return instant
  }

  /** Strict JSON (RFC 8259) into maps, lists, strings, numbers, booleans and null. */
  private fun readJson(json: String): Any? {
    try {
      JsonReader(StringReader(json)).use { reader ->
        reader.isLenient = false
        val value = readValue(reader, 0)
        if (reader.peek() != JsonToken.END_DOCUMENT) fail("syntax")
        return value
      }
    } catch (error: InvalidTimelineException) {
      throw error
    } catch (_: Exception) {
      fail("syntax")
    }
  }

  private fun readValue(reader: JsonReader, depth: Int): Any? {
    if (depth > 8) fail("depth")
    return when (reader.peek()) {
      JsonToken.BEGIN_OBJECT -> {
        val map = LinkedHashMap<String, Any?>()
        reader.beginObject()
        while (reader.hasNext()) map[reader.nextName()] = readValue(reader, depth + 1)
        reader.endObject()
        map
      }
      JsonToken.BEGIN_ARRAY -> {
        val list = ArrayList<Any?>()
        reader.beginArray()
        while (reader.hasNext()) list.add(readValue(reader, depth + 1))
        reader.endArray()
        list
      }
      JsonToken.STRING -> reader.nextString()
      JsonToken.NUMBER -> BigDecimal(reader.nextString())
      JsonToken.BOOLEAN -> reader.nextBoolean()
      JsonToken.NULL -> {
        reader.nextNull()
        null
      }
      else -> fail("syntax")
    }
  }

  private fun fail(reason: String): Nothing = throw InvalidTimelineException(reason)
}

sealed class WidgetSelection {
  data class Entry(val entry: WidgetEntry, val nextBoundary: Long) : WidgetSelection()
  data class Neutral(val reason: String) : WidgetSelection()
}

/** Rules 7.5, matching selectWidgetEntry in lib/widget/timeline.ts. */
object WidgetSelector {
  private val OFFSET_ZONE = Regex("^UTC([+-])(\\d{2}):(\\d{2})$")

  fun select(timeline: WidgetTimeline, nowMs: Long, zone: TimeZone): WidgetSelection {
    if (!zoneMatches(timeline.timeZone, zone, nowMs)) return WidgetSelection.Neutral("zone")
    val entries = timeline.entries
    if (nowMs < entries[0].startsAt) return WidgetSelection.Neutral("early")
    if (nowMs >= timeline.expiresAt) return WidgetSelection.Neutral("expired")
    var index = 0
    while (index + 1 < entries.size && entries[index + 1].startsAt <= nowMs) index += 1
    val next = if (index + 1 < entries.size) entries[index + 1].startsAt else timeline.expiresAt
    return WidgetSelection.Entry(entries[index], next)
  }

  fun zoneMatches(id: String, device: TimeZone, nowMs: Long): Boolean {
    if (id == device.id) return true
    val named = TimeZone.getTimeZone(id)
    if (named.id == id && named.hasSameRules(device)) return true
    val match = OFFSET_ZONE.matchEntire(id) ?: return false
    val (sign, hours, minutes) = match.destructured
    val offsetMinutes = (hours.toInt() * 60 + minutes.toInt()) * (if (sign == "-") -1 else 1)
    return offsetMinutes * 60_000 == device.getOffset(nowMs)
  }
}
