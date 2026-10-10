package app.cetele.android.feature.shop

import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.core.domain.model.ShopPlan
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.domain.validation.FieldCodes
import app.cetele.android.core.domain.validation.FieldError
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.ProblemDetail
import app.cetele.android.core.network.dto.ShopType
import app.cetele.android.core.network.dto.problem.ProblemFieldError
import app.cetele.android.core.network.dto.shops.CreateShopRequest
import app.cetele.android.feature.shop.create.CreateShopViewModel
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.time.Instant
import app.cetele.android.core.domain.model.ShopType as DomainShopType

@OptIn(ExperimentalCoroutinesApi::class)
class CreateShopViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val shops = mockk<ShopRepository>(relaxed = true)

    @BeforeEach fun prepare() {
        Dispatchers.setMain(dispatcher)
    }

    @AfterEach fun finish() {
        Dispatchers.resetMain()
    }

    @Test fun everyRequiredFieldRejectsEmptyInputWithoutRequest() {
        val model = CreateShopViewModel(shops)
        model.submit()
        assertEquals(
            setOf("name", "type", "il", "ilce"),
            model.state.value.errors
                .map { it.field }
                .toSet(),
        )
        assertEquals(
            setOf(FieldCodes.REQUIRED),
            model.state.value.errors
                .map { it.code }
                .toSet(),
        )
        coVerify(exactly = 0) { shops.create(any()) }
    }

    @Test fun lengthAndControlCharacterConstraintsMatchTheWireContract() {
        for (field in listOf("name", "il", "ilce")) {
            val form = ShopForm("Market", ShopType.BAKKAL, "İstanbul", "Kadıköy")
            val long = replace(form, field, "a".repeat(81))
            assertEquals(listOf(FieldError(field, FieldCodes.TOO_LONG)), long.errors())
            val control = replace(form, field, "a\nb")
            assertEquals(listOf(FieldError(field, FieldCodes.INVALID_FORMAT)), control.errors())
            assertEquals(emptyList<FieldError>(), replace(form, field, "a".repeat(80)).errors())
        }
    }

    @Test fun successSendsTrimmedFieldsAndActivatesReturnedShopOnce() =
        runTest(dispatcher) {
            val request = CreateShopRequest("Market", ShopType.BAKKAL, "İstanbul", "Kadıköy")
            coEvery { shops.create(request) } returns ApiResult.Success(shop(), 201)
            val model = CreateShopViewModel(shops)
            model.change(ShopForm(" Market ", ShopType.BAKKAL, " İstanbul ", " Kadıköy "))
            model.submit()
            model.submit()
            advanceUntilIdle()
            assertEquals("shop-one", model.state.value.completedShopId)
            assertFalse(model.state.value.busy)
            coVerify(exactly = 1) { shops.create(request) }
            coVerify(exactly = 1) { shops.setActive("shop-one") }
        }

    @Test fun fieldProblemsAndUnknownSupportCodesRemainVisibleWithoutActivation() =
        runTest(dispatcher) {
            coEvery { shops.create(any()) } returns
                ApiResult.Failure.Problem(
                    ProblemDetail(
                        title = "Invalid",
                        status = 422,
                        code = "validation.failed",
                        traceId = "support-one",
                        errors = listOf(ProblemFieldError("il", "invalid_format")),
                    ),
                )
            val model = CreateShopViewModel(shops)
            model.change(ShopForm("Market", ShopType.MANAV, "İstanbul", "Kadıköy"))
            model.submit()
            advanceUntilIdle()
            assertEquals(listOf(FieldError("il", "invalid_format")), model.state.value.errors)
            assertEquals(
                "support-one",
                model.state.value.failure
                    ?.traceId,
            )
            assertNull(model.state.value.completedShopId)
            coVerify(exactly = 0) { shops.setActive(any()) }
        }

    private fun replace(
        form: ShopForm,
        field: String,
        value: String,
    ): ShopForm =
        when (field) {
            "name" -> form.copy(name = value)
            "il" -> form.copy(il = value)
            else -> form.copy(ilce = value)
        }

    private fun shop() =
        Shop(
            "shop-one",
            "Market",
            DomainShopType.BAKKAL,
            "İstanbul",
            "Kadıköy",
            ShopPlan.FREE,
            ShopRole.OWNER,
            Instant.EPOCH,
        )
}
