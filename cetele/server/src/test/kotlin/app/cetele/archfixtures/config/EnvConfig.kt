package app.cetele.archfixtures.config

/** Fixture: reading the environment is allowed inside a config package. */
class EnvConfig {
    fun all(): Map<String, String> = System.getenv()
}
