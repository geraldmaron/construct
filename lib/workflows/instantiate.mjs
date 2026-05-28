/**
 * lib/workflows/instantiate.mjs — Workflow template instantiation engine.
 *
 * Resolves a workflow template (by id or path), validates required inputs,
 * substitutes ${variable_name} placeholders in all string fields, and returns
 * the artifact list and beads item list that the caller (CLI) should create.
 *
 * Key behaviors:
 *   - Template lookup: templates/workflows/<id>.yml relative to the nearest
 *     package root, or an explicit absolute/relative path.
 *   - Variable substitution: every ${name} token in string fields is replaced
 *     with the caller-supplied value for that name. Unresolved tokens are left
 *     as-is and do not cause an error unless the variable is required.
 *   - Artifact copy: for each artifact, if templates/docs/<template> exists the
 *     file is copied to the output path with a title comment prepended. If the
 *     template is not found, a stub markdown file is written instead.
 *   - Beads items are NOT created by this module. The returned beadsItems array
 *     is handed to the CLI, which calls the beads client.
 *   - File writes are skipped when cwd is null (dry-run mode).
 *
 * Non-obvious constraints:
 *   - YAML is parsed with a minimal line-by-line parser; complex YAML (anchors,
 *     multi-document, block scalars with special indicators) is not supported.
 *     The workflow schema is intentionally kept simple to stay within this limit.
 *   - The function is synchronous except for file I/O which uses the sync fs API,
 *     so callers do not need to await anything.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Walk upward from startDir until we find package.json, or fall back to startDir.
function findPackageRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

// Replace every ${name} token in a string with its value from the vars map.
function substitute(str, vars) {
  if (typeof str !== "string") return str;
  return str.replace(/\$\{([^}]+)\}/g, (_, name) => {
    return Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : `\${${name}}`;
  });
}

// Apply substitution recursively to all string values in an object or array.
function substituteDeep(node, vars) {
  if (typeof node === "string") return substitute(node, vars);
  if (Array.isArray(node)) return node.map((item) => substituteDeep(item, vars));
  if (node !== null && typeof node === "object") {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = substituteDeep(v, vars);
    return out;
  }
  return node;
}

// Minimal YAML parser. Handles the flat structure used in workflow templates:
// top-level scalar keys, simple lists (- key: value), and nested objects.
// Returns a plain JS object. Does not handle anchors, multi-line strings with
// block indicators, or multi-document streams.
function parseYaml(text) {
  const lines = text.split("\n");
  const root = {};
  const stack = [{ obj: root, indent: -1 }];

  function currentFrame() {
    return stack[stack.length - 1];
  }

  function getIndent(line) {
    let i = 0;
    while (i < line.length && line[i] === " ") i++;
    return i;
  }

  function parseValue(raw) {
    const v = raw.trim();
    if (v === "true") return true;
    if (v === "false") return false;
    if (v === "null" || v === "~" || v === "") return null;
    const n = Number(v);
    if (!isNaN(n) && v !== "") return n;
    // Strip surrounding quotes.
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      return v.slice(1, -1);
    }
    return v;
  }

  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i];
    i++;

    // Skip blank lines and comments.
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = getIndent(rawLine);

    // Pop stack frames that are deeper than the current indent.
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const frame = currentFrame();

    if (trimmed.startsWith("- ")) {
      // List item with inline key:value pairs, or a plain scalar.
      const itemStr = trimmed.slice(2);
      const item = {};
      // Parse inline key: value pairs within this list item by consuming
      // continuation lines at a deeper indent level.
      const itemIndent = indent + 2;
      const firstColon = itemStr.indexOf(": ");
      if (firstColon !== -1) {
        const k = itemStr.slice(0, firstColon).trim();
        const v = itemStr.slice(firstColon + 2).trim();
        item[k] = parseValue(v);

        // Consume continuation lines at deeper indent.
        while (i < lines.length) {
          const peekRaw = lines[i];
          const peekTrimmed = peekRaw.trim();
          if (!peekTrimmed || peekTrimmed.startsWith("#")) { i++; continue; }
          const peekIndent = getIndent(peekRaw);
          if (peekIndent <= indent) break;

          if (peekTrimmed.startsWith("- ")) {
            // Nested list under this item key — assign to the last key in the item object.
            const lastKey = Object.keys(item)[Object.keys(item).length - 1];
            if (!Array.isArray(item[lastKey])) item[lastKey] = [];
            item[lastKey].push(parseValue(peekTrimmed.slice(2)));
            i++;
          } else {
            const subColon = peekTrimmed.indexOf(": ");
            if (subColon !== -1) {
              const sk = peekTrimmed.slice(0, subColon).trim();
              const sv = peekTrimmed.slice(subColon + 2).trim();
              item[sk] = parseValue(sv);
              i++;
            } else if (peekTrimmed.endsWith(":")) {
              const sk = peekTrimmed.slice(0, -1).trim();
              item[sk] = {};
              i++;
            } else {
              break;
            }
          }
        }

        // Ensure the parent object has an array for this key.
        const parentKey = frame.listKey;
        if (parentKey && Array.isArray(frame.obj[parentKey])) {
          frame.obj[parentKey].push(item);
        } else {
          // No listKey on the frame — fall back to frame.currentArray, which is
          // set when a bare "key:" line initialises a new array in the parent object.
          const parentArr = frame.currentArray;
          if (Array.isArray(parentArr)) {
            parentArr.push(item);
          } else {
            // Fallback: push to the last array-type property of the parent obj.
            const keys = Object.keys(frame.obj);
            for (let ki = keys.length - 1; ki >= 0; ki--) {
              if (Array.isArray(frame.obj[keys[ki]])) {
                frame.obj[keys[ki]].push(item);
                break;
              }
            }
          }
        }
      } else {
        // Plain scalar list item.
        const lastKey = frame.listKey;
        if (lastKey && Array.isArray(frame.obj[lastKey])) {
          frame.obj[lastKey].push(parseValue(itemStr));
        } else if (Array.isArray(frame.currentArray)) {
          frame.currentArray.push(parseValue(itemStr));
        }
      }
    } else if (trimmed.endsWith(":")) {
      // Bare key — value will be an object or array on following lines.
      const key = trimmed.slice(0, -1).trim();
      frame.obj[key] = [];
      stack.push({ obj: frame.obj, indent, listKey: key, currentArray: frame.obj[key] });
    } else {
      const colon = trimmed.indexOf(": ");
      if (colon !== -1) {
        const key = trimmed.slice(0, colon).trim();
        const val = trimmed.slice(colon + 2);
        frame.obj[key] = parseValue(val);
      }
    }
  }

  return root;
}

// Locate a workflow template by id (looks in templates/workflows/<id>.yml) or
// by explicit path. Returns the absolute resolved path.
function resolveTemplatePath(templateIdOrPath, packageRoot) {
  if (path.isAbsolute(templateIdOrPath) || templateIdOrPath.includes(path.sep)) {
    return path.resolve(templateIdOrPath);
  }
  // Strip .yml extension if provided.
  const id = templateIdOrPath.replace(/\.ya?ml$/, "");
  return path.join(packageRoot, "templates", "workflows", `${id}.yml`);
}

// Resolve the variables map by merging declared defaults with caller-supplied
// values, then check for missing required inputs.
function resolveVars(inputs, suppliedValues) {
  if (!Array.isArray(inputs)) return suppliedValues || {};
  const vars = {};

  for (const input of inputs) {
    if (Object.prototype.hasOwnProperty.call(suppliedValues || {}, input.name)) {
      vars[input.name] = String(suppliedValues[input.name]);
    } else if (input.default != null) {
      vars[input.name] = String(input.default);
    } else if (input.required) {
      throw new Error(`Required workflow input "${input.name}" was not supplied.`);
    }
  }

  // Also pass through any extra values the caller provided.
  for (const [k, v] of Object.entries(suppliedValues || {})) {
    if (!Object.prototype.hasOwnProperty.call(vars, k)) vars[k] = String(v);
  }

  return vars;
}

// Write an artifact to disk. If the source doc template exists, copy it and
// prepend a title line. Otherwise write a minimal stub.
function writeArtifact(outputPath, docTemplatePath, title) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  if (fs.existsSync(docTemplatePath)) {
    const original = fs.readFileSync(docTemplatePath, "utf8");
    const withTitle = title
      ? original.replace(/^# .*$/m, `# ${title}`)
      : original;
    fs.writeFileSync(outputPath, withTitle, "utf8");
  } else {
    const stub = `# ${title || path.basename(outputPath, ".md")}\n\n<!-- stub: template not found -->\n`;
    fs.writeFileSync(outputPath, stub, "utf8");
  }
}

/**
 * Instantiate a workflow template.
 *
 * @param {string} templateId - Template id (e.g. "new-feature") or path to a .yml file.
 * @param {Object} inputs - Key/value map of variable values for the template.
 * @param {Object} options
 * @param {string|null} options.cwd - Project root for output paths. Pass null for dry-run (no files written).
 * @returns {{ artifacts: Array<{path: string, template: string, title: string}>, beadsItems: Array<{type: string, title: string, linkTo: string|undefined}> }}
 */
