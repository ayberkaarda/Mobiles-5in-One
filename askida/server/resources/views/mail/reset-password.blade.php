@component('mail.layout', ['title' => 'Şifre sıfırlama kodun'])
    <p>Merhaba {{ $name }},</p>
    <p>Şifreni sıfırlamak için bu kodu uygulamaya gir:</p>
    <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:24px 0;">{{ $code }}</p>
    <p>Kod {{ $minutes }} dakika geçerli ve yalnızca bir kez kullanılabilir. Şifren değişince bütün cihazlardaki oturumların kapanır.</p>
    <p>Bu isteği sen yapmadıysan şifren değişmez; bu e-postayı yok sayabilirsin.</p>
@endcomponent
