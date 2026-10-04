<?php

use App\Support\Web\TurkishSlug;

it('folds Turkish letters before lowercasing', function (string $name, string $slug): void {
    expect(TurkishSlug::make($name))->toBe($slug);
})->with([
    ['İstanbul', 'istanbul'],
    ['ISPARTA', 'isparta'],
    ['Iğdır', 'igdir'],
    ['Şişli', 'sisli'],
    ['Kadıköy Moda', 'kadikoy-moda'],
    ['Üsküdar', 'uskudar'],
    ['Çanakkale', 'canakkale'],
    ['Muğla', 'mugla'],
    ['Ağrı', 'agri'],
    ['Kâhta', 'kahta'],
    ['Şanlıurfa / Eyyübiye', 'sanliurfa-eyyubiye'],
    ['  Bakırköy -- Yeşilköy  ', 'bakirkoy-yesilkoy'],
    ['19 Mayıs', '19-mayis'],
]);

it('never leaves characters outside a-z, 0-9 and single inner hyphens', function (string $value): void {
    expect(TurkishSlug::make($value))->toMatch('/^(?:[a-z0-9]+(?:-[a-z0-9]+)*)?$/');
})->with([
    '<script>alert(1)</script>',
    '"><img src=x onerror=alert(1)>',
    "Çınar\nFırını\t2",
    '---',
    '',
    'Ünlü & Ortaklar',
]);
