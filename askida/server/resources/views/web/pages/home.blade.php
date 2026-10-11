@use('App\Support\Web\Facts')
@use('App\Support\Web\Format')
<x-web.layout :meta="$meta">
<section class="hero">
<div class="wrap head-grid">
<x-web.art name="hero" class="head-art" />
<div>
<h1 class="hero-title">Askıya bırak. Askıdan al.</h1>
<x-web.answer>Askıda, mahalle esnafındaki askıda ekmek geleneğini uygulamaya taşır. Bağışçı bir ekmeği, çorbayı ya da defteri uygulamadan askıya bırakır; dileyen herkes hesap açmadan, kimlik göstermeden yakındaki dükkândan tek kullanımlık kodla askıdan alır. Kimin aldığı kaydedilmez, kimse puanlanmaz; esnaf ödemesini doğrudan ödeme kuruluşundan alır.</x-web.answer>
<div class="actions">
<a class="button button-primary" href="#indir">Uygulamayı indir</a>
<a href="/esnaf">Esnaf mısınız?</a>
</div>
</div>
</div>
</section>
<section class="section rail-top" aria-labelledby="today-title">
<div class="wrap stack-lg">
<h2 id="today-title" class="headline">Bugün askıda @if ($counters->isSample)<x-web.tag variant="sample" />@endif</h2>
<x-web.rail-counter :count="$counters->availableNow" :as-of="$counters->asOf" :sample="$counters->isSample" />
<ul class="tag-row">
<li><div class="hang-tag is-crust"><p class="numeral-xl">{{ Format::count($counters->donatedToday) }}</p><p>askıya bırakılan ürün</p></div></li>
<li><div class="hang-tag"><p class="numeral-xl">{{ Format::count($counters->redeemedToday) }}</p><p>askıdan alınan ürün</p></div></li>
<li><div class="hang-tag"><p class="numeral-xl">{{ Format::count($counters->shops) }}</p><p>doğrulanmış dükkân</p></div></li>
</ul>
<p class="footnote">{{ Format::date($counters->asOf) }} itibarıyla. Sayılar ürün adedidir; kişi sayısı tutulmaz. <a href="/etki">Yöntem ve ayrıntılar</a></p>
</div>
</section>
<section class="section" aria-labelledby="how-title">
<div class="wrap">
<h2 id="how-title" class="headline section-title">Nasıl işler</h2>
<x-web.station-rail />
<p class="actions"><a href="/nasil-calisir">Adımların tamamı ve sınırlar</a></p>
</div>
</section>
<section class="section" aria-labelledby="who-title">
<div class="wrap">
<h2 id="who-title" class="headline section-title">Kim için</h2>
<ul class="index">
<li><h3><a href="/bagisci">Bağışçı</a></h3><p>Bir ürünün bedelini önceden ödersiniz; ürün dükkânın askısında bekler ve kimin aldığını görmezsiniz.</p></li>
<li><h3><a href="/esnaf">Esnaf</a></h3><p>Dükkânınızı doğrulatır, katalogunuzu açar, kodu okutup ürünü verirsiniz; ödeme size doğrudan ulaşır.</p></li>
<li><h3><a href="/askidan-al">Alan</a></h3><p>Hesap, kimlik ve kesin konum gerekmez. Yakındaki dükkândan kodu alır, ürünü dükkândan teslim alırsınız.</p></li>
</ul>
</div>
</section>
<section class="section" aria-labelledby="dignity-title">
<div class="wrap split">
<div class="stack">
<h2 id="dignity-title" class="headline">Askıdan almak ayıp değil</h2>
<p class="lead">Hesap, kimlik ya da puan istenmez; geride kimlik ya da geçmiş kalmaz.</p>
<p><a href="/rehber/askidan-almak-ayip-degil">Rehberi okuyun</a></p>
</div>
<div class="receipt">
<p class="receipt-head">Askıdan alırken</p>
<dl>
<div><dt>Hesap yok</dt><dd>Askıdan almak için üye olmak, e-posta ya da telefon vermek gerekmez.</dd></div>
<div><dt>Kimlik yok</dt><dd>Kimin aldığı sorulmaz; esnaf yalnızca verilen ürünü görür.</dd></div>
<div><dt>Konum kaydı yok</dt><dd>Kesin konumunuz saklanmaz; yakındaki dükkânlar yaklaşık konumla bulunur.</dd></div>
<div><dt>Puanlama yok</dt><dd>Alan kişi derecelendirilmez, listelenmez, kimseye gösterilmez.</dd></div>
</dl>
</div>
</div>
</section>
<section class="section" aria-labelledby="shops-title">
<div class="wrap stack">
<h2 id="shops-title" class="headline">Dükkânlar</h2>
<p class="lead">Dükkânlar il ve ilçeye göre listelenir. Yalnızca doğrulanmış ve web sitesinde yer almayı kabul eden dükkânlar görünür.</p>
<ul class="link-grid">
<li><a href="/dukkanlar/istanbul">İstanbul dükkânları</a></li>
</ul>
</div>
<div class="wrap city"><x-web.art name="city" /></div>
</section>
<x-web.download-band id="indir" />
</x-web.layout>
