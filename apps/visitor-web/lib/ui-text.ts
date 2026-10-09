import type { SupportedLocale } from '@damsen/shared-types';

/**
 * Visitor interface text for the UI locale (`vi | en`, ADR 0006). This is
 * independent of the narration locale, which comes from the catalog. Both
 * dictionaries must satisfy {@link UiText}, so a key missing in one language is
 * a compile error. Text that comes from the API (POI content, route steps,
 * server error messages) is not translated here.
 */
export interface UiText {
  documentTitle: string;
  close: string;

  // Header / account
  localeGroupLabel: string;
  login: string;
  logout: string;

  // Discovery panel
  eyebrow: string;
  heroLine1: string;
  heroLine2: string;
  heroBody: string;
  searchPlaceholder: string;
  searchLabel: string;
  searchResults: string;
  placesHeading: string;
  placeCount(count: number): string;
  loadingPlaces: string;
  noPlaces: string;
  loadPlacesFailed: string;

  // Map
  mapLabel: string;
  locateMe: string;
  researchBadge: string;
  gpsUnsupported: string;

  // POI card / routing
  routeAbout(duration: string): string;
  updateRoute: string;
  routeFromWalker: string;
  routeFromMe: string;
  routeCreated: string;
  routeFailed: string;
  routeNoGeometry: string;

  // Simulation
  simulatedWalker: string;
  simulationPlaced: string;
  simulationPickHint: string;
  simulationLabel: string;
  openSimulation: string;
  collapseSimulation: string;
  walking(percent: number): string;
  remaining(distance: string): string;
  placedOnMap: string;
  noPosition: string;
  clickMap: string;
  repositionWalker: string;
  placeWalker: string;
  progressLabel: string;
  walkAgain: string;
  startWalking: string;
  createRouteInCard: string;
  choosePoi: string;
  clearSimulation: string;

  // Narration playback
  autoplayBlocked: string;
  speechUnsupported: string;
  noNarrationToPlay: string;
  noVoice(language: string): string;
  arrived: string;
  usingFallback(resolved: string, requested: string): string;
  replayNarration: string;
  stopReading: string;
  noAudioNoSpeech: string;

  // Narration section
  narrationLabel: string;
  narrationLanguage: string;
  loadingLanguages: string;
  catalogError: string;
  retry: string;
  loadingNarration: string;
  noApprovedNarration: string;
  noNarrationFor(requested: string, resolved: string): string;
  narrationError: string;
  narrationTitle(language: string): string;
  audioLabel(language: string): string;
  speakWithBrowser: string;
  noAudioNoAutoRead: string;

  // Auth dialog
  authFailed: string;
  accountEyebrow: string;
  welcomeBack: string;
  createAccount: string;
  guestNote: string;
  email: string;
  password: string;
  working: string;
  signUp: string;
  noAccount: string;
  haveAccount: string;

  // Formatting
  unknownDistance: string;
  minutes(count: number): string;
  categories: Record<string, string>;
}

