import type { SupportedLocale } from '@damsen/shared-types';

/** Interface languages (ADR 0006): the shared POI content locales. */
export type UiLocale = SupportedLocale;

/** Locale to request POI content with. */
export function contentLocale(locale: UiLocale): SupportedLocale {
  return locale;
}

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
  mapKindLabel: string;
  mapOld: string;
  mapNew: string;
  mapLabel: string;
  locateMe: string;
  subPlacesHeading: string;
  subPlaceCount(count: number): string;
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
  hidePanel: string;
  showPanel: string;
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
  controllerLabel: string;
  controllerHint: string;
  moveNorth: string;
  moveEast: string;
  moveSouth: string;
  moveWest: string;
  manualControlActive: string;
  controllerPathsLoading: string;

  // Narration playback
  autoplayBlocked: string;
  // Auto narration near a place
  autoGuideTitle: string;
  autoGuideHint: string;
  autoGuideEnable: string;
  autoGuideDisable: string;
  autoGuideWaiting: string;
  autoGuideNear: string;
  autoGuideNarrating: string;
  autoGuideNoNearby: string;
  autoGuideInaccurate(meters: number): string;
  autoGuideDenied: string;
  autoGuideArrived(name: string): string;
  zoneCardLabel: string;
  zoneHere: string;
  zoneTry: string;
  zoneTip: string;
  zoneClose: string;
  nextTitle(zone: string | null): string;
  nextQuestion: string;
  nextEat: string;
  nextToilet: string;
  nextRest: string;
  nextPlay: string;
  nextHome: string;
  nextGoing(name: string, meters: number): string;
  nextNone: string;
  nextResults(label: string): string;
  nextClear: string;
  notInPark: string;
  refreshNarration: string;
  refreshHint: string;
  refreshNothingHere: string;
  refreshNoPosition: string;
  autoGuideCount(count: number): string;
  autoGuideNearest(name: string, distance: string): string;
  autoGuideStale: string;
  heardCount(count: number): string;
  newVisit: string;
  newVisitConfirm: string;
  listenNarration: string;
  listenAgain: string;
  listeningNow: string;
  listened: string;
  pauseAudio: string;
  resumeAudio: string;
  stopAudio: string;
  tapToListen: string;
  playbackFailed: string;
  listenInLanguage(label: string): string;
  audioBarLabel: string;
  clusterLabel(count: number): string;
  clusterMenuLabel: string;
  cameraLabel: string;
  followMe: string;
  fullRoute: string;
  stopGuidance: string;
  rerouting: string;
  routeUpdated: string;
  audioBarState(
    state: 'loading' | 'playing' | 'paused' | 'blocked' | 'error',
    name: string,
  ): string;
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

  mapKindLabel: 'Kiểu bản đồ',
  mapOld: 'Cũ',
  mapNew: 'Mới',
  mapLabel: 'Bản đồ điểm khám phá',
  locateMe: '◎ Vị trí của tôi',
  subPlacesHeading: 'Bên trong khu này',
  subPlaceCount: (count) => `${count} trò chơi, điểm tham quan`,
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
  hidePanel: 'Thu gọn bảng bên trái',
  showPanel: 'Mở bảng tìm kiếm và địa điểm',
  walking: (percent) => `Đang đi · ${percent}%`,
  remaining: (distance) => `Còn ${distance}`,
  placedOnMap: 'Đã đặt trên bản đồ',
  noPosition: 'Chưa có vị trí',
  clickMap: 'Click lên bản đồ…',
  repositionWalker: 'Đặt lại vị trí',
  placeWalker: 'Đặt người trên bản đồ',
  progressLabel: 'Tiến độ di chuyển',
  walkAgain: 'Đi lại tuyến',
  startWalking: 'Bắt đầu đi',
  createRouteInCard: 'Tạo tuyến trong thẻ POI',
  choosePoi: 'Chọn một POI',
  clearSimulation: 'Xóa mô phỏng',
  controllerLabel: 'Bộ điều khiển người mô phỏng',
  controllerHint: 'Nút, phím mũi tên/WASD hoặc gamepad · luôn bám lối đi',
  moveNorth: 'Đi lên',
  moveEast: 'Đi sang phải',
  moveSouth: 'Đi xuống',
  moveWest: 'Đi sang trái',
  manualControlActive: 'Đang điều khiển người mô phỏng.',
  controllerPathsLoading: 'Lối đi chưa sẵn sàng. Vui lòng thử lại.',

  autoplayBlocked: 'Trình duyệt chặn tự phát audio. Hãy bấm nút phát.',
  autoGuideTitle: 'Tự động thuyết minh',
  autoGuideHint:
    'Tự phát một bài thuyết minh khi bạn hoặc người mô phỏng đến gần POI. Hiển thị tối đa 2 POI gần nhất.',
  autoGuideEnable: 'Bật tự động',
  autoGuideDisable: 'Tắt tự động',
  autoGuideWaiting: 'Đang chờ vị trí của bạn…',
  autoGuideNear: 'Bạn đang ở gần',
  autoGuideNarrating: 'Đang tự thuyết minh',
  autoGuideNoNearby: 'Chưa có POI nào trong bán kính 50 m.',
  autoGuideInaccurate: (meters) =>
    `Tín hiệu GPS yếu (±${meters} m), đang chờ tín hiệu tốt hơn.`,
  autoGuideDenied:
    'Không lấy được vị trí. Hãy cho phép định vị (điện thoại cần HTTPS).',
  autoGuideArrived: (name) => `Bạn đang ở gần ${name} — đang phát thuyết minh.`,
  zoneCardLabel: 'Gợi ý cho khu này',
  zoneHere: 'Có gì',
  zoneTry: 'Nên thử',
  zoneTip: 'Lưu ý',
  zoneClose: 'Đóng',
  nextTitle: (zone) =>
    zone ? `Bạn đang ở ${zone}` : 'Bạn đang ở trong công viên',
  nextQuestion: 'Bạn muốn làm gì tiếp theo?',
  nextEat: 'Đi ăn',
  nextToilet: 'Nhà vệ sinh',
  nextRest: 'Nghỉ ngơi',
  nextPlay: 'Chơi tiếp',
  nextHome: 'Đi về',
  nextGoing: (name, meters) => `Đang dẫn bạn tới ${name} (cách ${meters} m).`,
  nextNone: 'Chưa tìm thấy địa điểm phù hợp gần bạn.',
  nextResults: (label) => `Gợi ý: ${label}`,
  nextClear: 'Xoá gợi ý',
  notInPark: 'Có vẻ bạn chưa ở trong công viên Đầm Sen.',
  refreshNarration: 'Làm mới thuyết minh',
  refreshHint:
    'Đứng gần một khu hoặc địa điểm mà chưa nghe thuyết minh? Bấm để phát ngay.',
  refreshNothingHere: 'Bạn chưa ở gần khu hay địa điểm nào để thuyết minh.',
  refreshNoPosition:
    'Chưa có vị trí của bạn: bật vị trí hoặc đặt người mô phỏng.',
  autoGuideCount: (count) =>
    `${count} địa điểm tự thuyết minh khi bạn đứng gần`,
  autoGuideNearest: (name, distance) => `Gần nhất: ${name} · ${distance}`,
  autoGuideStale: 'Chưa có vị trí mới, đang chờ…',
  heardCount: (count) => `Đã nghe ${count} điểm trong lượt này`,
  newVisit: 'Bắt đầu lượt tham quan mới',
  newVisitConfirm:
    'Xoá lịch sử đã nghe để các điểm được tự thuyết minh lại từ đầu?',
  listenNarration: 'Nghe thuyết minh',
  listenAgain: 'Nghe lại',
  listeningNow: 'Đang nghe',
  listened: 'Đã nghe',
  pauseAudio: 'Tạm dừng',
  resumeAudio: 'Tiếp tục',
  stopAudio: 'Dừng',
  tapToListen: 'Bấm để nghe',
  playbackFailed: 'Không phát được thuyết minh.',
  listenInLanguage: (label) => `Nghe bản ${label}`,
  audioBarLabel: 'Thuyết minh đang phát',
  clusterLabel: (count) => `${count} địa điểm gần nhau, bấm để xem`,
  clusterMenuLabel: 'Chọn địa điểm',
  cameraLabel: 'Bản đồ khi dẫn đường',
  followMe: 'Theo tôi',
  fullRoute: 'Toàn tuyến',
  stopGuidance: 'Dừng dẫn đường',
  rerouting: 'Bạn đã đi lệch tuyến, đang tính lại…',
  routeUpdated: 'Đã cập nhật tuyến mới từ vị trí của bạn.',
  audioBarState: (state, name) =>
    ({
      loading: `Đang tải: ${name}`,
      playing: `Đang nghe: ${name}`,
      paused: `Tạm dừng: ${name}`,
      blocked: `Bấm để nghe: ${name}`,
      error: `Lỗi phát: ${name}`,
    })[state],
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
    gate: 'Cổng',
    food: 'Ăn uống',
    restroom: 'Nhà vệ sinh',
    parking: 'Bãi đậu xe',
    first_aid: 'Y tế',
    security: 'Bảo vệ',
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

  mapKindLabel: 'Map style',
  mapOld: 'Old',
  mapNew: 'New',
  mapLabel: 'Map of places to explore',
  locateMe: '◎ My location',
  subPlacesHeading: 'Inside this area',
  subPlaceCount: (count) =>
    `${count} ${count === 1 ? 'attraction' : 'attractions'}`,
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
  hidePanel: 'Hide the side panel',
  showPanel: 'Show search and places',
  walking: (percent) => `Walking · ${percent}%`,
  remaining: (distance) => `${distance} left`,
  placedOnMap: 'Placed on the map',
  noPosition: 'No position yet',
  clickMap: 'Click the map…',
  repositionWalker: 'Reposition',
  placeWalker: 'Place walker on the map',
  progressLabel: 'Walking progress',
  walkAgain: 'Walk the route again',
  startWalking: 'Start walking',
  createRouteInCard: 'Create a route in the POI card',
  choosePoi: 'Choose a POI',
  clearSimulation: 'Clear simulation',
  controllerLabel: 'Simulated walker controller',
  controllerHint: 'Buttons, Arrow/WASD, or gamepad · stays on walkways',
  moveNorth: 'Move up',
  moveEast: 'Move right',
  moveSouth: 'Move down',
  moveWest: 'Move left',
  manualControlActive: 'Controlling the simulated walker.',
  controllerPathsLoading: 'Walkways are not ready yet. Please try again.',

  autoplayBlocked: 'The browser blocked autoplay. Press play.',
  autoGuideTitle: 'Auto narration',
  autoGuideHint:
    'Automatically plays one narration when you or the simulated walker approaches a POI. Shows at most the two nearest POIs.',
  autoGuideEnable: 'Turn on',
  autoGuideDisable: 'Turn off',
  autoGuideWaiting: 'Waiting for your location…',
  autoGuideNear: 'You are close',
  autoGuideNarrating: 'Playing automatically',
  autoGuideNoNearby: 'No POI is within 50 m yet.',
  autoGuideInaccurate: (meters) =>
    `Weak GPS signal (±${meters} m), waiting for a better fix.`,
  autoGuideDenied:
    'Could not get your location. Allow location access (phones need HTTPS).',
  autoGuideArrived: (name) => `You are near ${name} — playing the narration.`,
  zoneCardLabel: 'Tips for this area',
  zoneHere: "What's here",
  zoneTry: 'Worth trying',
  zoneTip: 'Good to know',
  zoneClose: 'Close',
  nextTitle: (zone) => (zone ? `You are in ${zone}` : 'You are in the park'),
  nextQuestion: 'What would you like to do next?',
  nextEat: 'Eat',
  nextToilet: 'Restroom',
  nextRest: 'Rest',
  nextPlay: 'Keep playing',
  nextHome: 'Head home',
  nextGoing: (name, meters) => `Guiding you to ${name} (${meters} m away).`,
  nextNone: 'No suitable place found near you.',
  nextResults: (label) => `Suggestions: ${label}`,
  nextClear: 'Clear',
  notInPark: 'You do not seem to be in Dam Sen park yet.',
  refreshNarration: 'Refresh narration',
  refreshHint:
    'Standing near an area or a place and hearing nothing? Tap to play it now.',
  refreshNothingHere: 'You are not near any area or place to narrate.',
  refreshNoPosition:
    'No position yet: turn on your location or place the simulated walker.',
  autoGuideCount: (count) =>
    `${count} places narrate by themselves when you stand near`,
  autoGuideNearest: (name, distance) => `Nearest: ${name} · ${distance}`,
  autoGuideStale: 'No fresh position yet, waiting…',
  heardCount: (count) => `Heard ${count} places on this visit`,
  newVisit: 'Start a new visit',
  newVisitConfirm:
    'Clear the listening history so places narrate again from the start?',
  listenNarration: 'Listen',
  listenAgain: 'Listen again',
  listeningNow: 'Listening',
  listened: 'Listened',
  pauseAudio: 'Pause',
  resumeAudio: 'Resume',
  stopAudio: 'Stop',
  tapToListen: 'Tap to listen',
  playbackFailed: 'The narration could not be played.',
  listenInLanguage: (label) => `Listen in ${label}`,
  audioBarLabel: 'Narration playing',
  clusterLabel: (count) => `${count} places close together, tap to see`,
  clusterMenuLabel: 'Choose a place',
  cameraLabel: 'Map while guiding',
  followMe: 'Follow me',
  fullRoute: 'Whole route',
  stopGuidance: 'Stop guidance',
  rerouting: 'You left the route, finding a new one…',
  routeUpdated: 'Route updated from where you are.',
  audioBarState: (state, name) =>
    ({
      loading: `Loading: ${name}`,
      playing: `Listening: ${name}`,
      paused: `Paused: ${name}`,
      blocked: `Tap to listen: ${name}`,
      error: `Playback failed: ${name}`,
    })[state],
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
    gate: 'Gate',
    food: 'Food & drink',
    restroom: 'Restroom',
    parking: 'Parking',
    first_aid: 'First aid',
    security: 'Security',
  },
};

const DICTIONARIES: Record<UiLocale, UiText> = { vi, en };

export function uiText(locale: UiLocale): UiText {
  return DICTIONARIES[locale] ?? vi;
}

export const UI_LOCALE_STORAGE_KEY = 'damsen.visitor.uiLocale.v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** Remembered interface language, or null (storage blocked / nothing saved). */
export function readUiLocalePreference(
  storage?: StorageLike | null,
): UiLocale | null {
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
  locale: UiLocale,
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
