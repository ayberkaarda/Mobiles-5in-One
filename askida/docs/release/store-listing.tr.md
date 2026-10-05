# Mağaza metni (tr-TR)

Yayımlanmış bir listeleme yoktur: mağaza hesabı yok (**not exercised: no store accounts**). Bu metin
ileride kullanılacak taslaktır. Sınırlar: Google Play kısa açıklama 80, tam açıklama 4000
karakter; App Store ad 30, alt başlık 30, tanıtım metni 170, açıklama 4000, anahtar kelime 100.
Karakter sayıları aşağıdaki tabloda ölçülmüş değerlerdir. Dil kuralı: "askıdan al" denir,
"muhtaç" ve benzeri sözcükler kullanılmaz; alan kişi hiçbir yerde tarif edilmez, gösterilmez.
Ödeme oranı gibi sayılar örnektir; yayın öncesi kesinleşir.

| Alan | Metin | Sınır | Uzunluk |
| --- | --- | --- | --- |
| Başlık | Askıda: Askıda Ekmek & İyilik | 30 | 29 |
| Alt başlık (App Store) | Askıya bırak, askıdan al | 30 | 24 |
| Kısa açıklama (Play) | Esnafa ekmek, çorba, defter bırak; ihtiyacı olan soru sorulmadan askıdan alsın. | 80 | 79 |
| Tanıtım metni (App Store) | Fırından kırtasiyeye, mahalle esnafında bir şey askıya bırak. Alan kişi hesap açmaz, kimse onu görmez. | 170 | 102 |

## Tam açıklama

Askıda, "askıda ekmek" geleneğini telefona taşır. Bir fırında, lokantada, kırtasiyede ya da
manavda bir şeyi önceden öde, dükkân onu askıya assın; ihtiyacı olan biri gelip soru sorulmadan
alsın.

Üç ayrı biçimde kullanılır, tek uygulamada:

ASKIYA BIRAK (bağışçı)
- Doğrulanmış dükkânları yakınında gör, ürünü ve adedi seç.
- Ödemeyi ödeme kuruluşunun güvenli sayfasında yap. Kart bilgisi uygulamaya ve sunucuya hiç gelmez.
- Ödeme onaylanınca ürünler dükkânın askısına asılır ve makbuz e-postana gelir.
- Askıdan kimin aldığı kaydedilmez; alındığında yalnızca "Askın alındı" bildirimi gelir.
- Para dükkâna ödeme kuruluşu üzerinden gider; platform yalnızca komisyonunu alır. Komisyon oranı örnektir ve yayın öncesi belirlenir.

ASKIDAN AL (alan)
- Hesap yok, ad yok, e-posta yok. Yalnızca bu cihaza bağlı rastgele bir kimlik kullanılır.
- Yakındaki dükkânları ve askıdaki ürünleri gör; konum yaklaşık olarak, yalnızca yakın dükkânları göstermek için kullanılır.
- Bir ürün seç, tek kullanımlık kodunu al. Kod 10 dakika geçerlidir; dükkânda göster, ürünü al.
- Günde en fazla iki askı, aynı dükkândan bir tane alınabilir.
- İstediğin an "Verilerimi sıfırla" ile bu cihazın anonim kimliğini silebilirsin.

ESNAF
- Dükkânını kaydet, belgelerini yükle, doğrulanınca ürünlerini askıya aç.
- Alıcının kodunu okut ya da elle gir; ürün verilir, kayıt tek adımda kapanır.
- Ödemelerini ve geçmişini uygulamadan izle.

Neden güvenli?
- Dükkânlar belgeyle doğrulanır; doğrulanmayan dükkân görünmez.
- Her kod bir kez kullanılır ve süresi dolunca askıya döner.
- Alan kişi dükkâna ve bağışçıya kimlik göstermez, puanlanmaz.
- Hesabını uygulamadan silebilirsin.

Türkçe öncelikli, İngilizce de desteklenir. Uygulama bu sürümde bir portföy çalışmasıdır:
dükkânlar, adresler ve rakamlar örnektir ve [ÖRNEK] ile işaretlidir.

## Yenilikler (sürüm 0.1.0)

İlk sürüm: yakındaki dükkânları gör, askıya bırak, askıdan al, esnaf olarak kodu okut.
Hesap silme ve anonim kimliği sıfırlama ayarlardan yapılır.

## Gizlilik ve veri güvenliği

Ayrıntılı tablo: `docs/release/privacy-labels.md`. Gizlilik politikası adresi olarak
`/gizlilik` kullanılır; metin örnektir, hukuki inceleme yapılmamıştır.
