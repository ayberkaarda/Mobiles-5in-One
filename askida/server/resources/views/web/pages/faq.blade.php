<x-web.layout :meta="$meta">
<section class="page-head">
<div class="wrap head-grid">
<x-web.art name="tags" class="head-art" />
<div>
<nav class="breadcrumbs" aria-label="Sayfa yolu"><ol><li><a href="/">Askıda</a></li><li aria-current="page">Sıkça sorulanlar</li></ol></nav>
<h1 class="display">Sıkça sorulan sorular</h1>
<x-web.answer>Askıda, bağışçının önceden ödediği ürünü dileyen herkesin hesapsız ve kimliksiz aldığı bir iyilik ağıdır. Aşağıda hesap, kod, günlük sınır, konum, komisyon, esnaf katılımı ve veri silme hakkında on beş soruyu kısa cevaplarla bulabilirsiniz; rakamlar uygulamadaki ayarlardan gelir ve sayfalar arasında değişmez. Her cevap kısa ve düz bir dille yazılmıştır.</x-web.answer>
</div>
</div>
</section>
<section class="section rail-top" aria-label="Sorular">
<div class="wrap">
<div class="faq">
@foreach ($pairs as [$question, $answer])
<details>
<summary>{{ $question }}</summary>
<p>{{ $answer }}</p>
</details>
@endforeach
</div>
</div>
</section>
<x-web.download-band />
</x-web.layout>
