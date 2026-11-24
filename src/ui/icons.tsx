import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  )
}

export const PlayIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 4.8v14.4c0 .8.9 1.3 1.6.9l11.3-7.2a1 1 0 0 0 0-1.8L8.6 3.9C7.9 3.5 7 4 7 4.8z" />
  </Icon>
)

export const PauseIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="6" y="4" width="4.2" height="16" rx="1.2" />
    <rect x="13.8" y="4" width="4.2" height="16" rx="1.2" />
  </Icon>
)

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9.5 16.2 5.3 12a1 1 0 1 0-1.4 1.4l4.9 4.9a1 1 0 0 0 1.4 0l10-10a1 1 0 0 0-1.4-1.4z" />
  </Icon>
)

export const BackIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15.4 4.6a1 1 0 0 1 0 1.4L9.4 12l6 6a1 1 0 1 1-1.4 1.4l-6.7-6.7a1 1 0 0 1 0-1.4L14 4.6a1 1 0 0 1 1.4 0z" />
  </Icon>
)

export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8.6 4.6a1 1 0 0 0 0 1.4l6 6-6 6A1 1 0 1 0 10 19.4l6.7-6.7a1 1 0 0 0 0-1.4L10 4.6a1 1 0 0 0-1.4 0z" />
  </Icon>
)

export const ForwardEndIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 5.6v12.8c0 .8.9 1.3 1.5.8l9-6.4a1 1 0 0 0 0-1.6l-9-6.4C4.9 4.3 4 4.8 4 5.6z" />
    <rect x="16.5" y="4.5" width="3" height="15" rx="1" />
  </Icon>
)

export const FullscreenIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 9V5a1 1 0 0 1 1-1h4a1 1 0 1 1 0 2H6v3a1 1 0 1 1-2 0zm11-5h4a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0V6h-3a1 1 0 1 1 0-2zM5 14a1 1 0 0 1 1 1v3h3a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zm14 0a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 1 1 0-2h3v-3a1 1 0 0 1 1-1z" />
  </Icon>
)

export const ExitFullscreenIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 1 1 0-2h3V5a1 1 0 0 1 1-1zm6 0a1 1 0 0 1 1 1v3h3a1 1 0 1 1 0 2h-4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM5 14h4a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0v-3H5a1 1 0 1 1 0-2zm10 0h4a1 1 0 1 1 0 2h-3v3a1 1 0 1 1-2 0v-4a1 1 0 0 1 1-1z" />
  </Icon>
)

export const VolumeIcon = ({ muted, ...p }: IconProps & { muted?: boolean }) => (
  <Icon {...p}>
    <path d="M11 5.2v13.6c0 .9-1 1.3-1.7.7L5.6 16H3a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h2.6l3.7-3.5c.7-.6 1.7-.2 1.7.7z" />
    {muted ? (
      <path d="M15.3 9.3a1 1 0 0 1 1.4 0l1.8 1.8 1.8-1.8a1 1 0 1 1 1.4 1.4l-1.8 1.8 1.8 1.8a1 1 0 0 1-1.4 1.4l-1.8-1.8-1.8 1.8a1 1 0 0 1-1.4-1.4l1.8-1.8-1.8-1.8a1 1 0 0 1 0-1.4z" />
    ) : (
      <path d="M14.6 8.2a1 1 0 0 1 1.4.1 5.6 5.6 0 0 1 0 7.4 1 1 0 1 1-1.5-1.3 3.6 3.6 0 0 0 0-4.8 1 1 0 0 1 .1-1.4zm2.9-2.6a1 1 0 0 1 1.4 0 9.4 9.4 0 0 1 0 12.8 1 1 0 0 1-1.4-1.4 7.4 7.4 0 0 0 0-10 1 1 0 0 1 0-1.4z" />
    )}
  </Icon>
)

export const TracksIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm0 2v10h16V7H4zm2 6h5a1 1 0 1 1 0 2H6a1 1 0 1 1 0-2zm8 0h4a1 1 0 1 1 0 2h-4a1 1 0 1 1 0-2zM6 10h3a1 1 0 0 1 0 2H6a1 1 0 1 1 0-2zm6 0h6a1 1 0 1 1 0 2h-6a1 1 0 1 1 0-2z" />
  </Icon>
)

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.3 6.3a1 1 0 0 1 1.4 0L12 10.6l4.3-4.3a1 1 0 1 1 1.4 1.4L13.4 12l4.3 4.3a1 1 0 0 1-1.4 1.4L12 13.4l-4.3 4.3a1 1 0 0 1-1.4-1.4l4.3-4.3-4.3-4.3a1 1 0 0 1 0-1.4z" />
  </Icon>
)

export const RewindIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5V2.5a.5.5 0 0 0-.8-.4L6.6 5.6a.5.5 0 0 0 0 .8l4.6 3.5a.5.5 0 0 0 .8-.4V7a6 6 0 1 1-6 6 1 1 0 1 0-2 0 8 8 0 1 0 8-8z" />
  </Icon>
)

