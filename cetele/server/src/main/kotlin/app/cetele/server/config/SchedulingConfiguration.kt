package app.cetele.server.config

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Configuration
import org.springframework.scheduling.annotation.EnableScheduling

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(prefix = "cetele.jobs", name = ["enabled"], havingValue = "true", matchIfMissing = true)
@EnableScheduling
class SchedulingConfiguration
