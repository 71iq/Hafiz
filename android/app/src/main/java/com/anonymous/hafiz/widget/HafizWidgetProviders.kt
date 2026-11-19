package com.anonymous.hafiz.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.os.Bundle

/**
 * Both widgets share one renderer. Every callback re-renders all placed widgets from the stored
 * timeline on the widget executor; adding or removing one also tells a running app.
 */
abstract class HafizWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    WidgetWork.refreshAsync(this, context, notifyPlacement = false)
  }

  override fun onAppWidgetOptionsChanged(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int, newOptions: Bundle) {
    WidgetWork.refreshAsync(this, context, notifyPlacement = false)
  }

  override fun onRestored(context: Context, oldWidgetIds: IntArray, newWidgetIds: IntArray) {
    WidgetWork.refreshAsync(this, context, notifyPlacement = false)
  }

  override fun onEnabled(context: Context) {
    WidgetWork.refreshAsync(this, context, notifyPlacement = true)
  }

  override fun onDeleted(context: Context, appWidgetIds: IntArray) {
    WidgetWork.refreshAsync(this, context, notifyPlacement = true)
  }

  override fun onDisabled(context: Context) {
    WidgetWork.refreshAsync(this, context, notifyPlacement = true)
  }
}

/** "Hafiz streak", 2 by 1. */
class HafizWidgetSmallProvider : HafizWidgetProvider()

/** "Hafiz wird", 4 by 2. */
class HafizWidgetMediumProvider : HafizWidgetProvider()
