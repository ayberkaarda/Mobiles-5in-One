{{-- Temporary home rendered by the `/` route of routes/web.php until the pages area serves `/`. --}}
@php
    $meta = \App\Support\Web\PageMeta::make(
        path: '/',
        title: 'Askıda: askıda ekmek ve iyilik ağı',
        description: 'Mahalle esnafında askıya bırakılan ekmeği, çorbayı, defteri dileyen herkes hesap açmadan ve soru sorulmadan askıdan alır.',
    );
@endphp
<x-web.layout :meta="$meta">
<section class="hero">
<div class="wrap grid-split">
<div>
<h1 class="hero-title">Askıya bırak. Askıdan al.</h1>
<x-web.answer>Askıda, mahalle esnafındaki askıda ekmek geleneğini uygulamaya taşır. Bağışçı bir ekmeği, çorbayı ya da defteri uygulamadan askıya bırakır; dileyen herkes hesap açmadan, kimlik göstermeden yakındaki dükkândan tek kullanımlık kodla askıdan alır. Kimin aldığı kaydedilmez, kimse puanlanmaz; esnaf ödemesini doğrudan ödeme kuruluşundan alır.</x-web.answer>
<div class="actions"><a href="/esnaf">Esnaf mısınız?</a></div>
</div>
<x-web.rail-counter :count="$counters->availableNow" :as-of="$counters->asOf" :sample="$counters->isSample" />
</div>
</section>
<section class="section" aria-labelledby="how-title">
<div class="wrap stack-lg">
<h2 id="how-title">Nasıl işler</h2>
<x-web.station-rail />
</div>
</section>
<x-web.download-band />
</x-web.layout>
