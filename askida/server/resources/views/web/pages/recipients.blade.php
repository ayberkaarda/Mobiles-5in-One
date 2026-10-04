@use('App\Support\Web\Facts')
<x-web.layout :meta="$meta">
<section class="page-head">
<div class="wrap">
<nav class="breadcrumbs" aria-label="Sayfa yolu"><ol><li><a href="/">Askıda</a></li><li aria-current="page">Askıdan al</li></ol></nav>
<h1 class="display">Askıdan almak ayıp değil</h1>
<x-web.answer>Askıdan almak için hesap açmanız, kimlik göstermeniz ya da kesin konumunuzu paylaşmanız gerekmez. Uygulamada yakındaki bir dükkânı ve ürünü seçersiniz, {{ Facts::codeLength() }} karakterlik tek kullanımlık kodu alırsınız ve {{ Facts::codeValidMinutes() }} dakika içinde dükkânda gösterirsiniz. Kimse kim olduğunuzu sormaz, hiçbir şey sizinle ilişkilendirilmez; esnaf yalnızca verilen ürünü görür.</x-web.answer>
</div>
</section>
<section class="section" aria-labelledby="steps-title">
<div class="wrap stack-lg">
<h2 id="steps-title" class="title1">Nasıl alırsınız</h2>
<ol class="stack">
<li><strong>Uygulamayı açın.</strong> İlk ekrandaki "Askıdan al" seçeneği hesap istemez.</li>
<li><strong>Dükkânı seçin.</strong> Yakındaki dükkânlarda kaç ürün askıda olduğunu görürsünüz; yaklaşık konum ya da ilçe seçimi yeterlidir.</li>
<li><strong>Kodu alın.</strong> Ürüne dokunursunuz; kod ve QR ekrana gelir.</li>
<li><strong>Dükkânda gösterin.</strong> Esnaf kodu okutur ve ürünü verir. Süre dolarsa ürün askıya geri döner.</li>
</ol>
</div>
</section>
<section class="section" aria-labelledby="private-title">
<div class="wrap stack-lg">
<h2 id="private-title" class="title1">Sizinle ilgili ne saklanmaz</h2>
<dl class="facts-list">
<dt>Hesap yok</dt><dd>E-posta, telefon, ad ya da şifre istenmez.</dd>
<dt>Kimlik yok</dt><dd>Bağışçı da esnaf da kimin aldığını görmez; esnaf yalnızca verilen ürünü görür.</dd>
<dt>Konum kaydı yok</dt><dd>Kesin konumunuz kaydedilmez. Arama yarıçapı {{ Facts::radiusDefaultM() / 1000 }} km, en fazla {{ Facts::radiusMaxM() / 1000 }} km olur.</dd>
<dt>Puanlama yok</dt><dd>Kimse derecelendirilmez; alım geçmişiniz listelenmez.</dd>
<dt>Toplu sayaç</dt><dd>Yalnızca 30 günlük toplam ürün adedi tutulur; kişi içermez.</dd>
</dl>
<p class="measure">Cihaz onayı yalnızca uygulamanın gerçek bir cihazda çalıştığını doğrular; saklanan tek şey onay sonucudur.</p>
</div>
</section>
<section class="section" aria-labelledby="limits-title">
<div class="wrap stack-lg">
<h2 id="limits-title" class="title1">Askının herkese yetmesi için</h2>
<p class="measure">Bir cihaz günde en fazla {{ Facts::anonDailyCap() }} ürün alabilir; aynı dükkândan günde {{ Facts::anonShopDailyCap() }} ürün alınır. Bu sınır, askıdaki ürünlerin mahalledeki herkese ulaşması içindir.</p>
<p><a href="/sss">Sıkça sorulan sorular</a></p>
</div>
</section>
<x-web.download-band heading="Uygulamayı açın, askıdan alın" text="Askıdan almak için hesap gerekmez." />
</x-web.layout>
