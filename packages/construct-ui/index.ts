/**
 * @construct/ui — shared editorial design system for Construct.
 *
 * Both the docs site (apps/docs) and the dashboard (apps/dashboard) consume
 * the same primitives + theme tokens. Updates here ripple across both.
 */

export { Section } from './components/section';
export { CodeBlock } from './components/code-block';
export { Mermaid, Diagram } from './components/mermaid';
export { Callout } from './components/callout';
export { FeatureGrid, type FeatureCell } from './components/feature-grid';
export { CommandPalette, type PaletteItem } from './components/command-palette';
export { useTheme, type DocsTheme } from './components/use-theme';
export {
  Chevron, ArrowRight, SearchIcon, GitHubIcon,
  SunGlyph, MoonGlyph, DensityCompact, DensityComfy,
} from './components/icons';
export {
  FlowPipeline, RequestFlow, SyncGrid, AgentGrid, DeployModes,
  Cards, Card, Steps, Step,
  type PipelineStep, type FlowNode, type SyncTarget,
  type AgentCard, type AgentGroup, type DeployMode,
} from './components/mdx-shims';
