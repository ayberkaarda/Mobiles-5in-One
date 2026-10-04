@use('App\Support\Web\Facts')
@use('App\Support\Web\Format')
<x-web.layout :meta="$meta">
<section class="page-head">
<div class="wrap">
<nav class="breadcrumbs" aria-label="Sayfa yolu"><ol><li><a href="/">Askıda</a></li><li aria-current="page">Nasıl çalışır</li></ol></nav>
<h1 class="display">Askıda nasıl çalışır?</h1>
<x-web.answer>Bağışçı bir ürünün bedelini uygulamadan öder ve ürün dükkânın askısına eklenir. Askıdan almak isteyen herkes hesap açmadan yakındaki dükkânı seçer, {{ Facts::codeLength() }} karakterlik tek kullanımlık kodu alır ve {{ Facts::codeValidMinutes() }} dakika içinde dükkânda gösterir. Esnaf kodu okutur, ürünü verir; kimin aldığı hiçbir yerde tutulmaz.</x-web.answer>
</div>
</section>
<section class="section" aria-labelledby="rail-title">
<div class="wrap stack-lg">
<h2 id="rail-title" class="title1">Üç adım, tek askı</h2>
<x-web.station-rail />
</div>
</section>
<section class="section" aria-labelledby="steps-title">
<div class="wrap stack-lg">
<h2 id="steps-title" class="title1">Adım adım</h2>
<div class="columns">
<div>
<h3 class="title3">Bağışçı</h3>
<ol>
<li>Uygulamada doğrulanmış bir dükkân seçersiniz.</li>
<li>Ürünü ve adedi seçersiniz (en fazla {{ Facts::qtyMax() }}).</li>
<li>Ödemeyi uygulama içinde tamamlarsınız; makbuz e-postayla gelir.</li>
<li>Ürün alındığında anonim bir bildirim alırsınız.</li>
</ol>
</div>
<div>
<h3 class="title3">Esnaf</h3>
<ol>
<li>Dükkânınızı kaydeder ve belgelerinizi yüklersiniz.</li>
<li>Doğrulama sonrasında ürün kataloğunuzu açarsınız.</li>
<li>Gelen kodu okutur ya da yazarsınız.</li>
<li>Ürünü verir, ödemenizi panelden izlersiniz.</li>
</ol>
</div>
<div>
<h3 class="title3">Alan</h3>
<ol>
<li>İlk ekranda "Askıdan al" seçeneğini açarsınız.</li>
<li>Yakındaki dükkânlardan ürünü seçersiniz.</li>
<li>Kodu ve QR'ı dükkânda gösterirsiniz.</li>
<li>Ürünü teslim alırsınız; geride kimlik ya da geçmiş kalmaz.</li>
</ol>
</div>
</div>
</div>
</section>
<section class="section" aria-labelledby="limits-title">
<div class="wrap stack-lg">
<h2 id="limits-title" class="title1">Sınırlar</h2>
<div class="table-wrap">
<table class="table">
<thead><tr><th scope="col">Konu</th><th scope="col">Sınır</th></tr></thead>
<tbody>
<tr><td>Kodun geçerlilik süresi</td><td>{{ Facts::codeValidMinutes() }} dakika</td></tr>
<tr><td>Kod uzunluğu</td><td>{{ Facts::codeLength() }} karakter</td></tr>
<tr><td>Bir cihazın günlük alımı</td><td>{{ Facts::anonDailyCap() }} ürün</td></tr>
<tr><td>Aynı dükkândan günlük alım</td><td>{{ Facts::anonShopDailyCap() }} ürün</td></tr>
<tr><td>Dükkân arama yarıçapı</td><td>{{ Facts::radiusDefaultM() / 1000 }} km (en fazla {{ Facts::radiusMaxM() / 1000 }} km)</td></tr>
<tr><td>Bir ödemede bir üründen</td><td>en fazla {{ Facts::qtyMax() }} adet</td></tr>
<tr><td>Tek ödeme üst sınırı</td><td class="num">{{ Format::money(Facts::txCapMinor()) }}</td></tr>
<tr><td>Bağışçının günlük üst sınırı</td><td class="num">{{ Format::money(Facts::dayCapMinor()) }}</td></tr>
</tbody>
</table>
</div>
<p class="footnote">Platform komisyonu {{ Facts::commissionLabel() }}; kesin oran yayın öncesi belirlenir.</p>
<p><a href="/sss">Sıkça sorulan sorular</a></p>
</div>
</section>
<x-web.download-band />
</x-web.layout>
