<figure {{ $attributes->class(['static-map']) }}>
<svg viewBox="0 0 640 240" aria-hidden="true" focusable="false"><path class="sm-grid" stroke-width="1" d="{{ $gridPath() }}"/><path class="sm-rail" stroke-width="2" stroke-linecap="round" d="M290 92H350M320 92V102"/><path class="sm-tag" fill-rule="evenodd" d="M311 102H329A5 5 0 0 1 334 107V135A5 5 0 0 1 329 140H311A5 5 0 0 1 306 135V107A5 5 0 0 1 311 102ZM317.5 111A2.5 2.5 0 1 0 322.5 111A2.5 2.5 0 1 0 317.5 111Z"/></svg>
<figcaption class="footnote">{{ $label }}@if ($coordinates() !== null) · <span class="tabular">{{ $coordinates() }}</span>@endif</figcaption>
</figure>
