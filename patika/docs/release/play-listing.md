# Google Play listing

**Portfolio: not published.** There is no Play Console account, no store listing and no release (README, "Gerçek / simüle"). This is the listing as it would be submitted for package `app.patika.android`. The copy describes only what the code does today: email sign-in (Google sign-in is not wired yet), the drawn map, check-ins, adoption, urgent help with push, and the optional Destekçi subscription.

Character counts were measured with `LC_ALL=C.UTF-8 wc -m` on the exact strings below, without the final newline (limits: title 30, short description 80, full description 4000).

## Türkçe (tr-TR, default)

**Uygulama adı** (24 / 30)

```text
Patika: Mahalle Patileri
```

**Kısa açıklama** (80 / 80)

```text
Mama noktaları, besleme kaydı, sahiplendirme ve acil yardım; mahallece birlikte.
```

**Tam açıklama**

```text
Mahallenin patilerini birlikte koruyalım.

Patika, sokak hayvanlarına bakan gönüllüleri aynı haritada buluşturur. Hangi mama kabının dolu, hangisinin boş olduğunu görür, beslediğinizde tek dokunuşla kaydedersiniz. Yaralı ya da hasta bir hayvan gördüğünüzde yakındaki gönüllülere haber verirsiniz.

MAMA VE SU NOKTALARI
• Mahallenizdeki mama ve su noktalarını haritada görün; kedi, köpek, mama, su ve "mama bitti" filtreleri.
• Bir noktayı beslediğinizde "Beslendi" deyin; son beslemeler ve fotoğraflar nokta sayfasında görünür.
• Yeni bir nokta eklemek için haritaya iğne bırakın.
• Bağlantı yokken yaptığınız besleme kayıtları saklanır, bağlantı gelince gönderilir.

HAYVAN PROFİLLERİ VE SAHİPLENDİRME
• Mahallenin tanıdık hayvanları için profil: tür, kısırlaştırma, aşı, küpe bilgisi ve görülme kayıtları.
• Takip ettiğiniz hayvanlarla ilgili güncellemeleri alın.
• Sahiplendirme ilanları moderasyondan geçer; başvurular yalnızca ilan sahibine görünür.

ACİL YARDIM
• Yaralı, hasta ya da mahsur kalmış bir hayvan için fotoğraflı acil çağrı açın.
• Acil bildirimlerini açan gönüllüler, seçtikleri bölgenin 2 km yakınındaki çağrılardan haberdar olur.
• Kötüye kullanımı önlemek için günlük çağrı ve bildirim sınırları vardır.
• Yakındaki veteriner ve barınakların listesi, 24 saat açık olanlar işaretli.

GİZLİLİK ÖNCE GELİR
• Fotoğraflarınızın konum ve cihaz bilgileri telefonunuzda silinir; sunucuya yalnızca görüntü gider.
• Konumunuz profilinizde saklanmaz, arka planda konum alınmaz.
• Reklam yok, takip aracı yok, sıralama tabloları yok.
• Hesabınızı uygulamadan ya da patika.app/hesap-silme adresinden silebilirsiniz.

PATİKA DESTEKÇİ (İSTEĞE BAĞLI)
Patika'yı desteklemek isterseniz aylık ya da yıllık Destekçi aboneliği alabilirsiniz: profilinizde destekçi rozeti ve günlük 30 yerine 100 fotoğraf yükleme hakkı. Uygulamanın tüm özellikleri abonelik olmadan da kullanılabilir. Patika kişiler arasında bağış ya da para aktarımına aracılık etmez.

Patika bir gönüllü topluluğu aracıdır; veteriner hizmeti ya da resmi bir kurtarma birimi değildir. Acil durumlarda yerel belediye veterinerliğine de haber verin.
```

## English (en-US)

**App name** (25 / 30)

```text
Patika: Street Animal Map
```

**Short description** (78 / 80)

```text
Feeding stations, check-ins, adoption and urgent help for your street animals.
```

**Full description**

```text
Let's look after the neighbourhood's paws together.

Patika brings the volunteers who care for street animals onto one shared map. See which food and water bowls are full and which are empty, log a feeding with one tap, and alert nearby volunteers when you find an injured or sick animal.

FEEDING STATIONS
• See food and water stations in your neighbourhood, filtered by cat, dog, food, water and "out of food".
• Tap "Fed" when you fill a station; recent feedings and photos show on the station page.
• Drop a pin to add a new station.
• Feedings logged offline are kept and sent when you are back online.

ANIMAL PROFILES AND ADOPTION
• Profiles for the neighbourhood's familiar animals: species, sterilised, vaccinated, ear-tagged, and a sighting log.
• Follow an animal to get its updates.
• Adoption listings are moderated; requests are visible only to the person who posted the listing.

URGENT HELP
• Open an urgent post with a photo for an injured, sick or trapped animal.
• Volunteers who turn on urgent alerts hear about posts within 2 km of the area they chose.
• Daily limits on posts and alerts prevent abuse.
• A directory of nearby vets and shelters, with 24-hour places marked.

PRIVACY FIRST
• Location and device details are removed from your photos on the phone; only the image reaches the server.
• Your location is not stored in your profile and is never collected in the background.
• No ads, no trackers, no leaderboards.
• Delete your account in the app or at patika.app/hesap-silme.

PATIKA DESTEKÇİ (OPTIONAL)
If you want to support Patika, a monthly or yearly Destekçi subscription adds a supporter badge and raises your daily photo uploads from 30 to 100. Every feature works without it. Patika does not handle donations or payments between people.

Patika is a volunteer community tool, not a veterinary service or an official rescue unit. In an emergency, also contact your municipality's veterinary service.
```

