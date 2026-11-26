package org.lifeos.beta

import android.content.Context
import org.json.JSONObject
import org.json.JSONTokener
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.time.LocalDate
import java.time.ZoneId

internal fun dashboardScope(baseUrl: String): String {
    return "-" + MessageDigest.getInstance("SHA-256").digest(baseUrl.toByteArray())
        .take(12).joinToString("") { "%02x".format(it.toInt() and 0xff) }
}

internal fun normalizeDashboardUrl(value: String): String {
    val uri = runCatching { URI(value.trim()) }.getOrElse {
        throw IllegalArgumentException("Die API-Adresse ist ungültig.")
    }
    require(uri.scheme == "https" && !uri.host.isNullOrBlank() &&
        uri.port in -1..65535 && uri.port != 0 && uri.userInfo == null &&
        uri.rawQuery == null && uri.rawFragment == null && !uri.rawPath.contains('%') &&
        uri.rawPath.split('/').none { it == "." || it == ".." }
    ) { "Die API-Adresse muss eine HTTPS-URL ohne Zugangsdaten, Abfrage oder Fragment sein." }
    return "https://${uri.rawAuthority.lowercase()}${uri.rawPath.trimEnd('/')}"
}

internal class DashboardHttpStatus(val status: Int, message: String) : IllegalArgumentException(message)

internal class DashboardConnection(context: Context) {
    private val secure = SecureApiSettings(context)

    fun load(): JSONObject = secure.loadDashboardProfile() ?: JSONObject()
        .put("baseUrl", "").put("protocol", "gymprogress").put("healthUpload", false)

    private fun token(profile: JSONObject, name: String): String? =
        profile.optString(name).takeIf { it.isNotBlank() }

    private fun writer(profile: JSONObject) = token(profile, "writeToken")

    private fun reader(profile: JSONObject) = token(profile, "readToken") ?: writer(profile)

    fun publicSettings(): JSONObject {
        val profile = load()
        val writable = writer(profile) != null ||
            (profile.optString("protocol") == "json" && profile.optString("authHeader").isEmpty())
        val readable = reader(profile) != null || profile.optString("protocol") == "json"
        return JSONObject(profile.toString()).apply {
            remove("readToken")
            remove("writeToken")
            put("canRead", readable)
            put("canWrite", writable)
        }
    }

    fun uploadSettings(): PersonalApiSettings? {
        val profile = load()
        if (profile.optString("protocol") != "gymprogress" || !profile.optBoolean("healthUpload")) return null
        return writer(profile)?.let { PersonalApiSettings(profile.getString("baseUrl"), it) }
    }

    fun destination(): String = load().getString("baseUrl")

    fun save(payload: JSONObject): JSONObject {
        val base = normalizeDashboardUrl(payload.getString("baseUrl"))
        val protocol = payload.getString("protocol")
        require(protocol in setOf("gymprogress", "json")) { "Das API-Format fehlt." }
        val auth = payload.optString("authHeader")
        require(auth.isEmpty() || (auth.matches(Regex("[A-Za-z0-9-]{1,60}")) &&
            auth.lowercase() !in setOf("host", "cookie", "content-length", "connection"))) {
            "Ungültiger Name für den Authentifizierungsheader."
        }
        val prefix = payload.optString("authPrefix").take(30)
        require(prefix.all { it.code in 32..126 }) { "Ungültiger Vorsatz für die Authentifizierung." }
        val prior = load()
        val reusable = prior.getString("baseUrl") == base && prior.getString("protocol") == protocol
        val profile = JSONObject().put("baseUrl", base).put("protocol", protocol)
            .put("routes", payload.optJSONObject("routes") ?: JSONObject())
            .put("authHeader", auth).put("authPrefix", prefix)
            .put("healthUpload", protocol == "gymprogress" && payload.optBoolean("healthUpload"))
        for (field in listOf("readToken", "writeToken")) {
            val newToken = if (payload.has(field)) token(payload, field) else if (reusable) token(prior, field) else null
            if (newToken != null) {
                require(newToken.length <= 512 && newToken.all { it.code in 33..126 }) {
                    "Ein API-Schlüssel enthält ungültige Zeichen."
                }
                profile.put(field, newToken)
            }
        }
        secure.saveDashboardProfile(profile)
        return publicSettings()
    }

