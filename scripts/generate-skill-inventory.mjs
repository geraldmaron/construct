#!/usr/bin/env node
/**
 * scripts/generate-skill-inventory.mjs — regenerate tests/certification/skills/inventory.json.
 */

import { writeSkillInventory } from '../lib/certification/skill-inventory.mjs';

const { inventoryPath, inventory } = writeSkillInventory();
process.stdout.write(`Wrote ${inventoryPath} (${inventory.skillCount} skills, ${inventory.blockingFindings.length} blocking findings)\n`);
