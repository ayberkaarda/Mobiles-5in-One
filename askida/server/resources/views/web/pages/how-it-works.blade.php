@use('App\Support\Web\Facts')
@use('App\Support\Web\Format')
<x-web.layout :meta="$meta">
<section class="page-head">
<div class="wrap head-grid">
<x-web.art name="loaf" class="head-art" />
<div>
<nav class="breadcrumbs" aria-label="Sayfa yolu"><ol><li><a href="/">Askıda</a></li><li aria-current="page">Nasıl çalışır</li></ol></nav>
<h1 class="display">Askıda nasıl çalışır?</h1>
<x-web.answer>Bağışçı bir ürünün bedelini uygulamadan öder ve ürün dükkânın askısına eklenir. Askıdan almak isteyen herkes hesap açmadan yakındaki dükkânı seçer, {{ Facts::codeLength() }} karakterlik tek kullanımlık kodu alır ve {{ Facts::codeValidMinutes() }} dakika içinde dükkânda gösterir. Esnaf kodu okutur, ürünü verir; kimin aldığı hiçbir yerde tutulmaz.</x-web.answer>
</div>
</div>
</section>
<section class="section rail-top" aria-labelledby="rail-title">
<div class="wrap">
<h2 id="rail-title" class="headline section-title">Üç adım, tek askı</h2>
<x-web.station-rail />
</div>
</section>
<section class="section" aria-labelledby="steps-title">
<div class="wrap">
<h2 id="steps-title" class="headline section-title">Adım adım</h2>
<ul class="index">
<li>
<h3>Bağışçı</h3>
<ol>
<li>Uygulamada doğrulanmış bir dükkân seçersiniz.</li>
<li>Ürünü ve adedi seçersiniz (en fazla {{ Facts::qtyMax() }}).</li>
<li>Ödemeyi uygulama içinde tamamlarsınız; makbuz e-postayla gelir.</li>
<li>Ürün alındığında anonim bir bildirim alırsınız.</li>
</ol>
</li>
<li>
<h3>Esnaf</h3>
<ol>
<li>Dükkânınızı kaydeder ve belgelerinizi yüklersiniz.</li>
<li>Doğrulama sonrasında ürün kataloğunuzu açarsınız.</li>
<li>Gelen kodu okutur ya da yazarsınız.</li>
<li>Ürünü verir, ödemenizi panelden izlersiniz.</li>
</ol>
</li>
<li>
<h3>Alan</h3>
<ol>
<li>İlk ekranda "Askıdan al" seçeneğini açarsınız.</li>
<li>Yakındaki dükkânlardan ürünü seçersiniz.</li>
<li>Kodu ve QR'ı dükkânda gösterirsiniz.</li>
<li>Ürünü teslim alırsınız; geride kimlik ya da geçmiş kalmaz.</li>
</ol>
</li>
</ul>
</div>
</section>
<section class="section" aria-labelledby="limits-title">
<div class="wrap stack-lg">
<h2 id="limits-title" class="headline">Sınırlar</h2>
<ul class="tag-grid">
<li><p class="hang-tag"><span>Kodun geçerlilik süresi</span> <strong>{{ Facts::codeValidMinutes() }} dakika</strong></p></li>
<li><p class="hang-tag"><span>Kod uzunluğu</span> <strong>{{ Facts::codeLength() }} karakter</strong></p></li>
<li><p class="hang-tag"><span>Bir cihazın günlük alımı</span> <strong>{{ Facts::anonDailyCap() }} ürün</strong></p></li>
<li><p class="hang-tag"><span>Aynı dükkândan günlük alım</span> <strong>{{ Facts::anonShopDailyCap() }} ürün</strong></p></li>
<li><p class="hang-tag"><span>Dükkân arama yarıçapı</span> <strong>{{ Facts::radiusDefaultM() / 1000 }} km (en fazla {{ Facts::radiusMaxM() / 1000 }} km)</strong></p></li>
<li><p class="hang-tag"><span>Bir ödemede bir üründen</span> <strong>en fazla {{ Facts::qtyMax() }} adet</strong></p></li>
<li><p class="hang-tag"><span>Tek ödeme üst sınırı</span> <strong>{{ Format::money(Facts::txCapMinor()) }}</strong></p></li>
<li><p class="hang-tag"><span>Bağışçının günlük üst sınırı</span> <strong>{{ Format::money(Facts::dayCapMinor()) }}</strong></p></li>
</ul>
<p class="footnote">Platform komisyonu {{ Facts::commissionLabel() }}; kesin oran yayın öncesi belirlenir.</p>
<p><a href="/sss">Sıkça sorulan sorular</a></p>
</div>
</section>
<x-web.download-band />
</x-web.layout>
