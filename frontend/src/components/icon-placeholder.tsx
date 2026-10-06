import { Check, Copy, Plus, Minus, type LucideProps } from '@/icons/lucide-shim';
const components = { Check, Copy, Plus, Minus };
/** BuzzForm compatibility; unsupported icon names fail TypeScript. */
export function IconPlaceholder({ lucide, className }: { lucide: keyof typeof components; className?: string; hugeicons?: string; tabler?: string; phosphor?: string; remixicon?: string } & LucideProps) {
  const Component = components[lucide];
  return <Component className={className} />;
}