const vi: UiText = {
  documentTitle: 'Khám phá Đầm Sen',
  close: 'Đóng',

  localeGroupLabel: 'Ngôn ngữ giao diện',
  login: 'Đăng nhập',
  logout: 'Đăng xuất',

  eyebrow: 'Khám phá theo cách của bạn',
  heroLine1: 'Mỗi bước chân,',
  heroLine2: 'một câu chuyện.',
  heroBody:
    'Chọn điểm đến, nghe thuyết minh và nhận tuyến đi bộ từ vị trí hiện tại.',
  searchPlaceholder: 'Tìm trò chơi, khu tham quan…',
  searchLabel: 'Tìm địa điểm',
  searchResults: 'Kết quả tìm kiếm',
  placesHeading: 'Điểm khám phá',
  placeCount: (count) => `${count} địa điểm`,
  loadingPlaces: 'Đang tải địa điểm…',
  noPlaces: 'Không tìm thấy địa điểm phù hợp.',
  loadPlacesFailed: 'Không tải được địa điểm.',

  mapLabel: 'Bản đồ điểm khám phá',
  locateMe: '◎ Vị trí của tôi',
  researchBadge: 'POI + lối đi tham khảo từ OSM · Cần kiểm tra thực địa',
  gpsUnsupported: 'Trình duyệt không hỗ trợ GPS.',

  routeAbout: (duration) => `Khoảng ${duration}`,
  updateRoute: 'Cập nhật tuyến đường',
  routeFromWalker: 'Dẫn đường từ người mô phỏng',
  routeFromMe: 'Dẫn đường từ vị trí của tôi',
  routeCreated: 'Đã tạo tuyến. Hãy đi theo đường màu vàng trên bản đồ.',
  routeFailed: 'Không thể tạo tuyến đường lúc này.',
  routeNoGeometry: 'Tuyến đường không có dữ liệu hình học hợp lệ.',

  simulatedWalker: 'Người mô phỏng',
  simulationPlaced: 'Đã đặt người mô phỏng. Chọn một POI rồi tạo tuyến đường.',
  simulationPickHint: 'Click vào một lối đi trên bản đồ để đặt người mô phỏng.',
  simulationLabel: 'Mô phỏng người đi bộ',
  openSimulation: 'Mở bảng mô phỏng',
  collapseSimulation: 'Thu gọn bảng mô phỏng',
  walking: (percent) => `Đang đi · ${percent}%`,
  remaining: (distance) => `Còn ${distance}`,
  placedOnMap: 'Đã đặt trên bản đồ',
  noPosition: 'Chưa có vị trí',
  clickMap: 'Click lên bản đồ…',
  repositionWalker: 'Đặt lại vị trí',
  placeWalker: 'Đặt người trên bản đồ',
  progressLabel: 'Tiến độ di chuyển',
  walkAgain: 'Đi lại tuyến trong 5 giây',
  startWalking: 'Bắt đầu đi trong 5 giây',
  createRouteInCard: 'Tạo tuyến trong thẻ POI',
  choosePoi: 'Chọn một POI',
  clearSimulation: 'Xóa mô phỏng',

  autoplayBlocked: 'Trình duyệt chặn tự phát audio. Hãy bấm nút phát.',
  speechUnsupported: 'Trình duyệt này không hỗ trợ Web Speech TTS.',
  noNarrationToPlay: 'Chưa có nội dung thuyết minh để phát.',
  noVoice: (language) =>
    `Thiết bị chưa có giọng đọc ${language}. Bạn vẫn có thể đọc nội dung thuyết minh.`,
  arrived: 'Bạn đã đến nơi',
  usingFallback: (resolved, requested) =>
    `Đang dùng bản ${resolved} vì chưa có bản ${requested}.`,
  replayNarration: '▶ Phát lại thuyết minh',
  stopReading: 'Dừng đọc',
  noAudioNoSpeech:
    'Chưa có audio thu sẵn và trình duyệt không hỗ trợ Web Speech TTS.',

  narrationLabel: 'Thuyết minh',
  narrationLanguage: 'Ngôn ngữ thuyết minh',
  loadingLanguages: 'Đang tải ngôn ngữ…',
  catalogError:
    'Không tải được danh sách ngôn ngữ; đang dùng Tiếng Việt/English.',
  retry: 'Thử lại',
  loadingNarration: 'Đang tải thuyết minh…',
  noApprovedNarration: 'Địa điểm này chưa có bản thuyết minh được duyệt.',
  noNarrationFor: (requested, resolved) =>
    `Chưa có thuyết minh ${requested}; đang hiển thị bản ${resolved}.`,
  narrationError: 'Không tải được thuyết minh.',
  narrationTitle: (language) => `Thuyết minh · ${language}`,
  audioLabel: (language) => `Audio thuyết minh ${language}`,
  speakWithBrowser: '▶ Đọc bằng giọng của trình duyệt',
  noAudioNoAutoRead:
    'Chưa có audio thu sẵn và trình duyệt không hỗ trợ đọc tự động; bạn vẫn có thể đọc nội dung ở trên.',

  authFailed: 'Không thể xác thực.',
  accountEyebrow: 'Tài khoản khách tham quan',
  welcomeBack: 'Chào mừng trở lại',
  createAccount: 'Tạo tài khoản',
  guestNote:
    'Bạn vẫn có thể khám phá với tư cách khách mà không cần đăng nhập.',
  email: 'Email',
  password: 'Mật khẩu',
  working: 'Đang xử lý…',
  signUp: 'Đăng ký',
  noAccount: 'Chưa có tài khoản? Đăng ký',
  haveAccount: 'Đã có tài khoản? Đăng nhập',

  unknownDistance: 'Chưa xác định',
  minutes: (count) => `${count} phút`,
  categories: {
    children: 'Trẻ em',
    exhibit: 'Trưng bày',
    garden: 'Vườn cảnh',
    indoor: 'Trong nhà',
    interactive: 'Tương tác',
    landmark: 'Điểm hẹn',
    ride: 'Trò chơi',
    show: 'Biểu diễn',
    thrill_ride: 'Cảm giác mạnh',
  },
};

