<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>{{ config('app.name') }}</title>
        <style @nonce>
            body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #FBF8F3; color: #2B2B2B; font-family: system-ui, sans-serif; }
            main { max-width: 32rem; padding: 1.5rem; text-align: center; }
            h1 { color: #C8763A; margin: 0 0 .5rem; }
        </style>
    </head>
    <body>
        <main>
            <h1>Askıda</h1>
            <p>Ön ödemeli iyilik ağı. Web sayfaları hazırlanıyor.</p>
        </main>
    </body>
</html>
