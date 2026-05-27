/**
 * mdx-components.tsx — Global MDX component registry.
 *
 * Components registered here are available in every .mdx page without
 * an explicit import. Fumadocs defaultMdxComponents handles the HTML
 * primitives (pre, a, img, headings, table, Callout, Card, Cards).
 * This file adds Fumadocs optional components and the custom diagram
 * components built for the Construct docs site.
 */

import defaultMdxComponents from 'fumadocs-ui/mdx';
import { Steps, Step } from 'fumadocs-ui/components/steps';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import { Accordion, Accordions } from 'fumadocs-ui/components/accordion';
import type { MDXComponents } from 'mdx/types';

import { Card, Cards } from 'fumadocs-ui/components/card';
import { FlowPipeline } from '@/components/flow-pipeline';
import { SyncGrid } from '@/components/sync-grid';
import { RequestFlow } from '@/components/request-flow';
import { DeployModes } from '@/components/deploy-modes';
import { AgentGrid } from '@/components/agent-grid';

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,

    // Fumadocs optional components (not in defaultMdxComponents)
    Steps,
    Step,
    Tab,
    Tabs,
    Accordion,
    Accordions,

    // Fumadocs card components
    Card,
    Cards,

    // Custom diagram components
    FlowPipeline,
    SyncGrid,
    RequestFlow,
    DeployModes,
    AgentGrid,

    // Caller overrides (for per-page customization)
    ...components,
  };
}
