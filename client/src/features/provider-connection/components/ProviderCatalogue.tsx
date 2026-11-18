import { Modal } from '@/shared/components/Modal';
import GoogleIcon from '@/assets/icons/google.svg?react';
import MicrosoftIcon from '@/assets/icons/microsoft.svg?react';
import styles from '@/styles/features/provider-connection/components/ProviderCatalogue.module.css';

/** Providers the backend can actually connect (see provider-connection.types.ts). */
export type ProviderId = 'm365' | 'google';

type SvgIcon = typeof GoogleIcon;

interface CatalogueEntry {
  id: string;
  name: string;
  full: string;
  blurb: string;
  Icon?: SvgIcon;
  /** Only entries flagged supported can be connected; the rest are roadmap. */
  supported: boolean;
}

/**
 * Single source of truth for the provider catalogue, shared by the strip on
 * Sync Mail and the Email Providers tab in the Admin Console. Everything the
 * server can genuinely connect is marked supported; the rest render disabled
 * with a "Coming soon" badge rather than being hidden, so the roadmap is
 * visible without implying a provider works when it doesn't.
 */
const CATALOGUE: CatalogueEntry[] = [
  {
    id: 'm365',
    name: 'Microsoft',
    full: 'Microsoft 365',
    blurb: 'Graph API · app-only credentials',
    Icon: MicrosoftIcon,
    supported: true,
  },
  {
    id: 'google',
    name: 'Google',
    full: 'Google Workspace',
    blurb: 'Service account · domain-wide delegation',
    Icon: GoogleIcon,
    supported: true,
  },
  { id: 'okta', name: 'Okta', full: 'Okta', blurb: 'SCIM directory sync', supported: false },
  {
    id: 'imap',
    name: 'IMAP',
    full: 'Generic IMAP',
    blurb: 'Any standards-compliant mail server',
    supported: false,
  },
];

function isProviderId(id: string): id is ProviderId {
  return id === 'm365' || id === 'google';
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (id: ProviderId) => void;
  isConnected: (id: ProviderId) => boolean;
}

/** Modal listing every provider, supported ones selectable. */
export function ProviderCatalogueModal({ open, onClose, onSelect, isConnected }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="Add an email provider" width={560}>
      <ul className={styles.catalogue}>
        {CATALOGUE.map(({ id, full, blurb, Icon, supported }) => {
          const already = isProviderId(id) && isConnected(id);
          return (
            <li key={id}>
              <button
                type="button"
                className={styles.catalogueRow}
                disabled={!supported}
                onClick={() => isProviderId(id) && onSelect(id)}
              >
                <span className={styles.catalogueIcon}>
                  {Icon ? <Icon /> : <span className={styles.monogram}>{full.charAt(0)}</span>}
                </span>
                <span className={styles.catalogueText}>
                  <span className={styles.catalogueName}>{full}</span>
                  <span className={styles.catalogueBlurb}>{blurb}</span>
                </span>
                {!supported ? (
                  <span className={styles.soonBadge}>Coming soon</span>
                ) : already ? (
                  <span className={styles.connectedBadge}>Connected</span>
                ) : (
                  <span className={styles.chevron}>→</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
