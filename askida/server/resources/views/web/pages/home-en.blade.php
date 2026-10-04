@use('App\Support\Web\Facts')
@use('App\Support\Web\Format')
<x-web.layout :meta="$meta">
<section class="hero">
<div class="wrap grid-split">
<div>
<h1 class="hero-title">Hang it up. Take it down.</h1>
<x-web.answer>Askıda brings the Turkish tradition of the suspended loaf to an app. A donor prepays a loaf, a soup or a notebook at a neighbourhood shop; anyone nearby takes it with a one-time code, with no account and no identity check. Nobody records who took it, nobody is rated, and the shop is paid directly through the payment provider.</x-web.answer>
<div class="actions">
<a class="button button-primary" href="#get">Get the app</a>
<a href="/en/how-it-works">How it works</a>
</div>
</div>
<x-web.rail-counter :count="$counters->availableNow" prefix="Today" label="on the rail" :sample="false" />
</div>
</section>
<section class="section band" aria-labelledby="today-title">
<div class="wrap stack-lg">
<h2 id="today-title" class="title1">Today on the rail @if ($counters->isSample)<x-web.tag variant="sample" />@endif</h2>
<div class="figures">
<div><p class="numeral-xl">{{ Format::count($counters->donatedToday) }}</p><p>items hung up</p></div>
<div><p class="numeral-xl">{{ Format::count($counters->redeemedToday) }}</p><p>items taken</p></div>
<div><p class="numeral-xl">{{ Format::count($counters->shops) }}</p><p>verified shops</p></div>
</div>
<p class="footnote">As of {{ $counters->asOf->locale('en')->translatedFormat('j F Y') }}. Figures count items, never people.@if ($counters->isSample) Sample figures until real data exists.@endif</p>
</div>
</section>
<section class="section" aria-labelledby="how-title">
<div class="wrap stack-lg">
<h2 id="how-title" class="title1">How it works</h2>
<x-web.station-rail :steps="[
['Hang', 'A donor pays for an item in the app; it is added to the shop rail.'],
['On the rail', 'The item waits on the shop rail, and everyone can see how many are hanging.'],
['Take', 'Anyone takes it at the shop with a one-time code, without an account.'],
]" />
<p><a href="/en/how-it-works">The full steps and limits</a></p>
</div>
</section>
<section class="section" aria-labelledby="who-title">
<div class="wrap stack-lg">
<h2 id="who-title" class="title1">Who it is for</h2>
<div class="columns">
<div><h3 class="title3">Donors</h3><p>You pay for an item in advance; it waits on the shop rail and you never see who takes it.</p></div>
<div><h3 class="title3">Shops</h3><p>You get verified, list your items, scan the code and hand over the item; payment reaches you directly.</p></div>
<div><h3 class="title3">Anyone taking</h3><p>No account, no identity and no precise location. Pick a nearby shop, get a code, collect the item.</p></div>
</div>
<p class="footnote">The rest of the site is in Turkish. <a href="/" hreflang="tr" lang="tr">Türkçe sayfa</a></p>
</div>
</section>
<section id="get" class="band section-dense" aria-labelledby="get-title">
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
