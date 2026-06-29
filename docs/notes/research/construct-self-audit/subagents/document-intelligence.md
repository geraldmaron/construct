---
intake: none
---

# Subagent Evidence Report: Document intelligence audit

> Agent H · model: Haiku · type: Explore (read-only) · Wave 1 · supervised by Opus.
> Structured output rendered by Opus; findings are the subagent's, not yet adjudicated.

## 1. Summary

Construct's document intelligence system combines explicit lane-based scaffolding (init-docs.mjs, detect-existing-structure.mjs), content-aware routing during intake (docs-routing.mjs, embed/inbox.mjs), and a quality standard (ADR-0018) enforced via structural requirements. The system detects existing ADRs/PRDs/RFCs by directory alias matching and markdown file counting, preserves user docs by deferring lane creation, and ingests new documents into typed lanes via suggestDocsLaneForFile(). However, several gaps exist: no explicit-approval migration path for unclassified docs crossing into typed lanes, no duplicate-lane prevention when aliases map to existing project-specific doc structures, and no registry of doc-type behaviors that remain hardcoded across init, routing, and artifact-gate modules.

## 2. Evidence table

| Finding | Evidence (file · observation) | Confidence |
|---|---|---|
| Existing ADR/RFC/PRD detection during init is implemented via directory-alias mapping and markdown file counting | `lib/init/detect-existing-structure.mjs:28-65` — LANE_DIR_ALIASES maps 'adr' → 'adrs', 'rfc' → 'rfcs', 'prd' → 'prds' etc. walkLaneDirs() counts markdown files recursively and registers any lane with >= 1 markdown file, except docs/<lane>/ paths which init owns. | confirmed |
| shouldScaffoldLane() defers lane creation when existingLanes already covers the lane, preserving user docs | `lib/init/detect-existing-structure.mjs:242-253` — Function returns {skip: true, reason: ...} when detection.existingLanes[laneKey] has entries, unless --force bypasses check. Both init-unified.mjs:1078 and init-docs.mjs:576 call this to filter lanes before scaffolding. | confirmed |
| Template inference maps lanes to templates but does not cross-check against existing root-level template files | `lib/init/doc-lanes.mjs:8-83` — DOC_LANES.prds.templates = ['prd.md', 'meta-prd.md', ...]; DOC_LANES.rfcs.templates = ['rfc.md', 'rfc-platform.md']. rootTemplateCoversLane() (detect-existing-structure.mjs:231-235) checks if root/templates/<lane>.md or <lane-singular>.md exists, but this check is never called in init-unified or init-docs to skip per-lane templates/ scaffold when root templates are sufficient. | confirmed |
| Doc-type routing during intake uses suggestDocsLaneForFile() for content-aware classification | `lib/docs-routing.mjs:29-89` — Inspects frontmatter type field, then filename patterns (prd \| adr \| rfc), then content preview for keywords (product requirement, architecture decision, drawbacks). Returns lane key or null. Used by init-docs.mjs:478-480 (--organize flag) and embed/inbox.mjs:275-276 (maybePromoteToDocs). | confirmed |
| Ingested documents can be promoted into docs lanes only if lane dir exists; no approval gate before placement | `lib/embed/inbox.mjs:274-311` — maybePromoteToDocs() calls suggestDocsLaneForFile(), checks if laneDir exists (if !existsSync(laneDir) return null), then writes a markdown rendering with '# ' + title and \"Promoted from intake for review\". No approval/review field, no intake_id tracking of the suggestion itself, no rejection workflow. | confirmed |
| Artifact-type inference reads frontmatter cx_doc_type, but no standardized field for suggested lane (only inferred from path) | `lib/artifact-type-from-path.mjs:14-28, 65-83` — readFrontmatterType() looks for cx_doc_type, artifactType, or doc_type fields. PREFIX_RULES use path regex to infer type (docs/adr/ → 'adr', docs/prds/ → 'prd'). No cx_suggested_lane or intake_suggested_lane field in frontmatter schema. | confirmed |
| Multiple lanes can map to same directory via aliases, risking scaffold conflicts | `lib/init/detect-existing-structure.mjs:33-65` — LANE_DIR_ALIASES: ['adr', 'adrs'] → 'adrs'; ['rfc', 'rfcs'] → 'rfcs'; ['incident', 'incidents', 'postmortem', 'postmortems'] → 'postmortems'. If a project has both internal/incidents/ and internal/postmortems/, both map to postmortems lane; only the first is registered as existing. | confirmed |
| Doc-lane definitions (DOC_LANES, templates list, descriptions) are duplicated across modules | `lib/init/doc-lanes.mjs:8-83; lib/docs-routing.mjs:10-23` — DOC_LANES defined in lib/init/doc-lanes.mjs with full metadata (title, dir, description, templates array). DOC_LANE_DIRS re-defined in docs-routing.mjs as minimal key → dir map. No shared registry or schema file. | confirmed |
| ADR-0045 specifies removal of .cx/inbox/ and docs/intake/ watch zones as clean break (no deprecation), but implementation status unclear | `docs/decisions/adr/0045-config-scope-docs-taxonomy-intake.md:62-66` — Decision states \"Remove the projectInbox (.cx/inbox/) and docsIntake (docs/intake/) watch zones outright — no back-compat, no deprecation reads.\" Comment in init-unified.mjs:597 still references docs/intake/ in context of Maildir handoff. intakePolicy config schema may still reference deprecated zones. | likely |
| No mechanism for explicit user approval before auto-promoting intake documents into doc lanes | `lib/embed/inbox.mjs:274-311; lib/intake/traceability.mjs:72-76` — maybePromoteToDocs() automatically writes promoted docs when lane exists; intake/traceability.mjs only refuses to overwrite an existing intake_id (different artifact, different intake_id). No approval_required or approval_pending field; no workflow to request user consent before lane placement. | confirmed |
| Test coverage for duplicate doc-lane prevention is absent | `tests/init/detect-existing-structure.test.mjs` — Test file covers lane detection, intake scripts, templates detection, but no test for the alias-mapping conflict scenario where both 'incidents/' and 'postmortems/' exist simultaneously and map to the same canonical lane. | confirmed |
| ADR-0018 (document quality standard) references STRUCTURE_REQUIREMENTS enforcement but file not examined in audit scope | `docs/decisions/adr/0018-document-quality-standard.md:23; doc-quality-rubric.md:4` — ADR-0018 states \"each doc type declares its required sections and visuals in a STRUCTURE_REQUIREMENTS map, checked by the postcondition engine\". References lib/templates/visual-requirements.mjs but not in assigned audit files. | unverified |

