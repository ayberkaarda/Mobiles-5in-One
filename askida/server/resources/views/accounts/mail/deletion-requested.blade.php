@component('mail.layout', ['title' => 'Hesap silme talebin alındı'])
    <p>Merhaba {{ $name }},</p>
    <p>Askıda hesabını silme talebini aldık. Hesabın şu an kapalı: bütün cihazlardaki oturumların sonlandı ve bildirimler durduruldu.</p>
    <p>Fikrini değiştirirsen {{ $until }} tarihine kadar uygulamaya yeniden giriş yapman yeterli; talebin iptal olur ve hesabın açılır.</p>
    <p>Bu tarihten sonra adın, e-posta adresin ve hesabına bağlı diğer kişisel verilerin kalıcı olarak silinir. Bağış kayıtları yasal muhasebe yükümlülükleri nedeniyle saklanır, ancak kimliğinle ilişkisi kaldırılır.</p>
    <p>Bu talebi sen yapmadıysan hemen uygulamaya giriş yap: talep iptal olur. Ardından şifreni değiştirmeni öneririz.</p>
@endcomponent
