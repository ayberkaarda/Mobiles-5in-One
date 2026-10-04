<!DOCTYPE html>
<html lang="tr">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="robots" content="noindex, nofollow">
        <meta name="referrer" content="no-referrer">
        <title>@yield('title') · Askıda</title>
        <style @nonce>
            :root { color-scheme: light; }
            body { margin: 0; background: #FBF8F3; color: #2B2B2B; font-family: system-ui, sans-serif; line-height: 1.55; }
            main { max-width: 32rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
            .brand { color: #C8763A; font-weight: 700; font-size: 1.25rem; margin: 0 0 1rem; }
            h1 { font-size: 1.5rem; margin: 0 0 .75rem; }
            dl { display: grid; grid-template-columns: 1fr auto; gap: .375rem 1rem; margin: 1rem 0 1.5rem; padding: 1rem; background: #FFFFFF; border: 1px solid #E5DED3; border-radius: .5rem; }
            dt { color: #6B6B6B; }
            dd { margin: 0; text-align: right; }
            .total { font-weight: 700; }
            .note { font-size: .9rem; color: #6B6B6B; }
            button, .button { display: inline-block; font: inherit; font-weight: 700; padding: .75rem 1rem; border: 0; border-radius: .375rem; background: #A3452C; color: #FFFFFF; cursor: pointer; text-decoration: none; }
            button:focus-visible, a:focus-visible { outline: 3px solid #C8763A; outline-offset: 2px; }
            .fake-checkout { display: grid; gap: .75rem; }
        </style>
    </head>
    <body>
        <main>
            <p class="brand">Askıda</p>
            @yield('content')
        </main>
    </body>
</html>
