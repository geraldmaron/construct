import { closed, str, bool, ToolInputError } from '../definition.ts';
import { lockStatus } from '../../registry/lockfile.ts';
import { emptyLock } from '../../project/lock.ts';
import { define } from './shared.ts';

export const skills = define<{ action: 'list' | 'show' | 'status'; id?: string; includeBody: boolean }, unknown>({
  name: 'skills',
  title: 'Skills',
  description:
    'List the skills available to this project, show one (its full text only when you ask for it), or check whether the ones a host needs on disk are current.',
  surface: 'both',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'list, show, or status.', enum: ['list', 'show', 'status'] },
      id: { type: 'string', description: 'The skill id, for show.' },
      includeBody: { type: 'boolean', description: 'Include the skill’s full text (default false).' },
    },
    required: ['action'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    return {
      action: str(raw, 'action', { oneOf: ['list', 'show', 'status'] }) as 'list' | 'show' | 'status',
      id: str(raw, 'id', { optional: true }),
      includeBody: bool(raw, 'includeBody', false),
    };
  },
  run(ctx, { action, id, includeBody }) {
    if (action === 'list')
      return ctx.skills.list().map((s) => ({
        id: s.manifest.id,
        title: s.manifest.title,
        version: s.manifest.version,
        category: s.manifest.category,
        description: s.description,
      }));
    if (action === 'status')
      return lockStatus(ctx.files.lock ?? emptyLock(), ctx.skills.list(), ctx.workflows.list()).map((r) => ({
        kind: r.kind,
        id: r.id,
        state: r.state,
        why: r.why,
      }));
    if (!id) throw new ToolInputError('"id" is required for show', { field: 'id' });
    const s = ctx.skills.get(id);
    if (!s) throw new Error(`no skill "${id}"`);
    const lock = lockStatus(ctx.files.lock ?? emptyLock(), ctx.skills.list(), ctx.workflows.list()).find(
      (r) => r.kind === 'skill' && r.id === id,
    );
    return {
      ...s.manifest,
      origin: s.origin,
      digest: s.digest,
      files: s.files,
      // Whether these bytes are the ones the project locked; how well the skill works is measured by its evals.
      lock: lock ? { state: lock.state, why: lock.why } : { state: 'unlocked', why: 'present but not locked' },
      body: includeBody ? ctx.skills.body(id) : undefined,
    };
  },
});
