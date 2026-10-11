# İnecek Var marka dosyaları

| Dosya | Kullanım |
| --- | --- |
| `logo/inecekvar-wordmark.svg` | Özel harf çizimleriyle İNECEK VAR minibüs tabelası. |
| `logo/inecekvar-mark.svg` | Üst askı, durak halkası, iki tekerlek ve alt şerit içeren rozet. |
| `logo/inecekvar-mark-mono.svg` | `currentColor` ile tek renk; halka, gövde simgesi ve şerit şeffaf boşluklardır. |
| `icons/app-icon.svg` | Lacivert zemin üzerinde tabela; yatay kenar boşluğu %18. |
| `icons/app-icon-foreground.svg` | 108 birim tuval üzerinde şeffaf uyarlanabilir ön plan. |
| `icons/app-icon-background.svg` | 108 birim tuval üzerinde düz lacivert arka plan. |
| `icons/favicon.svg` | 32 × 32 için sadeleştirilmiş askı, halka, tekerlek ve şerit. |
| `icons/maskable-icon.svg` | Lacivert zemin; çizim merkezdeki %80 çaplı güvenli dairenin içinde. |

## Renkler

| Renk | Kod | Kullanım |
| --- | --- | --- |
| Dolmuş sarısı | `#F2B705` | Tabela ve üst askı |
| Lacivert | `#14213D` | Zemin, harfler, durak halkası ve tekerlekler |
| Turkuaz | `#2AB7CA` | Minibüs tabelasının alt şeridi |

## Yapı ve ölçüler

Rozetin üst askısı ve iki alt tekerleği minibüs/durak tabelası siluetini kurar. İ harfinin noktası lacivert durak halkasıdır. Turkuaz şerit tüm renkli çeşitlerde ortak alt kenar ayrıntısıdır. Tek renkli çeşitte şerit şeffaf boşluk olarak korunur.

Wordmark tabela gövdesi 770 × 224 birimdir. Harf gövdeleri 70 birim yüksekliğindedir; nokta halkası dahil yazı yüksekliği 109 birimdir. Sol iç boşluk 50, sağ 53, üst 55 ve alt 60 birimdir. En küçük boşluk, nokta halkası dahil yazı yüksekliğinin %45,9'udur; harf gövdesi yüksekliğinin %71,4'üdür. Harf aralıkları genişletilmiştir.

Uyarlanabilir ön plan merkezdeki 66 birim çaplı güvenli daireye yerleşir. Çizim genişliği 52,8 birimdir: güvenli çapın %80'i. Katmanlar aynı merkez ve tuvali paylaşır; ayrı ayrı ölçeklenmemelidir. Platform maskesini tüketen uygulama uygular.

Harfler SVG yollarıdır; font veya görsel dosyası gerektirmez. Orantıları ve `viewBox` değerlerini koruyun. Tek renkli rozeti karşıt renkli bir yüzeyde kullanın.

Bu düzeltmede XML yapısı, içerik ve geometrik sınırlar kontrol edilmiştir. SVG dosyaları render edilmemiştir; 32 piksel okunabilirliği ve platform maskeleri görsel olarak yeniden doğrulanmamıştır. PNG çıktısı bulunmaz.
