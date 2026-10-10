plugins {
    alias(libs.plugins.cetele.android.feature)
}

dependencies {
    // The data module exposes its database type to the sync issue store, whose supertype lives in Room.
    implementation(libs.androidx.room.runtime)
    testImplementation(libs.kotlinx.coroutines.test)
}
