# Destekçi yerel demo

Gerçek ücret alınmaz. Play Console, Google Cloud ve Pub/Sub hesabı gerekmez.
Ürün `patika_destekci`; temel planlar `aylik` / `yillik`. ₺49,99 / ay ve ₺449,99 / yıl örnek fiyattır.
Kararlar ve sınırlar: [ADR-0010](../adr/0010-play-billing-simulated.md).

## 1. Sunucuyu başlat

**Compose ile:** `patika/` içinde `.env.example` dosyasını `.env` olarak kopyala, yerel depolama
değerlerini doldur ve `docker compose up --build -d` çalıştır. API migration uygular. Compose
yalnızca API ve Worker için `Billing__Provider=Fake`, `Billing__AllowFake=true`,
`Billing__AllowTestPurchases=true` (test alımları Development dışında ancak bu ayarla hak verir) ve ortak
`billing-keys` volume'unu (`DataProtection__KeysPath=/keys`) ayarlar. Worker Production
ortamında çalışır; AllowFake olmadan ve key ring olmadan başlamaz.

**Yerelde (`dotnet run`) ile:** PostGIS'i bir konteynerde başlat, sonra API ve Worker'ı aynı
ayarlarla çalıştır. Key ring klasörü ikisinde aynı olmalı; yoksa Worker şifreli satın alma
token'larını çözemez.

```bash
export ConnectionStrings__Patika="Host=127.0.0.1;Port=55433;Database=patika;Username=patika;Password=<yerel>"
export Billing__Provider=Fake
export DataProtection__KeysPath=/tmp/patika-keys
export Billing__Rtdn__Audience=https://patika.local/webhooks/play
export Billing__Rtdn__Email=play-push@patika-local.iam.gserviceaccount.com
export Billing__Rtdn__JwksUrl=http://127.0.0.1:5099/jwks.json
ASPNETCORE_ENVIRONMENT=Development Database__MigrateOnStartup=true ASPNETCORE_URLS=http://127.0.0.1:5000 \
  dotnet run --project src/Patika.Api &
DOTNET_ENVIRONMENT=Development dotnet run --project src/Patika.Worker &
```

