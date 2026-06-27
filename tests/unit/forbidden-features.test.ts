import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const SOURCE_ROOT = resolve(REPO_ROOT, 'src');

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface PackageLockRoot {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface PackageLock {
  packages?: Record<string, PackageLockRoot | undefined>;
}

interface ForbiddenPackageGroup {
  feature: string;
  patterns: readonly RegExp[];
}

interface SourceMatch {
  relativePath: string;
  lineNumber: number;
  lineText: string;
  pattern: RegExp;
}

const PACKAGE_JSON = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8')) as PackageJson;
const PACKAGE_LOCK = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package-lock.json'), 'utf8')) as PackageLock;

const FORBIDDEN_PACKAGE_GROUPS: readonly ForbiddenPackageGroup[] = [
  {
    feature: 'cloud upload/storage/backend service',
    patterns: [
      /^(?:firebase|@firebase\/.+|supabase|@supabase\/.+|appwrite|pocketbase)$/i,
      /^(?:aws-sdk|@aws-sdk\/.+|@google-cloud\/.+|cloudinary)$/i,
      /^(?:multer|formidable)$/i,
    ],
  },
  {
    feature: 'OCR/AI processing',
    patterns: [
      /^(?:openai|@openai\/.+|anthropic|@anthropic-ai\/.+|@google\/generative-ai)$/i,
      /^(?:langchain|@langchain\/.+|llamaindex|ollama|replicate)$/i,
      /^(?:@xenova\/transformers|transformers|huggingface|tesseract|tesseract\.js|ocr-space-api-wrapper)$/i,
    ],
  },
  {
    feature: 'library management or persistence',
    patterns: [
      /^(?:dexie|idb|localforage|pouchdb|rxdb|@nozbe\/watermelondb|realm-web)$/i,
      /^(?:sql\.js|better-sqlite3|sqlite3|@sqlite\.org\/sqlite-wasm)$/i,
      /^(?:drizzle-orm|prisma|@prisma\/client|typeorm|sequelize|mongoose)$/i,
    ],
  },
  {
    feature: 'analytics/account tracking',
    patterns: [/^(?:@sentry\/browser|posthog-js|mixpanel-browser|analytics|@segment\/analytics-next|plausible-tracker|amplitude-js)$/i],
  },
];

const UPLOAD_CAPABLE_BROWSER_APIS: readonly RegExp[] = [
  /\bfetch\s*\(/,
  /\bnavigator\.sendBeacon\b/,
  /\bsendBeacon\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bEventSource\b/,
];

const PERSISTENCE_BROWSER_APIS: readonly RegExp[] = [
  /\blocalStorage\b/,
  /\bsessionStorage\b/,
  /\bindexedDB\b/,
  /\bcaches\s*\./,
  /\bnavigator\.storage\b/,
  /\bnavigator\.serviceWorker\b/,
  /\bshowDirectoryPicker\b/,
  /\bshowSaveFilePicker\b/,
  /\bFileSystemDirectoryHandle\b/,
  /\bFileSystemWritableFileStream\b/,
];

describe('forbidden feature guardrails', () => {
  it('does not install direct dependencies for cloud upload, OCR/AI, library management, persistence, or analytics', () => {
    expect(findForbiddenPackages(collectDirectPackageNames())).toEqual([]);
  });

  it('keeps upload-capable browser APIs out of app code except the local export network guard', () => {
    expect(findUnexpectedSourceMatches(UPLOAD_CAPABLE_BROWSER_APIS, isAllowedUploadGuardMatch)).toEqual([]);
  });

  it('keeps browser persistence and library-storage APIs out of app source', () => {
    expect(findUnexpectedSourceMatches(PERSISTENCE_BROWSER_APIS)).toEqual([]);
  });
});

function collectDirectPackageNames(): string[] {
  const rootLock = PACKAGE_LOCK.packages?.[''];
  return Array.from(
    new Set([
      ...Object.keys(PACKAGE_JSON.dependencies ?? {}),
      ...Object.keys(PACKAGE_JSON.devDependencies ?? {}),
      ...Object.keys(rootLock?.dependencies ?? {}),
      ...Object.keys(rootLock?.devDependencies ?? {}),
    ]),
  ).sort();
}

function findForbiddenPackages(packageNames: readonly string[]): string[] {
  return packageNames
    .flatMap((packageName) =>
      FORBIDDEN_PACKAGE_GROUPS.flatMap((group) =>
        group.patterns.some((pattern) => pattern.test(packageName)) ? [`${packageName}: ${group.feature}`] : [],
      ),
    )
    .sort();
}

function findUnexpectedSourceMatches(patterns: readonly RegExp[], isAllowed: (match: SourceMatch) => boolean = () => false): string[] {
  return listSourceFiles(SOURCE_ROOT)
    .flatMap((filePath) => {
      const relativePath = toRepoRelativePath(filePath);
      const lines = readFileSync(filePath, 'utf8').split('\n');
      return lines.flatMap((lineText, index) =>
        patterns.flatMap((pattern) => {
          const match: SourceMatch = { relativePath, lineNumber: index + 1, lineText, pattern };
          return pattern.test(lineText) && !isAllowed(match) ? [`${relativePath}:${match.lineNumber}: ${String(pattern)}`] : [];
        }),
      );
    })
    .sort();
}

function isAllowedUploadGuardMatch(match: SourceMatch): boolean {
  if (match.relativePath === 'src/ui/export.ts') return true;
  return (
    match.relativePath === 'src/main.ts' &&
    (match.lineText.includes('/__pdf-slide-splitter-upload-probe') || match.lineText.includes('/__pdf-slide-splitter-beacon-probe'))
  );
}

function listSourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) return listSourceFiles(path);
    if (stats.isFile() && extname(path) === '.ts') return [path];
    return [];
  });
}

function toRepoRelativePath(filePath: string): string {
  return relative(REPO_ROOT, filePath).split('/').join('/');
}
