package app.cetele.android.feature.export

data class ExportActionState(
    val busy: Boolean = false,
    val fontsUnavailable: Boolean = false,
    val errorRes: Int? = null,
    val traceId: String? = null,
)
