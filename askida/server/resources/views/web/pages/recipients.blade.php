@use('App\Support\Web\Facts')
<x-web.layout :meta="$meta">
<section class="page-head">
<div class="wrap head-grid">
<x-web.art name="code" class="head-art" />
<div>
<nav class="breadcrumbs" aria-label="Sayfa yolu"><ol><li><a href="/">Askıda</a></li><li aria-current="page">Askıdan al</li></ol></nav>
<h1 class="display">Askıdan almak ayıp değil</h1>
<x-web.answer>Askıdan almak için hesap açmanız, kimlik göstermeniz ya da kesin konumunuzu paylaşmanız gerekmez. Uygulamada yakındaki bir dükkânı ve ürünü seçersiniz, {{ Facts::codeLength() }} karakterlik tek kullanımlık kodu alırsınız ve {{ Facts::codeValidMinutes() }} dakika içinde dükkânda gösterirsiniz. Kimse kim olduğunuzu sormaz, hiçbir şey sizinle ilişkilendirilmez; esnaf yalnızca verilen ürünü görür.</x-web.answer>
</div>
</div>
</section>
<section class="section rail-top" aria-labelledby="steps-title">
<div class="wrap">
<h2 id="steps-title" class="headline section-title">Nasıl alırsınız</h2>
<ol class="steps">
<li><strong>Uygulamayı açın</strong> İlk ekrandaki "Askıdan al" seçeneği hesap istemez.</li>
<li><strong>Dükkânı seçin</strong> Yakındaki dükkânlarda kaç ürün askıda olduğunu görürsünüz; yaklaşık konum ya da ilçe seçimi yeterlidir.</li>
<li><strong>Kodu alın</strong> Ürüne dokunursunuz; kod ve QR ekrana gelir.</li>
<li><strong>Dükkânda gösterin</strong> Esnaf kodu okutur ve ürünü verir. Süre dolarsa ürün askıya geri döner.</li>
</ol>
</div>
</section>
<section class="section" aria-labelledby="private-title">
<div class="wrap split">
<div class="stack">
<h2 id="private-title" class="headline">Sizinle ilgili ne saklanmaz</h2>
<p class="lead">Cihaz onayı yalnızca uygulamanın gerçek bir cihazda çalıştığını doğrular; saklanan tek şey onay sonucudur.</p>
</div>
<div class="receipt">
<p class="receipt-head">Askıdan alırken</p>
<dl>
<div><dt>Hesap yok</dt><dd>E-posta, telefon, ad ya da şifre istenmez.</dd></div>
<div><dt>Kimlik yok</dt><dd>Bağışçı da esnaf da kimin aldığını görmez; esnaf yalnızca verilen ürünü görür.</dd></div>
<div><dt>Konum kaydı yok</dt><dd>Kesin konumunuz kaydedilmez. Arama yarıçapı {{ Facts::radiusDefaultM() / 1000 }} km, en fazla {{ Facts::radiusMaxM() / 1000 }} km olur.</dd></div>
<div><dt>Puanlama yok</dt><dd>Kimse derecelendirilmez; alım geçmişiniz listelenmez.</dd></div>
<div><dt>Toplu sayaç</dt><dd>Yalnızca 30 günlük toplam ürün adedi tutulur; kişi içermez.</dd></div>
</dl>
</div>
</div>
</section>
<section class="section" aria-labelledby="limits-title">
<div class="wrap">
<h2 id="limits-title" class="headline section-title">Askının herkese yetmesi için</h2>
<p class="statement">Bir cihaz günde en fazla {{ Facts::anonDailyCap() }} ürün alabilir; aynı dükkândan günde {{ Facts::anonShopDailyCap() }} ürün alınır.</p>
<p class="lead">Bu sınır, askıdaki ürünlerin mahalledeki herkese ulaşması içindir. <a href="/sss">Sıkça sorulan sorular</a></p>
</div>
</section>
<x-web.download-band heading="Uygulamayı açın, askıdan alın" text="Askıdan almak için hesap gerekmez." />
</x-web.layout>
