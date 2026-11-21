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

export const EyeIcon = ({ off, ...p }: IconProps & { off?: boolean }) => (
  <Icon {...p}>
    <path d="M12 5c5 0 8.6 4.2 9.8 6.4a1.3 1.3 0 0 1 0 1.2C20.6 14.8 17 19 12 19s-8.6-4.2-9.8-6.4a1.3 1.3 0 0 1 0-1.2C3.4 9.2 7 5 12 5zm0 2c-3.6 0-6.4 2.9-7.7 5 1.3 2.1 4.1 5 7.7 5s6.4-2.9 7.7-5C18.4 9.9 15.6 7 12 7zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6z" />
    {off && <path d="M4.3 3.3a1 1 0 0 1 1.4 0l15 15a1 1 0 0 1-1.4 1.4l-15-15a1 1 0 0 1 0-1.4z" />}
  </Icon>
)
