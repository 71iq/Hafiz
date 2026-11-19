package com.anonymous.hafiz.widget

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * Registers the widget bridge. It lives in android/app, not in a local Expo module, so the bridge and
 * the providers share one validator, store, renderer and scheduler (spec 6.1).
 */
class HafizWidgetPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == HafizWidgetModule.NAME) HafizWidgetModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
      HafizWidgetModule.NAME to ReactModuleInfo(
        name = HafizWidgetModule.NAME,
        className = HafizWidgetModule::class.java.name,
        canOverrideExistingModule = false,
        needsEagerInit = false,
        isCxxModule = false,
        isTurboModule = false,
      ),
    )
  }
}
