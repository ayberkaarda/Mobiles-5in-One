@props(['variant' => 'secondary'])
{{-- variant: secondary (quiet chip), accent (count on the rail) or sample (the literal ÖRNEK label). --}}
@php($text = $variant === 'sample' && $slot->isEmpty() ? 'ÖRNEK' : $slot)
<span {{ $attributes->class(['tag', 'tag-accent' => $variant === 'accent', 'tag-sample' => $variant === 'sample']) }}>{{ $text }}</span>
