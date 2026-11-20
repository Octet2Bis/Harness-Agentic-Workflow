/** Faux réseau des tests : fichiers du dossier test/ selon l'URL ; SIGNALS_SITE_VERSION choisit la version du site. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = import.meta.dir;
const file = (n: string) => ({ status: 200, text: readFileSync(join(dir, n), 'utf8') });
export default async function fakeFetch(url: string): Promise<{ status: number; text: string }> {
  if (url.includes('maddyness.com/feed')) return file('maddyness.rss');
  if (url.includes('techfundingnews.com/feed')) return file('techfundingnews.rss');
  if (url.includes('yc-oss.github.io')) return file('yc.json');
  if (url.includes('recherche-entreprises') && /q=Pennylane/i.test(url)) return file('recherche-pennylane.json');
  if (url.includes('recherche-entreprises')) return { status: 200, text: '{"results":[],"total_results":0}' };
  if (url.includes('bodacc-datadila') && url.includes('880000001')) return file('bodacc-pennylane.json');
  if (url.includes('api.gleif.org')) return file('gleif-empty.json');
  if (url.startsWith('https://lemonanalytics.io')) return file(`site-lemon-v${process.env.SIGNALS_SITE_VERSION ?? '1'}.html`);
  if (url.includes('sifted.eu')) return { status: 403, text: '' };
  return { status: 0, text: '' };
}