const en: UiText = {
  documentTitle: 'Explore Dam Sen',
  close: 'Close',

  localeGroupLabel: 'Interface language',
  login: 'Log in',
  logout: 'Log out',

  eyebrow: 'Explore your own way',
  heroLine1: 'Every step,',
  heroLine2: 'a story.',
  heroBody:
    'Pick a destination, listen to the narration and get a walking route from where you are.',
  searchPlaceholder: 'Search rides and attractions…',
  searchLabel: 'Search places',
  searchResults: 'Search results',
  placesHeading: 'Places to explore',
  placeCount: (count) => `${count} ${count === 1 ? 'place' : 'places'}`,
  loadingPlaces: 'Loading places…',
  noPlaces: 'No matching places found.',
  loadPlacesFailed: 'Could not load places.',

  mapLabel: 'Map of places to explore',
  locateMe: '◎ My location',
  researchBadge: 'Reference POIs and OSM paths · Needs field verification',
  gpsUnsupported: 'This browser does not support GPS.',

  routeAbout: (duration) => `About ${duration}`,
  updateRoute: 'Update route',
  routeFromWalker: 'Navigate from the simulated walker',
  routeFromMe: 'Navigate from my location',
  routeCreated: 'Route created. Follow the yellow line on the map.',
  routeFailed: 'Could not create a route right now.',
  routeNoGeometry: 'The route has no valid geometry.',

  simulatedWalker: 'Simulated walker',
  simulationPlaced:
    'Simulated walker placed. Choose a POI, then create a route.',
  simulationPickHint: 'Click a path on the map to place the simulated walker.',
  simulationLabel: 'Pedestrian simulation',
  openSimulation: 'Open simulation panel',
  collapseSimulation: 'Collapse simulation panel',
  walking: (percent) => `Walking · ${percent}%`,
  remaining: (distance) => `${distance} left`,
  placedOnMap: 'Placed on the map',
  noPosition: 'No position yet',
  clickMap: 'Click the map…',
  repositionWalker: 'Reposition',
  placeWalker: 'Place walker on the map',
  progressLabel: 'Walking progress',
  walkAgain: 'Walk the route again in 5 s',
  startWalking: 'Start walking in 5 s',
  createRouteInCard: 'Create a route in the POI card',
  choosePoi: 'Choose a POI',
  clearSimulation: 'Clear simulation',

  autoplayBlocked: 'The browser blocked autoplay. Press play.',
  speechUnsupported: 'This browser does not support Web Speech TTS.',
  noNarrationToPlay: 'There is no narration to play yet.',
  noVoice: (language) =>
    `This device has no ${language} voice. You can still read the narration.`,
  arrived: 'You have arrived',
  usingFallback: (resolved, requested) =>
    `Showing the ${resolved} version because ${requested} is not available.`,
  replayNarration: '▶ Replay narration',
  stopReading: 'Stop',
  noAudioNoSpeech:
    'There is no recorded audio and this browser does not support Web Speech TTS.',

  narrationLabel: 'Narration',
  narrationLanguage: 'Narration language',
  loadingLanguages: 'Loading languages…',
  catalogError: 'Could not load the language list; using Tiếng Việt/English.',
  retry: 'Try again',
  loadingNarration: 'Loading narration…',
  noApprovedNarration: 'This place has no approved narration yet.',
  noNarrationFor: (requested, resolved) =>
    `No ${requested} narration yet; showing the ${resolved} version.`,
  narrationError: 'Could not load the narration.',
  narrationTitle: (language) => `Narration · ${language}`,
  audioLabel: (language) => `${language} narration audio`,
  speakWithBrowser: '▶ Read aloud with the browser voice',
  noAudioNoAutoRead:
    'There is no recorded audio and this browser cannot read aloud; you can still read the text above.',

  authFailed: 'Could not sign in.',
  accountEyebrow: 'Visitor account',
  welcomeBack: 'Welcome back',
  createAccount: 'Create an account',
  guestNote: 'You can keep exploring as a guest without logging in.',
  email: 'Email',
  password: 'Password',
  working: 'Working…',
  signUp: 'Sign up',
  noAccount: 'No account yet? Sign up',
  haveAccount: 'Already have an account? Log in',

  unknownDistance: 'Unknown',
  minutes: (count) => `${count} min`,
  categories: {
    children: 'Children',
    exhibit: 'Exhibit',
    garden: 'Garden',
    indoor: 'Indoor',
    interactive: 'Interactive',
    landmark: 'Meeting point',
    ride: 'Ride',
    show: 'Show',
    thrill_ride: 'Thrill ride',
  },
};

const DICTIONARIES: Record<SupportedLocale, UiText> = { vi, en };

export function uiText(locale: SupportedLocale): UiText {
  return DICTIONARIES[locale] ?? vi;
}

export const UI_LOCALE_STORAGE_KEY = 'damsen.visitor.uiLocale.v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** Remembered interface language, or null (storage blocked / nothing saved). */
export function readUiLocalePreference(
  storage?: StorageLike | null,
): SupportedLocale | null {
  try {
    const store =
      storage === undefined
        ? typeof window === 'undefined'
          ? null
          : window.localStorage
        : storage;
    const value = store?.getItem(UI_LOCALE_STORAGE_KEY);
    return value === 'vi' || value === 'en' ? value : null;
  } catch {
    return null;
  }
}

export function saveUiLocalePreference(
  locale: SupportedLocale,
  storage?: StorageLike | null,
): void {
  try {
    const store =
      storage === undefined
        ? typeof window === 'undefined'
          ? null
          : window.localStorage
        : storage;
    store?.setItem(UI_LOCALE_STORAGE_KEY, locale);
  } catch {
    // Blocked storage only loses the preference.
  }
}
