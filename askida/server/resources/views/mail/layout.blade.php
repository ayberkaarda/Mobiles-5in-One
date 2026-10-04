<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ $title }}</title>
</head>
<body style="margin:0;padding:24px;background:#FBF8F3;color:#2B2B2B;font-family:'Nunito Sans',Arial,sans-serif;font-size:16px;line-height:1.5;">
    <div style="max-width:480px;margin:0 auto;">
        <p style="font-family:Fraunces,Georgia,serif;font-size:22px;font-weight:700;color:#C8763A;margin:0 0 24px;">Askıda</p>
        {{ $slot }}
        <p style="font-size:13px;color:#6B6B6B;margin-top:32px;">Bu e-posta Askıda hesabınla ilgili bir işlem için gönderildi.</p>
    </div>
</body>
</html>
