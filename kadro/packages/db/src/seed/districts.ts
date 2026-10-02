/**
 * Districts (ilçe) of İstanbul, Ankara and İzmir.
 *
 * Coordinates are APPROXIMATE reference points near each district's administrative center,
 * rounded to about 0.01° (roughly 1 km). They are neither geometric centroids nor boundaries and
 * must not be used for legal, address or distance-critical purposes; they only seed map
 * defaults and "near me" ordering. Replace them with values derived from official boundary data
 * before relying on them for anything more precise.
 */
export interface DistrictSeed {
  readonly il: string;
  readonly ilce: string;
  readonly lat: number;
  readonly lng: number;
}

const istanbul: readonly DistrictSeed[] = [
  { il: 'İstanbul', ilce: 'Adalar', lat: 40.874, lng: 29.106 },
  { il: 'İstanbul', ilce: 'Arnavutköy', lat: 41.184, lng: 28.74 },
  { il: 'İstanbul', ilce: 'Ataşehir', lat: 40.983, lng: 29.127 },
  { il: 'İstanbul', ilce: 'Avcılar', lat: 40.98, lng: 28.721 },
  { il: 'İstanbul', ilce: 'Bağcılar', lat: 41.039, lng: 28.856 },
  { il: 'İstanbul', ilce: 'Bahçelievler', lat: 41.0, lng: 28.86 },
  { il: 'İstanbul', ilce: 'Bakırköy', lat: 40.98, lng: 28.873 },
  { il: 'İstanbul', ilce: 'Başakşehir', lat: 41.093, lng: 28.802 },
  { il: 'İstanbul', ilce: 'Bayrampaşa', lat: 41.035, lng: 28.912 },
  { il: 'İstanbul', ilce: 'Beşiktaş', lat: 41.043, lng: 29.007 },
  { il: 'İstanbul', ilce: 'Beykoz', lat: 41.13, lng: 29.12 },
  { il: 'İstanbul', ilce: 'Beylikdüzü', lat: 40.982, lng: 28.64 },
  { il: 'İstanbul', ilce: 'Beyoğlu', lat: 41.037, lng: 28.977 },
  { il: 'İstanbul', ilce: 'Büyükçekmece', lat: 41.02, lng: 28.585 },
  { il: 'İstanbul', ilce: 'Çatalca', lat: 41.143, lng: 28.461 },
  { il: 'İstanbul', ilce: 'Çekmeköy', lat: 41.035, lng: 29.18 },
  { il: 'İstanbul', ilce: 'Esenler', lat: 41.043, lng: 28.876 },
  { il: 'İstanbul', ilce: 'Esenyurt', lat: 41.034, lng: 28.68 },
  { il: 'İstanbul', ilce: 'Eyüpsultan', lat: 41.048, lng: 28.934 },
  { il: 'İstanbul', ilce: 'Fatih', lat: 41.019, lng: 28.94 },
  { il: 'İstanbul', ilce: 'Gaziosmanpaşa', lat: 41.064, lng: 28.912 },
  { il: 'İstanbul', ilce: 'Güngören', lat: 41.02, lng: 28.877 },
  { il: 'İstanbul', ilce: 'Kadıköy', lat: 40.99, lng: 29.029 },
  { il: 'İstanbul', ilce: 'Kağıthane', lat: 41.08, lng: 28.973 },
  { il: 'İstanbul', ilce: 'Kartal', lat: 40.889, lng: 29.19 },
  { il: 'İstanbul', ilce: 'Küçükçekmece', lat: 41.0, lng: 28.78 },
  { il: 'İstanbul', ilce: 'Maltepe', lat: 40.935, lng: 29.13 },
  { il: 'İstanbul', ilce: 'Pendik', lat: 40.877, lng: 29.234 },
  { il: 'İstanbul', ilce: 'Sancaktepe', lat: 41.0, lng: 29.227 },
  { il: 'İstanbul', ilce: 'Sarıyer', lat: 41.167, lng: 29.05 },
  { il: 'İstanbul', ilce: 'Silivri', lat: 41.073, lng: 28.246 },
  { il: 'İstanbul', ilce: 'Sultanbeyli', lat: 40.96, lng: 29.262 },
  { il: 'İstanbul', ilce: 'Sultangazi', lat: 41.106, lng: 28.867 },
  { il: 'İstanbul', ilce: 'Şile', lat: 41.175, lng: 29.612 },
  { il: 'İstanbul', ilce: 'Şişli', lat: 41.06, lng: 28.987 },
  { il: 'İstanbul', ilce: 'Tuzla', lat: 40.816, lng: 29.303 },
  { il: 'İstanbul', ilce: 'Ümraniye', lat: 41.016, lng: 29.12 },
  { il: 'İstanbul', ilce: 'Üsküdar', lat: 41.023, lng: 29.015 },
  { il: 'İstanbul', ilce: 'Zeytinburnu', lat: 40.994, lng: 28.904 },
];

