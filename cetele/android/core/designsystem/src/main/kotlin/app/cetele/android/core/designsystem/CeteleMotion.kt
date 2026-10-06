package app.cetele.android.core.designsystem

import androidx.compose.animation.core.CubicBezierEasing

@Suppress("ktlint:standard:property-naming")
object CeteleMotion {
    const val instant = 0
    const val short = 100
    const val medium = 200
    const val long = 300
    const val emphasized = 450

    val durations =
        mapOf(
            "instant" to instant,
            "short" to short,
            "medium" to medium,
            "long" to long,
            "emphasized" to emphasized,
        )
    val easingPoints =
        mapOf(
            "standard" to listOf(0.2f, 0f, 0f, 1f),
            "emphasizedDecelerate" to listOf(0.05f, 0.7f, 0.1f, 1f),
            "emphasizedAccelerate" to listOf(0.3f, 0f, 0.8f, 0.15f),
        )
    val standard = CubicBezierEasing(0.2f, 0f, 0f, 1f)
    val emphasizedDecelerate = CubicBezierEasing(0.05f, 0.7f, 0.1f, 1f)
    val emphasizedAccelerate = CubicBezierEasing(0.3f, 0f, 0.8f, 0.15f)

    fun duration(
        milliseconds: Int,
        reducedMotion: Boolean,
    ): Int = if (reducedMotion) instant else milliseconds
}
