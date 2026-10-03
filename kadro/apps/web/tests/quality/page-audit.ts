/**
 * Accessibility audit that runs inside the page (ADR-0059). axe-core is not a dependency of this
 * repository and none is added, so this is a documented subset of the WCAG 2.2 A/AA rules that
 * axe reports most often, evaluated on the rendered DOM in a real browser over the DevTools
 * protocol. It is not a replacement for axe: rules that need the accessibility tree of the
 * browser (aria-required-children, name computation of composite widgets, focus order) are not
 * covered. The expression evaluates to a JSON string of `{ violations, contrastSkipped }`.
 *
 * Rules: document-title, html-has-lang, viewport-allows-zoom, page-has-one-h1, heading-order,
 * empty-heading, landmark-one-main, landmark-banner, landmark-contentinfo, region (visible text
 * inside a landmark), skip-link target, image-alt, svg-img-alt, link-name, button-name, label,
 * duplicate-id, aria-valid-attr-value (id references), aria-hidden-focus, target-size (24 px
 * minimum, WCAG 2.5.8) and color-contrast (4.5:1, 3:1 for large text; elements over a background
 * image are counted in `contrastSkipped`, not judged).
 */
export const PAGE_AUDIT = String.raw`(() => {
  const violations = [];
  const add = (rule, detail) => violations.push({ rule, detail: String(detail).slice(0, 160) });
  const visible = (el) => {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  const describe = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
    (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '');
  const nameOf = (el) => {
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
      if (text) return text;
    }
    const label = el.getAttribute('aria-label');
    if (label && label.trim()) return label.trim();
    const text = (el.textContent ?? '').trim();
    if (text) return text;
    const img = el.querySelector('img[alt]:not([alt=""])');
    if (img) return img.getAttribute('alt');
    return (el.getAttribute('title') ?? '').trim();
  };

  if (!document.title.trim()) add('document-title', 'empty title');
  const lang = document.documentElement.getAttribute('lang');
  if (!lang || !/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(lang)) add('html-has-lang', lang);
  const viewport = document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '';
  if (/user-scalable\s*=\s*(no|0)/i.test(viewport) || /maximum-scale\s*=\s*[01](\.\d+)?\b/i.test(viewport)) {
    add('viewport-allows-zoom', viewport);
  }

  const h1 = [...document.querySelectorAll('h1')].filter(visible);
  if (h1.length !== 1) add('page-has-one-h1', h1.length + ' h1 elements');
  let previous = 0;
  for (const heading of document.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    if (!visible(heading)) continue;
    const level = Number(heading.tagName[1]);
    if (previous !== 0 && level > previous + 1) add('heading-order', 'h' + previous + ' to h' + level + ' at "' + heading.textContent.trim() + '"');
    previous = level;
    if (!nameOf(heading)) add('empty-heading', describe(heading));
  }

  const mains = document.querySelectorAll('main, [role="main"]');
  if (mains.length !== 1) add('landmark-one-main', mains.length + ' main landmarks');
  if (document.querySelectorAll('header, [role="banner"]').length < 1) add('landmark-banner', 'no header');
  if (document.querySelectorAll('footer, [role="contentinfo"]').length < 1) add('landmark-contentinfo', 'no footer');
  const landmarks = 'header, footer, main, nav, aside, section[aria-label], section[aria-labelledby], [role=banner], [role=contentinfo], [role=main], [role=navigation]';
  const skip = document.querySelector('a[href^="#"]');
  if (skip && !document.getElementById(skip.getAttribute('href').slice(1))) {
    add('skip-link', 'target of the first in-page link is missing');
  }
  for (const el of document.body.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6')) {
    if (visible(el) && el.textContent.trim() && !el.closest(landmarks)) {
      add('region', 'text outside every landmark: ' + describe(el));
    }
  }

  for (const img of document.querySelectorAll('img')) {
    if (!img.hasAttribute('alt') && img.getAttribute('role') !== 'presentation') add('image-alt', describe(img));
  }
  for (const svg of document.querySelectorAll('svg[role="img"]')) {
    if (!nameOf(svg)) add('svg-img-alt', describe(svg));
  }
  for (const link of document.querySelectorAll('a[href]')) {
    if (visible(link) && !nameOf(link)) add('link-name', link.getAttribute('href'));
  }
  for (const button of document.querySelectorAll('button, [role="button"]')) {
    if (visible(button) && !nameOf(button)) add('button-name', describe(button));
  }
  for (const control of document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea')) {
    if (!visible(control)) continue;
    const labelled = (control.labels && control.labels.length > 0) || control.getAttribute('aria-label') || control.getAttribute('aria-labelledby');
    if (!labelled) add('label', describe(control));
  }

  const seen = new Set();
  for (const el of document.querySelectorAll('[id]')) {
    if (seen.has(el.id)) add('duplicate-id', el.id);
    seen.add(el.id);
  }
  for (const attr of ['aria-labelledby', 'aria-describedby', 'aria-controls']) {
    for (const el of document.querySelectorAll('[' + attr + ']')) {
      for (const id of el.getAttribute(attr).split(/\s+/).filter(Boolean)) {
        if (!document.getElementById(id)) add('aria-valid-attr-value', attr + '=' + id);
      }
    }
  }
  const focusable = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
  for (const el of document.querySelectorAll('[aria-hidden="true"]')) {
    if (el.matches(focusable) || el.querySelector(focusable)) add('aria-hidden-focus', describe(el));
  }

  for (const el of document.querySelectorAll('a[href], button')) {
    if (!visible(el)) continue;
    if (getComputedStyle(el).display === 'inline') continue;
    const box = el.getBoundingClientRect();
    if (box.width < 24 || box.height < 24) add('target-size', describe(el) + ' ' + Math.round(box.width) + 'x' + Math.round(box.height));
  }

  const parse = (value) => {
    const m = /rgba?\(([^)]+)\)/.exec(value);
    if (!m) return null;
    const parts = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const over = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const luminance = ({ r, g, b }) => {
    const channel = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const backgroundOf = (el) => {
    const layers = [];
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== 'none') return null;
      const color = parse(style.backgroundColor);
      if (color && color.a > 0) { layers.push(color); if (color.a === 1) break; }
    }
    let result = { r: 255, g: 255, b: 255, a: 1 };
    for (const layer of layers.reverse()) result = over(layer, result);
    return result;
  };
  let skipped = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const checked = new Set();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!el || checked.has(el) || !node.textContent.trim() || !visible(el)) continue;
    checked.add(el);
    if (el.closest('script, style, noscript')) continue;
    const style = getComputedStyle(el);
    const foreground = parse(style.color);
    const background = backgroundOf(el);
    if (!foreground || !background) { skipped += 1; continue; }
    const text = over({ ...foreground, a: foreground.a * Number(style.opacity) }, background);
    const l1 = luminance(text);
    const l2 = luminance(background);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const size = parseFloat(style.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    const needed = large ? 3 : 4.5;
    if (ratio < needed) add('color-contrast', describe(el) + ' ' + ratio.toFixed(2) + ':1 needs ' + needed);
  }
  return JSON.stringify({ violations, contrastSkipped: skipped });
})()`;

export interface AuditViolation {
  readonly rule: string;
  readonly detail: string;
}

export interface AuditResult {
  readonly violations: readonly AuditViolation[];
  readonly contrastSkipped: number;
}
