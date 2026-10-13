/**
 * Build-time GitHub overlay installer for the existing Aippy Engagement Tester.
 * Called by a Vite buildStart hook; Node's fetch/fs perform exact-file downloads.
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';

export const MANIFEST_URL = 'https://raw.githubusercontent.com/benryaus-cmd/test2/main/updates/account-activity-13oct2026.json';

export async function importEngagementOverlay(rootDir = process.cwd()) {
  const manifestResponse = await fetch(MANIFEST_URL, { cache: 'no-store' });
  if (!manifestResponse.ok) throw new Error('Aippy engagement manifest: HTTP ' + manifestResponse.status);
  const manifest = await manifestResponse.json();
  if (!manifest.baseUrl || !Array.isArray(manifest.files)) throw new Error('Invalid engagement import manifest');
  const root = resolve(rootDir);
  const downloaded = await Promise.all(manifest.files.map(async entry => {
    const target = resolve(root, entry.target);
    const rel = relative(root, target);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) throw new Error('Invalid file target: ' + entry.target);
    const response = await fetch(new URL(entry.source, manifest.baseUrl), { cache: 'no-store' });
    if (!response.ok) throw new Error(entry.source + ': HTTP ' + response.status);
    return { target, contents: new Uint8Array(await response.arrayBuffer()), file: entry.target };
  }));
  for (const file of downloaded) {
    await mkdir(dirname(file.target), { recursive: true });
    await writeFile(file.target, file.contents);
    console.log('[Aippy Engagement] replaced', file.file, file.contents.byteLength + ' bytes');
  }
  console.log('[Aippy Engagement] downloaded ' + downloaded.length + '/' + manifest.files.length + ' files');
  return downloaded.map(x => x.file);
}
