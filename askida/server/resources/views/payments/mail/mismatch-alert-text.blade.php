Ödeme uyuşmazlığı tespit edildi / Payment mismatch detected

Tür / Kind: {{ $kind }}
Uyuşmazlık / Mismatch id: {{ $mismatchId }}
Bağış / Donation id: {{ $donationId }}
Tespit / Detected (Europe/Istanbul): {{ $detectedAt }}

Bizim kayıt / Our record:
@foreach ($ours as $key => $value)
- {{ $key }}: {{ $value === null ? '-' : (is_bool($value) ? ($value ? 'true' : 'false') : $value) }}
@endforeach

Sağlayıcı / Provider:
@foreach ($theirs as $key => $value)
- {{ $key }}: {{ $value === null ? '-' : (is_bool($value) ? ($value ? 'true' : 'false') : $value) }}
@endforeach

Tutarlar kuruş cinsindendir. / Amounts are in kuruş (TRY minor units).
Yönetim panelinde inceleyip not ile çözün. / Review and resolve it with a note in the admin panel.