export function instantiateWorkflow(templateId, inputs, { cwd } = {}) {
  const packageRoot = findPackageRoot(__dirname);

  const templatePath = resolveTemplatePath(templateId, packageRoot);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Workflow template not found: ${templatePath}`);
  }

  const raw = fs.readFileSync(templatePath, "utf8");
  const template = parseYaml(raw);

  if (!template.id || !template.title || !Array.isArray(template.artifacts)) {
    throw new Error(
      `Workflow template at ${templatePath} is missing required fields (id, title, artifacts).`
    );
  }

  const vars = resolveVars(template.inputs, inputs);

  // Substitute variables in the full template object.
  const resolved = substituteDeep(template, vars);

  const docsTemplatesDir = path.join(packageRoot, "templates", "docs");

  const artifacts = [];
  for (const artifact of resolved.artifacts) {
    const outputPath = cwd ? path.join(cwd, artifact.path) : artifact.path;
    const docTemplatePath = path.join(docsTemplatesDir, artifact.template);
    const title = artifact.title || "";

    if (cwd) {
      writeArtifact(outputPath, docTemplatePath, title);
    }

    artifacts.push({
      path: artifact.path,
      template: artifact.template,
      title,
    });
  }

  const beadsItems = (resolved.beads_items || []).map((item) => ({
    type: item.type,
    title: item.title,
    ...(item.link_to != null ? { linkTo: item.link_to } : {}),
    ...(item.depends_on_prior ? { dependsOnPrior: true } : {}),
  }));

  return { artifacts, beadsItems };
}
