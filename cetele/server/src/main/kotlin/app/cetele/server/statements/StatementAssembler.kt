package app.cetele.server.statements

import app.cetele.server.config.CeteleTime
import app.cetele.server.ledger.customer.CustomerRepository
import app.cetele.server.ledger.entry.LedgerEntryRepository
import app.cetele.server.ledger.money.Balance
import app.cetele.server.ledger.money.BalanceLine
import app.cetele.server.ledger.money.MoneyFormat
import app.cetele.server.tenancy.shop.ShopRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.format.DateTimeFormatter
import java.util.UUID

data class StatementRow(
    val date: String,
    val description: String,
    val debt: String,
    val payment: String,
    val balance: String,
    val reversed: Boolean,
)

data class StatementData(
    val shopName: String,
    val customerName: String,
    val date: String,
    val rows: List<StatementRow>,
    val balance: String,
) {
    val footer: String get() = "Bu döküm $shopName tarafından Çetele ile hazırlanmıştır."
}

@Service
class StatementAssembler(
    private val shops: ShopRepository,
    private val customers: CustomerRepository,
    private val entries: LedgerEntryRepository,
    private val clock: Clock,
) {
    @Transactional(readOnly = true)
    fun assemble(
        shopId: UUID,
        customerId: UUID,
    ): StatementData? {
        val shop = shops.findActive(shopId) ?: return null
        val customer = customers.findActive(shopId, customerId) ?: return null
        var running = 0L
        val rows =
            entries.findAllByShopIdAndCustomerIdOrderByOccurredOnAscCreatedAtAsc(shopId, customerId).map { entry ->
                running =
                    Math.addExact(running, Balance.of(listOf(BalanceLine(entry.type, entry.amountMinor, entry.reverses, entry.reversedBy))))
                StatementRow(
                    entry.occurredOn.format(DATE),
                    if (entry.reverses != null) "Düzeltme" else entry.note ?: if (entry.type == "DEBT") "Borç" else "Tahsilat",
                    if (entry.type == "DEBT") MoneyFormat.format(entry.amountMinor) else "",
                    if (entry.type == "PAYMENT") MoneyFormat.format(entry.amountMinor) else "",
                    MoneyFormat.format(running),
                    entry.reversedBy != null,
                )
            }
        return StatementData(shop.name, customer.name, CeteleTime.today(clock).format(DATE), rows, MoneyFormat.format(running))
    }

    companion object {
        private val DATE = DateTimeFormatter.ofPattern("dd.MM.yyyy")
    }
}
