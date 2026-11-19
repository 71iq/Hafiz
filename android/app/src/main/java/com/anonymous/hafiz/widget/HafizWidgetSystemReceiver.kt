package com.anonymous.hafiz.widget

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Re-renders the widgets when the right entry may have changed without the app: after a restart, an
 * app update, a time zone or clock change, a locale change, the boundary alarm, and the add-widget
 * dialog's callback. Not exported: the system delivers its broadcasts, and the app's own actions use
 * explicit intents.
 */
class HafizWidgetSystemReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_MY_PACKAGE_REPLACED,
      Intent.ACTION_TIMEZONE_CHANGED,
      Intent.ACTION_TIME_CHANGED,
      Intent.ACTION_LOCALE_CHANGED,
      ACTION_TICK -> WidgetWork.refreshAsync(this, context, notifyPlacement = false)
      ACTION_PINNED -> WidgetWork.refreshAsync(this, context, notifyPlacement = true)
    }
  }

  companion object {
    const val ACTION_TICK = "com.anonymous.hafiz.widget.action.TICK"
    const val ACTION_PINNED = "com.anonymous.hafiz.widget.action.PINNED"
  }
}
