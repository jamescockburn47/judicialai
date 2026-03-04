/**
 * Matter file system — reads/writes matters from ~/Documents/JudicialReview/
 * Demo matter is seeded on first launch by seedDemoMatterIfNeeded(),
 * which works both from the installer and from source via launch.ps1.
 */
import type { Matter, MatterAnalysisCache, AnalysisReport, AnalysisMode } from './types';

const isTauri = () => '__TAURI_INTERNALS__' in window;

// ── Path helpers ──────────────────────────────────────────────────────────────

let _baseDir: string | null = null;

async function getBaseDir(): Promise<string> {
  if (_baseDir) return _baseDir;
  if (!isTauri()) return '';
  const { documentDir } = await import('@tauri-apps/api/path');
  const docs = await documentDir();
  // documentDir() returns e.g. "C:\Users\James\Documents\"
  // Strip trailing slash and use forward slashes throughout
  _baseDir = docs.replace(/[/\\]+$/, '') + '/JudicialReview';
  return _baseDir;
}

async function ensureDir(path: string) {
  if (!isTauri()) return;
  try {
    const { mkdir } = await import('@tauri-apps/plugin-fs');
    await mkdir(path, { recursive: true });
  } catch {
    // Already exists — ignore
  }
}

async function pathExists(path: string): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { exists } = await import('@tauri-apps/plugin-fs');
    return await exists(path);
  } catch {
    return false;
  }
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const text = await readTextFile(path);
    return JSON.parse(text) as T;
  } catch (e) {
    console.warn('readJsonFile failed:', path, e);
    return null;
  }
}

async function writeJsonFile(path: string, data: unknown) {
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');
  await writeTextFile(path, JSON.stringify(data, null, 2));
}

// ── Demo matter seeding ───────────────────────────────────────────────────────
// Runs on first launch (both from source via launch.ps1 AND from the installer).
// Copies the bundled demo matter from the app's resource directory to ~/Documents/JudicialReview/

async function seedDemoMatterIfNeeded(baseDir: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const { exists, mkdir, copyFile, readDir } = await import('@tauri-apps/plugin-fs');
    const { resolveResource } = await import('@tauri-apps/api/path');

    const destMatterJson = `${baseDir}/rivera-v-harmon/matter.json`;
    if (await exists(destMatterJson)) return; // already seeded

    // Find bundled demo matter — try resolveResource first (production installer),
    // fall back to the known dev path
    let srcBase: string | null = null;
    try {
      const candidate = await resolveResource('demo-matters/rivera-v-harmon');
      if (await exists(`${candidate}/matter.json`)) {
        srcBase = candidate;
      }
    } catch { /* resolveResource not available or path not found */ }

    if (!srcBase) {
      // Dev fallback — absolute path used by launch.ps1
      const devPath = 'C:/Users/James/Desktop/Judicial AI/frontend/src-tauri/demo-matters/rivera-v-harmon';
      if (await exists(`${devPath}/matter.json`)) {
        srcBase = devPath;
      }
    }

    if (!srcBase) return; // no source found, skip silently

    const destDir = `${baseDir}/rivera-v-harmon`;
    const destDocsDir = `${destDir}/documents`;
    await mkdir(destDocsDir, { recursive: true });
    await copyFile(`${srcBase}/matter.json`, `${destDir}/matter.json`);

    const docEntries = await readDir(`${srcBase}/documents`).catch(() => []);
    for (const entry of docEntries) {
      if (entry.name) {
        await copyFile(
          `${srcBase}/documents/${entry.name}`,
          `${destDocsDir}/${entry.name}`,
        );
      }
    }
  } catch (e) {
    console.warn('Demo matter seeding failed (non-fatal):', e);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function listMatters(): Promise<Matter[]> {
  if (!isTauri()) return [];

  const baseDir = await getBaseDir();
  await ensureDir(baseDir);

  // Seed demo matter on first launch, regardless of how the app was started
  await seedDemoMatterIfNeeded(baseDir);

  const { readDir } = await import('@tauri-apps/plugin-fs');

  let entries: Array<{ name?: string }> = [];
  try {
    entries = await readDir(baseDir);
  } catch (e) {
    console.error('listMatters: readDir failed on', baseDir, e);
    return [];
  }

  const matters: Matter[] = [];

  for (const entry of entries) {
    if (!entry.name) continue;
    const matterDir = `${baseDir}/${entry.name}`;
    const matterFile = `${matterDir}/matter.json`;

    const exists = await pathExists(matterFile);
    if (!exists) continue;

    const data = await readJsonFile<Omit<Matter, 'documentsPath'>>(matterFile);
    if (data) {
      matters.push({ ...data, documentsPath: `${matterDir}/documents` });
    }
  }

  return matters.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createMatter(
  name: string,
  caseNumber: string,
  court: string,
  documentPaths: string[],
): Promise<Matter> {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
  const baseDir = await getBaseDir();
  const matterDir = `${baseDir}/${id}`;
  const docsDir = `${matterDir}/documents`;

  await ensureDir(docsDir);

  if (isTauri() && documentPaths.length > 0) {
    const { copyFile } = await import('@tauri-apps/plugin-fs');
    for (const src of documentPaths) {
      const filename = src.split(/[/\\]/).pop() ?? src;
      await copyFile(src, `${docsDir}/${filename}`);
    }
  }

  const filenames = documentPaths.map((p) => p.split(/[/\\]/).pop() ?? p);
  const matter: Matter = {
    id,
    name,
    caseNumber,
    court,
    createdAt: new Date().toISOString().slice(0, 10),
    primaryDocument: filenames[0] ?? '',
    supportingDocuments: filenames.slice(1),
    documentsPath: docsDir,
  };

  await writeJsonFile(`${matterDir}/matter.json`, matter);

  return matter;
}

export async function readDocument(matter: Matter, filename: string): Promise<string> {
  if (!isTauri()) {
    return `[Document: ${filename}]\n\nNot available outside the desktop app.`;
  }
  const { readTextFile } = await import('@tauri-apps/plugin-fs');
  return readTextFile(`${matter.documentsPath}/${filename}`);
}

export async function loadAnalysisCache(matter: Matter): Promise<MatterAnalysisCache | null> {
  if (!isTauri()) return null;
  const baseDir = await getBaseDir();
  return readJsonFile<MatterAnalysisCache>(`${baseDir}/${matter.id}/.jr/analysis.json`);
}

export async function saveAnalysisCache(
  matter: Matter,
  mode: AnalysisMode,
  report: AnalysisReport,
) {
  if (!isTauri()) return;
  const baseDir = await getBaseDir();
  await ensureDir(`${baseDir}/${matter.id}/.jr`);
  const cache: MatterAnalysisCache = {
    matterId: matter.id,
    mode,
    runAt: new Date().toISOString(),
    report,
  };
  await writeJsonFile(`${baseDir}/${matter.id}/.jr/analysis.json`, cache);
}

export async function pickDocuments(): Promise<string[]> {
  if (!isTauri()) return [];
  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({
    multiple: true,
    filters: [{ name: 'Documents', extensions: ['txt', 'pdf', 'docx', 'doc'] }],
  });
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}
