package app.hafizquran.updates

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class HafizApkVerifierModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HafizApkVerifier")

    AsyncFunction("sha256") { name: String ->
      ApkChecksum.sha256(File(appContext.cacheDirectory, "app-updates"), name)
    }
  }
}
