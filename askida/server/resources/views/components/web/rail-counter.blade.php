<figure {{ $attributes->class(['rail-counter']) }}>
<svg viewBox="0 0 280 32" aria-hidden="true" focusable="false"><path class="rc-rail" stroke-width="2" stroke-linecap="round" d="M4 6H276"/>@if ($shown() > 0 || $overflows())<g class="rc-tags"><path class="rc-tie" stroke-width="1.5" stroke-linecap="round" d="{{ $tiesPath() }}"/>@if ($shown() > 0)<path class="rc-tag" fill-rule="evenodd" d="{{ $tagsPath() }}"/>@endif
@if ($overflows())<path class="rc-more" fill-rule="evenodd" d="{{ $moreTagPath() }}"/><path class="rc-plus" stroke-width="1.5" stroke-linecap="round" d="{{ $plusPath() }}"/>@endif</g>@endif</svg>
<figcaption>
<p class="rail-counter-text"><span class="title1">{{ $prefix }}</span> <span class="numeral-xl">{{ $formattedCount() }}</span> <span class="title1">{{ $label }}</span></p>
@if ($formattedDate() !== null || $sample || $note !== null)
<p class="footnote">@if ($sample)<span class="tag tag-sample">ÖRNEK</span> @endif{{ trim(($formattedDate() !== null ? $formattedDate().' itibarıyla. ' : '').($note ?? '')) }}</p>
@endif
</figcaption>
</figure>
