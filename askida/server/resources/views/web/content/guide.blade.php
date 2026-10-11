<x-web.layout :meta="$meta">
<section class="page-head">
<div class="wrap head-grid">
<x-web.art name="loaf" class="head-art" />
<div>
<nav class="breadcrumbs" aria-label="Sayfa yolu">
<ol><li><a href="/">Askıda</a></li><li>Rehber</li></ol>
</nav>
<h1 class="display">{{ $guide->title }}</h1>
<x-web.answer>{{ $guide->answer }}</x-web.answer>
<p class="footnote">Yayın: {{ \App\Support\Web\Format::date($guide->published) }} · Güncelleme: {{ \App\Support\Web\Format::date($guide->updated) }}</p>
</div>
</div>
</section>
<section class="section rail-top">
<div class="wrap">
<x-web.prose :html="$guide->body" />
</div>
</section>
<section class="section" aria-labelledby="other-guides">
<div class="wrap stack">
<h2 id="other-guides" class="headline">Diğer rehberler</h2>
<ul class="link-grid">
@foreach ($others as $other)
<li><a href="/rehber/{{ $other->slug }}">{{ $other->title }}</a></li>
@endforeach
</ul>
</div>
</section>
<x-web.download-band />
</x-web.layout>
