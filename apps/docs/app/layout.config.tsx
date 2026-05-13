import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <span className="font-semibold">
        Construct <span className="text-fd-muted-foreground">docs</span>
      </span>
    ),
  },
  links: [
    {
      text: 'Start',
      url: '/start',
    },
    {
      text: 'Concepts',
      url: '/concepts',
    },
    {
      text: 'Cookbook',
      url: '/cookbook',
    },
    {
      text: 'Reference',
      url: '/reference',
    },
    {
      text: 'GitHub',
      url: 'https://github.com/geraldmaron/construct',
      external: true,
    },
  ],
};
