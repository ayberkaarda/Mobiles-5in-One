@props([
    'steps' => [
        ['Askıya bırak', 'Bağışçı bir ürünün bedelini uygulamadan öder; ürün dükkânın askısına eklenir.'],
        ['Askıda', 'Ürün dükkânın askısında bekler; kaç ürün asılı olduğunu herkes görür.'],
        ['Askıdan al', 'Dileyen herkes hesap açmadan, tek kullanımlık kodla ürünü dükkândan alır.'],
    ],
    'heading' => 'h3',
])
{{-- The station rail of design section 4: three tags on one rail (Bırak, Askıda, Al), one sentence under each. --}}
<figure {{ $attributes->class(['station-rail']) }}>
<svg viewBox="0 0 360 128" aria-hidden="true" focusable="false"><path class="sr-rail" stroke-width="2" stroke-linecap="round" d="M8 10H352M60 10V26M180 10V26M300 10V18"/><path class="sr-tag" fill-rule="evenodd" d="M34 26H86A6 6 0 0 1 92 32V100A6 6 0 0 1 86 106H34A6 6 0 0 1 28 100V32A6 6 0 0 1 34 26ZM55 40A5 5 0 1 0 65 40A5 5 0 1 0 55 40ZM274 38H326A6 6 0 0 1 332 44V112A6 6 0 0 1 326 118H274A6 6 0 0 1 268 112V44A6 6 0 0 1 274 38ZM295 52A5 5 0 1 0 305 52A5 5 0 1 0 295 52Z"/><path class="sr-tag-on" fill-rule="evenodd" d="M154 26H206A6 6 0 0 1 212 32V100A6 6 0 0 1 206 106H154A6 6 0 0 1 148 100V32A6 6 0 0 1 154 26ZM175 40A5 5 0 1 0 185 40A5 5 0 1 0 175 40Z"/><path class="sr-glyph" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M60 65V83M51 74H69M300 76V96M293 89L300 96L307 89"/><path class="sr-arrow" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M117 60L123 66L117 72M237 60L243 66L237 72"/></svg>
<figcaption>
<ol>
@foreach ($steps as [$title, $sentence])
<li><{{ $heading }} class="title3">{{ $title }}</{{ $heading }}><p>{{ $sentence }}</p></li>
@endforeach
</ol>
</figcaption>
</figure>
