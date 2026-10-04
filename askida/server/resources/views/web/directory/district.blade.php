{{-- /dukkanlar/{il}/{ilce}: listed shops of one district as shop cards. Names are escaped user input. --}}
<x-web.layout :meta="$meta">
<section class="page-head">
<div class="wrap">
<nav class="breadcrumbs" aria-label="Konum">
<ol>
<li><a href="/">Askıda</a></li>
<li><a href="/dukkanlar/{{ $ilSlug }}">{{ $il }}</a></li>
<li aria-current="page">{{ $ilce }}</li>
</ol>
</nav>
<h1>{{ $ilce }}, {{ $il }}: askıda dükkânlar</h1>
<x-web.answer>{{ $answer }}</x-web.answer>
</div>
</section>

<section class="section" aria-labelledby="shops-title">
<div class="wrap stack-lg">
<x-web.rail-counter :count="$available" prefix="Şu an" note="Bu ilçedeki listelenen dükkânlarda askıda bekleyen ürünler." />
<h2 id="shops-title" class="title2">Dükkânlar</h2>
<ul class="shop-list">
@foreach ($cards as $card)
<li><x-web.shop-card :name="$card['name']" :district="$ilce.', '.$il" :available="$card['available']" :href="$card['href']" :pictogram="$card['pictogram']" :type-label="$card['typeLabel']" :sample="$card['sample']" /></li>
@endforeach
</ul>
@if ($lastPage > 1)
<nav aria-label="Sayfalar">
<p class="actions">
@if ($page > 1)
<a href="{{ $page === 2 ? $path : $path.'?sayfa='.($page - 1) }}" rel="prev">Önceki sayfa</a>
@endif
<span class="footnote tabular">Sayfa {{ $page }} / {{ $lastPage }}</span>
@if ($page < $lastPage)
<a href="{{ $path }}?sayfa={{ $page + 1 }}" rel="next">Sonraki sayfa</a>
@endif
</p>
</nav>
@endif
</div>
</section>

<x-web.download-band />
</x-web.layout>
