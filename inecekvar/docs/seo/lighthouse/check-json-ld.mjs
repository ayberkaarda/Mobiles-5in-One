// JSON-LD check for the phase 4 gate (ADR-0042). Fetches each page from a running web server,
// extracts every <script type="application/ld+json">, parses it with JSON.parse and checks
// @context, @type and the properties each type needs (schema.org plus the search engine
// documentation for the rich result types). Prints one line per node; exit 1 on any error.
//
//   node docs/seo/lighthouse/check-json-ld.mjs http://127.0.0.1:58110 / /ornek-test-sehri ...

const [origin, ...paths] = process.argv.slice(2);
if (!origin || paths.length === 0) {
  console.error('usage: check-json-ld.mjs <origin> <path>...');
  process.exit(2);
}

const isText = (value) => typeof value === 'string' && value.trim().length > 0;
const isUrl = (value) => isText(value) && /^https?:\/\//.test(value);
const isDate = (value) => isText(value) && !Number.isNaN(Date.parse(value));
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const typeOf = (node) => (node && typeof node === 'object' ? node['@type'] : undefined);

function geo(node, path, errors) {
  const coordinates = node?.geo;
  if (typeOf(coordinates) !== 'GeoCoordinates') errors.push(`${path}.geo is not GeoCoordinates`);
  else if (!isNumber(coordinates.latitude) || !isNumber(coordinates.longitude)) {
    errors.push(`${path}.geo needs numeric latitude and longitude`);
  }
}

const rules = {
  Organization(node, errors) {
    if (!isText(node.name)) errors.push('name missing');
    if (!isUrl(node.url)) errors.push('url missing or not absolute');
  },
  WebSite(node, errors) {
    if (!isText(node.name)) errors.push('name missing');
    if (!isUrl(node.url)) errors.push('url missing or not absolute');
    const action = node.potentialAction;
    if (action !== undefined) {
      if (typeOf(action) !== 'SearchAction') errors.push('potentialAction is not SearchAction');
      const target = typeof action.target === 'string' ? action.target : action.target?.urlTemplate;
      if (!isText(target) || !target.includes('{search_term_string}')) {
        errors.push('SearchAction target lacks {search_term_string}');
      }
      const input = action['query-input'] ?? action.queryInput;
      if (!isText(input) && typeof input !== 'object') errors.push('SearchAction query-input missing');
    }
  },
  BreadcrumbList(node, errors) {
    const items = node.itemListElement;
    if (!Array.isArray(items) || items.length === 0) {
      errors.push('itemListElement empty');
      return;
    }
    items.forEach((item, index) => {
      if (typeOf(item) !== 'ListItem') errors.push(`item ${index + 1} is not ListItem`);
      if (item.position !== index + 1) errors.push(`item ${index + 1} position ${item.position}`);
      if (!isText(item.name)) errors.push(`item ${index + 1} name missing`);
      if (index < items.length - 1 && !isUrl(item.item)) errors.push(`item ${index + 1} item URL`);
    });
  },
  BusTrip(node, errors) {
    if (!isText(node.name)) errors.push('name missing');
    for (const key of ['departureBusStop', 'arrivalBusStop']) {
      const stop = node[key];
      if (typeOf(stop) !== 'BusStop' || !isText(stop.name)) errors.push(`${key} needs a named BusStop`);
      else geo(stop, key, errors);
    }
    if (!isText(node.provider?.name)) errors.push('provider name missing');
  },
  BusStop(node, errors) {
    if (!isText(node.name)) errors.push('name missing');
    geo(node, 'BusStop', errors);
  },
  Dataset(node, errors) {
    if (!isText(node.name)) errors.push('name missing');
    const length = isText(node.description) ? node.description.length : 0;
    if (length < 50 || length > 5000) errors.push(`description length ${length} (needs 50-5000)`);
    if (!isUrl(node.license) && !isUrl(node.license?.url)) errors.push('license URL missing');
    if (!node.creator) errors.push('creator missing');
    const distribution = [node.distribution ?? []].flat();
    for (const item of distribution) {
      if (typeOf(item) !== 'DataDownload') errors.push('distribution item is not DataDownload');
      if (!isText(item.encodingFormat)) errors.push('distribution encodingFormat missing');
      if (!isText(item.contentUrl)) errors.push('distribution contentUrl missing');
    }
  },
  FAQPage(node, errors) {
    const questions = node.mainEntity;
    if (!Array.isArray(questions) || questions.length === 0) {
      errors.push('mainEntity empty');
      return;
    }
    questions.forEach((question, index) => {
      if (typeOf(question) !== 'Question' || !isText(question.name)) {
        errors.push(`question ${index + 1} needs a named Question`);
      }
      const answer = question.acceptedAnswer;
      if (typeOf(answer) !== 'Answer' || !isText(answer.text)) {
        errors.push(`question ${index + 1} needs acceptedAnswer.text`);
      }
    });
    node.questionCount = questions.length;
  },
  Article(node, errors) {
    if (!isText(node.headline) || node.headline.length > 110) errors.push('headline missing or > 110');
    if (!isDate(node.datePublished)) errors.push('datePublished missing');
    if (node.dateModified !== undefined && !isDate(node.dateModified)) errors.push('dateModified invalid');
    if (!isText(node.author?.name) && !Array.isArray(node.author)) errors.push('author missing');
  },
  MobileApplication(node, errors) {
    if (!isText(node.name)) errors.push('name missing');
    if (!isText(node.operatingSystem)) errors.push('operatingSystem missing');
    if (!isText(node.applicationCategory)) errors.push('applicationCategory missing');
  },
};
rules.WebApplication = rules.MobileApplication;

let failures = 0;
let nodesChecked = 0;
for (const path of paths) {
  const response = await fetch(origin + path, { redirect: 'manual' });
  const html = await response.text();
  const blocks = [
    ...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi),
  ].map((match) => match[1]);
  console.log(`${path}  HTTP ${response.status}, ${blocks.length} JSON-LD block(s)`);
  if (response.status !== 200 || blocks.length === 0) {
    failures += 1;
    console.log('  FAIL no structured data');
    continue;
  }
  for (const block of blocks) {
    let data;
    try {
      data = JSON.parse(block);
    } catch (error) {
      failures += 1;
      console.log(`  FAIL JSON.parse: ${error.message}`);
      continue;
    }
    const context = data['@context'];
    const nodes = Array.isArray(data) ? data : Array.isArray(data['@graph']) ? data['@graph'] : [data];
    for (const node of nodes) {
      nodesChecked += 1;
      const errors = [];
      const nodeContext = node['@context'] ?? context;
      if (nodeContext !== 'https://schema.org') errors.push(`@context ${JSON.stringify(nodeContext)}`);
      const type = typeOf(node);
      const rule = rules[type];
      if (!rule) errors.push(`no rule for @type ${JSON.stringify(type)}`);
      else rule(node, errors);
      const extra = node.questionCount ? ` (${node.questionCount} questions)` : '';
      if (errors.length > 0) failures += 1;
      console.log(`  ${errors.length === 0 ? 'ok  ' : 'FAIL'} ${type}${extra}${errors.length ? ': ' + errors.join('; ') : ''}`);
    }
  }
}
console.log(`${nodesChecked} node(s) on ${paths.length} page(s), ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
