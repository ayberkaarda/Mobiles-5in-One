package app.cetele.android.feature.settings

import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.api.MeApi
import app.cetele.android.core.network.dto.me.Me
import app.cetele.android.core.network.dto.me.MePatchBody
import app.cetele.android.feature.settings.profile.ProfileViewModel
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ProfileViewModelBidiTest : SettingsTestSupport() {
    private val api = mockk<MeApi>()
    private val controls = listOf('\u200E', '\u200F', '\u061C') + ('\u202A'..'\u202E') + ('\u2066'..'\u2069')

    @Test
    fun displayNameWithBidiControlIsRejectedBeforeTheRequest() =
        runTest(dispatcher) {
            controls.forEach { control ->
                val model = ProfileViewModel(api)
                model.name("Ali${control}Usta")
                model.save().join()
                assertTrue(model.state.value.invalidName)
            }
            coVerify(exactly = 0) { api.patch(any()) }
        }

    @Test
    fun turkishAndJoinedEmojiDisplayNamesAreSent() =
        runTest(dispatcher) {
            listOf("Çağrı Şİşçi", "Ali 👩\u200D💻").forEach { name ->
                coEvery { api.patch(MePatchBody(name)) } returns
                    ApiResult.Success(Me("user", "+905550000000", name, emptyList()), 200)
                val model = ProfileViewModel(api)
                model.name(name)
                model.save().join()
                assertFalse(model.state.value.invalidName)
                assertTrue(model.state.value.saved)
                coVerify(exactly = 1) { api.patch(MePatchBody(name)) }
            }
        }
}
