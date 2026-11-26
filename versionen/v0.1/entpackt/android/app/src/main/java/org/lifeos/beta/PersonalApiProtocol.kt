package org.lifeos.beta

import org.json.JSONObject
import java.time.LocalDate


internal fun validateApiBaseUrl(value: String): String = normalizeDashboardUrl(value)


internal fun validateWriteToken(value: String): String {
    val token = value.trim()
    require(Regex("^gpw_[A-Za-z0-9_-]{8,32}\\.[A-Za-z0-9_-]{32,128}$").matches(token)) {
        "Der Handy-Schreibschlüssel ist ungültig."
    }
    return token
}


internal fun parseManualAcknowledgement(response: JSONObject): String {
    val raw = response.optJSONArray("manual_ack")
        ?: throw IllegalArgumentException("Die Serverantwort enthält keine Bestätigungen.")
    val result = mutableListOf<String>()
    val days = mutableSetOf<LocalDate>()
    for (index in 0 until raw.length()) {
        val token = raw.optString(index, "")
        val match = Regex("^(\\d{4}-\\d{2}-\\d{2}):([1-9]\\d*)$").matchEntire(token)
            ?: throw IllegalArgumentException("Eine Serverbestätigung ist ungültig.")
        val day = runCatching { LocalDate.parse(match.groupValues[1]) }.getOrElse {
            throw IllegalArgumentException("Eine Serverbestätigung hat ein ungültiges Datum.")
        }
        require(days.add(day)) { "Ein bestätigtes Datum kommt doppelt vor." }
        match.groupValues[2].toLongOrNull()
            ?: throw IllegalArgumentException("Eine Serverbestätigung hat eine ungültige Revision.")
        result += token
    }
    return result.joinToString(",")
}
