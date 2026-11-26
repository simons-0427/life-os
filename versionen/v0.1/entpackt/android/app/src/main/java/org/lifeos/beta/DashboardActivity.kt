package org.lifeos.beta

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.Executors

class DashboardActivity : ComponentActivity() {
    private val worker = Executors.newSingleThreadExecutor()
    private val connection by lazy { DashboardConnection(applicationContext) }
    private lateinit var dashboard: WebView
    private val origin = "https://liveos.invalid"
    private val included = mapOf(
        "index.html" to "text/html", "main.css" to "text/css",
        "app.js" to "text/javascript", "charts.js" to "text/javascript",
        "metrics.js" to "text/javascript", "analysis.js" to "text/javascript",
        "connector.js" to "text/javascript", "editor.js" to "text/javascript",
    )

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        dashboard = WebView(this)
        dashboard.setBackgroundColor(Color.rgb(22, 25, 29))
        dashboard.settings.apply {
            javaScriptEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            blockNetworkImage = true
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            javaScriptCanOpenWindowsAutomatically = false
        }
        dashboard.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                val uri = request.url
                val filename = uri.path?.removePrefix("/")?.ifEmpty { "index.html" }
                val mime = included[filename]
                if (uri.scheme != "https" || uri.host != "liveos.invalid" || uri.port != -1 ||
                    uri.encodedQuery != null || mime == null || request.method != "GET") {
                    return WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", emptyMap(), null)
                }
                return WebResourceResponse(mime, "UTF-8", 200, "OK", mapOf(
                    "Content-Security-Policy" to "default-src 'none'; script-src 'self'; style-src 'self'; " +
                        "img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
                    "X-Content-Type-Options" to "nosniff",
                    "Cache-Control" to "no-store",
                ), assets.open(filename!!))
            }
        }
        dashboard.addJavascriptInterface(Bridge(), "LiveOsNative")
        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.rgb(22, 25, 29))
            addView(dashboard, FrameLayout.LayoutParams(-1, -1))
        }
        setContentView(root)
        WindowCompat.getInsetsController(window, root).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        ViewCompat.requestApplyInsets(root)
        dashboard.loadUrl("$origin/")
    }

    inner class Bridge {
        @JavascriptInterface
        fun send(id: String, action: String, raw: String) {
            if (!id.matches(Regex("[0-9]{1,12}")) || raw.length > 100_000 || worker.isShutdown) return
            worker.execute {
                val result = JSONObject()
                try {
                    val data = when (action) {
                        "health" -> {
                            runOnUiThread { startActivity(Intent(this@DashboardActivity, MainActivity::class.java)) }
                            true
                        }
                        "syncMinimumPulse" -> runBlocking {
                            val settings = SecureApiSettings(applicationContext).load()
                                ?: error("Aktiviere Health Connect in den API-Einstellungen.")
                            val today = LocalDate.now(ZoneId.of("Europe/Berlin"))
                            val days = completedExportDays(today, HealthExportWorker.EXPORT_DAY_COUNT) + today
                            val minima = HealthConnectExporter(applicationContext).readMinimumPulse(days)
                            PersonalApiUploader(settings).uploadMinimumPulse(minima)
                        }
                        else -> connection.dispatch(action, JSONObject(raw))
                    }
                    if (action == "saveSettings") {
                        if (connection.uploadSettings() == null) HealthExportWorker.disable(applicationContext)
                        else HealthExportWorker.schedule(applicationContext)
                    }
                    result.put("ok", true).put("data", data ?: JSONObject.NULL)
                } catch (error: Exception) {
                    result.put("ok", false).put("error", error.message ?: "Life OS konnte die Anfrage nicht ausführen.")
                    if (error is DashboardHttpStatus) result.put("status", error.status)
                }
                runOnUiThread {
                    if (!isDestroyed) {
                        dashboard.evaluateJavascript(
                            "window.receiveLiveOs(${JSONObject.quote(id)}, JSON.parse(${JSONObject.quote(result.toString())}))",
                            null,
                        )
                    }
                }
            }
        }
    }

    override fun onDestroy() {
        worker.shutdownNow()
        dashboard.removeJavascriptInterface("LiveOsNative")
        dashboard.destroy()
        super.onDestroy()
    }
}
