import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const SOURCE_ROOT = resolve(REPO_ROOT, 'src');
const PACKAGE_JSON = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
};
const PACKAGE_LOCK = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package-lock.json'), 'utf8')) as {
  packages?: Record<string, { dependencies?: Record<string, string> }>;
};

describe('privacy and dependency regression guardrails', () => {
  it('keeps saved layouts session-only by avoiding browser persistence APIs', () => {
    expect(findForbiddenSourceMatches([/\blocalStorage\b/, /\bsessionStorage\b/, /\bindexedDB\b/, /\bcaches\s*\./])).toEqual([]);
  });

  it('does not add cloud or AI SDK imports to the app source', () => {
    expect(
      findForbiddenSourceMatches([
        /\b(?:firebase|supabase|appwrite|pocketbase|amplify)\b/i,
        /\b(?:aws-sdk|@aws-sdk|s3client)\b/i,
        /\b(?:openai|anthropic|gemini|langchain|llamaindex|ollama|huggingface|transformers)\b/i,
      ]),
    ).toEqual([]);
  });

  it('keeps runtime dependencies limited to the two PDF libraries', () => {
    const expectedRuntimeDependencies = ['pdf-lib', 'pdfjs-dist'];
    const packageDependencies = Object.keys(PACKAGE_JSON.dependencies ?? {}).sort();
    const lockfileDependencies = Object.keys(PACKAGE_LOCK.packages?.['']?.dependencies ?? {}).sort();

    expect(packageDependencies).toEqual(expectedRuntimeDependencies);
    expect(lockfileDependencies).toEqual(expectedRuntimeDependencies);
  });
});

function findForbiddenSourceMatches(patterns: readonly RegExp[]): string[] {
  return listSourceFiles(SOURCE_ROOT)
    .flatMap((filePath) => {
      const text = readFileSync(filePath, 'utf8');
      return patterns
        .filter((pattern) => pattern.test(text))
        .map((pattern) => `${filePath.replace(SOURCE_ROOT, 'src')}: ${String(pattern)}`);
    })
    .sort();
}

function listSourceFiles(root: string): string[] {
  const entries = readdirSync(root);
  return entries.flatMap((entry) => {
    const path = join(root, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) return listSourceFiles(path);
    if (stats.isFile() && extname(path) === '.ts' && basename(path) !== 'vite-env.d.ts') return [path];
    return [];
  });
}
