package app.cetele.android.core.designsystem

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import java.io.File

/** Reads `cetele/brand/tokens.json`; the path comes from the Gradle test task. */
internal object BrandTokens {
    val root: JsonObject by lazy {
        val path = requireNotNull(System.getProperty("cetele.brandTokens")) { "cetele.brandTokens is not set" }
        Json.parseToJsonElement(File(path).readText()).jsonObject
    }

    fun obj(vararg keys: String): JsonObject = keys.fold(root) { node, key -> node.getValue(key).jsonObject }
}
