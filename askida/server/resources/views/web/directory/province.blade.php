{{-- /dukkanlar/{il}: districts of a province with listed shops. Names are escaped user input. --}}
<x-web.layout :meta="$meta">
<section class="page-head">
<div class="wrap">
<nav class="breadcrumbs" aria-label="Konum">
<ol>
<li><a href="/">Askıda</a></li>
<li aria-current="page">{{ $il }}</li>
</ol>
</nav>
<h1>{{ $il }}: askıda dükkânlar</h1>
<x-web.answer>{{ $answer }}</x-web.answer>
</div>
</section>

<section class="section" aria-labelledby="districts-title">
<div class="wrap stack-lg">
<x-web.rail-counter :count="$available" prefix="Şu an" note="Bu ildeki listelenen dükkânlarda askıda bekleyen ürünler." />
<h2 id="districts-title" class="title2">İlçeler</h2>
<ul class="rail-list">
@foreach ($districts as $district)
<li><a href="/dukkanlar/{{ $ilSlug }}/{{ $district['slug'] }}">{{ $district['name'] }}</a><span class="footnote tabular">{{ \App\Support\Web\Format::count($district['shops']) }} dükkân · {{ \App\Support\Web\Format::count($district['available']) }} ürün askıda</span></li>
@endforeach
</ul>
</div>
</section>

<x-web.download-band />
</x-web.layout>
