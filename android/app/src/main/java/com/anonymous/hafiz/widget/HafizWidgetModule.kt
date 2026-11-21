package com.anonymous.hafiz.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.os.Build
import android.os.Bundle
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap

/**
 * The widget bridge (lib/widget/platform.android.ts). A legacy module, so it needs no codegen; React
 * Native's interop layer exposes it under the new architecture. Every method runs on the widget
 * executor, so publishing never races a render.
 */
class HafizWidgetModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  private val placementListener: () -> Unit = {
    val context = reactApplicationContext
    if (context.hasActiveReactInstance()) context.emitDeviceEvent(PLACEMENT_EVENT, null)
  }

  override fun getName(): String = NAME

  override fun initialize() {
    super.initialize()
    WidgetEvents.register(placementListener)
  }

  override fun invalidate() {
    WidgetEvents.unregister(placementListener)
    super.invalidate()
  }

  private fun placementMap(): WritableMap {
    val placement = WidgetWork.placement(reactApplicationContext)
    return Arguments.createMap().apply {
      putInt("small", placement.small)
      putInt("medium", placement.medium)
    }
  }

  @ReactMethod
  fun publishTimeline(json: String, promise: Promise) = publish(json, false, promise)

  @ReactMethod
  fun publishCelebration(json: String, promise: Promise) = publish(json, true, promise)

  private fun publish(json: String, celebrate: Boolean, promise: Promise) {
    val context = reactApplicationContext.applicationContext
    WidgetWork.executor.execute {
      try {
        val timeline = try {
          WidgetTimelineParser.parse(json)
        } catch (error: InvalidTimelineException) {
          WidgetLog.reason("publish", error.reason)
          WidgetStore.deleteTimeline(context)
          WidgetWork.refresh(context)
          promise.reject(E_INVALID, error.reason)
          return@execute
        }
        WidgetStore.save(context, json, timeline)
        WidgetWork.refresh(context, celebrate)
        promise.resolve(placementMap())
      } catch (error: Exception) {
        WidgetLog.failure("publish", error)
        promise.reject(E_FAILED, error.javaClass.simpleName)
      }
    }
  }

  @ReactMethod
  fun clearTimeline(promise: Promise) {
    val context = reactApplicationContext.applicationContext
    WidgetWork.executor.execute {
      try {
        WidgetStore.deleteTimeline(context)
        WidgetWork.refresh(context)
        promise.resolve(null)
      } catch (error: Exception) {
        WidgetLog.failure("clear", error)
        promise.reject(E_FAILED, error.javaClass.simpleName)
      }
    }
  }

  @ReactMethod
  fun getPlacement(promise: Promise) {
    WidgetWork.executor.execute {
      try {
        promise.resolve(placementMap())
      } catch (error: Exception) {
        promise.reject(E_FAILED, error.javaClass.simpleName)
      }
    }
  }

  @ReactMethod
  fun canRequestPin(promise: Promise) {
    WidgetWork.executor.execute {
      try {
        promise.resolve(pinSupported())
      } catch (error: Exception) {
        promise.reject(E_FAILED, error.javaClass.simpleName)
      }
    }
  }

  @ReactMethod
  fun requestPin(kind: String, promise: Promise) {
    val context = reactApplicationContext.applicationContext
    WidgetWork.executor.execute {
      try {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !pinSupported() || (kind != "small" && kind != "medium")) {
          promise.resolve(false)
          return@execute
        }
        val provider = ComponentName(
          context,
          if (kind == "small") HafizWidgetSmallProvider::class.java else HafizWidgetMediumProvider::class.java,
        )
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
          (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
        // Explicit, and mutable because the system adds EXTRA_APPWIDGET_ID to it.
        val callback = PendingIntent.getBroadcast(
          context,
          if (kind == "small") REQUEST_PIN_SMALL else REQUEST_PIN_MEDIUM,
          Intent(context, HafizWidgetSystemReceiver::class.java).setAction(HafizWidgetSystemReceiver.ACTION_PINNED),
          flags,
        )
        val extras = Bundle().apply {
          putParcelable(AppWidgetManager.EXTRA_APPWIDGET_PREVIEW, WidgetRenderer.buildPreview(context, kind))
        }
        promise.resolve(AppWidgetManager.getInstance(context).requestPinAppWidget(provider, extras, callback))
      } catch (error: Exception) {
        WidgetLog.failure("pin", error)
        promise.reject(E_FAILED, error.javaClass.simpleName)
      }
    }
  }

  private fun pinSupported(): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
      AppWidgetManager.getInstance(reactApplicationContext).isRequestPinAppWidgetSupported

  /** Required by NativeEventEmitter. */
  @ReactMethod
  fun addListener(eventName: String) {}

  /** Required by NativeEventEmitter. */
  @ReactMethod
  fun removeListeners(count: Int) {}

  companion object {
    const val NAME = "HafizWidget"
    const val PLACEMENT_EVENT = "HafizWidgetPlacement"
    private const val E_INVALID = "E_WIDGET_INVALID"
    private const val E_FAILED = "E_WIDGET_FAILED"
    private const val REQUEST_PIN_SMALL = 1002
    private const val REQUEST_PIN_MEDIUM = 1003
  }
}
