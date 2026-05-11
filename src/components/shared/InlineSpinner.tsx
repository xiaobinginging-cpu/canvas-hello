import LogoLoading from '../logo/LogoLoading.tsx'

/** Logo dots pulse (600ms loop); replaces monochrome spinner */
export default function InlineSpinner({ label }: { label?: string }) {
  return <LogoLoading size={16} label={label} />
}
