import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <span className="font-mono text-sm font-medium tracking-tight">
        <span className="font-semibold">construct</span>
        <span className="ml-2 text-fd-muted-foreground">/docs</span>
      </span>
    ),
  },
  links: [
    { text: 'Start', url: '/start' },
    { text: 'Concepts', url: '/concepts' },
    { text: 'Cookbook', url: '/cookbook' },
    { text: 'Reference', url: '/reference' },
    {
      text: 'GitHub',
      url: 'https://github.com/geraldmaron/construct',
      external: true,
    },
  ],
};
