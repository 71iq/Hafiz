package com.anonymous.hafiz
import expo.modules.splashscreen.SplashScreenManager

import android.content.Intent
import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Before React reads the launch link (Linking.getInitialURL reads this activity's intent).
    prepareWidgetLaunch(savedInstanceState)
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    // setTheme(R.style.AppTheme);
    // @generated begin expo-splashscreen - expo prebuild (DO NOT MODIFY) sync-f3ff59a738c56c9a6119210cb55f0b613eb8b6af
    SplashScreenManager.registerOnActivity(this)
    // @generated end expo-splashscreen
    super.onCreate(null)
    // React Native's edge-to-edge setup, run inside super.onCreate, forces Android's translucent
    // band behind three-button navigation. Hafiz draws its theme to the bottom edge and sets the
    // button style per theme (NavigationBarTheme.android.tsx), so the band is turned off again.
    // React Native modals get the band from their own window setup and keep it while open.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      window.isNavigationBarContrastEnforced = false
    }
  }

  /**
   * A widget tap (hafiz://widget?to=...) is acted on once per launch (SPEC 3.9). Android hands the
   * original intent back when the activity is restored from saved state or reopened from Recents, so
   * that link is cleared and the old tap never replays. A fresh launch gets a one-time `launch` number,
   * which JavaScript remembers, so a new launch while the process is still alive is not mistaken for
   * one already handled. Other links are left as they are.
   */
  private fun prepareWidgetLaunch(savedInstanceState: Bundle?) {
    val launch = intent ?: return
    if (!isWidgetLink(launch)) return
    val replayed =
      savedInstanceState != null || (launch.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0
    intent = if (replayed) Intent(launch).setData(null) else numbered(launch)
  }

  /**
   * MainActivity is singleTask, so a tap on a task that already exists arrives here, even when Android
   * restores the activity after killing the process; React may not be listening for it yet then. The
   * numbered tap becomes the activity's intent, so the launch-link read that runs once React starts
   * finds it, and JavaScript takes each number once whichever way it arrives.
   */
  override fun onNewIntent(intent: Intent) {
    if (!isWidgetLink(intent)) {
      super.onNewIntent(intent)
      return
    }
    val next = numbered(intent)
    setIntent(next)
    super.onNewIntent(next)
  }

  private fun isWidgetLink(intent: Intent): Boolean {
    val data = intent.data ?: return false
    return data.scheme == "hafiz" && data.host == "widget"
  }

  private fun numbered(intent: Intent): Intent {
    val data = intent.data ?: return intent
    return Intent(intent).setData(
      data.buildUpon().appendQueryParameter("launch", System.nanoTime().toString()).build(),
    )
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }
}
