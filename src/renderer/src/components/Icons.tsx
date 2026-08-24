/** Minimal 16px stroke icons for the chrome (monochrome, inherit currentColor). */

function Icon({ children, size = 16 }: { children: React.ReactNode; size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const SearchIcon = (): React.JSX.Element => (
  <Icon>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </Icon>
);

export const PinIcon = (): React.JSX.Element => (
  <Icon>
    <path d="M12 17v5" />
    <path d="M9 3h6l1 7 2 2H6l2-2z" />
  </Icon>
);

export const HistoryIcon = (): React.JSX.Element => (
  <Icon>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l3 3" />
  </Icon>
);

/** The space menu: an app-launcher grid of dots, distinct from the Spaces
 *  button's four solid tiles. Round caps turn each zero-length path into a dot. */
export const MenuIcon = (): React.JSX.Element => (
  <Icon>
    <path d="M6 6h.01M12 6h.01M18 6h.01" />
    <path d="M6 12h.01M12 12h.01M18 12h.01" />
    <path d="M6 18h.01M12 18h.01M18 18h.01" />
  </Icon>
);

export const RefreshIcon = (): React.JSX.Element => (
  <Icon>
    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
    <path d="M21 3v5h-5" />
  </Icon>
);

export const BackIcon = (): React.JSX.Element => (
  <Icon>
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </Icon>
);

export const CloseIcon = (): React.JSX.Element => (
  <Icon>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Icon>
);

export const OpenRightIcon = (): React.JSX.Element => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M12 4v16" />
    <path d="m14.5 10 2 2-2 2" />
  </Icon>
);

export const PromoteIcon = (): React.JSX.Element => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M12 4v16" />
    <path d="m9.5 14-2-2 2-2" />
  </Icon>
);

export const GridIcon = (): React.JSX.Element => (
  <Icon>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </Icon>
);

/** A 1-shot window: one plain frame with an address line, nothing pinned. */
export const OneShotIcon = (): React.JSX.Element => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9h18" />
    <path d="M6.5 6.5h5" />
  </Icon>
);

export const PlusIcon = (): React.JSX.Element => (
  <Icon>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Icon>
);

/** The address bar itself: an input pill with a text stub. */
export const AddressBarIcon = (): React.JSX.Element => (
  <Icon>
    <rect x="3" y="8" width="18" height="8" rx="2" />
    <path d="M7 12h6" />
  </Icon>
);

export const TrailIcon = (): React.JSX.Element => (
  <Icon>
    <path d="M4 6h16" />
    <path d="M4 12h10" />
    <path d="M4 18h7" />
  </Icon>
);

export const PuzzleIcon = (): React.JSX.Element => (
  <Icon>
    <path d="M9 4a2 2 0 1 1 4 0h4a1 1 0 0 1 1 1v4a2 2 0 1 1 0 4v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4a2 2 0 1 1 0-4V5a1 1 0 0 1 1-1z" />
  </Icon>
);