The full descriptions are 2,114 (tr) and 1,939 (en) characters (`wc -m`, UTF-8, without the final newline).

## Graphics

| Asset | Play requirement | Source | Status |
| --- | --- | --- | --- |
| App icon | 512 × 512 PNG | [`brand/app-icon/png/patika-icon-512.png`](../../brand/app-icon/png/patika-icon-512.png) | Ready (512 × 512) |
| Feature graphic | 1024 × 500 JPEG or PNG | none yet | To make from [`brand/logo/patika-lockup.svg`](../../brand/logo/patika-lockup.svg) on Kar Beyazı |
| Phone screenshots (2 to 8) | 320 to 3840 px per side, long side at most twice the short side | below | Captures are 1080 × 2400 (ratio 2.22): pad or crop to 1080 × 2160 before upload |

Screenshots, in listing order (all in [`docs/design/screenshots/`](../design/screenshots/)):

1. [`android-harita.png`](../design/screenshots/android-harita.png): map with stations and clusters. Caption: "Mahallendeki mama ve su noktaları".
2. [`android-acil.png`](../design/screenshots/android-acil.png): urgent help. Caption: "Yaralı bir pati mi gördün? Yakındaki gönüllülere haber ver".
3. [`android-sahiplen.png`](../design/screenshots/android-sahiplen.png): adoption listings. Caption: "Moderasyonlu sahiplendirme ilanları".
4. [`android-profil.png`](../design/screenshots/android-profil.png): volunteer profile and badges. Caption: "Beslemelerin ve rozetlerin, sıralama yok".
5. [`destekci-paywall.png`](../design/screenshots/destekci-paywall.png): Destekçi plans. Caption: "İsteğe bağlı Destekçi aboneliği".
6. [`destekci-profile.png`](../design/screenshots/destekci-profile.png): supporter badge. Caption: "Destekçi rozeti".

`destekci-test-purchase.png` shows the simulated test-purchase sheet and must not be used in a listing.

## Content rating (IARC questionnaire)

IARC app category: **"Social networking, forums, blogs and user-generated content sharing"**, because users post content that other users see. Answers:

| Question | Answer | Reason |
| --- | --- | --- |
| Violence, blood, gore | No | No such content from the developer. Users can post photos of injured animals in urgent posts; these are moderated, can be reported and hidden (`hidden_at`) |
| Sexual content, nudity | No | Not in scope; user content is moderated and reportable |
| Profanity or crude humour | No | Not from the developer; user text is moderated and reportable |
| Controlled substances, gambling | No | None |
| Users can interact or exchange content | Yes | Stations, feedings, animal profiles, adoption posts and requests, urgent posts, photos |
| Shares the user's current location with other users | No | The app sends the position only for a search or for the place of a record the user creates (a station or urgent post location, which is the animal's place); the user's own position is never shown to others or stored in the profile |
| Digital purchases | Yes | Destekçi subscription (Google Play Billing) |
| Unrestricted web access | No | No in-app browser |

Expected result: PEGI 3 / ESRB Everyone with the interactive elements "Users Interact" and "In-App Purchases" (not exercised: no questionnaire was submitted).

## Target audience and content

- Target age group: **18 and over**. Adoption requests and urgent posts involve meeting strangers about animals, and accounts need an email address. Not designed for children; not enrolled in the Families program.
- Ads: **No**.
- App access for review: email sign-in; a review account with a verified address would be created for the review team (not exercised).
- Data safety: see [data-safety.md](data-safety.md). Privacy policy URL: `https://patika.app/gizlilik` (draft page in the Web app, `src/Patika.Web/Content/yasal/gizlilik.md`).
- Account deletion URL (Play requirement): `https://patika.app/hesap-silme`.
- Category: **Lifestyle**. Tags: Pets, Community.
- Contact email and website: owner items (`patika.app` placeholder).

## ASO keywords (tr)

Play has no keyword field: these words are worked into the title, short and full description above and into screenshot captions. Primary: `sokak hayvanları`, `mama noktası`, `kedi`, `köpek`, `sahiplendirme`, `gönüllü`. Secondary: `besleme`, `acil yardım`, `yaralı hayvan`, `veteriner`, `barınak`, `pati`, `mahalle`, `sokak kedisi`, `mama kabı`, `hayvan sahiplendirme`. Avoid `bağış` (the app takes no donations) and competitor or charity names.
