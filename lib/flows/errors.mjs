/**
 * lib/flows/errors.mjs — typed errors for the flow engine.
 *
 * FlowDefinitionError is thrown at flow-load time (defineFlow/loadFlow) so an
 * invalid flow (bad schema, dangling step reference, a mutating fan-out step)
 * never reaches the execution engine. State-transition and step-execution
 * failures are NOT thrown — they are returned as structured results (see
 * state.mjs and engine.mjs) so a caller driving a long-running flow never has
 * to wrap every step in try/catch to keep going.
 */

export class FlowDefinitionError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = 'FlowDefinitionError';
    this.code = 'FLOW_DEFINITION_INVALID';
    this.errors = errors;
  }
}
