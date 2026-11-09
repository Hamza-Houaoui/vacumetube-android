package rocks.shy.vacuumtube

import android.app.Activity
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity

class SettingsActivity : AppCompatActivity() {

    companion object {
        private const val TYPE_HEADER = 0
        private const val TYPE_SWITCH = 1
        private const val TYPE_VOLUME = 2
        private const val TYPE_BUTTON = 3
        private const val TYPE_USERSTYLE = 4
        private const val TYPE_ORIENTATION = 5

        private val TAB_KEYS = listOf(
            "search", "shorts", "subscriptions", "library", "gaming", "music",
            "news", "podcasts", "movies_and_tv", "live", "sports"
        )
    }

    private lateinit var listView: ListView
    private val rows = mutableListOf<Row>()
    private lateinit var adapter: SettingsAdapter

    private val importPicker =
        registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
            if (uri == null) return@registerForActivityResult
            importUserstyle(uri)
        }

    private data class Row(
        val type: Int,
        val key: String = "",
        val title: String = "",
        val desc: String = "",
        val extra: String = ""
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        listView = findViewById(R.id.list)
        buildRows()
        adapter = SettingsAdapter()
        listView.adapter = adapter
    }

    private fun buildRows() {
        rows.clear()

        rows.add(Row(TYPE_HEADER, title = getString(R.string.section_playback)))
        rows.add(Row(TYPE_VOLUME, key = "volume", title = getString(R.string.vol_title), desc = getString(R.string.vol_desc)))
        rows.add(Row(TYPE_SWITCH, key = "fullscreen", title = getString(R.string.fullscreen_title), desc = getString(R.string.fullscreen_desc)))
        rows.add(Row(TYPE_SWITCH, key = "keep_screen_on", title = getString(R.string.keep_screen_on_title), desc = getString(R.string.keep_screen_on_desc)))
        rows.add(Row(TYPE_SWITCH, key = "pause_on_blur", title = getString(R.string.pause_on_blur_title), desc = getString(R.string.pause_on_blur_desc)))
        rows.add(Row(TYPE_SWITCH, key = "unlock_resolution", title = getString(R.string.unlock_res_title), desc = getString(R.string.unlock_res_desc)))
        rows.add(Row(TYPE_SWITCH, key = "remove_super_resolution", title = getString(R.string.remove_super_res_title), desc = getString(R.string.remove_super_res_desc)))
        rows.add(Row(TYPE_SWITCH, key = "h264ify", title = getString(R.string.h264ify_title), desc = getString(R.string.h264ify_desc)))
        rows.add(Row(TYPE_SWITCH, key = "h264ify_disable_webm", title = getString(R.string.h264ify_disable_webm)))
        rows.add(Row(TYPE_SWITCH, key = "h264ify_disable_vp8", title = getString(R.string.h264ify_disable_vp8)))
        rows.add(Row(TYPE_SWITCH, key = "h264ify_disable_vp9", title = getString(R.string.h264ify_disable_vp9)))
        rows.add(Row(TYPE_SWITCH, key = "h264ify_disable_av1", title = getString(R.string.h264ify_disable_av1)))
        rows.add(Row(TYPE_SWITCH, key = "low_memory_mode", title = getString(R.string.low_memory_title), desc = getString(R.string.low_memory_desc)))

        rows.add(Row(TYPE_HEADER, title = getString(R.string.section_playback)))

        rows.add(Row(TYPE_HEADER, title = getString(R.string.section_ads_privacy)))
        rows.add(Row(TYPE_SWITCH, key = "adblock", title = getString(R.string.adblock_title), desc = getString(R.string.adblock_desc)))
        rows.add(Row(TYPE_SWITCH, key = "sponsorblock", title = getString(R.string.sponsorblock_title), desc = getString(R.string.sponsorblock_desc)))
        for (category in listOf("sponsor", "selfpromo", "interaction", "intro", "outro", "preview", "hook", "filler")) {
            rows.add(Row(TYPE_SWITCH, key = "sponsorblock_skip_$category", title = getString(resIdForSponsor(category))))
        }
        rows.add(Row(TYPE_SWITCH, key = "dearrow", title = getString(R.string.dearrow_title), desc = getString(R.string.dearrow_desc)))
        rows.add(Row(TYPE_SWITCH, key = "dislikes", title = getString(R.string.dislikes_title), desc = getString(R.string.dislikes_desc)))

        rows.add(Row(TYPE_HEADER, title = getString(R.string.section_content)))
        rows.add(Row(TYPE_SWITCH, key = "hide_shorts", title = getString(R.string.hide_shorts_title), desc = getString(R.string.hide_shorts_desc)))
        rows.add(Row(TYPE_SWITCH, key = "touch_overlay", title = getString(R.string.touch_overlay_title), desc = getString(R.string.touch_overlay_desc)))
        rows.add(Row(TYPE_SWITCH, key = "features_enabled_music", title = getString(R.string.music_mode_title), desc = getString(R.string.music_mode_desc)))

        rows.add(Row(TYPE_HEADER, title = getString(R.string.guide_tabs_title)))
        for (tab in TAB_KEYS) {
            rows.add(Row(TYPE_SWITCH, key = "tab:$tab", title = getString(tabResId(tab)), desc = "", extra = tab))
        }

        rows.add(Row(TYPE_HEADER, title = getString(R.string.section_userstyles)))
        rows.add(Row(TYPE_SWITCH, key = "userstyles", title = getString(R.string.userstyles_enable) + " — " + getString(R.string.userstyles_title), desc = getString(R.string.userstyles_desc)))
        rows.add(Row(TYPE_BUTTON, title = getString(R.string.userstyles_import)))
        rows.add(Row(TYPE_BUTTON, title = getString(R.string.userstyles_clear)))
        val styles = UserstyleStore.load()
        if (styles.isEmpty()) {
            rows.add(Row(TYPE_SWITCH, key = "__none__", title = getString(R.string.userstyles_none), desc = ""))
        } else {
            for (style in styles) {
                rows.add(Row(TYPE_USERSTYLE, title = style.filename, desc = "styles.userstyles", extra = style.filename))
            }
        }

        rows.add(Row(TYPE_HEADER, title = getString(R.string.about_title)))
        rows.add(Row(TYPE_SWITCH, key = "__about__", title = getString(R.string.about_text), desc = ""))
    }

    private fun resIdForSponsor(category: String): Int {
        return resources.getIdentifier("sponsor_skip_$category", "string", packageName)
    }

    private fun tabResId(tab: String): Int {
        val name = "tab_${tab.replace("movies_and_tv", "movies_and_tv")}"
        return resources.getIdentifier(name, "string", packageName)
    }

    private fun importUserstyle(uri: Uri) {
        runCatching {
            val css = contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() } ?: return
            val name = uri.lastPathSegment?.substringAfterLast('/')?.takeIf { it.endsWith(".css") } ?: "userstyle-${System.currentTimeMillis()}.css"
            val safe = UserstyleStore.folder().resolve(name)
            safe.writeText(css)
        }
        buildRows()
        adapter.notifyDataSetChanged()
    }

    private fun handleSwitchChange(row: Row, checked: Boolean) {
        when {
            row.key == "features_enabled_music" -> {
                VtConfig.setBoolean("features_enabled", checked)
                VtConfig.setBoolean("music_mode_feature", checked)
                VtConfig.setBoolean("music_mode", checked)
            }

            row.key.startsWith("tab:") -> {
                val tab = row.key.removePrefix("tab:")
                val disabled = VtConfig.getStringSet("disabled_tabs").toMutableSet()
                if (checked) disabled.remove(tab) else disabled.add(tab)
                VtConfig.setStringSet("disabled_tabs", disabled)
            }

            row.key == "__none__" || row.key == "__about__" -> {}

            else -> {
                if (VtConfig.getValue(row.key) is Boolean) {
                    VtConfig.setBoolean(row.key, checked)
                } else {
                    VtConfig.setValue(row.key, checked)
                }
            }
        }
    }

    private fun handleUserstyleToggle(filename: String, checked: Boolean) {
        val disabled = VtConfig.getStringSet("disabled_userstyles").toMutableSet()
        if (checked) disabled.remove(filename) else disabled.add(filename)
        VtConfig.setStringSet("disabled_userstyles", disabled)
    }

    private inner class SettingsAdapter : BaseAdapter() {

        override fun getCount() = rows.size

        override fun getItem(position: Int) = rows[position]

        override fun getItemId(position: Int) = position.toLong()

        override fun getViewTypeCount() = 5

        override fun getItemViewType(position: Int) = rows[position].type

        override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
            val row = rows[position]
            return when (row.type) {
                TYPE_HEADER -> buildHeader(row)
                TYPE_VOLUME -> buildVolume(row)
                TYPE_BUTTON -> buildButton(row)
                TYPE_USERSTYLE -> buildUserstyle(row)
                else -> buildSwitch(row)
            }
        }
    }

    private fun buildHeader(row: Row): View {
        val tv = androidx.appcompat.widget.AppCompatTextView(this)
        tv.setTextColor(androidx.core.content.ContextCompat.getColor(this, R.color.vt_text_secondary))
        tv.textSize = 13f
        tv.setTypeface(null, android.graphics.Typeface.BOLD)
        tv.text = row.title
        tv.setPadding(dp(20), dp(20), dp(20), dp(8))
        return tv
    }

    private fun buildSwitch(row: Row, convertView: View? = null): View {
        val holder: SwitchViewHolder
        var view = convertView
        if (view != null && view.tag is SwitchViewHolder) {
            holder = view.tag as SwitchViewHolder
        } else {
            view = layoutInflater.inflate(R.layout.item_setting_switch, null)
            holder = SwitchViewHolder(view)
            view.tag = holder
        }

        holder.title.text = row.title
        holder.desc.text = row.desc
        holder.desc.visibility = if (row.desc.isEmpty()) View.GONE else View.VISIBLE

        val isTabRow = row.key.startsWith("tab:")
        val checked = when {
            isTabRow -> !VtConfig.getStringSet("disabled_tabs").contains(row.key.removePrefix("tab:"))
            row.type == TYPE_USERSTYLE -> !VtConfig.getStringSet("disabled_userstyles").contains(row.extra)
            row.key == "features_enabled_music" -> VtConfig.getBoolean("features_enabled") && VtConfig.getBoolean("music_mode_feature")
            row.key == "__none__" || row.key == "__about__" -> false
            else -> VtConfig.getValue(row.key) as? Boolean ?: false
        }

        holder.switchToggle.setOnCheckedChangeListener(null)
        holder.switchToggle.isChecked = checked
        holder.switchToggle.visibility = if (row.key == "__none__" || row.key == "__about__") View.GONE else View.VISIBLE

        holder.switchToggle.setOnCheckedChangeListener { _, isChecked ->
            when (row.type) {
                TYPE_USERSTYLE -> handleUserstyleToggle(row.extra, isChecked)
                else -> handleSwitchChange(row, isChecked)
            }
        }

        return view!!
    }

    private fun buildVolume(row: Row): View {
        val holder: VolumeViewHolder
        val view = layoutInflater.inflate(R.layout.item_setting_volume, null)
        holder = VolumeViewHolder(view)
        view.tag = holder

        holder.title.text = row.title
        holder.desc.text = row.desc
        holder.seekBar.max = 100
        holder.seekBar.progress = VtConfig.getInt("volume")
        holder.value.text = "${VtConfig.getInt("volume")}%"
        holder.seekBar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                holder.value.text = "$progress%"
                if (fromUser) VtConfig.setInt("volume", progress)
            }

            override fun onStartTrackingTouch(seekBar: SeekBar?) {}
            override fun onStopTrackingTouch(seekBar: SeekBar?) {}
        })
        return view
    }

    private fun buildButton(row: Row): View {
        val btn = com.google.android.material.button.MaterialButton(this)
        btn.layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        val params = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        params.setMargins(dp(20), dp(6), dp(20), dp(6))
        btn.layoutParams = params
        btn.text = row.title
        btn.setOnClickListener {
            if (row.title == getString(R.string.userstyles_import)) {
                importPicker.launch(arrayOf("text/css", "text/*", "application/octet-stream"))
            } else if (row.title == getString(R.string.userstyles_clear)) {
                UserstyleStore.clear()
                buildRows()
                adapter.notifyDataSetChanged()
            }
        }
        return btn
    }

    private fun buildUserstyle(row: Row): View {
        return buildSwitch(row)
    }

    private class SwitchViewHolder(val view: View) {
        val title: TextView = view.findViewById(R.id.title)
        val desc: TextView = view.findViewById(R.id.desc)
        val switchToggle: androidx.appcompat.widget.SwitchCompat = view.findViewById(R.id.switchToggle)
    }

    private class VolumeViewHolder(val view: View) {
        val title: TextView = view.findViewById(R.id.title)
        val desc: TextView = view.findViewById(R.id.desc)
        val seekBar: SeekBar = view.findViewById(R.id.seekBar)
        val value: TextView = view.findViewById(R.id.value)
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}