{{-- /dukkan/{slug}: one listed shop. Every value printed here is escaped; the shop's people, documents and payment data are never passed to this view. --}}
<x-web.layout :meta="$meta">
<section class="page-head">
<div class="wrap">
<nav class="breadcrumbs" aria-label="Konum">
<ol>
<li><a href="/">Askıda</a></li>
<li><a href="/dukkanlar/{{ $shop->il_slug }}">{{ $shop->il }}</a></li>
<li><a href="/dukkanlar/{{ $shop->il_slug }}/{{ $shop->ilce_slug }}">{{ $shop->ilce }}</a></li>
<li aria-current="page">{{ $shop->name }}</li>
</ol>
</nav>
<h1>{{ $shop->name }}</h1>
<x-web.answer>{{ $answer }}</x-web.answer>
<p class="shop-card-meta footnote"><span>{{ $typeLabel }} · {{ $shop->ilce }}, {{ $shop->il }}</span><span class="verified"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" d="{{ \App\Support\Web\Pictograms::path('check') }}"/></svg>Doğrulanmış</span>@if ($shop->is_sample) <x-web.tag variant="sample" />@endif</p>
</div>
</section>

<section class="section" aria-labelledby="shop-items-title">
<div class="wrap grid-split">
<div class="stack-lg">
<x-web.rail-counter :count="$available" prefix="Şu an" :sample="$shop->is_sample" note="Sayılar askıdaki ürünleri gösterir; kimin bıraktığı ya da aldığı tutulmaz." />
<div class="stack">
<h2 id="shop-items-title" class="title2">Askıdaki ürünler</h2>
@if ($items->isEmpty())
<p class="muted">Bu dükkân henüz askıya ürün eklemedi.</p>
@else
<div class="table-wrap">
<table class="table">
<thead><tr><th scope="col">Ürün</th><th scope="col" class="num">Fiyat</th><th scope="col" class="num">Askıda</th></tr></thead>
<tbody>
@foreach ($items as $item)
<tr><td>{{ $item->name }}</td><td class="num">{{ \App\Support\Web\Format::money($item->price_minor) }}</td><td class="num">{{ (int) $item->getAttribute('available_count') > 0 ? \App\Support\Web\Format::count((int) $item->getAttribute('available_count')) : '—' }}</td></tr>
@endforeach
</tbody>
</table>
</div>
@endif
</div>
</div>
<div class="stack-lg">
<div class="stack">
<h2 class="title2">Dükkân bilgileri</h2>
<dl class="facts-list">
<dt>Adres</dt><dd>{{ $shop->address }}</dd>
<dt>İlçe</dt><dd><a href="/dukkanlar/{{ $shop->il_slug }}/{{ $shop->ilce_slug }}">{{ $shop->ilce }}, {{ $shop->il }}</a></dd>
@if ($phone !== null)
<dt>Telefon</dt><dd><a href="tel:{{ $phone }}">{{ \App\Domain\Web\Directory\DirectoryCopy::phoneLabel($phone) }}</a></dd>
@endif
</dl>
</div>
<div class="stack">
<h2 class="title2">Çalışma saatleri</h2>
@if ($hours === [])
<p class="muted">Dükkân çalışma saatlerini henüz belirtmedi.</p>
@else
<dl class="facts-list">
@foreach ($hours as [$day, $time])
<dt>{{ $day }}</dt><dd class="tabular">{{ $time }}</dd>
@endforeach
</dl>
@endif
</div>
<x-web.static-map :label="$shop->ilce.', '.$shop->il" :lat="$shop->location->latitude" :lng="$shop->location->longitude" />
</div>
</div>
</section>

<x-web.download-band heading="Bu dükkâna askıya bırakın" text="Uygulamada bu dükkânı açıp bir ürün seçin; ödeme tamamlanınca ürün askıya çıkar ve dileyen biri hesap açmadan alır." :deep-link="'askida://shop/'.$shop->slug" deep-link-label="Askıya bırak" :primary="true" />
</x-web.layout>
