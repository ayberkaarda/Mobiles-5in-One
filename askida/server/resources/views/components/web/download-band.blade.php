<section {{ $attributes->class(['download-band', 'band', 'section-dense']) }} aria-labelledby="download-band-title">
<div class="wrap">
<div>
<h2 id="download-band-title" class="headline">{{ $heading }}</h2>
<p class="lead">{{ $text }}</p>
@if ($deepLink !== null || $stores() !== [])
<div class="actions">
@if ($deepLink !== null)
<a @class(['button', 'button-primary' => $primary, 'button-secondary' => ! $primary]) href="{{ $deepLink }}">{{ $deepLinkLabel }}</a>
@endif
@foreach ($stores() as $store => $url)
<a class="button button-secondary" href="{{ $url }}" rel="noopener">{{ $store }}</a>
@endforeach
</div>
@endif
@if ($stores() === [])
<p class="footnote">Mağaza bağlantıları uygulama yayımlandığında burada olacak.</p>
@endif
</div>
<x-web.art name="code" />
</div>
</section>
