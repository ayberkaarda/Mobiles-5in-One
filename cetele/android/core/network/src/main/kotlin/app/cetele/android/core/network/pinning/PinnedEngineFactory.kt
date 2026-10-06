package app.cetele.android.core.network.pinning

import app.cetele.android.core.network.ApiConfig
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.okhttp.OkHttp
import okhttp3.CertificatePinner
import okhttp3.OkHttpClient
import java.net.URI

object PinnedEngineFactory {
    fun client(
        config: ApiConfig,
        pins: CertificatePins,
    ): OkHttpClient {
        val builder = OkHttpClient.Builder()
        if (pins.enabled) {
            val host = URI(config.baseUrl).host
            val pinner = CertificatePinner.Builder()
            pins.pins.forEach { pin -> pinner.add(host, pin) }
            builder.certificatePinner(pinner.build())
        }
        return builder.build()
    }

    fun create(
        config: ApiConfig,
        pins: CertificatePins,
    ): HttpClientEngine = OkHttp.create { preconfigured = client(config, pins) }
}