## 3. Confirmed gaps

- No explicit-approval gate for auto-promoted intake documents into doc lanes (maybePromoteToDocs writes directly)
- Template inference (DOC_LANES.*.templates) is not cross-checked during init against existing root templates/ to skip redundant per-lane scaffold
- Doc-type definitions (DOC_LANES, lane directories, templates) duplicated in doc-lanes.mjs and docs-routing.mjs; no single schema registry
- Duplicate-lane risk when multiple aliases map to same canonical lane (e.g., incidents/ + postmortems/ both → postmortems), but only first is detected as existing
- ADR-0045 Phase 2 (single intake) specifies removal of .cx/inbox/ + docs/intake/ but implementation/migration status undocumented
- No frontmatter field for doc-lane suggestion confidence or user-override (only cx_doc_type for final type after manual curation)

## 4. Unconfirmed concerns

- Whether STRUCTURE_REQUIREMENTS enforcement (ADR-0018) is actually integrated into artifact-gate postconditions or only documented
- Whether init-docs --organize actually moves files in practice or only suggests (observation: code calls fs.renameSync but error handling may silently skip failures)
- Whether existing projects with legacy .cx/inbox/ drops are migrated by construct doctor or left orphaned
- Whether rootTemplateCoversLane() helper is used anywhere outside tests (grep found only in test file)
- Whether doc-type frontmatter fields (cx_doc_type, artifactType, doc_type) are standardized or audience varies by context

