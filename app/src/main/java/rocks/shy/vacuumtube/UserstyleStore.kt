package rocks.shy.vacuumtube

import android.content.Context
import java.io.File

/**
 * Mirrors `src/userstyles.js`: reads `.css` files from a userstyles folder and
 * exposes them to the injected web layer. On Android the folder lives in the
 * app's internal files dir, and files are imported through the system file
 * picker in Settings.
 */
object UserstyleStore {

    const val DIR_NAME = "userstyles"

    private lateinit var dir: File

    fun init(context: Context) {
        dir = File(context.filesDir, DIR_NAME)
        if (!dir.exists()) dir.mkdirs()
    }

    fun folder(): File = dir

    fun load(): List<ImportableStyle> {
        val result = mutableListOf<ImportableStyle>()
        if (!dir.exists()) return result

        dir.listFiles()?.sortedBy { it.name }?.forEach { file ->
            if (file.isFile && file.name.endsWith(".css")) {
                val css = runCatching { file.readText() }.getOrNull()
                if (css != null) {
                    result.add(ImportableStyle(file.name, css))
                }
            }
        }

        return result
    }

    fun clear() {
        if (!dir.exists()) return
        dir.listFiles()?.forEach { it.delete() }
    }

    data class ImportableStyle(val filename: String, val css: String)
}