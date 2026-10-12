import { app, Block, h2, note, ol, p, to, ul } from './blocks';

export const verifyBlocks: Block[] = [
  p(
    'Bir hat bilgisi, bir katkıcı onu önerdiğinde değil, bir moderatör onayladığında yayımlanır. Önerinin her alanı doğrulanır, onaydan sonra hat yeni bir sürüm olur ve sayfada sürüm numarası, tarihi ve son doğrulama zamanı görünür. Eski sürümler silinmez; yanlış bir düzeltme geri alınabilir. Bu rehber, bir bilginin sayfaya nasıl ulaştığını ve sen nasıl katkı verebileceğini anlatıyor.',
  ),
  p(
    'İnecek Var resmî bir kurum değildir. Dolmuş ve minibüs hatlarının çoğunda resmî bir veri yoktur; bu yüzden güven, kaynağın kim olduğuna değil, sürecin açık olmasına dayanır. Aşağıda bu süreci adım adım yazıyoruz.',
  ),
  h2('Katkı türleri'),
  ul(
    'Yeni hat önerisi: hat izi, duraklar, ücret, saat ve durdurma notu.',
    'Mevcut hatta düzeltme: yalnızca değişen alanlar önerilir; sistem eski sürümle farkı hesaplar.',
    'Yeni durak ya da durak düzeltmesi.',
    'Ücret güncellemesi: yeni ücret ve ücretin geçerli olduğu tarih.',
    'Hattın kaldırılması önerisi.',
  ),
  p(
    'Boş bir değişiklik kabul edilmez. Her öneri bilinen sınırlardan geçer: koordinatlar şehrin sınırları içinde olmalı, hat izi makul bir uzunlukta ve geçerli bir çizgi olmalı, ücret mantıklı bir aralıkta olmalı, metinler sınırlı uzunlukta ve kontrol karakteri içermemelidir. Bu kontroller moderatör bakmadan önce sunucuda yapılır.',
  ),
  h2('İz kaydı: yolculuğu kayda alarak hat çizmek'),
  p(
    'Hattın geometrisini elle çizmek yerine bir yolculuk sırasında konum kaydı alabilirsin. Kayıt, uygulama açıkken ve yalnızca sen başlattığında tutulur. Cihazda sadeleştirilir ve bir kayıt en fazla 5 000 nokta içerebilir. Ham iz kaydı özeldir; yalnızca sen ve moderatörler görebilir, herkese açık hiçbir sayfada ya da dışa aktarımda yer almaz.',
  ),
  p(
    'Evin ve işyerin genellikle yolculuğun başında ve sonunda olduğu için, kayıttan türetilen hat izinde ilk ve son 200 metre kesilir. Ayrıca yolculuk sırasında başlangıca ya da bitişe 200 metreden yakın geçen kısımlar da hat izine alınmaz. Geriye 100 metreden az kalırsa kayıt hat izi olarak kullanılamaz ve hattı elle çizmen istenir. Öneriye yalnızca türetilen, kısaltılmış geometri eklenir; ham iz öneriye bağlanmaz.',
  ),
  h2('Fotoğraf eklemek'),
  p(
    'Ücret tablosunun ya da durak levhasının fotoğrafını önerine ekleyebilirsin. Fotoğraf JPEG ya da WebP olmalı ve 4 MB’ı geçmemelidir. Sunucu fotoğrafı yeniden kodlar ve konum gibi gizli üst bilgileri siler. Bir fotoğraf önce karantina alanında kontrol edilir; sorun çıkarsa yayımlanmaz.',
  ),
  h2('Moderasyon: onay, red, geri alma'),
  ol(
    'Öneri kuyruğa düşer. Moderatör, önerinin harita üzerindeki farkını eski sürümle yan yana görür.',
    'Moderatör onaylarsa hat için yeni bir sürüm oluşur: sıralı duraklarla birlikte, değiştirilemez bir kayıt olarak.',
    'Reddederse bir gerekçe yazar ve katkıcı bunu görür.',
    'Bir sürüm sonradan yanlış çıkarsa, daha önceki bir sürüm yeni bir sürüm olarak kopyalanarak yayımlanır. Eski sürümler asla değiştirilmez.',
  ),
  p(
    'Kimse kendi önerisini onaylayamaz. Bir moderatör, son 30 günde kendi önerisini onaylamış birinin önerisini karşılık olarak onaylayamaz; bu, iki hesabın birbirini onaylayarak sisteme sahte bilgi sokmasını zorlaştırır. Geri alma ve hat kaldırma gibi yıkıcı işlemler ek bir doğrulama adımı gerektirir ve her moderasyon işlemi bir denetim kaydı bırakır.',
  ),
  h2('Sayfada ne görürsün'),
  ul(
    'Son doğrulama: hattın en son onaylandığı zaman.',
    'Katkıcı sayısı: hattı yazan ya da düzelten farklı kişilerin sayısı. Kişi adı gösterilmez.',
    'Sürüm numarası ve tarihi: sayfadaki bilginin hangi onaylı kayıttan geldiği.',
    'Ücretin güncelleme tarihi: ücret ayrıca tarihlenir.',
  ),
  h2('Lisans ve katkı'),
  p(
    'İlk katkıdan önce katkı lisansı sana gösterilir ve kabul etmen istenir. Önerilen lisans CC BY 4.0’dır; ancak bu lisans için hukuki onay beklenmektedir ve henüz verilmiş bir lisans yoktur. Güncel durumu ',
    to('/veri-lisansi', 'veri lisansı sayfasında'),
    ' bulabilirsin. Hesabını silersen onaylanmış katkıların kalır ancak adın kaldırılır; bunlar "silinmiş katkıcı" olarak görünür. Ayrıntılar ',
    to('/hesap-silme', 'hesap silme sayfasında'),
    '.',
  ),
  h2('Nasıl katkı verirsin'),
  ol(
    [
      'Hat sayfasının altındaki "Bu hattı düzelt" bağlantısına bas ya da ',
      app('/', 'uygulamada'),
      ' Katkı sekmesini aç.',
    ],
    'Giriş yap. Katkı için e-posta adresi gerekir; hesap açmadan hat okuyabilirsin.',
    'Lisansı kabul et.',
    'Neyi düzeltmek istediğini seç: ücret, saat, durak, hat izi ya da hattın kaldırılması.',
    'Gönder. Önerin kuyruğa düşer ve durumunu "Önerilerim" bölümünden takip edersin.',
  ),
  p(
    'Öneri sayısı itibara göre sınırlıdır: yeni katkıcılar günde on, daha çok onaylanmış katkısı olanlar günde yüz öneri gönderebilir. Her onaylanan öneri itibarını artırır.',
  ),
  note(
    'Doğrulama süreci hatasız değildir. Bir bilgi yanlışsa lütfen düzeltme öner; sayfadaki tarihler bilginin ne kadar taze olduğunu açıkça söyler ve eski bilgi sana eski olduğunu belli eder.',
  ),
  p(
    'Hattın nasıl okunduğunu ',
    to('/rehber/dolmus-ve-minibus-hatti-nasil-okunur', 'hat okuma rehberinde'),
    ' ve sık sorulan soruları ',
    to('/sss', 'SSS sayfasında'),
    ' bulabilirsin.',
  ),
];
