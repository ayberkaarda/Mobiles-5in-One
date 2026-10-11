@props([
    'steps' => [
        ['Askıya bırak', 'Bağışçı bir ürünün bedelini uygulamadan öder; ürün dükkânın askısına eklenir.'],
        ['Askıda', 'Ürün dükkânın askısında bekler; kaç ürün asılı olduğunu herkes görür.'],
        ['Askıdan al', 'Dileyen herkes hesap açmadan, tek kullanımlık kodla ürünü dükkândan alır.'],
    ],
    'heading' => 'h3',
])
{{-- The station rail: one rail, three hooks. The receipt (paid), the crust tag (hanging), the code tag (taken); one sentence under each. --}}
<figure {{ $attributes->class(['station-rail']) }}>
<svg class="art" viewBox="0 0 720 220" aria-hidden="true" focusable="false"><path d="M4 12H716"/><path class="f-paper" fill-rule="evenodd" d="M70 48H170V196l-10 8-10-8-10 8-10-8-10 8-10-8-10 8-10-8-10 8-10-8ZM114 66A6 6 0 1 0 126 66A6 6 0 1 0 114 66Z"/><path class="thin" d="M88 98H152M88 116H136M88 134H148"/><path class="thin dash" d="M88 158H152"/><path class="f-crust" fill-rule="evenodd" d="M320 48H400A10 10 0 0 1 410 58V190A10 10 0 0 1 400 200H320A10 10 0 0 1 310 190V58A10 10 0 0 1 320 48ZM354 66A6 6 0 1 0 366 66A6 6 0 1 0 354 66Z"/><path class="on-crust" d="M324 152c0-22 16-34 36-34s36 12 36 34c0 10-10 14-36 14s-36-4-36-14ZM344 148l7-10M357 148l7-10M370 148l7-10"/><path class="f-paper" fill-rule="evenodd" d="M524 48H676A14 14 0 0 1 690 62V182A14 14 0 0 1 676 196H524A14 14 0 0 1 510 182V62A14 14 0 0 1 524 48ZM593 66A7 7 0 1 0 607 66A7 7 0 1 0 593 66Z"/><path class="f-sand thin" d="M517 104h16v26h-16ZM537 104h16v26h-16ZM557 104h16v26h-16ZM577 104h16v26h-16ZM609 104h16v26h-16ZM629 104h16v26h-16ZM649 104h16v26h-16ZM669 104h16v26h-16Z"/><path class="thin" d="M530 160H670M530 176H616"/><path d="M113 16V12A7 7 0 0 1 127 12L113 62A7 7 0 0 0 127 62V58M353 16V12A7 7 0 0 1 367 12L353 62A7 7 0 0 0 367 62V58M593 16V12A7 7 0 0 1 607 12L593 62A7 7 0 0 0 607 62V58"/></svg>
<figcaption>
<ol>
@foreach ($steps as [$title, $sentence])
<li><{{ $heading }}>{{ $title }}</{{ $heading }}><p>{{ $sentence }}</p></li>
@endforeach
</ol>
</figcaption>
</figure>
