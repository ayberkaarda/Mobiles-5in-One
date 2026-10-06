package app.cetele.android.core.data.vault

class InMemoryVault : Vault {
    private val values = mutableMapOf<String, ByteArray>()

    override fun get(key: String): ByteArray? = values[key]?.copyOf()

    override fun put(
        key: String,
        value: ByteArray,
    ) {
        values[key] = value.copyOf()
    }

    override fun remove(key: String) {
        values.remove(key)
    }

    override fun clear() {
        values.clear()
    }

    fun keys(): Set<String> = values.keys.toSet()
}
