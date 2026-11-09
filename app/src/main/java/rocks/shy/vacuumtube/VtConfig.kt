package rocks.shy.vacuumtube

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Port of VacuumTube's `src/config.js`.
 *
 * Uses SharedPreferences instead of a JSON file in the userData folder, but keeps
 * the exact same keys and default values so the injected web modules behave
 * identically to the desktop app.
 */
object VtConfig {

    const val APP_VERSION = "2.0.0"

    private const val PREFS = "vacuumtube"
    private lateinit var prefs: SharedPreferences

    /** Current frontend: "tv" (Leanback youtube.com/tv) or "web" (normal youtube.com). */
    @Volatile
    var mode: String = "tv"

    /** key -> default value, mirrors the `defaults` object in src/config.js */
    val defaults: Map<String, Any> = linkedMapOf(
        "volume" to 100,
        "adblock" to true,
        "sponsorblock" to false,
        "sponsorblock_uuid" to "",
        "sponsorblock_skip_sponsor" to true,
        "sponsorblock_skip_selfpromo" to false,
        "sponsorblock_skip_interaction" to false,
        "sponsorblock_skip_intro" to false,
        "sponsorblock_skip_outro" to false,
        "sponsorblock_skip_preview" to false,
        "sponsorblock_skip_hook" to false,
        "sponsorblock_skip_filler" to false,
        "dearrow" to false,
        "dislikes" to false,
        "remove_super_resolution" to false,
        "hide_shorts" to false,
        "h264ify" to false,
        "h264ify_disable_webm" to true,
        "h264ify_disable_vp8" to true,
        "h264ify_disable_vp9" to true,
        "h264ify_disable_av1" to true,
        "low_memory_mode" to false,
        "fullscreen" to true,
        "pause_on_blur" to true,
        "features_enabled" to false,
        "music_mode_feature" to false,
        "music_mode" to false,
        "touch_overlay" to true,
        "userstyles" to false,
        "keep_screen_on" to true,
        "unlock_resolution" to false,
        "orientation_lock" to "auto",
        "screen_aspect_class" to "normal"
    )

    fun init(context: Context) {
        prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        if (getString("sponsorblock_uuid").isEmpty()) {
            setString("sponsorblock_uuid", UUID.randomUUID().toString())
        }
    }

    fun getBoolean(key: String): Boolean =
        prefs.getBoolean(key, defaults[key] as? Boolean ?: false)

    fun getInt(key: String): Int =
        prefs.getInt(key, defaults[key] as? Int ?: 0)

    fun getString(key: String): String =
        prefs.getString(key, defaults[key] as? String ?: "") ?: ""

    fun getStringSet(key: String): Set<String> = prefs.getStringSet(key, emptySet()) ?: emptySet()

    fun setBoolean(key: String, value: Boolean) {
        prefs.edit().putBoolean(key, value).apply()
    }

    fun setInt(key: String, value: Int) {
        prefs.edit().putInt(key, value).apply()
    }

    fun setString(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }

    fun setStringSet(key: String, value: Set<String>) {
        prefs.edit().putStringSet(key, value).apply()
    }

    /** value accessor by key, for generic settings rows */
    fun getValue(key: String): Any = when (defaults[key]) {
        is Boolean -> getBoolean(key)
        is Int -> getInt(key)
        is String -> getString(key)
        else -> getString(key)
    }

    fun getOrientationLock(): String = getString("orientation_lock")

    fun setScreenAspectClass(value: String) {
        setString("screen_aspect_class", value)
    }

    fun setValue(key: String, value: Any) {
        when (value) {
            is Boolean -> setBoolean(key, value)
            is Int -> setInt(key, value)
            else -> setString(key, value.toString())
        }
    }

    /** Serializes the whole config to the JSON shape the injected modules expect. */
    fun toJson(): JSONObject {
        val json = JSONObject()
        json.put("mode", mode)

        for ((key, default) in defaults) {
            when (default) {
                is Boolean -> json.put(key, getBoolean(key))
                is Int -> json.put(key, getInt(key))
                is String -> json.put(key, getString(key))
                else -> json.put(key, getString(key))
            }
        }

        val disabled = JSONArray()
        getStringSet("disabled_userstyles").forEach { disabled.put(it) }
        json.put("disabled_userstyles", disabled)

        val disabledTabs = JSONArray()
        getStringSet("disabled_tabs").forEach { disabledTabs.put(it) }
        json.put("disabled_tabs", disabledTabs)

        return json
    }
}