    fun dispatch(action: String, payload: JSONObject): Any? = when (action) {
        "settings" -> publicSettings()
        "saveSettings" -> save(payload)
        "today" -> LocalDate.now(ZoneId.of("Europe/Berlin")).toString()
        "call" -> call(payload)
        else -> throw IllegalArgumentException("Unbekannte App-Aktion.")
    }

    private fun call(payload: JSONObject): Any? {
        val profile = load()
        val protocol = profile.getString("protocol")
        val base = profile.getString("baseUrl")
        require(payload.optString("baseUrl") == base && payload.optString("protocol") == protocol) {
            "Die API-Verbindung hat sich geändert. Lade die Ansicht neu."
        }
        val role = payload.getString("role")
        val method = payload.getString("method")
        val path = payload.getString("path")
        require(role in setOf("read", "write") && method in setOf("GET", "POST", "PUT", "PATCH", "DELETE") &&
            (role == "read") == (method == "GET")) { "Die API-Methode ist nicht erlaubt." }
        require(path.matches(Regex("[A-Za-z0-9_.~/-]+")) &&
            path.split('/').none { it.isEmpty() || it == "." || it == ".." }) { "Ungültiger relativer API-Pfad." }
        if (protocol == "gymprogress") {
            require(path in (if (role == "read") setOf("data.php") else setOf("edit.php", "ingest.php"))) {
                "Der Endpunkt gehört nicht zur GymProgress-Schnittstelle."
            }
        }
        val token = if (role == "read") reader(profile) else writer(profile)
        val header = if (protocol == "gymprogress") "X-GymProgress-Key" else profile.optString("authHeader")
        require(header.isEmpty() || token != null) { "Hinterlege in den Einstellungen den passenden API-Schlüssel." }
        val prefix = if (protocol == "gymprogress") "" else profile.optString("authPrefix")
        val query = payload.optJSONObject("query")?.let { params ->
            params.keys().asSequence().joinToString("&") { key ->
                "${encode(key)}=${encode(params.getString(key))}"
            }
        }.orEmpty()
        val request = URL("$base/$path" + if (query.isEmpty()) "" else "?$query").openConnection() as HttpURLConnection
        try {
            request.requestMethod = method
            request.connectTimeout = 15_000
            request.readTimeout = 25_000
            request.instanceFollowRedirects = false
            request.setRequestProperty("Accept", "application/json")
            request.setRequestProperty("User-Agent", "Live-OS-Android/2")
            if (header.isNotEmpty()) request.setRequestProperty(header, prefix + token)
            if (payload.has("body") && !payload.isNull("body")) {
                val body = payload.get("body").toString().toByteArray(Charsets.UTF_8)
                request.doOutput = true
                request.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                request.setFixedLengthStreamingMode(body.size)
                request.outputStream.use { it.write(body) }
            }
            val status = request.responseCode
            if (status !in 200..299) throw DashboardHttpStatus(status, when (status) {
                401 -> "Der API-Schlüssel wurde abgelehnt."
                403 -> "Dem Schlüssel fehlt die Berechtigung."
                404 -> "Der API-Endpunkt ist nicht erreichbar (HTTP 404)."
                409 -> "Der Wert hat sich geändert. Lade die Daten neu."
                422 -> "Die API akzeptiert diesen Wert oder Datentyp nicht."
                else -> "Die API meldet HTTP $status."
            })
            if (status == 204) return null
            val bytes = request.inputStream.use { input ->
                val result = ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (true) {
                    val n = input.read(buffer)
                    if (n < 0) break
                    require(result.size() + n <= 12_000_000) { "Die API-Antwort ist zu groß." }
                    result.write(buffer, 0, n)
                }
                result.toByteArray()
            }
            return if (bytes.isEmpty()) null else JSONTokener(bytes.toString(Charsets.UTF_8)).nextValue()
        } catch (error: IOException) {
            throw IllegalArgumentException("Die API ist nicht erreichbar.", error)
        } finally {
            request.disconnect()
        }
    }

    private fun encode(value: String): String = URLEncoder.encode(value, "UTF-8")
}
