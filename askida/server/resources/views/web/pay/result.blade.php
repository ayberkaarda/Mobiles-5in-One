@extends('web.pay.layout')

@section('title', 'Ödeme sonucu')

@section('content')
    @if ($status === 'paid')
        <h1>Teşekkürler!</h1>
        <p>Bağışın alındı ve askıya bırakıldı. Makbuzunu e-posta adresine gönderiyoruz.</p>
    @elseif ($status === 'failed')
        <h1>Ödeme tamamlanamadı</h1>
        <p>Kartından bir tutar çekilmedi. Uygulamaya dönüp yeniden deneyebilirsin.</p>
    @else
        <h1>Ödemen kontrol ediliyor</h1>
        <p>Sonuç birkaç dakika içinde uygulamadaki bağış geçmişinde görünecek.</p>
    @endif
    <p><a class="button" id="back-to-app" href="{{ $deepLink }}">Uygulamaya dön</a></p>
    <script @nonce>
        window.location.href = document.getElementById('back-to-app').getAttribute('href');
    </script>
@endsection
