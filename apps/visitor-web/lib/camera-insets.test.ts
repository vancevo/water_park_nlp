import { describe, expect, it } from 'vitest';
import { insetsFromRects } from './camera-insets';

const phone = { width: 390, height: 700 };
const desktop = { width: 970, height: 690 };

describe('camera insets', () => {
  it('keeps a small margin when nothing covers the map', () => {
    expect(insetsFromRects(desktop, [])).toEqual({
      top: 24,
      right: 24,
      bottom: 24,
      left: 24,
    });
  });

  it('a card on the right of a wide screen takes the right side', () => {
    const insets = insetsFromRects(desktop, [
      { left: 520, top: 340, right: 952, bottom: 672 },
    ]);
    expect(insets.right).toBe(970 - 520 + 24);
    expect(insets.bottom).toBe(24);
  });

  it('a sheet across a phone takes the bottom, a bar across the top takes the top', () => {
    const insets = insetsFromRects(phone, [
      { left: 10, top: 300, right: 380, bottom: 690 },
      { left: 12, top: 10, right: 378, bottom: 60 },
    ]);
    expect(insets.bottom).toBe(700 - 300 + 24);
    expect(insets.top).toBe(60 + 24);
  });

  it('a small panel in a corner of a phone takes a band, not a whole side', () => {
    const insets = insetsFromRects(phone, [
      { left: 10, top: 72, right: 233, bottom: 125 },
    ]);
    expect(insets.top).toBe(125 + 24);
    expect(insets.left).toBe(24);
  });

  it('never leaves less than a quarter of the map to look at', () => {
    const insets = insetsFromRects(phone, [
      { left: 0, top: 20, right: 390, bottom: 400 },
      { left: 0, top: 420, right: 390, bottom: 700 },
    ]);
    expect(phone.height - insets.top - insets.bottom).toBeGreaterThanOrEqual(
      phone.height * 0.25 - 0.001,
    );
  });

  it('ignores what is not over the map', () => {
    const insets = insetsFromRects(desktop, [
      { left: -400, top: 0, right: -10, bottom: 600 },
    ]);
    expect(insets.left).toBe(24);
  });
});