export const ForwardIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5V2.5a.5.5 0 0 1 .8-.4l4.6 3.5a.5.5 0 0 1 0 .8l-4.6 3.5a.5.5 0 0 1-.8-.4V7a6 6 0 1 0 6 6 1 1 0 1 1 2 0 8 8 0 1 1-8-8z" />
  </Icon>
)

export const RestartIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4a8 8 0 1 1-7.6 10.5 1 1 0 1 1 1.9-.6A6 6 0 1 0 7.8 7.8L9.6 9.6A.5.5 0 0 1 9.2 10.5H4.5a.5.5 0 0 1-.5-.5V5.3a.5.5 0 0 1 .9-.4l1.5 1.5A8 8 0 0 1 12 4z" />
  </Icon>
)

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <path
      fillRule="evenodd"
      d="M10.5 3a7.5 7.5 0 0 1 5.96 12.05l4.25 4.24a1 1 0 0 1-1.42 1.42l-4.24-4.25A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z"
    />
  </Icon>
)

/** Bookmark: outlined, or filled when the title is on the Plex list. */
export const BookmarkIcon = ({ filled, ...p }: IconProps & { filled?: boolean }) => (
  <Icon {...p}>
    {filled ? (
      <path d="M6.5 3h11A1.5 1.5 0 0 1 19 4.5v15.6a.9.9 0 0 1-1.4.7L12 16.7l-5.6 4.1a.9.9 0 0 1-1.4-.7V4.5A1.5 1.5 0 0 1 6.5 3z" />
    ) : (
      <path
        fillRule="evenodd"
        d="M6.5 3h11A1.5 1.5 0 0 1 19 4.5v15.6a.9.9 0 0 1-1.4.7L12 16.7l-5.6 4.1a.9.9 0 0 1-1.4-.7V4.5A1.5 1.5 0 0 1 6.5 3zM7 5v13.1l4.4-3.2a1 1 0 0 1 1.2 0l4.4 3.2V5H7z"
      />
    )}
  </Icon>
)

/** House: the «Главная» settings page. */
export const HomeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path
      fillRule="evenodd"
      d="M11.3 3.3a1 1 0 0 1 1.4 0l8 7.6a1 1 0 0 1-1.4 1.5l-.3-.3V19a2 2 0 0 1-2 2h-3.5a1 1 0 0 1-1-1v-4.5h-1V20a1 1 0 0 1-1 1H7a2 2 0 0 1-2-2v-6.9l-.3.3a1 1 0 0 1-1.4-1.5l8-7.6zM7 10.2V19h2.5v-4.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V19H17v-8.8l-5-4.8-5 4.8z"
    />
  </Icon>
)

/** Two server units: the «Сервер и аккаунт» settings page. */
export const ServerIcon = (p: IconProps) => (
  <Icon {...p}>
    <path
      fillRule="evenodd"
      d="M5 3h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm0 2v4h14V5H5zm0 8h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2zm0 2v4h14v-4H5zm2-9h2v2H7V6zm0 10h2v2H7v-2z"
    />
  </Icon>
)

/** Gear (Material Icons "settings", Apache 2.0). */
export const SettingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z" />
  </Icon>
)

export const EyeIcon =({ off, ...p }: IconProps & { off?: boolean }) => (
  <Icon {...p}>
    <path d="M12 5c5 0 8.6 4.2 9.8 6.4a1.3 1.3 0 0 1 0 1.2C20.6 14.8 17 19 12 19s-8.6-4.2-9.8-6.4a1.3 1.3 0 0 1 0-1.2C3.4 9.2 7 5 12 5zm0 2c-3.6 0-6.4 2.9-7.7 5 1.3 2.1 4.1 5 7.7 5s6.4-2.9 7.7-5C18.4 9.9 15.6 7 12 7zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6z" />
    {off && <path d="M4.3 3.3a1 1 0 0 1 1.4 0l15 15a1 1 0 0 1-1.4 1.4l-15-15a1 1 0 0 1 0-1.4z" />}
  </Icon>
)

export const ChevronUpIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.6 15.4a1 1 0 0 0 1.4 0l6-6 6 6a1 1 0 1 0 1.4-1.4l-6.7-6.7a1 1 0 0 0-1.4 0L4.6 14a1 1 0 0 0 0 1.4z" />
  </Icon>
)

export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.6 8.6a1 1 0 0 1 1.4 0l6 6 6-6a1 1 0 1 1 1.4 1.4l-6.7 6.7a1 1 0 0 1-1.4 0L4.6 10a1 1 0 0 1 0-1.4z" />
  </Icon>
)

/** «Ещё»: three dots. */
export const MoreIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
  </Icon>
)

export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path
      fillRule="evenodd"
      d="M9 3h6a1 1 0 0 1 1 1v1h4a1 1 0 1 1 0 2h-1l-.9 12.2A2 2 0 0 1 16.1 21H7.9a2 2 0 0 1-2-1.8L5 7H4a1 1 0 0 1 0-2h4V4a1 1 0 0 1 1-1zm-2 4 .9 12h8.2L17 7H7zm3 2a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1zm4 0a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1z"
    />
  </Icon>
)

