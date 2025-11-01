#!/usr/bin/env node

/**
 * Adds `.js` extensions to all relative import/export specifiers so that the
 * emitted ESM can be resolved by Node at runtime.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const projectRoot = process.cwd();
const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
const configResult = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
if (configResult.error) {
  throw new Error(ts.formatDiagnosticsWithColorAndContext([configResult.error], {
    getCurrentDirectory: () => projectRoot,
    getCanonicalFileName: (fileName) => fileName,
    getNewLine: () => ts.sys.newLine,
  }));
}

const parsedConfig = ts.parseJsonConfigFileContent(
  configResult.config,
  ts.sys,
  projectRoot,
);
const compilerOptions = parsedConfig.options;
const moduleResolutionCache = ts.createModuleResolutionCache(
  projectRoot,
  (fileName) => fileName,
  compilerOptions,
);

const fileExtensions = new Set(['.ts', '.tsx', '.mts', '.cts']);
const skipExtensions = new Set(['.d.ts', '.d.mts', '.d.cts']);
const skipDirs = new Set(['node_modules', '.git', 'dist', 'legacy']);
const candidateExtensions = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
];

const processedFiles = [];
const updatedFiles = [];
const jsLikeExtensions = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);

async function main() {
  const files = await collectFiles(projectRoot);

  for (const file of files) {
    processedFiles.push(path.relative(projectRoot, file));
    const changed = await processFile(file);
    if (changed) {
      updatedFiles.push(path.relative(projectRoot, file));
    }
  }

  console.log(
    `Processed ${processedFiles.length} file(s); updated ${updatedFiles.length}.`,
  );
}

async function collectFiles(dir) {
  const result = [];
  await walk(dir, result);
  return result;
}

async function walk(dir, result) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      if (entry.name === '.env') {
        continue;
      }
      if (skipDirs.has(entry.name)) {
        continue;
      }
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) {
        continue;
      }
      await walk(fullPath, result);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (!fileExtensions.has(ext)) {
        continue;
      }
      if ([...skipExtensions].some((suffix) => entry.name.endsWith(suffix))) {
        continue;
      }
      result.push(fullPath);
    }
  }
}

async function processFile(filePath) {
  const original = await fsp.readFile(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    original,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );

  const replacements = [];

  function visit(node) {
    if (
      ts.isImportDeclaration(node) ||
      ts.isExportDeclaration(node) ||
      ts.isImportEqualsDeclaration(node)
    ) {
      const specifier = getModuleSpecifier(node);
      if (specifier) {
        maybeQueueReplacement(specifier, replacements, filePath);
      }
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const [arg] = node.arguments;
        if (ts.isStringLiteralLike(arg)) {
          maybeQueueReplacement(arg, replacements, filePath);
        }
      } else if (
        ts.isIdentifier(node.expression) &&
        node.expression.escapedText === 'require'
      ) {
        const [arg] = node.arguments;
        if (ts.isStringLiteralLike(arg)) {
          maybeQueueReplacement(arg, replacements, filePath);
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (replacements.length === 0) {
    return false;
  }

  replacements.sort((a, b) => b.start - a.start);
  let content = original;
  for (const { start, end, text } of replacements) {
    content =
      content.slice(0, start) +
      text +
      content.slice(end);
  }

  if (content !== original) {
    await fsp.writeFile(filePath, content, 'utf8');
    return true;
  }

  return false;
}

function getModuleSpecifier(node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)
      ? node.moduleSpecifier
      : undefined;
  }

  if (ts.isImportEqualsDeclaration(node)) {
    if (
      node.moduleReference &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      return node.moduleReference.expression;
    }
  }

  return undefined;
}

function maybeQueueReplacement(literal, replacements, sourceFilePath) {
  const rawText = literal.getText();
  const quote = rawText[0];
  const moduleText = literal.text;

  if (moduleText.includes('?') || moduleText.includes('#')) {
    return;
  }

  const resolved = resolveModule(moduleText, sourceFilePath);
  if (!resolved) {
    return;
  }

  const { resolvedFileName } = resolved;

  if (!resolvedFileName) {
    return;
  }

  if (!isWithinProject(resolvedFileName)) {
    return;
  }

  if (resolvedFileName.endsWith('.d.ts')) {
    return;
  }

  const newSpecifier = buildRelativeSpecifier(sourceFilePath, resolvedFileName, moduleText);

  if (!newSpecifier || newSpecifier === moduleText) {
    return;
  }

  const updated = `${quote}${newSpecifier}${quote}`;
  replacements.push({
    start: literal.getStart(),
    end: literal.getEnd(),
    text: updated,
  });
}

function resolveModule(specifier, sourceFilePath) {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
  const hasExtension = !!path.extname(specifier);

  if (isRelative && hasExtension && !jsLikeExtensions.has(path.extname(specifier))) {
    // Already points to a concrete asset (e.g., .json). Skip.
    return null;
  }

  const resolved = ts.resolveModuleName(
    specifier,
    sourceFilePath,
    compilerOptions,
    ts.sys,
    moduleResolutionCache,
  );

  return resolved.resolvedModule ?? null;
}

function tryResolveFile(absoluteBase) {
  for (const ext of candidateExtensions) {
    if (fs.existsSync(absoluteBase + ext)) {
      return absoluteBase + ext;
    }
  }
  return null;
}

function tryResolveDirectory(absoluteBase) {
  if (!fs.existsSync(absoluteBase)) {
    return null;
  }

  let stats;
  try {
    stats = fs.statSync(absoluteBase);
  } catch {
    return null;
  }

  if (!stats.isDirectory()) {
    return null;
  }

  for (const ext of candidateExtensions) {
    if (fs.existsSync(path.join(absoluteBase, `index${ext}`))) {
      return true;
    }
  }

  return null;
}

function isWithinProject(resolvedFileName) {
  const relative = path.relative(projectRoot, resolvedFileName);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function buildRelativeSpecifier(sourceFilePath, resolvedFilePath, originalSpecifier) {
  if (resolvedFilePath.includes('node_modules')) {
    return null;
  }

  const ext = path.extname(resolvedFilePath);

  const shouldAddJsExtension = jsLikeExtensions.has(ext);

  let relativePath = path.relative(path.dirname(sourceFilePath), resolvedFilePath);
  relativePath = relativePath.replace(/\\/g, '/');

  if (!relativePath.startsWith('.')) {
    relativePath = `./${relativePath}`;
  }

  let withoutExt = relativePath;
  if (ext) {
    withoutExt = relativePath.slice(0, relativePath.length - ext.length);
  }

  const finalSpecifier = shouldAddJsExtension
    ? `${withoutExt}.js`
    : `${withoutExt}${ext}`;

  return finalSpecifier;
}

await main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
