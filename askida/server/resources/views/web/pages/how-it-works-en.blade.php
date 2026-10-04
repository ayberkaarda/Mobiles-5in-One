@use('App\Support\Web\Facts')
<x-web.layout :meta="$meta">
<section class="page-head">
<div class="wrap">
<nav class="breadcrumbs" aria-label="Breadcrumb"><ol><li><a href="/en">Askıda</a></li><li aria-current="page">How it works</li></ol></nav>
<h1 class="display">How Askıda works</h1>
<x-web.answer>A donor pays for an item in the app and it is added to the shop rail. Anyone who wants one picks a nearby shop without opening an account, receives a one-time code of {{ Facts::codeLength() }} characters and shows it at the shop within {{ Facts::codeValidMinutes() }} minutes. The shop scans it and hands over the item; who took it is never recorded.</x-web.answer>
</div>
</section>
<section class="section" aria-labelledby="rail-title">
<div class="wrap stack-lg">
<h2 id="rail-title" class="title1">Three steps, one rail</h2>
<x-web.station-rail :steps="[
['Hang', 'A donor pays for an item in the app; it is added to the shop rail.'],
['On the rail', 'The item waits on the shop rail, and everyone can see how many are hanging.'],
['Take', 'Anyone takes it at the shop with a one-time code, without an account.'],
]" />
</div>
</section>
<section class="section" aria-labelledby="limits-title">
<div class="wrap stack-lg">
<h2 id="limits-title" class="title1">The limits</h2>
<dl class="facts-list">
<dt>Code validity</dt><dd>{{ Facts::codeValidMinutes() }} minutes, one use.</dd>
<dt>Daily limit</dt><dd>{{ Facts::anonDailyCap() }} items per device, {{ Facts::anonShopDailyCap() }} per shop.</dd>
<dt>Search radius</dt><dd>{{ Facts::radiusDefaultM() / 1000 }} km by default, {{ Facts::radiusMaxM() / 1000 }} km at most, from an approximate location.</dd>
<dt>No account</dt><dd>Taking an item needs no account, no identity and no rating.</dd>
</dl>
<p class="footnote">The details, the FAQ and the legal pages are in Turkish. <a href="/nasil-calisir" hreflang="tr" lang="tr">Türkçe sayfa</a></p>
</div>
</section>
<section class="band section-dense" aria-labelledby="get-title">
<div class="wrap">
<h2 id="get-title" class="title1">Askıda in your pocket</h2>
<p class="lead">Use the app to hang an item. Taking one needs no account.</p>
@if (Facts::storeUrls() !== [])
<div class="actions">
@foreach (['android' => 'Google Play', 'ios' => 'App Store'] as $platform => $label)
@if (isset(Facts::storeUrls()[$platform]))
<a class="button button-secondary" href="{{ Facts::storeUrls()[$platform] }}" rel="noopener">{{ $label }}</a>
@endif
@endforeach
</div>
@else
<p class="footnote">Store links will appear here when the app is released.</p>
@endif
</div>
</section>
</x-web.layout>
