package org.lifeos.beta

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec


internal data class PersonalApiSettings(val baseUrl: String, val writeToken: String)


internal class SecureApiSettings(private val context: Context) {
    private val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    @Synchronized
    fun save(writeToken: String) {
        val token = validateWriteToken(writeToken)
        val profile = requireNotNull(loadDashboardProfile()) {
            "Hinterlege zuerst eine API-Basisadresse in den Einstellungen."
        }
        require(profile.optString("protocol") == "gymprogress" && profile.optBoolean("healthUpload")) {
            "Aktiviere Health Connect für die ausgewählte Verbindung in den Einstellungen."
        }
        saveDashboardProfile(profile.put("writeToken", token))
    }

    private fun putEncrypted(field: String, text: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val ciphertext = cipher.doFinal(text.toByteArray(Charsets.UTF_8))
        val stored = Base64.encodeToString(cipher.iv + ciphertext, Base64.NO_WRAP)
        check(preferences.edit().putString(field, stored).commit()) {
            "Der API-Schlüssel konnte nicht sicher gespeichert werden."
        }
    }

    private fun getEncrypted(field: String): String? {
        val encoded = preferences.getString(field, null) ?: return null
        return try {
            val stored = Base64.decode(encoded, Base64.NO_WRAP)
            require(stored.size > IV_SIZE_BYTES)
            val iv = stored.copyOfRange(0, IV_SIZE_BYTES)
            val ciphertext = stored.copyOfRange(IV_SIZE_BYTES, stored.size)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
            cipher.doFinal(ciphertext).toString(Charsets.UTF_8)
        } catch (error: Exception) {
            throw IllegalStateException("Der gespeicherte API-Schlüssel ist beschädigt.", error)
        }
    }

    fun loadDashboardProfile(): JSONObject? = getEncrypted(KEY_DASHBOARD_PROFILE)?.let(::JSONObject)

    fun saveDashboardProfile(profile: JSONObject) = putEncrypted(KEY_DASHBOARD_PROFILE, profile.toString())

    fun load(): PersonalApiSettings? = DashboardConnection(context).uploadSettings()

    fun isConfigured(): Boolean = load() != null

    private fun getOrCreateKey(): SecretKey = synchronized(KEY_LOCK) {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return@synchronized it }
        KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build(),
            )
            generateKey()
        }
    }

    companion object {
        private const val PREFERENCES_NAME = "personal_api_settings"
        private const val KEY_DASHBOARD_PROFILE = "encrypted_dashboard_profile"
        private val KEY_LOCK = Any()
        private const val KEY_ALIAS = "gymprogress-personal-api-write-key"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val IV_SIZE_BYTES = 12
    }
}
