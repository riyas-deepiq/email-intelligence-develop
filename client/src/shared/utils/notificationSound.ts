export const NOTIFICATION_SOUND_KEY = 'settings.notificationSound';
export const ALERT_NOTIFICATIONS_KEY = 'settings.alertNotifications';

export function isNotificationSoundEnabled(): boolean {
  return localStorage.getItem(NOTIFICATION_SOUND_KEY) === 'true';
}

export function areAlertNotificationsEnabled(): boolean {
  return localStorage.getItem(ALERT_NOTIFICATIONS_KEY) !== 'false';
}

export function playNotificationSound(): void {
  if (!isNotificationSoundEnabled()) return;

  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return;

  const ctx = new AudioContextCtor();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(880, ctx.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.14);
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);

  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + 0.2);
  oscillator.onended = () => void ctx.close();
}
