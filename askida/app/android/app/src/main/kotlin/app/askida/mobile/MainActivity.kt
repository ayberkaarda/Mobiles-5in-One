package app.askida.mobile

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

class MainActivity : FlutterActivity() {
    private var attestChannel: AttestChannel? = null
    private var screenChannel: ScreenChannel? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val messenger = flutterEngine.dartExecutor.binaryMessenger
        attestChannel = AttestChannel(this, messenger)
        screenChannel = ScreenChannel(this, messenger)
    }

    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        attestChannel?.dispose()
        attestChannel = null
        screenChannel?.dispose()
        screenChannel = null
        super.cleanUpFlutterEngine(flutterEngine)
    }
}
