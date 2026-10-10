/** A fix from the device's GPS/network location. */
export interface DevicePosition {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
}

export type GeolocationFailure =
  | 'insecure'
  | 'unsupported'
  | 'denied'
  | 'unavailable'
  | 'timeout';

export const GEOLOCATION_MESSAGES: Record<GeolocationFailure, string> = {
  insecure:
    'Trình duyệt chỉ cho lấy vị trí trên HTTPS (hoặc localhost). Hãy mở trang admin qua HTTPS.',
  unsupported: 'Thiết bị này không hỗ trợ lấy vị trí.',
  denied:
    'Bạn đã từ chối quyền vị trí. Bật lại trong cài đặt trình duyệt rồi thử lại.',
  unavailable: 'Không xác định được vị trí. Ra chỗ thoáng và thử lại.',
  timeout: 'Lấy vị trí quá lâu. Ra chỗ thoáng và thử lại.',
};

export class GeolocationError extends Error {
  constructor(readonly reason: GeolocationFailure) {
    super(GEOLOCATION_MESSAGES[reason]);
    this.name = 'GeolocationError';
  }
}

interface GeolocationEnvironment {
  geolocation?: Pick<Geolocation, 'getCurrentPosition'>;
  isSecureContext: boolean;
}

/**
 * Asks the device for its position once, with high accuracy and no cached fix
 * (an admin marking a spot needs where they stand now). Rejects with a
 * {@link GeolocationError} carrying a Vietnamese, user-facing message.
 */
export function getDevicePosition(
  environment: GeolocationEnvironment = {
    geolocation:
      typeof navigator === 'undefined' ? undefined : navigator.geolocation,
    isSecureContext:
      typeof window === 'undefined' ? false : window.isSecureContext,
  },
  options: PositionOptions = {
    enableHighAccuracy: true,
    timeout: 20_000,
    maximumAge: 0,
  },
): Promise<DevicePosition> {
  if (!environment.isSecureContext) {
    return Promise.reject(new GeolocationError('insecure'));
  }
  const { geolocation } = environment;
  if (!geolocation) {
    return Promise.reject(new GeolocationError('unsupported'));
  }
  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
        }),
      (error) =>
        reject(
          new GeolocationError(
            error.code === 1
              ? 'denied'
              : error.code === 3
                ? 'timeout'
                : 'unavailable',
          ),
        ),
      options,
    );
  });
}

/** Maps a browser PositionError code to our failure reason. */
export function failureForCode(code: number): GeolocationFailure {
  return code === 1 ? 'denied' : code === 3 ? 'timeout' : 'unavailable';
}
