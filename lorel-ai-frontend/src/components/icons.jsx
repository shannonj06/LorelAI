/* Line icons drawn to match the paper-airplane asset: 24px grid, 2px round strokes. */

function Icon({ children, size = 18, ...props }) {
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
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const SendIcon = (p) => (
  <Icon {...p}>
    <path d="M14.5 21.7a.5.5 0 0 0 .9 0L22 2.7a.5.5 0 0 0-.6-.7L2.3 8.5a.5.5 0 0 0 0 .9l7.9 3.2a2 2 0 0 1 1.1 1.1z" />
    <path d="M21.9 2.1 10.9 13.1" />
  </Icon>
);
export const PlusIcon = (p) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const CloseIcon = (p) => (
  <Icon {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
);
export const TrashIcon = (p) => (
  <Icon {...p}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
  </Icon>
);
export const UploadIcon = (p) => (
  <Icon {...p}>
    <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
  </Icon>
);
export const BookIcon = (p) => (
  <Icon {...p}>
    <path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6.5a2.5 2.5 0 0 0 0 5H19" />
  </Icon>
);
export const CheckIcon = (p) => (
  <Icon {...p}>
    <path d="m5 12 5 5 9-10" />
  </Icon>
);
export const MenuIcon = (p) => (
  <Icon {...p}>
    <path d="M4 7h16M4 12h16M4 17h10" />
  </Icon>
);
export const EyeIcon = (p) => (
  <Icon {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);
export const EyeOffIcon = (p) => (
  <Icon {...p}>
    <path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M3 3l18 18M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </Icon>
);
export const ArrowIcon = (p) => (
  <Icon {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);
export const BookmarkIcon = (p) => (
  <Icon {...p}>
    <path d="M6 3h12v18l-6-4-6 4z" />
  </Icon>
);
