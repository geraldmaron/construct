#!/usr/bin/env node
/**
 * scripts/migrate-skills-to-skill-md.mjs — One-shot migration of flat skill
 * files to the SKILL.md directory format.
 *
 * For each `skills/<cat>/<name>.md` file found, this script:
 *   1. Creates the directory `skills/<cat>/<name>/`
 *   2. Writes the original content to `skills/<cat>/<name>/SKILL.md`
 *   3. Removes the original `skills/<cat>/<name>.md` flat file
 *
 * Idempotent: if `skills/<cat>/<name>/SKILL.md` already exists the entry is
 * skipped regardless of whether the flat `.md` file is still present.
 *
 * Flags:
 *   --dry-run   (default) Show what would change without writing anything.
 *   --apply     Actually perform the migration.
 *
 * Usage:
 *   node scripts/migrate-skills-to-skill-md.mjs           # dry-run (safe)
 *   node scripts/migrate-skills-to-skill-md.mjs --apply   # write changes
 */

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const skillsDir = path.join(root, "skills");

const APPLY = process.argv.includes("--apply");
const DRY_RUN = !APPLY;

/**
 * Walk a directory tree, yielding absolute paths of every .md file that is
 * NOT named routing.md or SKILL.md. Does not descend into a directory that
 * already contains a SKILL.md (those are already migrated).
 */
function* walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Already migrated form — skip.
      if (fs.existsSync(path.join(full, "SKILL.md"))) continue;
      yield* walk(full);
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".md") &&
      entry.name !== "routing.md" &&
      entry.name !== "SKILL.md"
    ) {
      yield full;
    }
  }
}

function collectMigrationTargets() {
  const targets = [];

  if (!fs.existsSync(skillsDir)) {
    console.error(`Error: skills directory not found at ${skillsDir}`);
    process.exit(1);
  }

  for (const flatPath of walk(skillsDir)) {
    const dir = path.dirname(flatPath);
    const base = path.basename(flatPath, ".md");
    const targetDir = path.join(dir, base);
    const targetFile = path.join(targetDir, "SKILL.md");

    // Idempotency: already migrated.
    if (fs.existsSync(targetFile)) {
      continue;
    }

    targets.push({ flatPath, targetDir, targetFile });
  }

  return targets;
}

function migrate(targets) {
  let migrated = 0;
  let skipped = 0;

  for (const { flatPath, targetDir, targetFile } of targets) {
    const rel = path.relative(root, flatPath);
    const relTarget = path.relative(root, targetFile);

    if (DRY_RUN) {
      console.log(`  would migrate: ${rel} -> ${relTarget}`);
      migrated++;
      continue;
    }

    // Read before any writes so a failure leaves source intact.
    let content;
    try {
      content = fs.readFileSync(flatPath, "utf8");
    } catch (err) {
      console.error(`  error reading ${rel}: ${err.message} — skipping`);
      skipped++;
      continue;
    }

    try {
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(targetFile, content, { flag: "wx" });
      fs.unlinkSync(flatPath);
      console.log(`  migrated: ${rel} -> ${relTarget}`);
      migrated++;
    } catch (err) {
      if (err.code === "EEXIST") {
        // Race or idempotency hit — SKILL.md appeared between collect and write.
        console.log(`  skipped (already exists): ${relTarget}`);
        skipped++;
      } else {
        console.error(`  error migrating ${rel}: ${err.message}`);
        skipped++;
      }
    }
  }

  return { migrated, skipped };
}

// --- Main ---

const targets = collectMigrationTargets();

if (targets.length === 0) {
  console.log("Nothing to migrate — all skills are already in SKILL.md format (or directory is empty).");
  process.exit(0);
}

if (DRY_RUN) {
  console.log(`[dry-run] ${targets.length} skill(s) would be migrated to SKILL.md directory form:\n`);
} else {
  console.log(`[apply] Migrating ${targets.length} skill(s) to SKILL.md directory form:\n`);
}

const { migrated, skipped } = migrate(targets);
console.log("");

if (DRY_RUN) {
  console.log(`Dry run complete. ${migrated} would be migrated, ${skipped} skipped.`);
  console.log("Re-run with --apply to perform the migration.");
} else {
  console.log(`Done. ${migrated} migrated, ${skipped} skipped.`);
}
