@use('App\Support\Web\Facts')
@use('App\Support\Web\Format')
<x-web.layout :meta="$meta" :sample-notice="true">
<section class="page-head">
<div class="wrap head-grid">
<x-web.art name="tags" class="head-art" />
<div>
<nav class="breadcrumbs" aria-label="Sayfa yolu"><ol><li><a href="/">Askıda</a></li><li aria-current="page">Hakkında</li></ol></nav>
<h1 class="display">Askıda hakkında</h1>
<x-web.answer>Askıda, mahalle esnafındaki askıda ekmek geleneğini uygulamaya taşıyan bir iyilik ağıdır; işletmesi {{ Facts::LEGAL_NAME }} adıyla anılır. Bağışçı ürünü önceden öder, dileyen herkes hesapsız ve kimliksiz alır. Platform parayı tutmaz, yalnızca {{ Facts::commissionLabel() }} komisyonunu kaydeder; kesin oran yayın öncesi belirlenir. Sayfalardaki rakamlar şimdilik örnek veridir ve açıkça etiketlenir.</x-web.answer>
</div>
</div>
</section>
<section class="section rail-top" aria-labelledby="principles-title">
<div class="wrap split">
<h2 id="principles-title" class="headline">İlkeler</h2>
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
<h2 id="numbers-title" class="headline">Sayılarla</h2>
<ul class="tag-grid">
<li><p class="hang-tag"><span>Kod uzunluğu ve süresi</span> <strong>{{ Facts::codeLength() }} karakter, {{ Facts::codeValidMinutes() }} dakika</strong></p></li>
<li><p class="hang-tag"><span>Günlük alım sınırı</span> <strong>cihaz başına {{ Facts::anonDailyCap() }}, dükkân başına {{ Facts::anonShopDailyCap() }}</strong></p></li>
<li><p class="hang-tag"><span>Dükkân arama yarıçapı</span> <strong>{{ Facts::radiusDefaultM() / 1000 }} km, en fazla {{ Facts::radiusMaxM() / 1000 }} km</strong></p></li>
<li><p class="hang-tag"><span>Bir ödemede bir üründen</span> <strong>en fazla {{ Facts::qtyMax() }} adet</strong></p></li>
<li><p class="hang-tag"><span>Tek ödeme üst sınırı</span> <strong>{{ Format::money(Facts::txCapMinor()) }}</strong></p></li>
<li><p class="hang-tag"><span>Günlük bağışçı üst sınırı</span> <strong>{{ Format::money(Facts::dayCapMinor()) }}</strong></p></li>
<li><p class="hang-tag"><span>Komisyon</span> <strong>{{ Facts::commissionLabel() }}</strong></p></li>
</ul>
<p class="footnote">Askıda yayında değildir; sayfalardaki rakamlar ve dükkânlar örnek veridir ve [ÖRNEK] etiketiyle işaretlenir. Komisyon yayın öncesi belirlenir.</p>
</div>
</section>
<section class="section" aria-labelledby="who-title">
<div class="wrap stack-lg">
<h2 id="who-title" class="headline">Kimin ne gördüğü</h2>
<dl class="facts-list">
<dt>Bağışçı</dt><dd>Kendi bağışlarını ve anonim "Askın alındı" bildirimini görür.</dd>
<dt>Esnaf</dt><dd>Kendi dükkânının bağışlarını, verilen ürün sayısını ve uzlaşma durumunu görür; alanın kimliği yoktur.</dd>
<dt>Alan</dt><dd>Yakındaki dükkânları ve askıdaki ürün sayısını görür; kimseye gösterilmez.</dd>
</dl>
<p><a href="/sss">Sıkça sorulan sorular</a> · <a href="/iletisim">İletişim</a></p>
</div>
</section>
</x-web.layout>
