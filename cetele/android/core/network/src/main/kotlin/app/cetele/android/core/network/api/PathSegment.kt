package app.cetele.android.core.network.api

import io.ktor.http.encodeURLParameter

internal fun segment(value: String): String = value.encodeURLParameter(spaceToPlus = false)
