import { type SearchInput, searchContext } from '../../context/retrieval.ts';
import { closed, str } from '../definition.ts';
import { define } from './shared.ts';

export const contextSearch = define<SearchInput, unknown>({
  name: 'context_search',
  title: 'Find relevant context',
  surface: 'interactive',
  readOnly: true,
  description:
    'Rank admitted project context and source passages. Expand related concepts with the current host and pass expansions. Results carry citations, revisions, provenance and coverage; similarity grants no authority. Exact project_context lookups remain available.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Question, concept, exact phrase or record reference.' },
      expansions: {
        type: 'array',
        items: { type: 'string', description: 'Text value.' },
        description: 'Up to eight related queries inferred by this host.',
      },
      topic: { type: 'string', description: 'sources, statements, decisions, claims, entities, work, runs or outcomes.' },
      sourceId: { type: 'string', description: 'Restrict to one admitted source.' },
      limit: { type: 'number', description: 'At most 50 documents; default 12.' },
      budgetChars: {
        type: 'number',
        description: 'Returned item budget; default 12000, maximum 48000 characters. Diagnostics are separately bounded.',
      },
      embedding: {
        type: 'object',
        description: 'Optional vector from the explicitly configured embedding implementation.',
        properties: {
          model: { type: 'string', description: 'Text value.' },
          dimensions: { type: 'number', description: 'Finite numeric value.' },
          vector: { type: 'array', description: 'Embedding dimensions.', items: { type: 'number', description: 'Finite numeric value.' } },
        },
        required: ['model', 'dimensions', 'vector'],
        additionalProperties: false,
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    return { ...raw, query: str(raw, 'query')! } as unknown as SearchInput;
  },
  run(ctx, input) {
    return searchContext(ctx.store, input, ctx.now());
  },
});
