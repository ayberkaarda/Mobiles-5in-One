@use('App\Support\Web\Facts')
<x-web.layout :meta="$meta">
<section class="page-head">
<div class="wrap">
<nav class="breadcrumbs" aria-label="Sayfa yolu"><ol><li><a href="/">Askıda</a></li><li aria-current="page">Esnaf</li></ol></nav>
<h1 class="display">Esnaf için Askıda</h1>
<x-web.answer>Fırın, lokanta, kırtasiye ya da manav olarak dükkânınızı Askıda'ya kaydedersiniz; belgeleriniz doğrulandıktan sonra bağışçılar ürünlerinizi önceden öder. Gelen kodu okutup ürünü verirsiniz. Ödeme ödeme kuruluşu üzerinden doğrudan size ulaşır, Askıda parayı tutmaz; yalnızca komisyonunu kaydeder. Doğrulama tamamlanmadan dükkânınız kimseye görünmez, alanın kimliği size de gösterilmez.</x-web.answer>
<div class="actions">
<a class="button button-primary" href="#indir">Uygulamada kayıt ol</a>
<a href="/sss">Sıkça sorulan sorular</a>
</div>
</div>
</section>
<section class="section" aria-labelledby="why-title">
<div class="wrap stack-lg">
<h2 id="why-title" class="title1">Dükkânınıza ne getirir</h2>
<ul class="rail-list">
<li><span>Önceden ödenmiş ürünler dükkânınızın askısında bekler.</span></li>
<li><span>Yeni bir askı eklendiğinde bildirim alırsınız.</span></li>
<li><span>Panelde yalnızca "1 ekmek verildi" görürsünüz; alanın kimliği yoktur.</span></li>
<li><span>Bağışlar, verilen ürün sayısı ve uzlaşma durumu tek yerde görünür.</span></li>
</ul>
</div>
</section>
<section class="section" aria-labelledby="join-title">
<div class="wrap stack-lg">
<h2 id="join-title" class="title1">Nasıl katılırsınız</h2>
<ol class="stack">
<li><strong>Kayıt.</strong> Uygulamada esnaf hesabı açar; dükkân adı, türü, adresi, harita konumu, telefonu ve vergi numarasını girersiniz.</li>
<li><strong>Belgeler.</strong> Vergi levhası ve işletme belgesi gibi en fazla 3 belge yüklersiniz; ödeme alabilmeniz için IBAN bilgisi de istenir.</li>
<li><strong>Doğrulama.</strong> Belgeleriniz incelenir. Doğrulama tamamlanmadan dükkânınız kimseye görünmez.</li>
<li><strong>Katalog.</strong> Ürünlerinizi, fiyatlarını ve ürün başına günlük alım sınırını belirlersiniz.</li>
</ol>
<p class="measure">Dükkânınızın web sitesindeki sayfası ayrıca sizin izninize bağlıdır; izin vermezseniz dükkânınız yalnızca uygulamada görünür.</p>
</div>
</section>
<section class="section" aria-labelledby="pay-title">
<div class="wrap stack-lg">
<h2 id="pay-title" class="title1">Ödeme ve komisyon</h2>
<dl class="facts-list">
<dt>Para akışı</dt><dd>Bağışçıdan ödeme kuruluşuna, oradan dükkânınızın alt üye işyeri hesabına. Askıda parayı kendi hesabında tutmaz.</dd>
<dt>Komisyon</dt><dd>{{ Facts::commissionLabel() }}; kesin oran yayın öncesi belirlenir ve panelde ayrı bir satırdır.</dd>
<dt>Uzlaşma</dt><dd>Aktarım, ödeme kuruluşunun takvimine göre yapılır; durum doğrudan sağlayıcı verisinden okunur.</dd>
<dt>Kod</dt><dd>Her kod {{ Facts::codeLength() }} karakterdir, {{ Facts::codeValidMinutes() }} dakika geçerlidir ve tek kez kullanılır.</dd>
</dl>
</div>
</section>
<x-web.download-band id="indir" heading="Kaydı uygulamadan başlatın" text="Esnaf hesabı uygulamada açılır; belgeleriniz doğrulandıktan sonra dükkânınız askıya açılır." />
</x-web.layout>
