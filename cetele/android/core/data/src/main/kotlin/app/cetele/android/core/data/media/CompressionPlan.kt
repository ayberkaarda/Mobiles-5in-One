package app.cetele.android.core.data.media

import app.cetele.android.core.domain.validation.Limits

data class CompressedPhoto(
    val bytes: ByteArray,
    val width: Int,
    val height: Int,
)

data class Step(
    val scale: Float,
    val quality: Int,
)

object CompressionPlan {
    val qualities: List<Int> = listOf(85, 75, 65)

    fun steps(
        width: Int,
        height: Int,
        bytes: Int,
    ): List<Step> {
        require(width > 0 && height > 0 && bytes >= 0)
        val scale = minOf(1f, Limits.PHOTO_MAX_SIDE.toFloat() / maxOf(width, height))
        return qualities.map { Step(scale, it) }
    }
}
