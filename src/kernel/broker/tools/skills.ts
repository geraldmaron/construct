import { closed, str, bool, ToolInputError } from '../definition.ts';
import { lockStatus } from '../../registry/lockfile.ts';
import { emptyLock } from '../../project/lock.ts';
import { define } from './shared.ts';

type SkillsAction = 'list' | 'show' | 'file' | 'status';

export const skills = define<{ action: SkillsAction; id?: string; path?: string; includeBody: boolean }, unknown>({
  name: 'skills',
  title: 'Skills',
  description:
    'List the skills available to this project, show one (its files, and its full text only when you ask), read one of its files by path, or check whether the ones a host needs on disk are current.',
  surface: 'both',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'list, show, file, or status.', enum: ['list', 'show', 'file', 'status'] },
      id: { type: 'string', description: 'The skill id, for show and file.' },
      path: { type: 'string', description: 'For file: one of the paths show lists, such as references/sources.md.' },
      includeBody: { type: 'boolean', description: 'Include the skill’s full text (default false).' },
    },
    required: ['action'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    return {
      action: str(raw, 'action', { oneOf: ['list', 'show', 'file', 'status'] }) as SkillsAction,
      id: str(raw, 'id', { optional: true }),
      path: str(raw, 'path', { optional: true }),
      includeBody: bool(raw, 'includeBody', false),
    };
  },
  run(ctx, { action, id, path, includeBody }) {
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
    if (!id) throw new ToolInputError(`"id" is required for ${action}`, { field: 'id' });
    const s = ctx.skills.get(id);
    if (!s) throw new Error(`no skill "${id}"`);
    if (action === 'file') {
      if (!path) throw new ToolInputError('"path" is required for file', { field: 'path' });
      const bytes = ctx.skills.file(id, path);
      if (!bytes) throw new ToolInputError(`skill "${id}" has no file "${path}"; show lists its files`, { field: 'path' });
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      if (text.includes('\u0000')) throw new ToolInputError(`"${path}" is not a text file`, { field: 'path' });
      return { id, path, text };
    }
    const lock = lockStatus(ctx.files.lock ?? emptyLock(), ctx.skills.list(), ctx.workflows.list()).find(
      (r) => r.kind === 'skill' && r.id === id,
    );
    return {
      ...s.manifest,
      origin: s.origin,
      digest: s.digest,
      files: s.files,
      // Whether these bytes are the ones the project locked; it says nothing about how well the skill works.
      lock: lock ? { state: lock.state, why: lock.why } : { state: 'unlocked', why: 'present but not locked' },
      body: includeBody ? ctx.skills.body(id) : undefined,
    };
  },
});
