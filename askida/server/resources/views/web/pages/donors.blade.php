@use('App\Support\Web\Facts')
@use('App\Support\Web\Format')
<x-web.layout :meta="$meta">
<section class="page-head">
<div class="wrap head-grid">
<x-web.art name="receipt" class="head-art" />
<div>
<nav class="breadcrumbs" aria-label="Sayfa yolu"><ol><li><a href="/">Askıda</a></li><li aria-current="page">Bağışçı</li></ol></nav>
<h1 class="display">Bağışçı için Askıda</h1>
<x-web.answer>Doğrulanmış bir dükkân seçer, bir ekmeği, çorbayı ya da defteri uygulamadan önceden ödersiniz. Ürün dükkânın askısında bekler; dileyen herkes kodla alır. Kimin aldığını görmezsiniz, yalnızca "Askın alındı" diyen anonim bir bildirim gelir. Tek ödeme {{ Format::money(Facts::txCapMinor()) }}, günlük toplam {{ Format::money(Facts::dayCapMinor()) }} ile sınırlıdır; komisyon ayrıca ve açıkça gösterilir.</x-web.answer>
<div class="actions">
<a class="button button-primary" href="#indir">Uygulamayı indir</a>
<a href="/nasil-calisir">Nasıl çalışır?</a>
</div>
</div>
</div>
</section>
<section class="section rail-top" aria-labelledby="steps-title">
<div class="wrap">
<h2 id="steps-title" class="headline section-title">Askıya nasıl bırakırsınız</h2>
<ol class="steps">
<li><strong>Dükkân</strong> Yakınınızdaki doğrulanmış dükkânlar mesafeye göre sıralanır.</li>
<li><strong>Ürün</strong> Ürünü ve adedi seçersiniz; bir ödemede bir üründen en fazla {{ Facts::qtyMax() }} adet olur.</li>
<li><strong>Ödeme</strong> Ödemeyi uygulama içinde güvenli ödeme sayfasında tamamlarsınız; makbuz e-postayla gelir.</li>
<li><strong>Askı</strong> Ürün dükkânın askısına eklenir ve bağış geçmişinizde görünür.</li>
</ol>
</div>
</section>
<section class="section" aria-labelledby="limits-title">
<div class="wrap split">
<h2 id="limits-title" class="headline">Sınırlar ve ücretler</h2>
<dl class="facts-list">
<dt>Tek ödeme</dt><dd>En fazla {{ Format::money(Facts::txCapMinor()) }}.</dd>
<dt>Günlük toplam</dt><dd>Bir bağışçı için en fazla {{ Format::money(Facts::dayCapMinor()) }}.</dd>
<dt>Komisyon</dt><dd>{{ Facts::commissionLabel() }}; kesin oran yayın öncesi belirlenir. Ürün bedelinin esnafa ulaşan kısmı panelde şeffaf görünür.</dd>
<dt>Para akışı</dt><dd>Ödeme ödeme kuruluşu üzerinden esnafa gider; Askıda parayı tutmaz.</dd>
</dl>
</div>
</section>
<section class="section" aria-labelledby="privacy-title">
<div class="wrap">
<h2 id="privacy-title" class="headline section-title">Gizlilik iki yönlüdür</h2>
<p class="statement">Alan kişiyle ilgili hiçbir bilgi size gösterilmez; sizin kimliğiniz de alana ya da esnafa gösterilmez.</p>
<p class="lead">Uygulamada yalnızca ürün adedi olarak sayılan toplu etkiyi görürsünüz. Sayılar kişi değil ürün sayar. <a href="/etki">Etki sayfası</a></p>
</div>
</section>
<x-web.download-band id="indir" />
</x-web.layout>
