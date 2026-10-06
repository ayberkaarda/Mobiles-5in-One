package app.cetele.server.statements.web

import app.cetele.server.auth.ratelimit.RateLimit
import app.cetele.server.auth.ratelimit.RateLimiter
import app.cetele.server.security.CurrentUser
import app.cetele.server.statements.StatementAssembler
import app.cetele.server.statements.StatementLinkRequest
import app.cetele.server.statements.StatementLinkResponse
import app.cetele.server.statements.StatementPdf
import app.cetele.server.statements.StatementService
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import io.swagger.v3.oas.annotations.Parameter
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

@RestController
class StatementController(
    private val service: StatementService,
    private val assembler: StatementAssembler,
    private val pdf: StatementPdf,
    private val limits: RateLimiter,
) {
    @PostMapping("/v1/shops/{shopId}/statement-links")
    @PreAuthorize("@perm.can(#shopId, 'STATEMENT_LINK_CREATE')")
    fun issue(
        @PathVariable shopId: UUID,
        @Parameter(hidden = true) @AuthenticationPrincipal caller: CurrentUser,
        @RequestBody body: StatementLinkRequest,
    ): ResponseEntity<StatementLinkResponse> = ResponseEntity.status(201).body(service.issue(shopId, caller, body))

    @GetMapping("/v1/shops/{shopId}/customers/{customerId}/statement.pdf", produces = [MediaType.APPLICATION_PDF_VALUE])
    @PreAuthorize("@perm.can(#shopId, 'LEDGER_READ') and @perm.can(#shopId, 'CUSTOMER_READ')")
    fun download(
        @PathVariable shopId: UUID,
        @PathVariable customerId: UUID,
        @Parameter(hidden = true) @AuthenticationPrincipal caller: CurrentUser,
    ): ResponseEntity<ByteArray> {
        limits.consume(RateLimit.STATEMENT_PDF_USER, caller.userId.toString())
        val data = assembler.assemble(shopId, customerId) ?: throw ProblemException(ProblemCode.NOT_FOUND)
        return ResponseEntity
            .ok()
            .contentType(MediaType.APPLICATION_PDF)
            .header(
                HttpHeaders.CONTENT_DISPOSITION,
                "attachment; filename=\"hesap-dokumu.pdf\"; filename*=UTF-8''hesap-d%C3%B6k%C3%BCm%C3%BC.pdf",
            ).body(pdf.render(data))
    }
}
