<!DOCTYPE html>
<html lang="tr">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="robots" content="noindex">
        <title>Hesabını sil · Askıda</title>
        <style @nonce>
            :root { color-scheme: light; }
            body { margin: 0; background: #FBF8F3; color: #2B2B2B; font-family: system-ui, sans-serif; line-height: 1.55; }
            main { max-width: 40rem; margin: 0 auto; padding: 2rem 1rem 3rem; }
            .brand { color: #C8763A; font-weight: 700; font-size: 1.25rem; margin: 0 0 1.5rem; }
            h1 { font-size: 1.75rem; margin: 0 0 .75rem; }
            h2 { font-size: 1.1rem; margin: 1.75rem 0 .5rem; }
            ul { padding-left: 1.25rem; }
            li { margin: .25rem 0; }
            .notice { border-radius: .5rem; padding: .875rem 1rem; margin: 1.25rem 0; border: 1px solid; }
            .notice-error { background: #FBEAE5; border-color: #D9826C; }
            .notice-done { background: #EAF4EC; border-color: #7FB08A; }
            form { margin-top: 1.5rem; display: grid; gap: .75rem; }
            label { font-weight: 600; }
            input { font: inherit; padding: .625rem .75rem; border: 1px solid #B9B2A8; border-radius: .375rem; background: #FFFFFF; }
            button { font: inherit; font-weight: 700; padding: .75rem 1rem; border: 0; border-radius: .375rem; background: #A3452C; color: #FFFFFF; cursor: pointer; }
            button:focus-visible, input:focus-visible { outline: 3px solid #C8763A; outline-offset: 2px; }
        </style>
    </head>
    <body>
        <main>
            <p class="brand">Askıda</p>
            <h1>Hesabını sil</h1>
            <p>Bağışçı ve esnaf hesapları bu sayfadan ya da uygulamadaki hesap ayarlarından silinebilir.</p>

            @if ($state === 'done')
                <div class="notice notice-done" role="status">
                    <p><strong>Silme talebin alındı.</strong> Hesabın kapatıldı ve e-posta adresine bir onay gönderdik.</p>
                    <p>Fikrini değiştirirsen {{ $until }} tarihine kadar uygulamaya giriş yapman yeterli; talebin iptal olur.</p>
                </div>
            @elseif ($state === 'merchant_blocked')
                <div class="notice notice-error" role="alert">
                    <p><strong>Hesabın şu an silinemiyor.</strong> Dükkânında henüz kullanılmamış ürünler var (askıda bekleyen ya da ayrılmış).</p>
                    <p>Bu ürünler alınana kadar beklemen ya da destek ekibine yazman gerekiyor. Ekip ürünleri bağışçılara bilgi vererek başka bir onaylı dükkâna aktarabilir ya da ödeme sağlayıcısı üzerinden iade başlatabilir.</p>
                </div>
            @elseif ($state === 'invalid')
                <div class="notice notice-error" role="alert">
                    <p><strong>E-posta adresi veya şifre hatalı.</strong> Apple ya da Google ile giriş yapıyorsan hesabını uygulamadan silebilirsin.</p>
                </div>
            @endif

            <h2>Ne olur?</h2>
            <ul>
                <li>Hesabın hemen kapatılır: bütün cihazlardaki oturumların sonlanır ve bildirimler durur.</li>
                <li>{{ $graceDays }} gün içinde yeniden giriş yaparsan silme talebin iptal olur ve hesabın açılır.</li>
                <li>{{ $graceDays }} günün sonunda adın, e-posta adresin ve hesabına bağlı diğer kişisel verilerin kalıcı olarak silinir.</li>
                <li>Bağış kayıtları yasal muhasebe yükümlülükleri nedeniyle saklanır, ancak kimliğinle ilişkisi kaldırılır.</li>
            </ul>

            <h2>Esnaf hesapları</h2>
            <p>Dükkânında askıda bekleyen ya da ayrılmış ürün varsa hesap silinemez. Önce bu ürünlerin alınması ya da destek ekibinin aktarım veya iade yapması gerekir. Silme tamamlanınca doğrulama belgelerin de kalıcı olarak silinir.</p>

            <h2>Apple veya Google ile giriş yaptıysan</h2>
            <p>Şifresi olmayan hesaplar bu sayfadan silinemez. Uygulamada hesap ayarlarındaki <strong>Hesabı sil</strong> adımını kullan; kimliğini Apple ya da Google ile yeniden doğrulaman istenir.</p>

            <h2>Askıdan al modu</h2>
            <p>Askıdan al modunda hesap açılmaz. Uygulamadaki <strong>Verilerimi sıfırla</strong> seçeneği cihazına bağlı verileri hemen siler.</p>

            @if ($state !== 'done')
                <h2>Hesabımı sil</h2>
                <p>Devam etmek için hesabının e-posta adresini ve şifreni gir.</p>
                <form method="post" action="{{ route('web.account-deletion.store') }}">
                    @csrf
                    <label for="email">E-posta adresi</label>
                    <input id="email" name="email" type="email" autocomplete="email" required maxlength="254">
                    <label for="password">Şifre</label>
                    <input id="password" name="password" type="password" autocomplete="current-password" required maxlength="128">
                    <button type="submit">Hesabımı sil</button>
                </form>
            @endif
        </main>
    </body>
</html>
