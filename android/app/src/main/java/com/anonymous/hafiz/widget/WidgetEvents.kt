package com.anonymous.hafiz.widget

/** Tells a running React instance that a widget was placed or removed (HafizWidgetPlacement). */
object WidgetEvents {
  @Volatile private var listener: (() -> Unit)? = null

  fun register(next: () -> Unit) {
    listener = next
  }

  fun unregister(previous: () -> Unit) {
    if (listener === previous) listener = null
  }

  fun notifyPlacementChanged() {
    try {
      listener?.invoke()
    } catch (error: Exception) {
      WidgetLog.failure("placement event", error)
    }
  }
}
