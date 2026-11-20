package app.hafizquran.content

import android.net.Uri
import android.system.Os
import com.github.luben.zstd.ZstdInputStream
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.io.RandomAccessFile
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.zip.GZIPInputStream

class ReaderContentModule : Module() {
  private val context get() = appContext.reactContext ?: throw Exceptions.AppContextLost()
  private val manifest by lazy {
    context.assets.open("reader/downloads.json").bufferedReader().use { JSONObject(it.readText()) }
  }
  private val classicDir by lazy {
    val version = context.assets.open("reader/classic-version").bufferedReader().use { it.readText() }
    File(context.noBackupFilesDir, "qcf2/$version")
  }

  private fun unpack(name: String) = ZstdInputStream(context.assets.open("reader/$name.zst"))
  private fun classicPage(page: Int): File {
    require(page in 1..604)
    return File(classicDir, "p$page.ttf")
  }

  // Existing files were verified before their atomic rename. A killed download can resume at
  // the next missing page. The directory version binds every page to the APK's manifest.
  private fun downloadClassicPage(page: Int) {
    val target = classicPage(page)
    val item = manifest.getJSONArray("classic").getJSONObject(page - 1)
    if (target.isFile && target.length() == item.getLong("size")) return
    classicDir.mkdirs()
    val part = File.createTempFile("page-", ".part", classicDir)
    try {
      val urlHash = item.getString("urlHash")
      part.outputStream().use { download("/assets/assets/fonts/QPC_V2/p$page.$urlHash.ttf", item, false, it) }
      Os.rename(part.path, target.path)
    } finally {
      part.delete()
    }
  }

  private fun download(path: String, item: JSONObject, gzipFile: Boolean, out: OutputStream) {
    val connection = URL("https://hafizquran.app$path").openConnection() as HttpURLConnection
    connection.connectTimeout = 15000
    connection.readTimeout = 30000
    connection.setRequestProperty("Accept-Encoding", if (gzipFile) "identity" else "gzip")
    try {
      check(connection.responseCode == 200) { "Content download returned HTTP ${connection.responseCode}" }
      val input = connection.inputStream
      val compressed = gzipFile || connection.contentEncoding.equals("gzip", ignoreCase = true)
      (if (compressed) GZIPInputStream(input) else input).use {
        copyVerified(it, out, item.getInt("size"), item.getString("sha256"))
      }
    } finally {
      connection.disconnect()
    }
  }

  private fun copyVerified(input: InputStream, output: OutputStream, size: Int, sha256: String) {
    val digest = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(32 * 1024)
    var total = 0L
    while (true) {
      val count = input.read(buffer)
      if (count < 0) break
      total += count
      check(total <= size) { "Content exceeds the expected size" }
      digest.update(buffer, 0, count)
      output.write(buffer, 0, count)
    }
    val actual = digest.digest().joinToString("") { "%02x".format(it) }
    check(total == size.toLong() && actual == sha256) { "Content did not match the release manifest" }
  }

  private fun seedDatabase(directory: String, name: String) {
    require(name == "hafiz.db")
    val dir = File(directory).canonicalFile
    require(dir == File(context.filesDir, "SQLite").canonicalFile)
    val target = File(dir, name)
    if (target.exists()) return
    dir.mkdirs()
    // Multiple React contexts can share a process. The file lock also covers another process
    // opening the database. Android permits atomic rename here but denies hard links.
    synchronized(seedLock) {
      RandomAccessFile(File(dir, ".seed.lock"), "rw").use { lockFile ->
        lockFile.channel.lock().use {
          if (target.exists()) return
          val temp = File(dir, ".seed.part")
          try {
            unpack("data/quran.db").use { input -> temp.outputStream().use { input.copyTo(it) } }
            Os.rename(temp.path, target.path)
          } finally {
            temp.delete()
          }
        }
      }
    }
  }

  companion object {
    private val seedLock = Any()
  }

  override fun definition() = ModuleDefinition {
    Name("HafizReaderContent")

    Function("isClassicInstalled") { File(classicDir, "complete").isFile }
    Function("classicPageUri") { page: Int -> Uri.fromFile(classicPage(page)).toString() }
    AsyncFunction("downloadClassicPage") Coroutine { page: Int ->
      withContext(Dispatchers.IO) { downloadClassicPage(page) }
    }
    AsyncFunction("finishClassicInstall") {
      check((1..604).all { classicPage(it).isFile })
      File(classicDir, "complete").createNewFile()
    }

    AsyncFunction("v4PageBytes") { page: Int ->
      require(page in 1..604)
      unpack("v4/p$page.ttf").use { it.readBytes() }
    }
    AsyncFunction("readDataset") { name: String ->
      require(name.matches(Regex("[a-zA-Z0-9_-]+(/[a-zA-Z0-9_-]+)?\\.json")))
      unpack("data/$name").bufferedReader().use { it.readText() }
    }
    AsyncFunction("downloadTafsir") Coroutine { source: String, surah: Int ->
      withContext(Dispatchers.IO) {
        require(surah in 1..114)
        val item = manifest.getJSONObject("tafsir").getJSONArray(source).getJSONObject(surah - 1)
        val bytes = ByteArrayOutputStream(item.getInt("size"))
        download("/data/tafsir-sources/$source/$surah.json.gz", item, true, bytes)
        bytes.toString("UTF-8")
      }
    }
    AsyncFunction("seedDatabase") { directory: String, name: String -> seedDatabase(directory, name) }
  }
}
