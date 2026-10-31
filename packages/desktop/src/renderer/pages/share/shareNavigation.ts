import { getPublicShareToken } from '@/common/utils/urlValidation';

/** Crossing an anonymous capability boundary requires a clean application bootstrap. */
export function watchPublicShareNavigation(
  initialToken: string | null,
  reload = () => window.location.reload()
): () => void {
  const onHashChange = () => {
    const nextToken = getPublicShareToken(window.location.hash);
    if (nextToken !== initialToken && (nextToken || initialToken)) reload();
  };
  window.addEventListener('hashchange', onHashChange);
  return () => window.removeEventListener('hashchange', onHashChange);
}
