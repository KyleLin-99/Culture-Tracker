// Built for a phone in a gloved hand: large text, large targets, high contrast.
export const colors = {
  bg: '#F6F7F4',
  card: '#FFFFFF',
  text: '#1B1F1A',
  muted: '#626B60',
  border: '#D9DED6',
  primary: '#2F6B3F',
  primaryText: '#FFFFFF',
  danger: '#B3261E',
  dangerBg: '#FCEDEC',
  warn: '#8A5A00',
  warnBg: '#FFF4DB',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

export const font = {
  code: 28,
  title: 22,
  body: 17,
  small: 14,
};

/** Minimum height for anything tappable. */
export const TAP = 56;

export const statusColor: Record<string, { fg: string; bg: string }> = {
  active: { fg: colors.primary, bg: '#E5F1E8' },
  contaminated: { fg: colors.danger, bg: colors.dangerBg },
  used: { fg: colors.muted, bg: '#ECEEEA' },
  archived: { fg: colors.muted, bg: '#ECEEEA' },
  discarded: { fg: colors.muted, bg: '#ECEEEA' },
  warn: { fg: colors.warn, bg: colors.warnBg },
};
