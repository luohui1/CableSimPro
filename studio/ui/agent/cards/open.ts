// A card takes its object to the workbench: the address the host gave it, opened in the same window.
import { useRouter } from '@tanstack/react-router';

export function useOpen(): (href: string) => void {
  const router = useRouter();
  return href => router.history.push(href);
}
