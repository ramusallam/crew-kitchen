// Reads a recipe page server-side and returns its schema.org Recipe data
// in Crew Kitchen's recipe shape: {title, time, serves, tags, ingredients, steps, source}.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const raw = (req.query.url || '').trim();
  let url;
  try {
    url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) throw new Error('protocol');
    if (isPrivateHost(url.hostname)) throw new Error('host');
  } catch {
    return res.status(400).json({ error: 'That does not look like a valid link.' });
  }

  let html;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    const page = await fetch(url.href, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });
    clearTimeout(timer);
    html = (await page.text()).slice(0, 3_000_000);
  } catch {
    return res.status(502).json({ error: 'Could not read that page. Try another link.' });
  }

  const recipe = findRecipe(html);
  if (!recipe) {
    return res.status(422).json({ error: 'No recipe found on that page. Try the recipe page itself, not a list.' });
  }
  return res.status(200).json(normalize(recipe, url.href));
}

function isPrivateHost(host) {
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return true;
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

function findRecipe(html) {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, body] of blocks) {
    let json;
    try { json = JSON.parse(body.trim()); } catch { continue; }
    const found = walk(json);
    if (found) return found;
  }
  return null;
}

function walk(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const item of node) { const r = walk(item, depth + 1); if (r) return r; }
    return null;
  }
  const type = node['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.includes('Recipe')) return node;
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) {
    if (node[key]) { const r = walk(node[key], depth + 1); if (r) return r; }
  }
  return null;
}

function normalize(r, sourceUrl) {
  const text = v => decode(String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
  const arr = v => Array.isArray(v) ? v : v ? [v] : [];

  const steps = flattenInstructions(r.recipeInstructions).map(text).filter(Boolean);
  const tags = [...arr(r.recipeCuisine), ...arr(r.recipeCategory)]
    .map(t => text(typeof t === 'object' ? t.name : t).toLowerCase()).filter(Boolean).slice(0, 3);

  return {
    title: text(r.name) || 'Imported recipe',
    time: isoDuration(r.totalTime) || isoDuration(r.cookTime) || '',
    serves: yieldCount(r.recipeYield),
    tags,
    ingredients: arr(r.recipeIngredient).map(text).filter(Boolean),
    steps,
    source: sourceUrl
  };
}

function flattenInstructions(v) {
  if (!v) return [];
  if (typeof v === 'string') return v.split(/\r?\n+/);
  const out = [];
  for (const item of (Array.isArray(v) ? v : [v])) {
    if (typeof item === 'string') out.push(item);
    else if (item && item.itemListElement) out.push(...flattenInstructions(item.itemListElement));
    else if (item && item.text) out.push(item.text);
    else if (item && item.name) out.push(item.name);
  }
  return out;
}

function isoDuration(v) {
  const m = typeof v === 'string' && v.match(/^PT(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m || (!m[1] && !m[2])) return '';
  const h = Number(m[1] || 0), min = Number(m[2] || 0);
  return [h ? h + ' hr' : '', min ? min + ' min' : ''].filter(Boolean).join(' ');
}

function yieldCount(v) {
  const first = Array.isArray(v) ? v[0] : v;
  const m = String(first ?? '').match(/\d+(\s*[-–]\s*\d+)?/);
  return m ? m[0].replace(/\s+/g, '') : '';
}

function decode(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
