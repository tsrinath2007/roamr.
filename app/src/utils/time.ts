export interface CountdownInfo {
  expired: boolean;
  label: string;
}

export function formatRemainingTime(expiresAt?: string): CountdownInfo | null {
  if (!expiresAt) return null;
  const endMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(endMs)) return null;

  const diffMs = endMs - Date.now();
  if (diffMs <= 0) {
    return { expired: true, label: 'Expired' };
  }

  const totalMin = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;

  if (days > 0) {
    return { expired: false, label: `${days}d ${hours}h left` };
  }
  if (hours > 0) {
    return { expired: false, label: `${hours}h ${mins}m left` };
  }
  return { expired: false, label: `${Math.max(1, mins)}m left` };
}
