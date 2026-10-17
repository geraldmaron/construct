/** Domain bindings share a workflow graph; aliases retain the old public addresses. */
import type { SkillRegistry } from './skill-registry.ts';
import type { RegisteredWorkflow } from './models.ts';

export function bindWorkflow(
  workflow: RegisteredWorkflow,
  domain: string,
  alias?: string,
  skills?: SkillRegistry,
): RegisteredWorkflow | null {
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
      aliases: undefined,
      domainStep: undefined,
      id: alias ?? m.id,
      // Aliases infer domain, so old callers need not supply a newly required input.
      requiredInputs: alias
        ? (fields.requiredInputs ?? m.requiredInputs).filter((k) => k !== 'domain')
        : (fields.requiredInputs ?? m.requiredInputs),
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

/** Intake keeps domain-specific deliverable kinds and old explicit selections addressable. */
export function workflowCandidates(workflows: readonly RegisteredWorkflow[]): readonly RegisteredWorkflow[] {
  return workflows
    .flatMap((w) =>
      w.manifest.domains ? Object.entries(w.manifest.aliases ?? {}).map(([alias, domain]) => bindWorkflow(w, domain, alias)!) : [w],
    )
    .sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
}

export function workflowAlias(
  workflows: readonly RegisteredWorkflow[],
  id: string,
): { workflow: RegisteredWorkflow; domain: string } | null {
  for (const workflow of workflows) {
    const aliases = workflow.manifest.aliases;
    if (aliases && Object.hasOwn(aliases, id)) return { workflow, domain: aliases[id]! };
  }
  return null;
}

/** Public catalog metadata, also used when interpreting saved host transcripts. */
export function workflowDomainCatalog(workflow: RegisteredWorkflow) {
  const m = workflow.manifest;
  if (!m.domains) return {};
  return {
    aliases: m.aliases,
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