const ankara: readonly DistrictSeed[] = [
  { il: 'Ankara', ilce: 'Akyurt', lat: 40.134, lng: 33.087 },
  { il: 'Ankara', ilce: 'Altındağ', lat: 39.95, lng: 32.88 },
  { il: 'Ankara', ilce: 'Ayaş', lat: 40.018, lng: 32.345 },
  { il: 'Ankara', ilce: 'Bala', lat: 39.554, lng: 33.123 },
  { il: 'Ankara', ilce: 'Beypazarı', lat: 40.168, lng: 31.921 },
  { il: 'Ankara', ilce: 'Çamlıdere', lat: 40.49, lng: 32.474 },
  { il: 'Ankara', ilce: 'Çankaya', lat: 39.9, lng: 32.86 },
  { il: 'Ankara', ilce: 'Çubuk', lat: 40.238, lng: 33.032 },
  { il: 'Ankara', ilce: 'Elmadağ', lat: 39.921, lng: 33.231 },
  { il: 'Ankara', ilce: 'Etimesgut', lat: 39.95, lng: 32.67 },
  { il: 'Ankara', ilce: 'Evren', lat: 39.024, lng: 33.806 },
  { il: 'Ankara', ilce: 'Gölbaşı', lat: 39.79, lng: 32.805 },
  { il: 'Ankara', ilce: 'Güdül', lat: 40.21, lng: 32.247 },
  { il: 'Ankara', ilce: 'Haymana', lat: 39.432, lng: 32.496 },
  { il: 'Ankara', ilce: 'Kahramankazan', lat: 40.207, lng: 32.683 },
  { il: 'Ankara', ilce: 'Kalecik', lat: 40.098, lng: 33.408 },
  { il: 'Ankara', ilce: 'Keçiören', lat: 39.99, lng: 32.865 },
  { il: 'Ankara', ilce: 'Kızılcahamam', lat: 40.47, lng: 32.65 },
  { il: 'Ankara', ilce: 'Mamak', lat: 39.93, lng: 32.92 },
  { il: 'Ankara', ilce: 'Nallıhan', lat: 40.186, lng: 31.352 },
  { il: 'Ankara', ilce: 'Polatlı', lat: 39.584, lng: 32.147 },
  { il: 'Ankara', ilce: 'Pursaklar', lat: 40.038, lng: 32.9 },
  { il: 'Ankara', ilce: 'Sincan', lat: 39.97, lng: 32.58 },
  { il: 'Ankara', ilce: 'Şereflikoçhisar', lat: 38.939, lng: 33.541 },
  { il: 'Ankara', ilce: 'Yenimahalle', lat: 39.97, lng: 32.81 },
];

const izmir: readonly DistrictSeed[] = [
  { il: 'İzmir', ilce: 'Aliağa', lat: 38.799, lng: 26.972 },
  { il: 'İzmir', ilce: 'Balçova', lat: 38.389, lng: 27.05 },
  { il: 'İzmir', ilce: 'Bayındır', lat: 38.219, lng: 27.648 },
  { il: 'İzmir', ilce: 'Bayraklı', lat: 38.462, lng: 27.167 },
  { il: 'İzmir', ilce: 'Bergama', lat: 39.121, lng: 27.18 },
  { il: 'İzmir', ilce: 'Beydağ', lat: 38.085, lng: 28.21 },
  { il: 'İzmir', ilce: 'Bornova', lat: 38.47, lng: 27.22 },
  { il: 'İzmir', ilce: 'Buca', lat: 38.388, lng: 27.175 },
  { il: 'İzmir', ilce: 'Çeşme', lat: 38.324, lng: 26.306 },
  { il: 'İzmir', ilce: 'Çiğli', lat: 38.495, lng: 27.07 },
  { il: 'İzmir', ilce: 'Dikili', lat: 39.071, lng: 26.889 },
  { il: 'İzmir', ilce: 'Foça', lat: 38.67, lng: 26.757 },
  { il: 'İzmir', ilce: 'Gaziemir', lat: 38.32, lng: 27.13 },
  { il: 'İzmir', ilce: 'Güzelbahçe', lat: 38.37, lng: 26.89 },
  { il: 'İzmir', ilce: 'Karabağlar', lat: 38.37, lng: 27.11 },
  { il: 'İzmir', ilce: 'Karaburun', lat: 38.637, lng: 26.513 },
  { il: 'İzmir', ilce: 'Karşıyaka', lat: 38.46, lng: 27.11 },
  { il: 'İzmir', ilce: 'Kemalpaşa', lat: 38.427, lng: 27.417 },
  { il: 'İzmir', ilce: 'Kınık', lat: 39.087, lng: 27.381 },
  { il: 'İzmir', ilce: 'Kiraz', lat: 38.23, lng: 28.203 },
  { il: 'İzmir', ilce: 'Konak', lat: 38.418, lng: 27.129 },
  { il: 'İzmir', ilce: 'Menderes', lat: 38.253, lng: 27.134 },
  { il: 'İzmir', ilce: 'Menemen', lat: 38.61, lng: 27.07 },
  { il: 'İzmir', ilce: 'Narlıdere', lat: 38.395, lng: 27.0 },
  { il: 'İzmir', ilce: 'Ödemiş', lat: 38.228, lng: 27.97 },
  { il: 'İzmir', ilce: 'Seferihisar', lat: 38.197, lng: 26.839 },
  { il: 'İzmir', ilce: 'Selçuk', lat: 37.951, lng: 27.368 },
  { il: 'İzmir', ilce: 'Tire', lat: 38.089, lng: 27.735 },
  { il: 'İzmir', ilce: 'Torbalı', lat: 38.155, lng: 27.362 },
  { il: 'İzmir', ilce: 'Urla', lat: 38.323, lng: 26.765 },
];

export const DISTRICT_SEEDS: readonly DistrictSeed[] = [...istanbul, ...ankara, ...izmir];