## 5. Registry / config / schema opportunities

- Consolidate DOC_LANES definition into a single schema file (e.g., lib/schemas/doc-lanes.schema.json or lib/init/doc-lanes-schema.mjs) that both init and routing import, eliminating duplication in docs-routing.mjs DOC_LANE_DIRS
- Add doc-type registry to track suggested-lane confidence (high/medium/low) from content routing, enabling explicit-approval workflow: store suggestion in .cx/intake/suggestions.jsonl with intake_id + suggested_lane + confidence + user_approval field
- Formalize the LANE_ALIASES map as a configuration table mapping directory name → canonical lane key, with conflict detection for multiple aliases pointing to the same lane in a project
- Add per-lane metadata in DOC_LANES: { ..., suggestedBy: 'content|path|frontmatter', approvalRequired: boolean } to enable opt-in review gates before promotion
- Create a doc-type inference registry ({type: 'adr', patterns: {...}, content: {...}}) that centralizes the hardcoded patterns in suggestDocsLaneForFile() and artifact-type-from-path.mjs, making it data-driven

## 6. Tests needed

- Unit test in tests/init/detect-existing-structure.test.mjs for alias-conflict detection: create both internal/incidents/ and internal/postmortems/, verify both are recognized but conflict is reported
- Functional test for init-docs --organize to verify files are actually moved and not just suggested
- Integration test for intake promotion flow: drop a PDF into inbox/, verify suggestDocsLaneForFile output, confirm markdown is written to correct lane if it exists
- Test rootTemplateCoversLane() actually prevents per-lane templates/ scaffold when root templates/ covers the lane

## 7. Docs needed

- Update docs/guides/reference/doc-lanes.md or new docs/guides/intake/lane-suggestion.md: explain when suggestDocsLaneForFile is called, what confidence means, why some suggestions are not auto-promoted
- Document the frontmatter schema for doc-type fields (cx_doc_type vs artifactType vs doc_type) with a canonical example per lane
- Add a troubleshooting section in docs explaining the --force flag behavior and why a project's existing meetings/ folder causes init to skip docs/meetings/

## 8. Migration concerns

- Projects with both internal/incidents/ and internal/postmortems/ will have only one recognized as existing; the second may scaffold a conflicting docs/postmortems/ if --force is used
- Existing .cx/inbox/ drops are not auto-migrated to inbox/ by init or sync; users must move them by hand per ADR-0045 Phase 2 spec
- If rootTemplateCoversLane() becomes an active gate, projects that already have per-lane templates/ (from prior init runs) should not re-run init-docs without --force, or templates will be skipped

## 9. Questions for Opus

- Is the ADR-0045 Phase 2 implementation (remove .cx/inbox/ and docs/intake/ zones) already complete, or is it still in progress? Does construct doctor detect orphaned .cx/inbox/ drops?
- Should the explicit-approval workflow for doc-lane promotion be a separate feature, or bundled with intake rerouting (construct intake reroute)?
- Is rootTemplateCoversLane() used anywhere in production code outside tests? If not, should it be removed or integrated into init's lane-filtering?
- Should docs-routing.mjs hardcoded patterns (prdPatterns, adrPatterns, etc.) be moved into DOC_LANES metadata, or kept separate for decoupling content-classification from lane definitions?

## 10. Suggested bead updates (proposals only — Opus owns Beads)

- Create a bead for explicit-approval intake-to-lanes workflow: add approval_required field to intake item schema, gate maybePromoteToDocs() on approval status, surface pending-approvals in construct intake list / dashboard
- Add rootTemplateCoversLane() call to init-unified.mjs and init-docs.mjs lane-filtering logic to skip per-lane templates/ scaffold when root templates/ already covers the lane
- Extend detect-existing-structure.mjs to flag alias conflicts (incidents/ + postmortems/ both detected) and report ambiguity in formatDeferralSummary
- Create migration script for ADR-0045 Phase 2: detect .cx/inbox/ and docs/intake/ in projects, move drops to inbox/, update intakePolicy config

