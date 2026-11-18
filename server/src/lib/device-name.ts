export function getDeviceName(userAgent?: string | null): string | null {
  if (!userAgent) return null;

  const ua = userAgent.toLowerCase();

  const os = ua.includes('windows')
    ? 'Windows'
    : ua.includes('mac os') || ua.includes('macintosh')
      ? 'Mac'
      : ua.includes('iphone')
        ? 'iPhone'
        : ua.includes('ipad')
          ? 'iPad'
          : ua.includes('android')
            ? 'Android'
            : ua.includes('linux')
              ? 'Linux'
              : 'Device';

  const browser = ua.includes('edg/')
    ? 'Microsoft Edge'
    : ua.includes('opr/') || ua.includes('opera')
      ? 'Opera'
      : ua.includes('chrome/') || ua.includes('crios/')
        ? 'Chrome'
        : ua.includes('firefox/') || ua.includes('fxios/')
          ? 'Firefox'
          : ua.includes('safari/')
            ? 'Safari'
            : 'Browser';

  return `${browser} on ${os}`;
}
