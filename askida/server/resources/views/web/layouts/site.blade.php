<!DOCTYPE html>
<html lang="{{ $meta->lang }}">
<head>
<x-web.head :meta="$meta" />
</head>
<body>
<a class="skip-link" href="#main">{{ $meta->lang === 'en' ? 'Skip to content' : 'İçeriğe geç' }}</a>
<x-web.nav :lang="$meta->lang" />
@if ($sampleNotice)
<x-web.sample-notice />
@endif
<main id="main">
{{ $slot }}
</main>
<x-web.footer :lang="$meta->lang" />
</body>
</html>
