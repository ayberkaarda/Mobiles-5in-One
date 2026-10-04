@use('App\Support\Web\Facts')
@use('App\Support\Web\Format')
<x-web.layout :meta="$meta">
<section class="hero">
<div class="wrap grid-split">
<div>
<h1 class="hero-title">Askıya bırak. Askıdan al.</h1>
<x-web.answer>Askıda, mahalle esnafındaki askıda ekmek geleneğini uygulamaya taşır. Bağışçı bir ekmeği, çorbayı ya da defteri uygulamadan askıya bırakır; dileyen herkes hesap açmadan, kimlik göstermeden yakındaki dükkândan tek kullanımlık kodla askıdan alır. Kimin aldığı kaydedilmez, kimse puanlanmaz; esnaf ödemesini doğrudan ödeme kuruluşundan alır.</x-web.answer>
<div class="actions">
<a class="button button-primary" href="#indir">Uygulamayı indir</a>
<a href="/esnaf">Esnaf mısınız?</a>
</div>
</div>
<x-web.rail-counter :count="$counters->availableNow" :as-of="$counters->asOf" :sample="$counters->isSample" />
</div>
</section>
<section class="section band" aria-labelledby="today-title">
<div class="wrap stack-lg">
<h2 id="today-title" class="title1">Bugün askıda @if ($counters->isSample)<x-web.tag variant="sample" />@endif</h2>
<div class="figures">
<div><p class="numeral-xl">{{ Format::count($counters->donatedToday) }}</p><p>askıya bırakılan ürün</p></div>
<div><p class="numeral-xl">{{ Format::count($counters->redeemedToday) }}</p><p>askıdan alınan ürün</p></div>
<div><p class="numeral-xl">{{ Format::count($counters->shops) }}</p><p>doğrulanmış dükkân</p></div>
</div>
<p class="footnote">{{ Format::date($counters->asOf) }} itibarıyla. Sayılar ürün adedidir; kişi sayısı tutulmaz. <a href="/etki">Yöntem ve ayrıntılar</a></p>
</div>
</section>
<section class="section" aria-labelledby="how-title">
<div class="wrap stack-lg">
<h2 id="how-title" class="title1">Nasıl işler</h2>
<x-web.station-rail />
<p><a href="/nasil-calisir">Adımların tamamı ve sınırlar</a></p>
</div>
</section>
<section class="section" aria-labelledby="who-title">
<div class="wrap stack-lg">
<h2 id="who-title" class="title1">Kim için</h2>
<div class="columns">
<div><h3 class="title3">Bağışçı</h3><p>Bir ürünün bedelini önceden ödersiniz; ürün dükkânın askısında bekler ve kimin aldığını görmezsiniz.</p><p><a href="/bagisci">Bağışçı için</a></p></div>
<div><h3 class="title3">Esnaf</h3><p>Dükkânınızı doğrulatır, katalogunuzu açar, kodu okutup ürünü verirsiniz; ödeme size doğrudan ulaşır.</p><p><a href="/esnaf">Esnaf için</a></p></div>
<div><h3 class="title3">Alan</h3><p>Hesap, kimlik ve kesin konum gerekmez. Yakındaki dükkândan kodu alır, ürünü dükkândan teslim alırsınız.</p><p><a href="/askidan-al">Askıdan al</a></p></div>
</div>
</div>
</section>
<section class="section" aria-labelledby="dignity-title">
<div class="wrap stack-lg">
<h2 id="dignity-title" class="title1">Askıdan almak ayıp değil</h2>
<dl class="facts-list">
<dt>Hesap yok</dt><dd>Askıdan almak için üye olmak, e-posta ya da telefon vermek gerekmez.</dd>
<dt>Kimlik yok</dt><dd>Kimin aldığı sorulmaz; esnaf yalnızca verilen ürünü görür.</dd>
<dt>Konum kaydı yok</dt><dd>Kesin konumunuz saklanmaz; yakındaki dükkânlar yaklaşık konumla bulunur.</dd>
<dt>Puanlama yok</dt><dd>Alan kişi derecelendirilmez, listelenmez, kimseye gösterilmez.</dd>
</dl>
</div>
</section>
<section class="section" aria-labelledby="shops-title">
<div class="wrap stack-lg">
<h2 id="shops-title" class="title1">Dükkânlar</h2>
<p class="measure">Dükkânlar il ve ilçeye göre listelenir. Yalnızca doğrulanmış ve web sitesinde yer almayı kabul eden dükkânlar görünür.</p>
<ul class="link-grid">
<li><a href="/dukkanlar/istanbul">İstanbul dükkânları</a></li>
</ul>
</div>
</section>
<x-web.download-band id="indir" />
</x-web.layout>
