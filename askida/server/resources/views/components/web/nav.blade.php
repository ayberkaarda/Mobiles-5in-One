@props(['lang' => 'tr'])
@php
    $links = $lang === 'en'
        ? ['/en/how-it-works' => 'How it works', '/' => 'Türkçe']
        : ['/nasil-calisir' => 'Nasıl çalışır', '/esnaf' => 'Esnaf', '/bagisci' => 'Bağışçı', '/askidan-al' => 'Askıdan al', '/etki' => 'Etki', '/sss' => 'SSS'];
    $current = '/'.trim(request()->getPathInfo(), '/');
@endphp
<header class="site-header">
<div class="wrap">
<a class="brand" href="{{ $lang === 'en' ? '/en' : '/' }}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M3 4H21M12 4V8"/><path fill="currentColor" fill-rule="evenodd" d="M9 8H15A3 3 0 0 1 18 11V18A3 3 0 0 1 15 21H9A3 3 0 0 1 6 18V11A3 3 0 0 1 9 8ZM10.5 11.5A1.5 1.5 0 1 0 13.5 11.5A1.5 1.5 0 1 0 10.5 11.5Z"/></svg>askıda</a>
<nav class="nav" aria-label="{{ $lang === 'en' ? 'Main' : 'Ana menü' }}">
<ul>
@foreach ($links as $href => $text)
<li><a {{ new \Illuminate\View\ComponentAttributeBag(array_filter(['href' => $href, 'aria-current' => $current === $href ? 'page' : null, 'hreflang' => $href === '/' && $lang === 'en' ? 'tr' : null, 'lang' => $href === '/' && $lang === 'en' ? 'tr' : null])) }}>{{ $text }}</a></li>
@endforeach
</ul>
</nav>
</div>
</header>
