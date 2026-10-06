package app.cetele.archfixtures.web

import app.cetele.archfixtures.domain.PlainRepository
import app.cetele.archfixtures.repository.RawLedgerStore

/** Fixture: a web class talking to repositories directly instead of a service. */
class LeakyController(
    private val plainRepository: PlainRepository,
    private val store: RawLedgerStore,
) {
    fun count(): Long = plainRepository.count() + store.size()
}

/** Fixture: a web class that only uses a service. */
class CleanController(
    private val service: CleanService,
) {
    fun count(): Long = service.count()
}

class CleanService {
    fun count(): Long = 0
}
