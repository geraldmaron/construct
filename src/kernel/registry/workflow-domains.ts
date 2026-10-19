/** Domain bindings share one workflow graph; a domain-keyed workflow is addressed by its id and a domain. */
import type { SkillRegistry } from './skill-registry.ts';
import type { RegisteredWorkflow } from './models.ts';

export function bindWorkflow(workflow: RegisteredWorkflow, domain: string, skills?: SkillRegistry): RegisteredWorkflow | null {
  const m = workflow.manifest;
  if (!m.domains || !Object.hasOwn(m.domains, domain)) return null;
  const binding = m.domains[domain]!;
  const { skill, steps, ...fields } = binding;
  return {
    ...workflow,
    canonicalId: m.id,
    domain,
    manifest: {
      ...m,
      ...fields,
      domains: undefined,
      domainStep: undefined,
      requiredInputs: fields.requiredInputs ?? m.requiredInputs,
      steps: m.steps.map((s) => {
        const bound = { ...s, ...steps?.[s.id], ...(s.id === m.domainStep ? { skill } : {}) };
        if (s.id === m.domainStep && skills)
          return {
            ...bound,
            validators: [...new Set([...bound.validators, ...(skills.get(skill.id)?.manifest.requiredValidators ?? [])])],
          };
        return bound;
      }),
    },
  };
}

/** Every workflow intake can match: each domain of a domain-keyed workflow as its own bound copy. */
export function workflowCandidates(workflows: readonly RegisteredWorkflow[]): readonly RegisteredWorkflow[] {
  return workflows
    .flatMap((w) => (w.manifest.domains ? Object.keys(w.manifest.domains).map((domain) => bindWorkflow(w, domain)!) : [w]))
    .sort((a, b) => a.manifest.id.localeCompare(b.manifest.id) || (a.domain ?? '').localeCompare(b.domain ?? ''));
}

/** Public catalog metadata, also used when interpreting saved host transcripts. */
export function workflowDomainCatalog(workflow: RegisteredWorkflow) {
  const m = workflow.manifest;
  if (!m.domains) return {};
  return {
    domains: Object.fromEntries(
      Object.keys(m.domains).map((domain) => {
        const bound = bindWorkflow(workflow, domain)!.manifest;
        return [
          domain,
          {
            title: bound.title,
            deliverableKind: bound.deliverable.kind,
            inputSchema: bound.inputSchema,
            requiredInputs: bound.requiredInputs,
            skill: m.domains![domain]!.skill,
          },
        ];
      }),
    ),
  };
}
