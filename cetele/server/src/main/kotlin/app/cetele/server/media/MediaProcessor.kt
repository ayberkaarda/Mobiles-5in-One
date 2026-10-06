package app.cetele.server.media

import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import net.coobird.thumbnailator.Thumbnails
import org.apache.tika.Tika
import org.springframework.stereotype.Component
import java.awt.Color
import java.awt.image.BufferedImage
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import javax.imageio.ImageIO

data class ProcessedImage(
    val bytes: ByteArray,
    val width: Int,
    val height: Int,
)

@Component
class MediaProcessor {
    fun process(bytes: ByteArray): ProcessedImage {
        try {
            if (Tika().detect(bytes) !in setOf("image/jpeg", "image/webp")) invalid()
            val image =
                ImageIO.createImageInputStream(ByteArrayInputStream(bytes)).use { input ->
                    val readers = ImageIO.getImageReaders(input)
                    if (!readers.hasNext()) invalid()
                    val reader = readers.next()
                    try {
                        reader.setInput(input, true, true)
                        val width = reader.getWidth(0)
                        val height = reader.getHeight(0)
                        if (width !in 1..6000 || height !in 1..6000) invalid()
                        reader.read(0) ?: invalid()
                    } finally {
                        reader.dispose()
                    }
                }
            val rgb = BufferedImage(image.width, image.height, BufferedImage.TYPE_INT_RGB)
            val graphics = rgb.createGraphics()
            try {
                graphics.color = Color.WHITE
                graphics.fillRect(0, 0, rgb.width, rgb.height)
                graphics.drawImage(image, 0, 0, null)
            } finally {
                graphics.dispose()
            }
            val resized = Thumbnails.of(rgb).size(minOf(1600, rgb.width), minOf(1600, rgb.height)).asBufferedImage()
            val output = ByteArrayOutputStream()
            Thumbnails
                .of(resized)
                .scale(1.0)
                .outputFormat("jpg")
                .outputQuality(0.85)
                .toOutputStream(output)
            return ProcessedImage(output.toByteArray(), resized.width, resized.height)
        } catch (exception: ProblemException) {
            throw exception
        } catch (exception: Exception) {
            invalid()
        }
    }

    private fun invalid(): Nothing = throw ProblemException(ProblemCode.MEDIA_INVALID)
}
