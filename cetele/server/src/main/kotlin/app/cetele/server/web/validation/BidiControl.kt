package app.cetele.server.web.validation

fun containsBidiControl(text: String): Boolean =
    text.any {
        it == '\u200E' || it == '\u200F' || it == '\u061C' ||
            it in '\u202A'..'\u202E' || it in '\u2066'..'\u2069'
    }
