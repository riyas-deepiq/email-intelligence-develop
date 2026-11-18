import type { TestConnectionResponse } from '../provider-connection.types';
import IcCheck from '@/assets/icons/check.svg?react';
import IcX from '@/assets/icons/x.svg?react';
import styles from '@/styles/features/provider-connection/components/ProviderConnectionStep.module.css';

interface Props {
  result: TestConnectionResponse;
}

function Check({ ok }: { ok: boolean }) {
  return ok ? (
    <IcCheck className={styles.permOk} width={14} height={14} />
  ) : (
    <IcX className={styles.permErr} width={14} height={14} />
  );
}

export function ConnectionTestResult({ result }: Props) {
  return (
    <div className={`${styles.testResult} ${result.valid ? styles.testResultOk : styles.testResultFail}`}>
      {result.valid ? (
        <>
          <div className={styles.testResultTitle}>Connection successful</div>
          <div className={styles.permRow}><Check ok={result.permissions.canListUsers} /> User directory access</div>
          <div className={styles.permRow}><Check ok={result.permissions.canReadMail} /> Mail read access</div>
          <div className={styles.permRow}>
            <Check ok={result.userCount > 0} />
            {result.userCount} user{result.userCount !== 1 ? 's' : ''} discovered
          </div>
          {result.sampleUsers.length > 0 && (
            <div className={styles.sampleUsers}>
              <span className={styles.sampleLabel}>Preview:</span>
              {result.sampleUsers.slice(0, 5).map((u) => (
                <span key={u.email} className={styles.sampleEmail}>{u.email}</span>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className={styles.testResultTitle}>Connection failed</div>
          {result.error && <div className={styles.testResultError}>{result.error}</div>}
          <div className={styles.permRow}><Check ok={result.permissions.canListUsers} /> User directory access</div>
          <div className={styles.permRow}><Check ok={result.permissions.canReadMail} /> Mail read access</div>
        </>
      )}
    </div>
  );
}
