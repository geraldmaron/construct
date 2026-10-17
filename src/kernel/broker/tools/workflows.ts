import { closed, str, obj, ToolInputError } from '../definition.ts';
import { workflowDomainCatalog } from '../../registry/workflow-domains.ts';
import { define } from './shared.ts';
import { workflowVerification } from './intake-helpers.ts';

export const workflows = define<{ action: 'list' | 'show' | 'resolve'; id?: string; input?: Record<string, unknown> }, unknown>({
  name: 'workflows',
  title: 'Workflows',
  description:
    'List the workflows this project can run, show one, or resolve one against this session to learn whether it can run and what would stop it.',
  surface: 'interactive',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'list, show, or resolve.', enum: ['list', 'show', 'resolve'] },
      id: { type: 'string', description: 'The workflow id, for show and resolve.' },
      input: { type: 'object', description: 'The workflow input, for resolve.' },
    },
    required: ['action'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    return {
      action: str(raw, 'action', { oneOf: ['list', 'show', 'resolve'] }) as 'list' | 'show' | 'resolve',
      id: str(raw, 'id', { optional: true }),
      input: obj(raw, 'input', { optional: true }),
    };
  },
  run(ctx, { action, id, input }) {
    if (action === 'list')
      return ctx.workflows.list().map((w) => ({
        id: w.manifest.id,
        ...workflowDomainCatalog(w),
        title: w.manifest.title,
        version: w.manifest.version,
        interactionClass: w.manifest.interactionClass,
        purpose: w.manifest.purpose,
        deliverableKind: w.manifest.deliverable.kind,
        verification: workflowVerification(w),
        triggers: w.manifest.triggers,
      }));
    if (!id) throw new ToolInputError(`"id" is required for ${action}`, { field: 'id' });
    const w = ctx.workflows.get(id, input?.domain);
    if (!w) throw new Error(`no workflow "${id}"; list shows the ones this project has`);
    if (action === 'show') return { ...w.manifest, origin: w.origin, digest: w.digest };
    return ctx.workflow.preflight(id, input ?? {}).preflight;
  },
});
