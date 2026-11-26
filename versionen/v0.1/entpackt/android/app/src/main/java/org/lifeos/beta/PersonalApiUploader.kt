package org.lifeos.beta

import org.json.JSONObject
import org.json.JSONArray
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate


internal class PersonalApiUploader(private val settings: PersonalApiSettings) {
    fun uploadMinimumPulse(minima: Map<LocalDate, Long>): Int {
        if (minima.isEmpty()) return 0
        val records = JSONArray()
        minima.forEach { (day, bpm) ->
            records.put(JSONObject().put("date", day.toString())
                .put("namespace", "fitness.health").put("metric", "min_heart_rate_bpm")
                .put("value", bpm).put("source", "android-health-connect"))
        }
        upload(JSONObject().put("schema_version", 1).put("records", records))
        return minima.size
    }

    fun upload(payload: JSONObject): String {
        val baseUrl = validateApiBaseUrl(settings.baseUrl)
        val connection = URL("$baseUrl/ingest.php").openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            connection.doOutput = true
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.setRequestProperty("X-GymProgress-Key", settings.writeToken)
            connection.setRequestProperty("User-Agent", "GymProgress-Android/0.19.2")
            val body = payload.toString().toByteArray(Charsets.UTF_8)
            require(body.size <= MAX_UPLOAD_BYTES) { "Der Health-Upload ist zu groß." }
            connection.setFixedLengthStreamingMode(body.size)
            connection.outputStream.use { it.write(body) }
            val status = connection.responseCode
            if (status != HttpURLConnection.HTTP_OK) {
                throw IOException("Der API-Server antwortete mit HTTP $status.")
            }
            val response = connection.inputStream.use(::readLimited)
            parseManualAcknowledgement(JSONObject(response.toString(Charsets.UTF_8)))
        } finally {
            connection.disconnect()
        }
    }

    private fun readLimited(input: java.io.InputStream): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(4096)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            if (output.size() + count > MAX_RESPONSE_BYTES) {
                throw IOException("Die API-Serverantwort ist unerwartet groß.")
            }
            output.write(buffer, 0, count)
        }
        return output.toByteArray()
    }

    companion object {
        private const val MAX_UPLOAD_BYTES = 1_500_000
        private const val MAX_RESPONSE_BYTES = 128_000
    }
}
