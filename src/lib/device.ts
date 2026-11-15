const DEVICE_ID_KEY = 'studydeck_device_id';
const DEVICE_NAME_KEY = 'studydeck_device_name';

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  platform: string;
}

function detectBrowserAndOs(): { browser: string; os: string } {
  const ua = navigator.userAgent;
  let browser = 'Browser';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';

  let os = 'Desktop';
  if (/iPhone|iPad|iPod/.test(ua)) os = /iPad/.test(ua) ? 'iPadOS' : 'iOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Linux/.test(ua)) os = 'Linux';

  return { browser, os };
}

export function getDeviceInfo(): DeviceInfo {
  let deviceId = '';
  try {
    deviceId = localStorage.getItem(DEVICE_ID_KEY) || '';
  } catch {
    // ignore
  }
  if (!deviceId || !/^[a-zA-Z0-9_-]{1,128}$/.test(deviceId)) {
    const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    deviceId = `dev_${rand}`;
    try {
      localStorage.setItem(DEVICE_ID_KEY, deviceId);
    } catch {
      // ignore
    }
  }

  const { browser, os } = detectBrowserAndOs();
  let customName = '';
  try {
    customName = localStorage.getItem(DEVICE_NAME_KEY) || '';
  } catch {
    // ignore
  }

  return {
    deviceId,
    deviceName: (customName || `${browser} on ${os}`).slice(0, 100),
    platform: `${os} · ${browser}`.slice(0, 64),
  };
}

export function setCustomDeviceName(name: string): DeviceInfo {
  const clean = name.trim().slice(0, 100);
  try {
    if (clean) localStorage.setItem(DEVICE_NAME_KEY, clean);
    else localStorage.removeItem(DEVICE_NAME_KEY);
  } catch {
    // ignore
  }
  return getDeviceInfo();
}
