package app.cetele.android.feature.export

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.repository.CustomerRepository
import app.cetele.android.core.data.repository.LedgerRepository
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.designsystem.copy.ProblemCodeText
import app.cetele.android.core.domain.ledger.StatementRows
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.domain.time.CeteleClock
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.api.StatementsApi
import app.cetele.android.feature.export.csv.EntriesCsvWriter
import app.cetele.android.feature.export.pdf.FontUnavailableException
import app.cetele.android.feature.export.pdf.PdfFonts
import app.cetele.android.feature.export.pdf.StatementPdfWriter
import app.cetele.android.feature.export.share.ExportFiles
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException
import java.time.Clock
import javax.inject.Inject

@Suppress("TooManyFunctions")
@HiltViewModel
class ExportViewModel
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
        private val shops: ShopRepository,
        private val customers: CustomerRepository,
        private val ledger: LedgerRepository,
        private val statements: StatementsApi,
        private val clock: Clock,
    ) : ViewModel() {
        private val target = MutableStateFlow<ExportTarget?>(null)
        private val mutableSnapshot = MutableStateFlow(ExportSnapshot())
        val snapshot = mutableSnapshot.asStateFlow()
        private val mutableAction = MutableStateFlow(ExportActionState())
        val action = mutableAction.asStateFlow()
        private val attachments = Channel<ExportAttachment>(Channel.BUFFERED)
        val shares = attachments.receiveAsFlow()
        private val files = ExportFiles(context.cacheDir)
        private var exportJob: Job? = null

        init {
            viewModelScope.launch {
                combine(target, shops.observeActive()) { request, shop -> request to shop }
                    .collectLatest { (request, shop) ->
                        exportJob?.cancel()
                        mutableSnapshot.value = ExportSnapshot(shop = shop, loading = request != null && shop != null)
                        mutableAction.value = ExportActionState()
                        if (request != null && shop != null) observe(request, shop)
                    }
            }
        }

        fun openStatement(customerId: String) {
            target.value = ExportTarget(customerId)
        }

        fun openAll() {
            target.value = ExportTarget(null)
        }

        private suspend fun observe(
            request: ExportTarget,
            shop: Shop,
        ) {
            if (request.customerId != null) {
                combine(
                    customers.observe(shop.id, request.customerId),
                    ledger.observeEntries(shop.id, request.customerId),
                ) { customer, entries ->
                    ExportSnapshot(
                        shop,
                        customer?.takeIf { it.deletedAt == null },
                        StatementRows.build(entries),
                        loading = false,
                        available = customer != null && customer.deletedAt == null,
                    )
                }.catch { mutableSnapshot.value = ExportSnapshot(shop = shop, loading = false) }
                    .collect { mutableSnapshot.value = it }
            } else if (shop.role == ShopRole.OWNER) {
                combine(customers.observeList(shop.id), ledger.observeAll(shop.id)) { people, entries ->
                    csvSnapshot(customers, shop, people, entries)
                }.catch { mutableSnapshot.value = ExportSnapshot(shop = shop, loading = false) }
                    .collect { mutableSnapshot.value = it }
            } else {
                mutableSnapshot.value = ExportSnapshot(shop = shop, loading = false)
            }
        }

        fun share() = perform(server = false)

        fun download() {
            if (mutableAction.value.fontsUnavailable) perform(server = true)
        }

        fun sharingFailed() {
            mutableAction.value = mutableAction.value.copy(errorRes = R.string.export_common_error)
        }

        private fun perform(server: Boolean) {
            val data = snapshot.value
            val shop = data.shop
            val request = target.value
            if (request == null || shop == null || !canExport(data, request, busy = action.value.busy)) return
            mutableAction.value = mutableAction.value.copy(busy = true, errorRes = null, traceId = null)
            exportJob =
                viewModelScope.launch {
                    try {
                        deliver(server, data, shop, request)
                    } catch (error: CancellationException) {
                        throw error
                    } catch (ignored: FontUnavailableException) {
                        mutableAction.value =
                            ExportActionState(fontsUnavailable = true, errorRes = R.string.export_statement_fonts_error)
                    } catch (ignored: IOException) {
                        mutableAction.value = mutableAction.value.copy(errorRes = R.string.export_common_error)
                    } catch (ignored: IllegalStateException) {
                        mutableAction.value = mutableAction.value.copy(errorRes = R.string.export_common_error)
                    } finally {
                        mutableAction.value = mutableAction.value.copy(busy = false)
                    }
                }
        }

        private suspend fun deliver(
            server: Boolean,
            data: ExportSnapshot,
            shop: Shop,
            request: ExportTarget,
        ) {
            if (!authorized(shop, request)) return
            val attachment =
                if (server) downloadPdf(data) else withContext(Dispatchers.IO) { writeLocal(data, request) }
            if (attachment == null) return
            if (authorized(shop, request)) attachments.send(attachment) else attachment.file.delete()
        }

        private suspend fun authorized(
            shop: Shop,
            request: ExportTarget,
        ): Boolean {
            val current = shops.observeActive().first() ?: return false
            return current.id == shop.id && target.value == request &&
                (request.customerId != null || current.role == ShopRole.OWNER)
        }

        private fun writeLocal(
            data: ExportSnapshot,
            request: ExportTarget,
        ): ExportAttachment {
            val shop = requireNotNull(data.shop)
            val date = CeteleClock.today(clock)
            if (request.customerId != null) {
                val fonts = PdfFonts.load(context)
                val writer = StatementPdfWriter(context, files)
                val file = writer.write(shop, requireNotNull(data.customer), data.rows, date, fonts)
                return ExportAttachment(file, PDF_MIME)
            }
            val file = files.csv(shop.name, date)
            var complete = false
            try {
                file.outputStream().use { EntriesCsvWriter.write(data.csvRows, it) }
                complete = true
                return ExportAttachment(file, CSV_MIME)
            } finally {
                if (!complete) file.delete()
            }
        }

        private suspend fun downloadPdf(data: ExportSnapshot): ExportAttachment? {
            val shop = requireNotNull(data.shop)
            val customer = requireNotNull(data.customer)
            return when (val result = statements.pdf(shop.id, customer.id)) {
                is ApiResult.Success -> {
                    withContext(Dispatchers.IO) {
                        val bytes = result.value
                        val signature = bytes.take(PDF_SIGNATURE.length).toByteArray().toString(Charsets.US_ASCII)
                        if (signature != PDF_SIGNATURE) throw IOException("Invalid statement document")
                        val file = files.pdf(shop.name, customer.name, CeteleClock.today(clock))
                        var complete = false
                        try {
                            file.outputStream().use { it.write(bytes) }
                            complete = true
                            ExportAttachment(file, PDF_MIME)
                        } finally {
                            if (!complete) file.delete()
                        }
                    }
                }

                is ApiResult.Failure -> {
                    val problem = result as? ApiResult.Failure.Problem
                    mutableAction.value =
                        mutableAction.value.copy(
                            errorRes = ProblemCodeText.resId(result.problemCode) ?: R.string.export_common_error,
                            traceId = problem?.problem?.traceId,
                        )
                    null
                }
            }
        }

        private companion object {
            const val PDF_MIME = "application/pdf"
            const val CSV_MIME = "text/csv"
            const val PDF_SIGNATURE = "%PDF-"
        }
    }
