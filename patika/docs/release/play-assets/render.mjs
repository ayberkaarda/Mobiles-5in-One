import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Renders the Play listing graphics from docs/design/screenshots and the brand lockup:
//   npm i playwright && node docs/release/play-assets/render.mjs   (CHROMIUM_PATH picks a local Chromium)
const exe = process.env.CHROMIUM_PATH || undefined;
const root = fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\/]$/, '');
const out = root + '/docs/release/play-assets';
mkdirSync(out, { recursive: true });
const mime = (p) => p.endsWith('.png') ? 'image/png' : 'font/woff2';
const f = (p) => `data:${mime(p)};base64,` + readFileSync(root + '/' + p).toString('base64');
const fonts = `
@font-face { font-family: Nunito; src: url(${f('src/Patika.Web/wwwroot/fonts/nunito/Nunito-latin.woff2')}) format('woff2'); font-weight: 200 1000; }
@font-face { font-family: Nunito; src: url(${f('src/Patika.Web/wwwroot/fonts/nunito/Nunito-latin-ext.woff2')}) format('woff2'); font-weight: 200 1000; unicode-range: U+0100-024F, U+1E00-1EFF; }
body { margin: 0; background: #FBFAF8; color: #3D3A36; font-family: Nunito, sans-serif; }`;
const shots = [
  ['android-harita', 'Mahallendeki mama ve su noktaları'],
  ['android-acil', 'Yaralı bir pati mi gördün? Yakındaki gönüllülere haber ver'],
  ['android-sahiplen', 'Moderasyonlu sahiplendirme ilanları'],
  ['android-profil', 'Beslemelerin ve rozetlerin, sıralama yok'],
  ['destekci-paywall', 'İsteğe bağlı Destekçi aboneliği'],
  ['destekci-profile', 'Destekçi rozeti'],
];
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
for (const [i, [name, caption]] of shots.entries()) {
  await page.setContent(`<!doctype html><html lang="tr"><head><style>${fonts}
    .frame { width: 1080px; height: 1920px; display: flex; flex-direction: column; align-items: center; box-sizing: border-box; padding: 72px 0 0; }
    h1 { margin: 0 96px 40px; font-size: 58px; line-height: 1.15; font-weight: 900; text-align: center; letter-spacing: -0.5px; height: 200px; display: flex; align-items: center; justify-content: center; }
    img { height: 1540px; width: auto; border-radius: 48px; box-shadow: 0 24px 64px rgba(61,58,54,.18); border: 10px solid #3D3A36; }
    </style></head><body><div class="frame"><h1>${caption}</h1><img src="${f('docs/design/screenshots/' + name + '.png')}"></div></body></html>`);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${out}/${String(i + 1).padStart(2, '0')}-${name}-1080x1920.png` });
  console.log('screenshot', name);
}
const lockup = readFileSync(root + '/brand/logo/patika-lockup.svg', 'utf8');
await page.setViewportSize({ width: 1024, height: 500 });
await page.setContent(`<!doctype html><html lang="tr"><head><style>${fonts}
  .g { width: 1024px; height: 500px; box-sizing: border-box; padding: 0 80px; display: flex; align-items: center; justify-content: space-between; gap: 48px; background: #FBFAF8; position: relative; overflow: hidden; }
  .g::after { content: ""; position: absolute; right: -120px; bottom: -160px; width: 520px; height: 520px; border-radius: 50%; background: #F28C28; opacity: .14; }
  .logo svg { width: 360px; height: auto; display: block; }
  p { margin: 0; max-width: 440px; font-size: 38px; line-height: 1.2; font-weight: 800; position: relative; z-index: 1; }
  span { color: #A8520A; }
  </style></head><body><div class="g"><div class="logo">${lockup}</div><p>Sokak hayvanları için<br><span>mahalle gönüllüleri</span><br>bir arada</p></div></body></html>`);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: `${out}/feature-graphic-1024x500.png` });
console.log('feature graphic');
await browser.close();