/** A film frame with a play triangle: «Трейлер». */
export const TrailerIcon = (p: IconProps) => (
  <Icon {...p}>
    <path
      fillRule="evenodd"
      d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v12h14V6H5zm5 2.6 5 3.1a.4.4 0 0 1 0 .6l-5 3.1a.4.4 0 0 1-.6-.3V8.9a.4.4 0 0 1 .6-.3z"
    />
  </Icon>
)

/**
 * The Loge wordmark: DM Serif Display (SIL OFL) «L», «g», «e», the «o» is a play disc.
 * Same outline as app/brand/loge-wordmark.svg. `height` includes the descender of «g».
 */
export const Wordmark = ({ height = 24, ...rest }: SVGProps<SVGSVGElement> & { height?: number }) => (
  <svg
    height={height}
    width={(height * 303.38) / 133.5}
    viewBox="0 0 303.38 133.5"
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    <path d="M0 99 L0 97.5 L3.15 96.3 Q6.3 95.1 7.12 93.38 Q7.95 91.65 7.95 88.65 L7.95 10.35 Q7.95 7.35 7.05 5.55 Q6.15 3.75 3.15 2.7 L0 1.5 L0 0 L38.25 0 L38.25 1.5 L35.55 2.7 Q32.7 3.75 31.65 5.62 Q30.6 7.5 30.6 10.5 L30.6 96 L53.7 96 Q59.25 96 61.88 93.3 Q64.5 90.6 66.9 85.5 L72.75 72.9 L74.25 72.9 L72.9 99 Z M112.94 24.05 C134.06 24.05 151.18 41.17 151.18 62.29 C151.18 83.41 134.06 100.53 112.94 100.53 C91.82 100.53 74.7 83.41 74.7 62.29 C74.7 41.17 91.82 24.05 112.94 24.05 Z M101.18 44.7 L101.18 79.88 L132.13 62.29 Z M189.88 73.05 Q179.53 73.05 172.33 69.6 L172.33 74.7 Q172.33 79.35 176.98 80.25 L205.18 85.5 Q212.23 86.85 217.93 89.03 Q223.63 91.2 227.08 95.17 Q230.53 99.15 230.53 106.05 Q230.53 113.4 225.73 119.62 Q220.93 125.85 211.55 129.68 Q202.18 133.5 188.23 133.5 Q176.23 133.5 169.18 131.03 Q162.13 128.55 159.2 124.65 Q156.28 120.75 156.28 116.4 Q156.28 111 159.95 105.53 Q163.63 100.05 169.03 96.75 Q164.38 94.95 162.28 92.1 Q160.18 89.25 160.18 85.95 Q160.18 82.95 161.75 80.33 Q163.33 77.7 165.58 75 L170.53 68.7 Q159.58 62.4 159.58 48.9 Q159.58 38.1 167.3 31.35 Q175.03 24.6 190.03 24.6 Q197.68 24.6 203.45 26.4 Q209.23 28.2 212.98 31.5 Q217.78 30.75 222.05 29.03 Q226.33 27.3 229.78 24.3 L231.88 25.8 L231.88 33.45 L214.93 33.45 Q220.33 39.45 220.33 48.9 Q220.33 59.4 212.6 66.22 Q204.88 73.05 189.88 73.05 Z M189.73 70.05 Q195.73 70.05 198.5 65.1 Q201.28 60.15 201.28 48.6 Q201.28 37.05 198.5 32.33 Q195.73 27.6 190.03 27.6 Q184.48 27.6 181.63 32.48 Q178.78 37.35 178.78 48.9 Q178.78 60.45 181.4 65.25 Q184.03 70.05 189.73 70.05 Z M167.38 111.6 Q167.38 120.45 172.85 124.95 Q178.33 129.45 190.18 129.45 Q202.63 129.45 208.93 125.4 Q215.23 121.35 215.23 114 Q215.23 109.8 212.15 107.25 Q209.08 104.7 201.73 103.35 L174.58 98.25 Q173.38 97.95 172.18 97.65 Q170.08 100.65 168.73 104.47 Q167.38 108.3 167.38 111.6 Z M272.48 24.6 Q282.23 24.6 289.13 28.58 Q296.03 32.55 299.7 39.38 Q303.38 46.2 303.38 54.9 Q303.38 56.55 303.23 58.27 Q303.08 60 302.63 61.35 L257.93 61.35 Q258.08 77.55 263.7 84.67 Q269.33 91.8 280.43 91.8 Q287.93 91.8 292.58 89.4 Q297.23 87 301.28 82.35 L302.78 83.7 Q298.13 91.95 290.4 96.6 Q282.68 101.25 271.88 101.25 Q261.23 101.25 252.98 96.67 Q244.73 92.1 240.08 83.55 Q235.43 75 235.43 63.15 Q235.43 50.85 240.83 42.23 Q246.23 33.6 254.7 29.1 Q263.18 24.6 272.48 24.6 Z M272.03 27.6 Q267.68 27.6 264.6 30.23 Q261.53 32.85 259.8 39.53 Q258.08 46.2 257.93 58.35 L283.58 58.35 Q285.08 42 282.38 34.8 Q279.68 27.6 272.03 27.6 Z" />
  </svg>
)
