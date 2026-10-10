package app.cetele.android.feature.export.pdf

class FontUnavailableException(
    cause: Throwable? = null,
) : IllegalStateException("Statement fonts unavailable", cause)
