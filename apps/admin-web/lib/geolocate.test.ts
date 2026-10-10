import { describe, expect, it } from 'vitest';
import { GeolocationError, getDevicePosition } from './geolocate';

const fix = (latitude: number, longitude: number, accuracy: number) =>
  ({ coords: { latitude, longitude, accuracy } }) as GeolocationPosition;

describe('getDevicePosition', () => {
  it('resolves latitude, longitude and accuracy from a fix', async () => {
    const position = await getDevicePosition({
      isSecureContext: true,
      geolocation: {
        getCurrentPosition: (ok) => ok(fix(10.7658, 106.638, 6.4)),
      },
    });
    expect(position).toEqual({
      latitude: 10.7658,
      longitude: 106.638,
      accuracyMeters: 6.4,
    });
  });

  it('asks for a fresh high-accuracy fix', async () => {
    let seen: PositionOptions | undefined;
    await getDevicePosition(
      {
        isSecureContext: true,
        geolocation: {
          getCurrentPosition: (ok, _error, options) => {
            seen = options;
            ok(fix(1, 2, 3));
          },
        },
      },
      undefined,
    );
    expect(seen).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 });
  });

  it('refuses outside a secure context (phones need HTTPS)', async () => {
    await expect(
      getDevicePosition({
        isSecureContext: false,
        geolocation: { getCurrentPosition: () => undefined },
      }),
    ).rejects.toMatchObject({ reason: 'insecure' });
  });

  it('reports a missing geolocation API', async () => {
    await expect(
      getDevicePosition({ isSecureContext: true }),
    ).rejects.toMatchObject({ reason: 'unsupported' });
  });

  it.each([
    [1, 'denied'],
    [2, 'unavailable'],
    [3, 'timeout'],
  ])('maps browser error code %i to %s', async (code, reason) => {
    const promise = getDevicePosition({
      isSecureContext: true,
      geolocation: {
        getCurrentPosition: (_ok, error) =>
          error?.({ code, message: '' } as GeolocationPositionError),
      },
    });
    await expect(promise).rejects.toBeInstanceOf(GeolocationError);
    await expect(promise).rejects.toMatchObject({ reason });
  });
});