Yerel doğrulama postaları Development'ta geçici klasördeki `patika-dev-mail` içine yazılır
(compose'da API konteynerinde `/tmp/patika-dev-mail`). Android Debug uygulaması API'ye
`http://10.0.2.2:5000/` üzerinden bağlanır. Giriş uç noktası IP başına 15 dakikada 5 deneme
kabul eder; demo sırasında aşarsan API'yi yeniden başlat.

## 2. Uygulamada satın al ve geri yükle

1. Profil → "Patika Destekçi ol" kartı → paywall. Aylık plan önden seçilidir; yıllık bir
   dokunuşla seçilir. Yenileme ve iptal metni düğmenin üstünde yazar.
2. "Destekçi ol" → "Test ödemesi — gerçek ücret alınmaz" onay penceresi → onayla. Uygulama
   `POST /dev/billing/purchases` ile sahte mağazaya alım ekler, sonra `POST /v1/subscriptions/verify`
   çağırır. Sunucu durumu sahte Play API'den okur, onaylar (acknowledge) ve hakkı verir.
3. Profilde kart "Patika Destekçi" olur, Rozetler'de "Destekçi" görünür; kendi acil çağrının
   ayrıntısında da rozet çıkar. Günlük fotoğraf kotası 30 → 100 olur.
4. "Satın alımları geri yükle" aynı cihazdaki test alımlarını yeniden doğrular. Tekrar doğrulama
   yeni satır ya da yeni grant audit üretmez.

## 3. API ile satın alma ve sınırlar

```bash
B=http://127.0.0.1:5000
# Play, uygulamanın satın almaya verdiği hesap kimliğini (obfuscatedExternalAccountId) saklar; sahte mağaza da.
A=$(curl -s $B/v1/me/entitlement -H "Authorization: Bearer $ACCESS" | sed -E 's/.*"billingAccountId":"([^"]+)".*/\1/')
P=$(curl -s -X POST $B/dev/billing/purchases -H "Authorization: Bearer $ACCESS" \
  -H 'Content-Type: application/json' -d "{\"basePlanId\":\"aylik\",\"obfuscatedAccountId\":\"$A\"}" | sed -E 's/.*"purchaseToken":"([^"]+)".*/\1/')
curl -s -X POST $B/v1/subscriptions/verify -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d "{\"productId\":\"patika_destekci\",\"basePlanId\":\"aylik\",\"purchaseToken\":\"$P\"}"
curl -s $B/v1/me/entitlement -H "Authorization: Bearer $ACCESS"
```

Aynı token'ı başka hesapla doğrulamak ya da başka hesabın kimliğiyle alınmış bir alımı doğrulamak
`409 purchase_owned_elsewhere` döner ve `subscription.claim_rejected` audit kaydı bırakır; yanlış
plan ya da bitmiş alım `400 invalid_purchase`, mağazada olmayan token `400 purchase_not_found` döner. Dev uç noktası yalnızca Development + Fake'de vardır.

## 4. İmzalı bildirim (RTDN) ve Worker

`docs/demo/rtdn-local.cs`, Pub/Sub push'un yerini tutar: geçici bir RSA anahtarı üretir,
JWKS olarak yayınlar ve bu anahtarla imzalı OIDC bearer taşıyan DeveloperNotification gönderir.
API ona yalnızca `Billing:Rtdn:JwksUrl` buraya işaret ettiği için güvenir.

```bash
dotnet run docs/demo/rtdn-local.cs -- serve /tmp/patika-rtdn 5099 &
send() { dotnet run docs/demo/rtdn-local.cs -- send /tmp/patika-rtdn http://127.0.0.1:5000/webhooks/play \
  https://patika.local/webhooks/play play-push@patika-local.iam.gserviceaccount.com "$P" "$1"; }
q() { docker exec <postgis-konteyneri> psql -U patika -d patika -tAc "$1"; }
H=$(printf '%s' "$P" | sha256sum | cut -c1-64)
```

1. **Gövdeye güvenilmez:** `send 13` (EXPIRED). Mağaza hâlâ ACTIVE olduğu için ~10 saniye sonra
   satır Active kalır, entitlement `supporter: true`.
2. **İptal:** mağazada iptali taklit et, sonra bildir. Satır Canceled olur; hak bitişe kadar sürer.
   ```bash
   q "update fake_play_purchases set response_json = replace(replace(response_json,'SUBSCRIPTION_STATE_ACTIVE','SUBSCRIPTION_STATE_CANCELED'),'\"AutoRenewEnabled\":true','\"AutoRenewEnabled\":false') where token_hash='$H'"
   send 3
   ```
3. **Geri alma:** `SUBSCRIPTION_STATE_CANCELED` → `SUBSCRIPTION_STATE_REVOKED` ile aynı güncelleme,
   sonra `send 12`. Satır Revoked olur, `subscription.revoked` audit yazılır, rozet ve kota gider.

İmzasız istek 401, 64 KiB üstü 413, aynı `messageId` tekrarı 200 (no-op) döner. Gerçek Play
iptali genelde EXPIRED olarak gösterir; sahte mağaza Revoked durumunu yerel olarak sınamak için
`SUBSCRIPTION_STATE_REVOKED` da kabul eder. Günlük reconcile UTC 01:00'de bitişi geçmiş satırları
Expired yapar; Worker testi aynı kodu doğrudan çağırır.

## Denenmeyenler

Gerçek Play REST, native Play Billing Library, Google Pub/Sub ve cihazlar arası geri yükleme
denenmemiştir. Testler: `dotnet test` ile `Subscriptions` ve `Billing` filtreleri; PostGIS
gerektirenler Docker ister.
