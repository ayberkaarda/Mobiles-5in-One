<article {{ $attributes->class(['shop-card']) }}>
<span @class(['shop-card-icon', 'is-on' => $available > 0])><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" d="{{ $icon() }}"/></svg></span>
<div>
<{{ $headingTag() }} class="shop-card-name">@if ($href !== null)<a href="{{ $href }}">{{ $name }}</a>@else{{ $name }}@endif</{{ $headingTag() }}>
<p class="shop-card-meta footnote"><span>{{ $typeLabel !== null ? $typeLabel.' · ' : '' }}{{ $district }}</span>@if ($verified)<span class="verified"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" d="{{ $check() }}"/></svg>Doğrulanmış</span>@endif
@if ($sample)<span class="tag tag-sample">ÖRNEK</span>@endif</p>
</div>
<p class="shop-card-count"><span class="numeral">{{ $countLabel() }}</span> <span class="caption">askıda</span></p>
</article>
