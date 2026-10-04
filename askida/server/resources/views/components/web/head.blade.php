<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{ $meta->title }}</title>
<meta name="description" content="{{ $meta->description }}">
<meta name="robots" content="{{ $meta->robots }}">
<link rel="canonical" href="{{ $meta->canonical }}">
@foreach ($meta->alternates as $alternate)
<link rel="alternate" hreflang="{{ $alternate['hreflang'] }}" href="{{ $alternate['href'] }}">
@endforeach
<link rel="preload" href="{{ $textFont() }}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="{{ $stylesheet() }}">
<link rel="icon" href="/logo/askida-favicon.svg" type="image/svg+xml">
<meta name="theme-color" content="#F4F0E8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#171411" media="(prefers-color-scheme: dark)">
<meta property="og:site_name" content="{{ \App\Support\Web\Facts::BRAND }}">
<meta property="og:type" content="{{ $meta->ogType }}">
<meta property="og:title" content="{{ $meta->title }}">
<meta property="og:description" content="{{ $meta->description }}">
<meta property="og:url" content="{{ $meta->canonical }}">
<meta property="og:image" content="{{ $meta->ogImageUrl() }}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="{{ $meta->ogLocale() }}">
<meta name="twitter:card" content="summary_large_image">
@if ($meta->modifiedAt !== null)
<meta property="article:modified_time" content="{{ $meta->modifiedAt->toAtomString() }}">
@endif
@if ($iosAppId() !== null)
<meta name="apple-itunes-app" content="app-id={{ $iosAppId() }}">
@endif
@foreach ($meta->jsonLdBlocks() as $block)
<script type="application/ld+json">@json($block, \App\Support\Web\JsonLd::FLAGS)</script>
@endforeach
