@use('App\Support\Web\Format')
<x-web.layout :meta="$meta" :sample-notice="false">
<section class="page-head">
<div class="wrap">
<h1 class="display">Askıda etki</h1>
<x-web.answer>Bu sayfa, son otuz günde askıya bırakılan ve askıdan alınan ürün birimleri ile doğrulanmış dükkân sayısını il il gösterir. Sayılar yalnızca ürün adedidir; kimin bıraktığı ya da aldığı tutulmaz. Bir dükkânı belli etmesin diye küçük gruplar birleştirilir. Aynı veriyi CSV olarak indirebilirsiniz.</x-web.answer>
</div>
</section>
<section class="section" aria-labelledby="totals-title">
<div class="wrap stack-lg">
<h2 id="totals-title" class="title1">Son {{ $windowDays }} gün</h2>
@if ($overview->sample)
<p class="notice"><span class="tag tag-sample">ÖRNEK</span> Bu sayılar örnek dükkânlardan türetilmiştir; gerçek bir etkiyi göstermez.</p>
@endif
@if ($overview->hasData())
<div class="figures">
<div><p class="numeral-xl">{{ Format::count($overview->donated) }}</p><p class="label">Askıya bırakılan ürün</p></div>
<div><p class="numeral-xl">{{ Format::count($overview->redeemed) }}</p><p class="label">Askıdan alınan ürün</p></div>
<div><p class="numeral-xl">{{ Format::count($overview->shops) }}</p><p class="label">Doğrulanmış dükkân</p></div>
</div>
<p class="footnote">{{ Format::date($overview->from) }} – {{ Format::date($overview->to) }} arası. Ürün sayıları günlük toplanır; dükkân sayısı son günün sayısıdır.</p>
@else
<p class="lead">Henüz yayımlanacak bir sayı yok. İlk doğrulanmış dükkânlar katıldığında sayılar burada görünür.</p>
@endif
</div>
</section>
@if ($overview->rows !== [])
<section class="section band" aria-labelledby="province-title">
<div class="wrap stack-lg">
<h2 id="province-title" class="title1">İllere göre</h2>
<div class="table-wrap">
<table class="table">
<thead><tr><th scope="col">İl</th><th scope="col" class="num">Bırakılan ürün</th><th scope="col" class="num">Alınan ürün</th><th scope="col" class="num">Dükkân</th></tr></thead>
<tbody>
@foreach ($overview->rows as $row)
<tr><td>@if ($row->slug !== null)<a href="/etki/{{ $row->slug }}">{{ $row->name }}</a>@else{{ $row->name }}@endif</td><td class="num">{{ Format::count($row->donated) }}</td><td class="num">{{ Format::count($row->redeemed) }}</td><td class="num">{{ Format::count($row->shops) }}</td></tr>
@endforeach
</tbody>
</table>
</div>
<p class="footnote">En az {{ $minShops }} doğrulanmış dükkânı olmayan iller "Diğer iller" satırında birleştirilir.</p>
</div>
</section>
@endif
<section class="section" aria-labelledby="method-title">
<div class="wrap measure stack">
<h2 id="method-title" class="title1">Nasıl sayıyoruz</h2>
<p>Bırakılan ürün, ödemesi tamamlanan bağışların ürün adedidir. Alınan ürün, kodu dükkânda okutulan ürün birimidir. Günler Türkiye saatine göre hesaplanır. Dükkân sayısı, o gün doğrulanmış dükkânlardır. Hiçbir satırda kişi, hesap ya da tek bir dükkân yoktur.</p>
</div>
</section>
<section class="section band" aria-labelledby="open-title">
<div class="wrap measure stack">
<h2 id="open-title" class="title1">Açık veri</h2>
<p>Son {{ $csvDays }} günün günlük sayıları tek dosyada: <a href="/etki.csv">etki.csv</a>. Sütunlar: <code class="code">day,il,ilce,donated,redeemed,shops</code>. Küçük gruplar burada da birleştirilir.</p>
<p class="footnote">{{ $licence }}</p>
</div>
</section>
<x-web.download-band />
</x-web.layout>
