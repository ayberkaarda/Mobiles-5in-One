package app.cetele.android.feature.settings

import app.cetele.android.core.domain.model.Shop
import app.cetele.android.core.domain.model.ShopPlan
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.domain.model.ShopType
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.ProblemDetail
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import java.time.Instant

@OptIn(ExperimentalCoroutinesApi::class)
abstract class SettingsTestSupport {
    protected val dispatcher = StandardTestDispatcher()

    @BeforeEach
    fun installMain() {
        Dispatchers.setMain(dispatcher)
    }

    @AfterEach
    fun restoreMain() {
        Dispatchers.resetMain()
    }
}

internal fun problem(
    code: String,
    retry: Int? = null,
): ApiResult.Failure.Problem =
    ApiResult.Failure.Problem(ProblemDetail(title = "Request rejected", status = 403, code = code), retry)

internal fun shop(role: ShopRole = ShopRole.OWNER): Shop =
    Shop("shop", "Dükkân", ShopType.BAKKAL, "İstanbul", "Kadıköy", ShopPlan.FREE, role, Instant.EPOCH)
