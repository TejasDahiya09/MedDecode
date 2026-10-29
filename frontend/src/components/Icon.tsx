import type { SVGProps } from 'react';

export type IconName =
  | 'ai'
  | 'analytics'
  | 'arrow'
  | 'bell'
  | 'bookmark'
  | 'briefcase'
  | 'calendar'
  | 'check'
  | 'chevron'
  | 'close'
  | 'copy'
  | 'dashboard'
  | 'filter'
  | 'home'
  | 'inbox'
  | 'linkedin'
  | 'menu'
  | 'message'
  | 'monitor'
  | 'moon'
  | 'plus'
  | 'profile'
  | 'search'
  | 'settings'
  | 'share'
  | 'shield'
  | 'sparkles'
  | 'store'
  | 'sun'
  | 'team'
  | 'whatsapp'
  | 'warning';

const paths: Readonly<Record<IconName, readonly string[]>> = {
  ai: [
    'M12 3a4 4 0 0 0-4 4v2a4 4 0 0 0-3 3.87V15a4 4 0 0 0 4 4h1',
    'M12 3a4 4 0 0 1 4 4v2a4 4 0 0 1 3 3.87V15a4 4 0 0 1-4 4h-1',
    'M9 9h6M9 13h6M12 7v12',
  ],
  analytics: ['M4 19V9M10 19V5M16 19v-7M22 19V3', 'M2 19h22'],
  arrow: ['M5 12h14', 'm13 6 6 6-6 6'],
  bell: ['M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9', 'M10 21h4'],
  bookmark: ['M6 3h12v18l-6-4-6 4z'],
  briefcase: ['M9 6V4h6v2', 'M4 6h16v14H4z', 'M4 11h16', 'M10 11v2h4v-2'],
  calendar: ['M6 2v4M18 2v4M3 9h18', 'M4 4h16v18H4z'],
  check: ['m5 12 4 4L19 6'],
  chevron: ['m9 18 6-6-6-6'],
  close: ['M6 6l12 12M18 6 6 18'],
  copy: ['M8 8h12v12H8z', 'M4 16V4h12'],
  dashboard: ['M4 4h6v6H4zM14 4h6v10h-6zM4 14h6v6H4zM14 18h6v2h-6z'],
  filter: ['M4 5h16M7 12h10M10 19h4'],
  home: ['m3 11 9-8 9 8', 'M5 10v11h14V10', 'M9 21v-7h6v7'],
  inbox: ['M4 5h16l2 9v5H2v-5z', 'M2 14h6l2 3h4l2-3h6'],
  linkedin: ['M5 9v10M5 5.5v.01M10 19V9', 'M10 13a4 4 0 0 1 8 0v6', 'M3 3h18v18H3z'],
  menu: ['M4 7h16M4 12h16M4 17h16'],
  message: ['M4 4h16v13H8l-4 4z'],
  monitor: ['M3 4h18v12H3z', 'M8 20h8M12 16v4'],
  moon: ['M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5z'],
  plus: ['M12 5v14M5 12h14'],
  profile: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M4 21a8 8 0 0 1 16 0'],
  search: ['M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16', 'm21 21-4.35-4.35'],
  settings: [
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7',
    'M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.55V20.3h-3v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 7.08 15a1.7 1.7 0 0 0-1.55-1H5.4v-3h.13a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.12-2.12.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1-1.55V4.7h3v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06A1.7 1.7 0 0 0 19.4 10a1.7 1.7 0 0 0 1.55 1h.13v3h-.13a1.7 1.7 0 0 0-1.55 1z',
  ],
  share: ['M12 3v12', 'm7 8 5-5 5 5', 'M5 13v7h14v-7'],
  shield: ['M12 3 4 6v5c0 5.2 3.4 8.7 8 10 4.6-1.3 8-4.8 8-10V6z', 'm9 12 2 2 4-4'],
  sparkles: [
    'm12 3 1.3 3.7L17 8l-3.7 1.3L12 13l-1.3-3.7L7 8l3.7-1.3z',
    'm19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7z',
    'M5 14v4M3 16h4',
  ],
  store: ['M4 10v11h16V10', 'M3 4h18l-2 6H5z', 'M9 21v-6h6v6'],
  sun: [
    'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M18.4 5.6l1.4-1.4M4.2 19.8l1.4-1.4',
    'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10',
  ],
  team: [
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
    'M17 11a3 3 0 1 0 0-6',
    'M2 21a7 7 0 0 1 14 0',
    'M16 15a6 6 0 0 1 6 6',
  ],
  whatsapp: [
    'M20 11.5a8 8 0 0 1-11.8 7L4 20l1.4-4.1A8 8 0 1 1 20 11.5z',
    'M9 8.5c.5 2.3 2.2 4 4.5 4.8l1.2-1.1 2 .9c-.5 1.7-1.7 2.5-3.2 2.2-3.5-.8-6.2-3.6-6.9-7.1-.2-1.5.6-2.7 2.2-3.2z',
  ],
  warning: ['M12 3 2 21h20z', 'M12 9v5M12 18h.01'],
};

interface IconProps extends SVGProps<SVGSVGElement> {
  readonly name: IconName;
}

export function Icon({ name, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      {...props}
    >
      {paths[name].map((path) => (
        <path d={path} key={path} />
      ))}
    </svg>
  );
}
