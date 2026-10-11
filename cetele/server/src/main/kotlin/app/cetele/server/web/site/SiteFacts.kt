package app.cetele.server.web.site

import app.cetele.server.tenancy.PlanLimits
import app.cetele.server.tenancy.shop.ShopPlan

/**
 * Product facts repeated outside the content files (JSON-LD, `llms.txt`). They restate the
 * product specification and the content; the plan numbers come from [PlanLimits] itself, so the
 * public pages can never promise a limit the server does not enforce.
 */
object SiteFacts {
    const val NAME = "Çetele"
    const val APP_NAME = "Çetele: Veresiye Defteri"
    const val APPLICATION_ID = "app.cetele.android"
    const val TAGLINE = "Veresiyeyi unutma, Çetele'ye yaz."
    const val LANGUAGE = "tr-TR"
    const val CURRENCY = "TRY"
    const val OG_IMAGE = "/assets/site/og-cetele.png"
    const val OG_IMAGE_WIDTH = 1200
    const val OG_IMAGE_HEIGHT = 630
    const val OG_IMAGE_ALT = "Çetele logosu: çentikli Ç harfi ve Çetele yazısı"
    const val LOGO = "/assets/site/cetele-icon.png"
    const val LOGO_SIZE = 1024

    const val AUDIENCE =
        "Bakkal, manav, kasap, berber, kahvehane ve küçük esnaf; dükkân sahibi ve çalışanları, " +
            "orta ve giriş seviyesi Android telefonlar, kesintili internet bağlantısı."

    const val STATUS =
        "Çetele tek geliştiricinin portföy projesidir; şirket, adres veya vergi numarası yoktur. " +
            "Android uygulaması Google Play'de yayına hazırlanıyor."

    const val PRICE_NOTE = "Pro fiyatları Google Play'de gösterilir; bu projede sabit bir fiyat yoktur."

    val FEATURES: List<String> =
        listOf(
            "İnternet olmadan çalışır; bağlantı gelince kayıtları eşitler.",
            "Dükkân sahibi ve çalışan rolleri; çalışan davet ile eklenir.",
            "Müşteriler, borçlar ve tahsilatlar Türk lirası ile tutulur.",
            "Kayıtlar değiştirilmez; hata ters kayıtla düzeltilir.",
            "WhatsApp ile imzalı hesap dökümü bağlantısı paylaşılır.",
            "SMS hatırlatması yalnızca onayı kayıtlı müşterilere, aylık kota ile gönderilir.",
            "Hesap dökümü PDF, kayıtlar CSV olarak alınır.",
            "Fiş ve not fotoğrafları kayda eklenir.",
            "PIN ve biyometrik kilit.",
        )

    val free: PlanLimits get() = PlanLimits.of(ShopPlan.FREE)
    val pro: PlanLimits get() = PlanLimits.of(ShopPlan.PRO)

    fun customers(limits: PlanLimits): String = if (limits.customers == Int.MAX_VALUE) "sınırsız müşteri" else "${limits.customers} müşteri"

    fun freeSummary(): String = "Free: ücretsiz; ${customers(free)}, ayda ${free.photosPerMonth} fotoğraf, ayda ${free.smsPerMonth} SMS."

    fun proSummary(): String =
        "Pro: Google Play aboneliği (aylık veya yıllık); ${customers(pro)}, ayda ${pro.photosPerMonth} fotoğraf, " +
            "ayda ${pro.smsPerMonth} SMS ve öncelikli eşitleme. $PRICE_NOTE"
}
