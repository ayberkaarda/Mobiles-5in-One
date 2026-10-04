@component('mail.layout', ['title' => 'Bağış makbuzun'])
    <p>Teşekkürler! Bağışın alındı ve askıya bırakıldı.</p>
    <table role="presentation" style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:6px 0;color:#6B6B6B;">Dükkân</td><td style="padding:6px 0;text-align:right;">{{ $shop }}</td></tr>
        <tr><td style="padding:6px 0;color:#6B6B6B;">Ürün</td><td style="padding:6px 0;text-align:right;">{{ $item }}</td></tr>
        <tr><td style="padding:6px 0;color:#6B6B6B;">Adet</td><td style="padding:6px 0;text-align:right;">{{ $qty }}</td></tr>
        <tr><td style="padding:6px 0;color:#6B6B6B;">Toplam</td><td style="padding:6px 0;text-align:right;font-weight:700;">{{ $amount }}</td></tr>
        <tr><td style="padding:6px 0;color:#6B6B6B;">Esnafa giden</td><td style="padding:6px 0;text-align:right;">{{ $net }}</td></tr>
        <tr><td style="padding:6px 0;color:#6B6B6B;">Platform komisyonu</td><td style="padding:6px 0;text-align:right;">{{ $commission }}</td></tr>
        <tr><td style="padding:6px 0;color:#6B6B6B;">Ödeme tarihi</td><td style="padding:6px 0;text-align:right;">{{ $paidAt }}</td></tr>
        <tr><td style="padding:6px 0;color:#6B6B6B;">Makbuz no</td><td style="padding:6px 0;text-align:right;">{{ $reference }}</td></tr>
    </table>
    <p>Ödeme, ödeme kuruluşu üzerinden doğrudan esnafın hesabına aktarılır. Askıda yalnızca platform komisyonunu alır, bağış tutarını elinde tutmaz.</p>
    <p>Askıdaki ürünler, ihtiyacı olan biri tarafından kimliği sorulmadan alınır. Ürün alındığında sana yalnızca "Askın alındı" bildirimi gelir.</p>
@endcomponent
