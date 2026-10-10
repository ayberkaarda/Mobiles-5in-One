package app.cetele.android.core.data.media

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import app.cetele.android.core.domain.validation.Limits
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import javax.inject.Inject

class ImageCompressor
    @Inject
    constructor() {
        suspend fun compress(file: File): CompressedPhoto =
            withContext(Dispatchers.IO) {
                try {
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeFile(file.path, bounds)
                    require(bounds.outWidth > 0 && bounds.outHeight > 0) { "Invalid image" }
                    var sample = 1
                    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= Limits.PHOTO_MAX_SIDE) sample *= 2
                    val bitmap =
                        requireNotNull(
                            BitmapFactory.decodeFile(
                                file.path,
                                BitmapFactory.Options().apply {
                                    inSampleSize =
                                        sample
                                },
                            ),
                        )
                    val steps =
                        CompressionPlan.steps(
                            bitmap.width,
                            bitmap.height,
                            file.length().coerceAtMost(Int.MAX_VALUE.toLong()).toInt(),
                        )
                    val scale = steps.first().scale
                    val scaled =
                        Bitmap.createScaledBitmap(
                            bitmap,
                            (bitmap.width * scale).toInt().coerceAtLeast(1),
                            (
                                bitmap.height *
                                    scale
                            ).toInt().coerceAtLeast(1),
                            true,
                        )
                    try {
                        val bytes =
                            steps.firstNotNullOfOrNull { step ->
                                val encoded =
                                    ByteArrayOutputStream().use { out ->
                                        check(scaled.compress(Bitmap.CompressFormat.JPEG, step.quality, out))
                                        out.toByteArray()
                                    }
                                encoded.takeIf { it.size <= Limits.PHOTO_MAX_BYTES }
                            } ?: error("Image exceeds upload limit")
                        CompressedPhoto(bytes, scaled.width, scaled.height)
                    } finally {
                        if (scaled !== bitmap) scaled.recycle()
                        bitmap.recycle()
                    }
                } finally {
                    check(file.delete() || !file.exists()) { "Capture could not be removed" }
                }
            }
    }
