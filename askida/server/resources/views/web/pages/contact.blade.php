@use('App\Support\Web\Facts')
<x-web.layout :meta="$meta" :sample-notice="true">
<section class="page-head">
<div class="wrap">
<nav class="breadcrumbs" aria-label="Sayfa yolu"><ol><li><a href="/">Askıda</a></li><li aria-current="page">İletişim</li></ol></nav>
<h1 class="display">İletişim</h1>
<x-web.answer>Askıda ile iletişim için aşağıdaki örnek adres ve işletme adı kullanılır. Adres henüz aktif değildir; uygulama yayımlanmadan önce gerçek bir iletişim kanalı belirlenir. Hesabınızı silmek istiyorsanız hesap silme sayfasını, uygulamanın nasıl çalıştığını öğrenmek istiyorsanız sıkça sorulan soruları kullanabilirsiniz. Bu sayfa bir iletişim formu içermez; yazılı adres tıklanabilir bir bağlantı değil, düz metindir.</x-web.answer>
</div>
</section>
<section class="section" aria-labelledby="details-title">
<div class="wrap stack-lg">
<h2 id="details-title" class="title1">İletişim bilgileri</h2>
<dl class="facts-list">
<dt>E-posta</dt><dd><span class="tabular">{{ $email }}</span> (örnek adres, aktif değil)</dd>
<dt>İşletme adı</dt><dd>{{ Facts::LEGAL_NAME }}</dd>
</dl>
<p class="measure">İletişim formu yoktur. Bu sayfada yazan adres tıklanabilir bir bağlantı değildir.</p>
</div>
</section>
<section class="section" aria-labelledby="links-title">
<div class="wrap stack-lg">
<h2 id="links-title" class="title1">Sık gidilen sayfalar</h2>
<ul class="link-grid">
<li><a href="/hesap-silme">Hesap silme</a></li>
<li><a href="/sss">Sıkça sorulanlar</a></li>
<li><a href="/kvkk-aydinlatma">KVKK aydınlatma metni</a></li>
<li><a href="/gizlilik">Gizlilik</a></li>
</ul>
</div>
</section>
</x-web.layout>
