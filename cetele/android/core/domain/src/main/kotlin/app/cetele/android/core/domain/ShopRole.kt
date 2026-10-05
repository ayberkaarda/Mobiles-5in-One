package app.cetele.android.core.domain

/** Membership role inside a shop. The server is authoritative; the app only gates its UI by role. */
enum class ShopRole {
    OWNER,
    STAFF,
}
