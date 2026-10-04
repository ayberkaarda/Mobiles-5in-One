@props(['lang' => 'tr'])
@php
    $links = $lang === 'en'
        ? ['/hakkinda' => 'About (Turkish)', '/iletisim' => 'Contact (Turkish)', '/gizlilik' => 'Privacy (Turkish)', '/kvkk-aydinlatma' => 'KVKK notice (Turkish)', '/hesap-silme' => 'Delete an account']
        : ['/hakkinda' => 'Hakkında', '/sss' => 'Sıkça sorulanlar', '/etki' => 'Etki ve açık veri', '/iletisim' => 'İletişim', '/gizlilik' => 'Gizlilik', '/kvkk-aydinlatma' => 'KVKK aydınlatma metni', '/hesap-silme' => 'Hesap silme'];
@endphp
<footer class="site-footer">
<div class="wrap">
<p class="tagline" lang="tr">{{ \App\Support\Web\Facts::TAGLINE }}</p>
<p class="footnote">{{ \App\Support\Web\Facts::LEGAL_NAME }}</p>
<ul class="footer-links">
@foreach ($links as $href => $text)
<li><a href="{{ $href }}">{{ $text }}</a></li>
@endforeach
</ul>
</div>
</footer>
