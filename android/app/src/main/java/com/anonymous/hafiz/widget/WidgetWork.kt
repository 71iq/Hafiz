package com.anonymous.hafiz.widget

import android.appwidget.AppWidgetManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.provider.Settings
import android.util.Log
import java.util.TimeZone
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/** Reason codes only: never strings or numbers from the timeline. */
object WidgetLog {
  const val TAG = "HafizWidget"

  fun reason(where: String, reason: String) {
    Log.w(TAG, "$where: $reason")
  }

  fun failure(where: String, error: Throwable) {
    Log.w(TAG, "$where failed: ${error.javaClass.simpleName}")
  }
}

/** Placed instances of each provider. */
data class WidgetPlacementCounts(val small: Int, val medium: Int) {
  val total: Int get() = small + medium
}

/**
 * One thread for all widget work: publishing, provider callbacks, system broadcasts and alarms. They
 * never race, so a render always reads a whole stored timeline.
 */
object WidgetWork {
  val executor: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { runnable ->
    Thread(runnable, "HafizWidget").apply { isDaemon = true }
  }

  fun smallIds(context: Context, manager: AppWidgetManager): IntArray =
    manager.getAppWidgetIds(ComponentName(context, HafizWidgetSmallProvider::class.java))

  fun mediumIds(context: Context, manager: AppWidgetManager): IntArray =
    manager.getAppWidgetIds(ComponentName(context, HafizWidgetMediumProvider::class.java))

  fun placement(context: Context): WidgetPlacementCounts {
    val manager = AppWidgetManager.getInstance(context)
    return WidgetPlacementCounts(smallIds(context, manager).size, mediumIds(context, manager).size)
  }

  /** Reads the store, renders every placed widget and arms the next boundary alarm, or cancels it. */
  fun refresh(context: Context, celebrate: Boolean = false) {
    val manager = AppWidgetManager.getInstance(context)
    val ids = smallIds(context, manager) + mediumIds(context, manager)
    val timeline = WidgetStore.readTimeline(context)
    val appearance = WidgetStore.readAppearance(context)
    val selection = if (timeline == null) {
      WidgetSelection.Neutral("missing")
    } else {
      WidgetSelector.select(timeline, System.currentTimeMillis(), TimeZone.getDefault())
    }
    if (selection is WidgetSelection.Neutral && selection.reason != "missing") WidgetLog.reason("select", selection.reason)
    // Turning off system animations leaves every widget still (spec 8.3).
    val animations = Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) > 0f
    val entry = (selection as? WidgetSelection.Entry)?.entry
    val celebrating = celebrate && animations && ids.isNotEmpty() && entry?.pose != null && WidgetArt.celebration(entry) != null
    val motion = when {
      celebrating -> WidgetRenderer.Motion.CELEBRATE
      animations -> WidgetRenderer.Motion.IDLE
      else -> WidgetRenderer.Motion.NONE
    }
    WidgetRenderer.renderAll(context, manager, ids, timeline, selection, appearance, motion)
    if (celebrating) {
      // Replace the one-shot with the resting blink, which starts from the clip's last drawing. Read
      // the current timeline again in case settings, account or today's state changed. Leave the
      // clip on its final frame briefly so a busy launcher has time to display the landing.
      executor.schedule({ refresh(context) }, 5, TimeUnit.SECONDS)
    }
    if (ids.isNotEmpty() && selection is WidgetSelection.Entry) {
      WidgetScheduler.schedule(context, selection.nextBoundary)
    } else {
      WidgetScheduler.cancel(context)
    }
  }

  /** Runs a refresh for a broadcast on the executor and keeps the receiver alive until it ends. */
  fun refreshAsync(receiver: BroadcastReceiver, context: Context, notifyPlacement: Boolean) {
    val pending = receiver.goAsync()
    val app = context.applicationContext
    executor.execute {
      try {
        refresh(app)
        if (notifyPlacement) WidgetEvents.notifyPlacementChanged()
      } catch (error: Exception) {
        WidgetLog.failure("refresh", error)
      } finally {
        pending.finish()
      }
    }
  }
}
