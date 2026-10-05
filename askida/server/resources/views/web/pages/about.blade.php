@use('App\Support\Web\Facts')
@use('App\Support\Web\Format')
<x-web.layout :meta="$meta" :sample-notice="true">
<section class="page-head">
<div class="wrap">
<nav class="breadcrumbs" aria-label="Sayfa yolu"><ol><li><a href="/">Askıda</a></li><li aria-current="page">Hakkında</li></ol></nav>
<h1 class="display">Askıda hakkında</h1>
<x-web.answer>Askıda, mahalle esnafındaki askıda ekmek geleneğini uygulamaya taşıyan bir iyilik ağıdır; işletmesi {{ Facts::LEGAL_NAME }} adıyla anılır. Bağışçı ürünü önceden öder, dileyen herkes hesapsız ve kimliksiz alır. Platform parayı tutmaz, yalnızca {{ Facts::commissionLabel() }} komisyonunu kaydeder; kesin oran yayın öncesi belirlenir. Sayfalardaki rakamlar şimdilik örnek veridir ve açıkça etiketlenir.</x-web.answer>
</div>
</section>
<section class="section" aria-labelledby="principles-title">
<div class="wrap stack-lg">
<h2 id="principles-title" class="title1">İlkeler</h2>
<dl class="facts-list">
<dt>Saygı</dt><dd>Askıdan almak herkes için sıradan bir davranıştır. Alan kişi hesap açmaz, kimliği sorulmaz, puanlanmaz.</dd>
<dt>Anonimlik</dt><dd>Kimin aldığı bağışçıya da esnafa gösterilmez; sayılar ürün adedidir, kişi sayısı değil.</dd>
<dt>Şeffaflık</dt><dd>Para ödeme kuruluşu üzerinden esnafa gider; komisyon {{ Facts::commissionLabel() }} olarak açıkça yazılır ve yayın öncesi belirlenir.</dd>
<dt>Doğrulama</dt><dd>Yalnızca belgeleri doğrulanmış dükkânlar görünür; web dizininde yer almak ayrıca esnafın iznine bağlıdır.</dd>
</dl>
</div>
</section>
<section class="section" aria-labelledby="numbers-title">
<div class="wrap stack-lg">
<h2 id="numbers-title" class="title1">Sayılarla</h2>
<div class="table-wrap">
<table class="table">
<thead><tr><th scope="col">Konu</th><th scope="col">Değer</th></tr></thead>
<tbody>
<tr><td>Kod uzunluğu ve süresi</td><td>{{ Facts::codeLength() }} karakter, {{ Facts::codeValidMinutes() }} dakika</td></tr>
<tr><td>Günlük alım sınırı</td><td>cihaz başına {{ Facts::anonDailyCap() }}, dükkân başına {{ Facts::anonShopDailyCap() }}</td></tr>
<tr><td>Dükkân arama yarıçapı</td><td>{{ Facts::radiusDefaultM() / 1000 }} km, en fazla {{ Facts::radiusMaxM() / 1000 }} km</td></tr>
<tr><td>Bir ödemede bir üründen</td><td>en fazla {{ Facts::qtyMax() }} adet</td></tr>
<tr><td>Tek ödeme üst sınırı</td><td class="num">{{ Format::money(Facts::txCapMinor()) }}</td></tr>
<tr><td>Günlük bağışçı üst sınırı</td><td class="num">{{ Format::money(Facts::dayCapMinor()) }}</td></tr>
<tr><td>Komisyon</td><td>{{ Facts::commissionLabel() }}</td></tr>
</tbody>
</table>
</div>
<p class="footnote">Askıda yayında değildir; sayfalardaki rakamlar ve dükkânlar örnek veridir ve [ÖRNEK] etiketiyle işaretlenir. Komisyon yayın öncesi belirlenir.</p>
</div>
</section>
<section class="section" aria-labelledby="who-title">
<div class="wrap stack-lg">
<h2 id="who-title" class="title1">Kimin ne gördüğü</h2>
<dl class="facts-list">
<dt>Bağışçı</dt><dd>Kendi bağışlarını ve anonim "Askın alındı" bildirimini görür.</dd>
<dt>Esnaf</dt><dd>Kendi dükkânının bağışlarını, verilen ürün sayısını ve uzlaşma durumunu görür; alanın kimliği yoktur.</dd>
<dt>Alan</dt><dd>Yakındaki dükkânları ve askıdaki ürün sayısını görür; kimseye gösterilmez.</dd>
</dl>
<p><a href="/sss">Sıkça sorulan sorular</a> · <a href="/iletisim">İletişim</a></p>
</div>
</section>
</x-web.layout>
