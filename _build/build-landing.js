// Builds the landing pages from one bilingual source.
//   _build/landing.src.html  ->  index.html (Turkish, root)  and  en/index.html (English)
// Usage, from the gh-pages root:  npm i --no-save cheerio@1.0.0 && node _build/build-landing.js
// Build-time only: the published pages have no runtime dependency and no language JS.
'use strict';
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(__dirname, 'landing.src.html'), 'utf8');
const BASE = 'https://ayberkaarda.github.io/Mobiles-5in-One/';
const URLS = { tr: BASE, en: BASE + 'en/' };

function isRelative(u) {
  return u && !/^(?:[a-z]+:|#|\/|\.\.\/)/i.test(u);
}

function build(lang) {
  const other = lang === 'tr' ? 'en' : 'tr';
  const prefix = lang === 'en' ? '../' : '';
  const $ = cheerio.load(src);

  $('.' + other).remove();
  if (lang === 'en') $('[lang="en"]').removeAttr('lang');
  $('.tr, .en').removeClass('tr en').filter('[class=""]').removeAttr('class');
  $('[class=""]').removeAttr('class');
  $('html').attr('lang', lang);

  const t = $('title');
  if (lang === 'en') t.text(t.attr('data-en'));
  t.removeAttr('data-en');
  const d = $('meta[name="description"]');
  if (lang === 'en') d.attr('content', d.attr('data-en'));
  d.removeAttr('data-en');
  $('[data-alt-en]').each((_, el) => { const e = $(el); if (lang === 'en') e.attr('alt', e.attr('data-alt-en')); e.removeAttr('data-alt-en'); });
  $('[data-href-en]').each((_, el) => { const e = $(el); if (lang === 'en') e.attr('href', e.attr('data-href-en')); e.removeAttr('data-href-en'); });
  $('[data-aria-en]').each((_, el) => { const e = $(el); if (lang === 'en') e.attr('aria-label', e.attr('data-aria-en')); e.removeAttr('data-aria-en'); });

  // Fix relative paths for the /en/ depth.
  if (prefix) {
    for (const attr of ['href', 'src', 'srcset']) {
      $('[' + attr + ']').each((_, el) => {
        const e = $(el), v = e.attr(attr);
        if (v === './') return; // the page's own home stays local
        if (isRelative(v)) e.attr(attr, prefix + v);
      });
    }
    $('style').each((_, el) => {
      const e = $(el);
      e.text(e.text().replace(/url\((?!["']?(?:data:|https?:|\/|\.\.\/))/g, 'url(' + prefix));
    });
  }

  let html = $.html();
  const alternates = [
    `<link rel="canonical" href="${URLS[lang]}">`,
    `<link rel="alternate" hreflang="tr" href="${URLS.tr}">`,
    `<link rel="alternate" hreflang="en" href="${URLS.en}">`,
    `<link rel="alternate" hreflang="x-default" href="${URLS.tr}">`,
  ].join('\n');
  const trHref = lang === 'tr' ? './' : '../';
  const enHref = lang === 'tr' ? 'en/' : './';
  const sw = `<nav class="lang" aria-label="${lang === 'tr' ? 'Dil' : 'Language'}">`
    + `<a href="${trHref}" hreflang="tr" lang="tr"${lang === 'tr' ? ' aria-current="page"' : ''}>Türkçe</a>`
    + `<a href="${enHref}" hreflang="en" lang="en"${lang === 'en' ? ' aria-current="page"' : ''}>English</a></nav>`;
  html = html.replace('<!--ALTERNATES-->', alternates).replace('<!--LANGSWITCH-->', sw);
  if (!html.startsWith('<!doctype') && !html.startsWith('<!DOCTYPE')) html = '<!doctype html>\n' + html;
  return html.replace(/^<!DOCTYPE html>/, '<!doctype html>');
}

fs.writeFileSync(path.join(root, 'index.html'), build('tr'));
fs.mkdirSync(path.join(root, 'en'), { recursive: true });
fs.writeFileSync(path.join(root, 'en', 'index.html'), build('en'));
console.log('built index.html and en/index.html');
