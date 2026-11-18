import { Navigate } from 'react-router-dom';
import { View, viewPath } from '../dashboard.types';

/**
 * The provider credential form no longer has its own page — it lives in the
 * Email Providers tab of the Admin Console. This redirect points
 * /email-providers there, keeping bookmarks and the setup-flow banner working.
 */
export function EmailProviderView() {
  return <Navigate to={`${viewPath(View.Admin)}/providers`} replace />;
}
