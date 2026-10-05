package app.cetele.server.tenancy

import org.springframework.data.repository.NoRepositoryBean
import org.springframework.data.repository.Repository
import java.util.UUID

/**
 * Base of every repository for [TenantScoped] rows. It deliberately inherits nothing from
 * `CrudRepository`: there is no `findById`, `findAll` or `deleteById` that could read or touch a
 * row of another shop. Every query method declared by a sub-interface takes a `shopId` parameter
 * (architecture rule 2). Writing goes through [save] and [delete], whose argument already carries
 * its shop.
 */
@NoRepositoryBean
interface TenantRepository<T : TenantScoped> : Repository<T, UUID> {
    fun <S : T> save(entity: S): S

    fun delete(entity: T)
}
