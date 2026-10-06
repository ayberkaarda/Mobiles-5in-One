package app.cetele.server.tenancy

import app.cetele.server.tenancy.shop.ShopPlan

data class PlanLimits(
    val customers: Int,
    val photosPerMonth: Int,
    val smsPerMonth: Int,
) {
    companion object {
        fun of(plan: ShopPlan): PlanLimits =
            when (plan) {
                ShopPlan.FREE -> PlanLimits(100, 200, 30)
                ShopPlan.PRO -> PlanLimits(Int.MAX_VALUE, 2000, 500)
            }
    }
}
