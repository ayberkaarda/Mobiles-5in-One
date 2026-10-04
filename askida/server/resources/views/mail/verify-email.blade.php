@component('mail.layout', ['title' => 'E-posta doğrulama kodun'])
    <p>Merhaba {{ $name }},</p>
    <p>E-posta adresini doğrulamak için bu kodu uygulamaya gir:</p>
    <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:24px 0;">{{ $code }}</p>
    <p>Kod {{ $minutes }} dakika geçerli ve yalnızca bir kez kullanılabilir.</p>
    <p>Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin.</p>
@endcomponent
