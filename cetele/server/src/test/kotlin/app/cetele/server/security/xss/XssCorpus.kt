package app.cetele.server.security.xss

/**
 * The stored-XSS payload corpus of security item 16. Every entry is at most 80 characters (the
 * longest free-text field the write paths accept besides notes), contains no leading or trailing
 * whitespace and no control character, so the same value fits a customer name, a shop name, a
 * display name and an entry note. The template-expression entries evaluate to [EVAL_MARKER] if
 * anything ever runs them; a page that contains the marker has evaluated user text.
 */
object XssCorpus {
    /** What the concatenating expression payloads produce if anything evaluates them. */
    const val EVAL_MARKER = "xssevaluated"

    val markup: List<String> =
        listOf(
            "<script>alert(1)</script>",
            "\"><script>alert(1)</script>",
            "'><img src=x onerror=alert(1)>",
            "<img src=x onerror=alert(1)>",
            "<svg onload=alert(1)>",
            "<svg><script>alert(1)</script></svg>",
            "<a href=\"javascript:alert(1)\">x</a>",
            "<iframe src=javascript:alert(1)>",
            "<body onload=alert(1)>",
            "</textarea><script>alert(1)</script>",
            "</title><script>alert(1)</script>",
            "\" onmouseover=\"alert(1)",
            "' onfocus='alert(1)' autofocus='",
            "<style>*{display:none}</style>",
            "<!--<script>alert(1)//-->",
            "<math><mi xlink:href=\"javascript:alert(1)\">x</mi></math>",
            "<meta http-equiv=\"refresh\" content=\"0;url=javascript:alert(1)\">",
            "<base href=\"https://example.invalid/\">",
            "<form action=\"https://example.invalid\"><button>x</button></form>",
        )

    val urls: List<String> =
        listOf(
            "javascript:alert(1)",
            "JaVaScRiPt:alert(document.domain)",
            "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
            "vbscript:msgbox(1)",
        )

    val expressions: List<String> =
        listOf(
            "[[\${'xss'+'evaluated'}]]",
            "[(\${'xss'+'evaluated'})]",
            "\${'xss'+'evaluated'}",
            "#{'xss'+'evaluated'}",
            "*{'xss'+'evaluated'}",
            "@{'xss'+'evaluated'}",
            "__\${'xss'+'evaluated'}__::x",
            "{{'xss'+'evaluated'}}",
            "<%= 'xss'+'evaluated' %>",
            "\${T(java.lang.Runtime).getRuntime().exec('calc')}",
        )

    val encodings: List<String> =
        listOf(
            "&lt;script&gt;alert(1)&lt;/script&gt;",
            "&#60;script&#62;alert(1)&#60;/script&#62;",
            "%3Cscript%3Ealert(1)%3C/script%3E",
            "\\u003cscript\\u003ealert(1)\\u003c/script\\u003e",
        )

    val unicode: List<String> =
        listOf(
            "Ali ‮gnp.exe",
            "⁦<b>izole</b>⁩",
            "<scr​ipt>alert(1)</scr​ipt>",
            "＜script＞alert(1)＜/script＞",
            "﻿<script>alert(1)</script>",
            "¼script¾alert(1)¼/script¾",
            "Çağrı Öztürk İı <i>",
        )

    val csv: List<String> =
        listOf(
            "=HYPERLINK(\"https://example.invalid\",\"x\")",
            "+cmd|' /C calc'!A0",
            "-2+3+cmd|' /C calc'!A0",
            "@SUM(1+1)*cmd|' /C calc'!A0",
        )

    val all: List<String> = markup + urls + expressions + encodings + unicode + csv

    /** Entries that fit a 30-character field (customer tags). */
    val short: List<String> = all.filter { it.length <= 30 }

    /** Entries that a PDF font can carry glyph for glyph (printable ASCII only). */
    val ascii: List<String> = all.filter { value -> value.all { it in ' '..'~' } }

    init {
        check(all.size == all.toSet().size) { "duplicate payloads" }
        all.forEach { value ->
            check(value.length in 1..80) { "payload too long: $value" }
            check(value == value.trim()) { "payload with outer whitespace: $value" }
            check(value.none { Character.isISOControl(it) }) { "payload with a control character" }
        }
    }
}
