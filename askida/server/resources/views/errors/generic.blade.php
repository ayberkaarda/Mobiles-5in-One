<!DOCTYPE html>
<html lang="tr">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="robots" content="noindex">
        <title>Bir sorun oluştu · Askıda</title>
        <style @nonce>
            body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #FBF8F3; color: #2B2B2B; font-family: system-ui, sans-serif; }
            main { max-width: 32rem; padding: 1.5rem; text-align: center; }
            h1 { color: #C8763A; margin: 0 0 .5rem; font-size: 1.5rem; }
            code { font-size: .875rem; }
        </style>
    </head>
    <body>
        <main>
            <h1>
                @if ($status === 404)
                    Aradığınız sayfa bulunamadı.
                @elseif ($status === 403 || $status === 419)
                    Bu işlem için izniniz yok ya da oturumunuzun süresi doldu.
                @elseif ($status === 429)
                    Çok fazla istek gönderildi. Lütfen biraz sonra tekrar deneyin.
                @elseif ($status === 503)
                    Kısa bir bakım çalışması yapıyoruz. Lütfen biraz sonra tekrar deneyin.
                @elseif ($status >= 400 && $status < 500)
                    İsteğiniz işlenemedi.
                @else
                    Beklenmeyen bir sorun oluştu. Lütfen biraz sonra tekrar deneyin.
                @endif
            </h1>
            <p><a href="/">Ana sayfaya dön</a></p>
            @if ($requestId)
                <p>İstek numarası: <code>{{ $requestId }}</code></p>
            @endif
        </main>
    </body>
</html>
