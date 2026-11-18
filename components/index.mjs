#!/usr/bin/env node
/**
 * Installer-core component reader.
 *
 * Component descriptors keep installer metadata independent from platform-
 * specific packaging code. See docs/packaging-design.md §0B.
 *
 * CLI:
 *   node components/index.mjs list            # ids in dependency order
 *   node components/index.mjs describe <id>   # one descriptor as JSON
 *   node components/index.mjs validate        # exit 1 if anything is malformed
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const componentsRoot = path.dirname(fileURLToPath(import.meta.url));

/** Reads every `<dir>/component.json` under the components root. */
export function loadComponents(root = componentsRoot) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => path.join(root, entry.name, 'component.json'))
    .filter((file) => fs.existsSync(file))
    .map((file) => ({ ...JSON.parse(fs.readFileSync(file, 'utf8')), _path: file }));
}

/**
 * Orders components so every component follows the ones it depends on, which is the
 * order to install and start them in (reverse it to stop and uninstall).
 * Throws on an unknown or circular `dependsOn`.
 */
export function resolveOrder(components) {
  const byId = new Map(components.map((c) => [c.id, c]));
  const ordered = [];
  const state = new Map(); // id → 'visiting' | 'done'

  const visit = (id, trail) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      throw new Error(`Circular dependency: ${[...trail, id].join(' → ')}`);
    }
    const component = byId.get(id);
    if (!component) {
      throw new Error(`Unknown component "${id}" referenced by ${trail.at(-1) ?? '(root)'}`);
    }

    state.set(id, 'visiting');
    for (const dep of component.dependsOn ?? []) visit(dep, [...trail, id]);
    state.set(id, 'done');
    ordered.push(component);
  };

  for (const { id } of components) visit(id, []);
  return ordered;
}

const REQUIRED_FIELDS = ['id', 'name', 'kind'];
const VALID_KINDS = new Set(['service', 'container', 'static', 'external']);
const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateStringArray(value, field, where, problems) {
  if (!Array.isArray(value) || value.some((item) => !isNonEmptyString(item))) {
    problems.push(`${where}: "${field}" must be an array of non-empty strings`);
  }
}

/** Structural checks the installer relies on. Returns a list of problems. */
export function validate(components) {
  const problems = [];
  const seen = new Set();

  for (const component of components) {
    const where = path.relative(componentsRoot, component._path ?? '(memory)');

    for (const field of REQUIRED_FIELDS) {
      if (!component[field]) problems.push(`${where}: missing required field "${field}"`);
    }
    if (component.kind && !VALID_KINDS.has(component.kind)) {
      problems.push(`${where}: invalid kind "${component.kind}"`);
    }
    if (component.id) {
      if (!ID_PATTERN.test(component.id)) problems.push(`${where}: id has an invalid format`);
      if (component._path && path.basename(path.dirname(component._path)) !== component.id) {
        problems.push(`${where}: id must match its directory name`);
      }
      if (seen.has(component.id)) problems.push(`${where}: duplicate id "${component.id}"`);
      seen.add(component.id);
    }

    for (const field of ['config', 'dataDirs', 'dependsOn']) {
      if (component[field] !== undefined) {
        validateStringArray(component[field], field, where, problems);
      }
    }

    if (Array.isArray(component.dependsOn)) {
      if (new Set(component.dependsOn).size !== component.dependsOn.length) {
        problems.push(`${where}: "dependsOn" contains duplicate ids`);
      }
      if (component.dependsOn.includes(component.id)) {
        problems.push(`${where}: a component cannot depend on itself`);
      }
    }

    if (component.kind === 'service') {
      if (!component.binary || typeof component.binary !== 'object') {
        problems.push(`${where}: kind=service requires platform-specific "binary" paths`);
      } else {
        for (const platform of ['win32', 'linux']) {
          if (!isNonEmptyString(component.binary[platform])) {
            problems.push(`${where}: binary.${platform} is required`);
          }
        }
      }
      if (!isNonEmptyString(component.service?.name)) {
        problems.push(`${where}: kind=service requires "service.name"`);
      }
      if (!isNonEmptyString(component.healthcheck?.path) || !component.healthcheck.path.startsWith('/')) {
        problems.push(`${where}: kind=service requires an absolute "healthcheck.path"`);
      }
    }

    if (component.kind === 'container') {
      if (!isNonEmptyString(component.image)) {
        problems.push(`${where}: kind=container requires "image"`);
      }
      if (!isNonEmptyString(component.service?.name)) {
        problems.push(`${where}: kind=container requires "service.name"`);
      }
      if (!isNonEmptyString(component.healthcheck?.path) || !component.healthcheck.path.startsWith('/')) {
        problems.push(`${where}: kind=container requires an absolute "healthcheck.path"`);
      }
    }

    if (component.kind === 'static') {
      if (!isNonEmptyString(component.servedBy)) {
        problems.push(`${where}: kind=static requires "servedBy"`);
      }
      if (!isNonEmptyString(component.buildOutput) || !isNonEmptyString(component.bundledInto)) {
        problems.push(`${where}: kind=static requires "buildOutput" and "bundledInto"`);
      }
    }
  }

  for (const component of components) {
    if (component.servedBy && !seen.has(component.servedBy)) {
      problems.push(`${component.id}: unknown servedBy component "${component.servedBy}"`);
    }
  }

  try {
    resolveOrder(components);
  } catch (err) {
    problems.push(err.message);
  }

  return problems;
}

/** Resolves the platform-specific binary path for a component. */
export function binaryFor(component, platform = process.platform) {
  if (!component.binary) return undefined;
  return component.binary[platform];
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const [command = 'list', arg] = process.argv.slice(2);
  const components = loadComponents();

  switch (command) {
    case 'list': {
      for (const c of resolveOrder(components)) console.log(c.id);
      break;
    }
    case 'describe': {
      const found = components.find((c) => c.id === arg);
      if (!found) {
        console.error(`No such component: ${arg}`);
        process.exit(1);
      }
      const { _path, ...descriptor } = found;
      console.log(JSON.stringify(descriptor, null, 2));
      break;
    }
    case 'validate': {
      const problems = validate(components);
      if (problems.length > 0) {
        for (const problem of problems) console.error(`✗ ${problem}`);
        process.exit(1);
      }
      console.log(`✓ ${components.length} component descriptor(s) valid`);
      break;
    }
    default:
      console.error(`Usage: node components/index.mjs <list|describe <id>|validate>`);
      process.exit(2);
  }
}
