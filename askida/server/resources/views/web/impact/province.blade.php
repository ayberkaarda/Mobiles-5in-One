@use('App\Support\Web\Format')
<x-web.layout :meta="$meta" :sample-notice="false">
<section class="page-head">
<div class="wrap">
<h1 class="display">{{ $province->name }} etki sayıları</h1>
<x-web.answer>{{ $province->name }} için son otuz günde askıya bırakılan ve askıdan alınan ürün birimleri ile doğrulanmış dükkân sayısı bu sayfadadır. Sayılar yalnızca ürün adedidir; kimin bıraktığı ya da aldığı tutulmaz. Bir dükkânı belli etmesin diye küçük gruplar birleştirilir. Ülke sayılarına etki sayfasından ulaşabilirsiniz.</x-web.answer>
<nav class="breadcrumbs" aria-label="Sayfa yolu"><ol><li><a href="/etki">Etki</a></li><li>{{ $province->name }}</li></ol></nav>
</div>
</section>
<section class="section" aria-labelledby="totals-title">
<div class="wrap stack-lg">
<h2 id="totals-title" class="title1">Son {{ $windowDays }} gün</h2>
@if ($province->sample)
<p class="notice"><span class="tag tag-sample">ÖRNEK</span> Bu sayılar örnek dükkânlardan türetilmiştir; gerçek bir etkiyi göstermez.</p>
@endif
@if ($province->listed)
<div class="figures">
<div><p class="numeral-xl">{{ Format::count($province->donated) }}</p><p class="label">Askıya bırakılan ürün</p></div>
<div><p class="numeral-xl">{{ Format::count($province->redeemed) }}</p><p class="label">Askıdan alınan ürün</p></div>
<div><p class="numeral-xl">{{ Format::count($province->shops) }}</p><p class="label">Doğrulanmış dükkân</p></div>
</div>
<p class="footnote">{{ Format::date($province->from) }} – {{ Format::date($province->to) }} arası.</p>
@else
<p class="lead">{{ $province->name }} için ayrı sayı yayımlanmıyor: en az {{ $minShops }} doğrulanmış dükkân olmayan yerlerin sayıları, tek bir dükkânı belli etmemek için ülke sayılarına katılır.</p>
@endif
</div>
</section>
@if ($province->rows !== [])
<section class="section band" aria-labelledby="district-title">
<div class="wrap stack-lg">
<h2 id="district-title" class="title1">İlçelere göre</h2>
<div class="table-wrap">
<table class="table">
<thead><tr><th scope="col">İlçe</th><th scope="col" class="num">Bırakılan ürün</th><th scope="col" class="num">Alınan ürün</th><th scope="col" class="num">Dükkân</th></tr></thead>
<tbody>
@foreach ($province->rows as $row)
<tr><td>{{ $row->name }}</td><td class="num">{{ Format::count($row->donated) }}</td><td class="num">{{ Format::count($row->redeemed) }}</td><td class="num">{{ Format::count($row->shops) }}</td></tr>
@endforeach
</tbody>
</table>
</div>
<p class="footnote">En az {{ $minShops }} doğrulanmış dükkânı olmayan ilçeler "Diğer ilçeler" satırında birleştirilir.</p>
</div>
</section>
@endif
<section class="section" aria-labelledby="shops-title">
<div class="wrap measure stack">
<h2 id="shops-title" class="title1">Dükkânlar</h2>
<p><a href="/dukkanlar/{{ $province->slug }}">{{ $province->name }} dükkânlarını</a> dükkân listesinde görebilirsiniz.</p>
</div>
</section>
<x-web.download-band />
</x-web.layout>
