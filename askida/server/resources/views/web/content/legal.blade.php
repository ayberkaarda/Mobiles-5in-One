<x-web.layout :meta="$meta" :sample-notice="true">
<section class="page-head">
<div class="wrap measure">
<nav class="breadcrumbs" aria-label="Sayfa yolu">
<ol>
<li><a href="/">Askıda</a></li>
<li>{{ $page->title }}</li>
</ol>
</nav>
<h1 class="display">{{ $page->title }}</h1>
<x-web.answer>{{ $page->answer }}</x-web.answer>
<p class="footnote">{{ $footnote }}</p>
</div>
</section>
<section class="section-dense">
<div class="wrap">
<x-web.prose :html="$page->body" />
</div>
</section>
</x-web.layout>
