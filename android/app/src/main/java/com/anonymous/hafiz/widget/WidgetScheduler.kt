package com.anonymous.hafiz.widget

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent

/**
 * Spec 9.3: one inexact alarm for the next entry boundary. Inexact alarms never fire early and need
 * no exact-alarm permission; Doze may defer them by minutes, and each render picks the entry from the
 * current time, so a late alarm only delays a change. Reusing one PendingIntent replaces the previous
 * alarm, so there is never more than one.
 */
object WidgetScheduler {
  private const val REQUEST_TICK = 1001
  private const val SLACK_MS = 1000L

  private fun tick(context: Context): PendingIntent =
    PendingIntent.getBroadcast(
      context,
      REQUEST_TICK,
      Intent(context, HafizWidgetSystemReceiver::class.java).setAction(HafizWidgetSystemReceiver.ACTION_TICK),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

  fun schedule(context: Context, boundary: Long) {
    val alarms = context.getSystemService(AlarmManager::class.java) ?: return
    alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, boundary + SLACK_MS, tick(context))
  }

  fun cancel(context: Context) {
    val alarms = context.getSystemService(AlarmManager::class.java) ?: return
    alarms.cancel(tick(context))
  }
}
