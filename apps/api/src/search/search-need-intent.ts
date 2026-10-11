import { normalizeSearchText } from './search-text.js';

/**
 * Need intents: what a visitor asks for in plain words ("tôi muốn đi về", "đi tắm", "I am
 * hungry", "toilet") rather than a place name. The text search only matches words, and with
 * diacritics removed "về" looks like "vệ" and "vé", so these queries are answered from a short,
 * curated table: each need lists the phrases that mean it and the places that satisfy it.
 *
 * Words that are neither the need nor filler ("nhà hàng Hương Sen" → "hương sen") are left to
 * the search: if they name a place, that place comes first; if they match nothing they are
 * noise and the need still applies. Phrases are written with diacritics for reading and
 * normalised at load.
 */
export interface NeedIntent {
  id: string;
  /** The places that satisfy the need, in the order shown when the position is unknown. */
  slugs?: readonly string[];
  slugPrefixes?: readonly string[];
  categories?: readonly string[];
  /** With a position, the nearest place comes first. */
  nearest: boolean;
  /**
   * Why these places answer the need, shown instead of the place's own short description
   * ("Gần Đu quay đứng có cây ATM để rút tiền"), so the visitor knows why they are sent there.
   */
  note?: { vi: string; en: string };
  /** The query says "near/next to": a named place in it is the place to measure from. */
  near?: boolean;
  /** The query without filler words (diacritics removed): equals a place's name when it is one. */
  core?: string;
  /**
   * Words of the query that are neither the need nor filler ("nhà hàng Hương Sen" → "huong
   * sen"). The search decides whether they name a place or are just noise.
   */
  residual?: string;
}

interface NeedRule extends NeedIntent {
  phrases: readonly string[];
}

const GATES = [
  'p01-cong-so-1-duong-lac-long-quan',
  'p02-cong-so-1a-duong-hoa-binh',
  'p16-cong-so-2-nha-hang-thuy-ta',
];

// prettier-ignore
const RULES: readonly NeedRule[] = [
  {
    id: 'go-home',
    nearest: true,
    slugs: GATES,
    phrases: [
      'đi về', 'ra về', 'muốn về', 'về nhà', 'về', 'lối ra', 'cổng ra', 'đường ra', 'ra khỏi công viên',
      'ra cổng', 'cổng', 'các cổng', 'tìm cổng', 'hết giờ chơi', 'exit', 'gate', 'gates', 'way out',
      'go home', 'leave the park', 'leave', 'đi ra', 'thoát', 'cổng chính', 'main gate',
      'ra ngoài', 'muốn ra ngoài', 'thoát ra', 'về lấy xe', 'ra đường', 'cổng 1', 'cổng 1a', 'cổng 2', 'cổng một', 'cổng hai', 'gate 1', 'gate 2',
      'an exit', 'the exit', 'where is the exit',
    ],
  },
  {
    id: 'water-park',
    nearest: false,
    slugs: ['new-cong-lien-thong'],
    phrases: [
      'đi tắm', 'tắm', 'đi bơi', 'bơi', 'bơi lội', 'hồ bơi', 'công viên nước', 'đầm sen nước',
      'chơi nước', 'trượt nước', 'cổng liên thông', 'qua công viên nước', 'sang đầm sen nước',
      'water park', 'waterpark', 'swim', 'swimming', 'swimming pool', 'pool', 'slides pool',
      'connecting gate', 'go to the water park',
      'qua khu nước', 'sang khu nước', 'khu nước', 'quay lại khu khô', 'về đầm sen khô', 'khu khô', 'đã đi khu nước', 'chơi nước ở đầm sen nước', 'cầu trượt nước', 'tắm hồ', 'tắm công viên', 'tắm đầm sen',
    ],
  },
  {
    id: 'atm',
    nearest: false,
    slugs: ['p25-du-quay-dung'],
    note: {
      vi: 'Gần Đu quay đứng có cây ATM để rút tiền.',
      en: 'There is an ATM next to the Ferris wheel where you can withdraw cash.',
    },
    phrases: [
      'atm', 'cây atm', 'máy atm', 'trụ atm', 'rút tiền', 'rút tiền mặt', 'cây rút tiền', 'máy rút tiền', 'tiền mặt',
      'cần tiền mặt', 'hết tiền mặt', 'hết tiền', 'ngân hàng', 'cash', 'cash machine', 'cash point', 'cashpoint',
      'withdraw money', 'withdraw cash', 'bank', 'bank machine', 'i need cash',
    ],
  },
  {
    id: 'lockers',
    nearest: false,
    slugs: ['p04-khu-tro-choi-cam-giac-manh'],
    note: {
      vi: 'Khu trò chơi cảm giác mạnh có dịch vụ gửi đồ.',
      en: 'The Thrill Rides area has a bag-storage service.',
    },
    phrases: [
      'tủ gửi đồ', 'gửi đồ', 'tủ đồ', 'tủ khóa', 'gửi hành lý', 'hành lý', 'gửi túi', 'gửi balo', 'gửi ba lô',
      'locker', 'lockers', 'luggage', 'bag storage', 'left luggage', 'store my bag', 'cloakroom',
    ],
  },
  {
    id: 'wheelchair-rental',
    nearest: true,
    slugs: ['p12-nha-ga-monorail-1-nha-hang-de-men', 'p31-nha-ga-monorail-2'],
    note: {
      vi: 'Gần nhà ga Monorail có chỗ cho thuê xe lăn.',
      en: 'Next to the Monorail station you can rent a wheelchair.',
    },
    phrases: [
      'thuê xe lăn', 'mượn xe lăn', 'xe lăn thuê', 'cho thuê xe lăn', 'xe lăn cho thuê', 'cần xe lăn', 'thuê xe đẩy',
      'rent a wheelchair', 'wheelchair rental', 'borrow a wheelchair', 'wheelchair hire',
    ],
  },
  {
    id: 'raincoat',
    nearest: true,
    slugs: ['p12-nha-ga-monorail-1-nha-hang-de-men', 'p31-nha-ga-monorail-2'],
    note: {
      vi: 'Gần nhà ga Monorail có bán áo mưa.',
      en: 'Raincoats are sold next to the Monorail station.',
    },
    phrases: [
      'áo mưa', 'mua áo mưa', 'mượn áo mưa', 'cần áo mưa', 'ô dù', 'mua ô', 'raincoat', 'rain coat', 'poncho',
      'umbrella', 'buy a raincoat',
    ],
  },
  {
    id: 'charging',
    nearest: true,
    slugs: ['p12-nha-ga-monorail-1-nha-hang-de-men', 'p31-nha-ga-monorail-2'],
    note: {
      vi: 'Gần nhà ga Monorail có trạm sạc.',
      en: 'There is a charging point next to the Monorail station.',
    },
    phrases: [
      'trạm sạc', 'trạm sạc xe điện', 'sạc xe điện', 'sạc ô tô điện', 'sạc xe', 'sạc pin', 'chỗ sạc', 'charging station',
      'charging point', 'charge my car', 'ev charging', 'charger',
    ],
  },
  {
    id: 'drinking-water',
    nearest: true,
    slugs: ['p12-nha-ga-monorail-1-nha-hang-de-men', 'p31-nha-ga-monorail-2', 'new-cafe-windy', 'p06-tiem-ca-phe-sai-gon', 'p08-ca-phe-vuon-da-dam-sen'],
    note: {
      vi: 'Mua nước uống tại nhà ga Monorail hoặc quán cà phê gần đó.',
      en: 'Buy drinking water at the Monorail station or a nearby café.',
    },
    phrases: [
      'vòi nước uống', 'vòi nước uống miễn phí', 'vòi uống nước', 'nước uống miễn phí', 'uống nước miễn phí', 'trạm nước uống',
      'nước lọc', 'nước suối', 'refill', 'refill water', 'drinking fountain', 'drinking water', 'water fountain',
      'free water', 'water refill',
    ],
  },
  {
    id: 'wash-tap',
    nearest: true,
    categories: ['restroom'],
    note: {
      vi: 'Có vòi nước để rửa chân, rửa tay ở nhà vệ sinh.',
      en: 'Taps for washing your feet or hands are in the restrooms.',
    },
    phrases: [
      'vòi nước', 'vòi nước rửa chân', 'vòi rửa chân', 'rửa chân', 'vòi rửa', 'vòi nước rửa', 'rửa', 'tắm chân',
      'rửa bùn', 'rửa cát', 'rửa người', 'tap', 'water tap', 'faucet', 'foot wash', 'wash my feet', 'wash feet',
      'shower', 'rinse',
    ],
  },
  {
    id: 'high-view',
    nearest: false,
    slugs: [
      'new-dao-than-tai',
      'p25-du-quay-dung',
      'p12-nha-ga-monorail-1-nha-hang-de-men',
      'p31-nha-ga-monorail-2',
    ],
    phrases: [
      'ngắm cảnh trên cao', 'ngắm cảnh', 'trên cao', 'view đẹp', 'góc nhìn', 'góc nhìn toàn công viên',
      'nhìn từ trên cao', 'điểm cao', 'đu quay', 'vòng quay', 'view', 'viewpoint', 'view from above',
      'scenic view', 'panorama', 'ferris wheel', 'see the whole park', 'đảo thần kỳ', 'toàn cảnh', 'view toàn cảnh', 'cảnh đẹp', 'ngắm cảnh đẹp',
    ],
  },
  {
    id: 'thrill',
    nearest: false,
    categories: ['thrill_ride'],
    phrases: [
      'cảm giác mạnh', 'trò chơi cảm giác mạnh', 'mạo hiểm', 'hồi hộp', 'kích thích', 'xoay vòng', 'trò mạnh', 'mạnh nhất', 'mạnh', 'adrenaline', 'thrill', 'thrills', 'thrill rides', 'extreme',
      'roller coaster', 'scary rides', 'fast rides', 'spinning ride', 'trò chơi mạnh', 'chơi mạnh',
    ],
  },
  {
    id: 'kids',
    nearest: false,
    slugs: [
      'p11-khu-tro-choi-thieu-nhi',
      'p13-kids-playground',
      'p09-vong-luon-tuoi-tho',
      'p14-san-khau-de-men',
      'svc-food-5',
    ],
    phrases: [
      'cho bé', 'cho trẻ em', 'trẻ em', 'trẻ nhỏ', 'con nhỏ', 'đi với con nhỏ', 'đi với con', 'cho con', 'con tôi', 'tuổi',
      'khu vui chơi thiếu nhi', 'vui chơi thiếu nhi', 'bé chơi gì', 'gia đình có trẻ nhỏ', 'sân chơi',
      'khu trẻ em', 'em bé', 'kids', 'children', 'child', 'playground', 'toddler', 'with a toddler',
      'baby', 'baby friendly', 'family with small children', 'kids area',
      'gia đình', 'cả gia đình', 'cả nhà', 'bé 1m2', 'chiều cao trẻ em', 'cùng trẻ', 'xiếc trẻ em', 'đi cùng trẻ',
    ],
  },
  {
    id: 'toilet-accessible',
    nearest: true,
    slugPrefixes: ['svc-wc-access-'],
    phrases: [
      'nhà vệ sinh cho người khuyết tật', 'nhà vệ sinh người khuyết tật', 'vệ sinh khuyết tật',
      'toilet người khuyết tật', 'nhà vệ sinh xe lăn', 'lối cho người khuyết tật',
      'nhà vệ sinh cho người đi xe lăn', 'nhà vệ sinh dành cho người già', 'nhà vệ sinh khuyết tật',
      'vệ sinh xe lăn', 'accessible toilet', 'disabled toilet', 'wheelchair restroom',
      'wheelchair toilet', 'handicap restroom', 'accessible bathroom', 'accessible restroom',
      'accessible wc',
      'xe lăn', 'khuyết tật', 'ít bậc', 'không cầu thang', 'đi lại khó', 'xe đẩy em bé', 'xe đẩy', 'wc hỗ trợ', 'nhà vệ sinh hỗ trợ', 'wc xe lăn', 'wc khuyết tật', 'wc accessible', 'hỗ trợ xe lăn', 'ký hiệu xe lăn', 'lối không có bậc', 'wheelchair', 'disabled',
    ],
  },
  {
    id: 'toilet',
    nearest: true,
    categories: ['restroom'],
    phrases: [
      'nhà vệ sinh', 'đi vệ sinh', 'phòng vệ sinh', 'vệ sinh', 'toilet', 'toilets', 'wc', 'toalet',
      'restroom', 'restrooms', 'bathroom', 'public toilet', 'đi toilet', 'nhà wc', 'cần đi vệ sinh',
      'i need the bathroom',
      'nvs', 'mắc tiểu', 'đi tè', 'tè', 'rửa tay', 'rửa mặt', 'bồn rửa', 'thay đồ', 'thay quần áo', 'tắm rửa', 'thay tã', 'bàn thay tã', 'baby changing', 'wc đang mở', 'nhà vệ sinh đang mở', 'toilet nearby', 'vệ sinh gần tôi', 'vệ sinh sau trò chơi', 'cần chỗ thay đồ',
    ],
  },
  {
    id: 'food',
    nearest: true,
    categories: ['food'],
    phrases: [
      'đói', 'tôi đói', 'ăn', 'ăn uống', 'ăn trưa', 'ăn cơm', 'ăn gì', 'ăn nhẹ', 'nhà hàng', 'quán ăn',
      'chỗ ăn', 'đồ ăn', 'món ngon', 'ẩm thực', 'khu ăn uống', 'restaurant', 'restaurants', 'food',
      'hungry', 'i am hungry', 'lunch', 'dinner', 'where to eat', 'snack', 'snacks', 'food court',
      'dining', 'eat', 'something to eat',
      'ăn bữa chính', 'đồ ăn nhanh', 'ăn vặt', 'kem', 'ice cream', 'mua kem', 'ăn chay', 'món chay', 'vegetarian', 'vừa túi tiền', 'ăn rẻ', 'giá mềm', 'tiết kiệm', 'dị ứng hải sản', 'không hải sản', 'ăn nhóm', 'gia đình đông người', 'đoàn học sinh', 'ăn view hồ', 'ăn ngắm nước', 'nhà hàng ven hồ', 'ăn gần', 'quán ăn gần tôi', 'nhà hàng gần nhất', 'ăn rồi', 'nhà hàng cho cả nhóm',
    ],
  },
  {
    id: 'coffee-drink',
    nearest: true,
    categories: ['food'],
    slugs: [
      'new-cafe-windy',
      'p06-tiem-ca-phe-sai-gon',
      'p08-ca-phe-vuon-da-dam-sen',
      'svc-food-2',
      'svc-food-7',
    ],
    phrases: [
      'cà phê', 'cafe', 'quán cà phê', 'uống nước', 'khát', 'khát nước', 'giải khát', 'trà',
      'nước giải khát', 'uống cà phê', 'coffee', 'coffee shop', 'drink', 'drinks', 'thirsty', 'tea',
      'something to drink',
      'cf', 'mua nước', 'nước ép', 'trà sữa', 'nước trái cây', 'nước uống', 'quán nước', 'quán mát', 'cafe làm việc', 'wifi', 'wi fi', 'sạc điện thoại', 'ổ điện', 'ít ồn', 'cafe view hồ', 'cafe gần hồ', 'cafe ven hồ', 'cafe nhìn hồ', 'cf nhìn hồ', 'ngắm hồ uống cafe', 'cafe sân vườn', 'cafe cây xanh', 'uống cà phê', 'cà phê gần', 'nhiều cây xanh',
      'mua nước uống', 'muốn mua nước uống', 'mua đồ uống', 'đồ uống', 'mua nước giải khát',
    ],
  },
  {
    id: 'rest',
    nearest: true,
    slugs: [
      'new-cafe-windy',
      'p06-tiem-ca-phe-sai-gon',
      'p08-ca-phe-vuon-da-dam-sen',
      'new-dao-than-tai',
      'svc-food-7',
      'p19-quang-truong-la-ma',
    ],
    phrases: [
      'nghỉ ngơi', 'mệt', 'tôi mệt', 'mệt rồi', 'chỗ ngồi nghỉ', 'nghỉ chân', 'chỗ mát', 'ngồi nghỉ',
      'thư giãn', 'yên tĩnh', 'chỗ nghỉ', 'nghỉ', 'rest', 'tired', 'i am tired', 'sit down', 'relax',
      'quiet place', 'take a break', 'break', 'shade',
      'ghế công viên', 'ngồi miễn phí', 'không mua nước', 'mỏi chân', 'ngồi một chút', 'nghỉ thôi', 'nghỉ mát', 'mệt chân',
    ],
  },
  {
    id: 'first-aid',
    nearest: true,
    slugs: ['svc-first-aid'],
    phrases: [
      'y tế', 'sơ cứu', 'trạm y tế', 'bị thương', 'bị ngã', 'chảy máu', 'cần bác sĩ', 'bác sĩ', 'cấp cứu',
      'thuốc', 'say nắng', 'đau bụng', 'đau đầu', 'ngất', 'first aid', 'medical', 'doctor', 'injured',
      'emergency', 'nurse', 'clinic', 'i need help', 'hurt', 'sick', 'ambulance',
      'chóng mặt', 'trầy chân', 'băng bó', 'khám', 'té ngã', 'mệt trong người', 'không khỏe', 'buồn nôn', 'chơi xong mệt', 'buồn nôn sau trò chơi', 'trạm sơ cứu', 'tai nạn', 'vết thương',
    ],
  },
  {
    id: 'security',
    nearest: true,
    slugs: ['svc-security', 'p03-quay-ve-van-phong-cong-vien'],
    phrases: [
      'bảo vệ', 'an ninh', 'mất đồ', 'mất ví', 'mất điện thoại', 'lạc con', 'con bị lạc', 'trẻ bị lạc',
      'bị lạc', 'tìm người', 'nhặt được đồ', 'báo công an', 'công an', 'phòng bảo vệ', 'thất lạc',
      'security', 'lost child', 'lost wallet', 'lost and found', 'help desk', 'police', 'missing item',
      'lost', 'guard',
      'thất lạc người thân', 'không thấy người thân', 'người đi cùng', 'tìm trẻ', 'đồ thất lạc', 'bàn giao đồ', 'đồ bỏ quên', 'đồ bỏ quên trò chơi', 'quên đồ', 'quên đồ trên tàu', 'gây rối', 'có người gây rối', 'đánh nhau', 'báo sự cố', 'sự cố', 'mất điện thoại', 'xin lại đồ',
    ],
  },
  {
    id: 'tickets',
    nearest: true,
    slugs: ['p03-quay-ve-van-phong-cong-vien', 'p17-quay-ve'],
    phrases: [
      'mua vé', 'quầy vé', 'vé', 'giá vé', 'đổi vé', 'văn phòng công viên', 'văn phòng', 'hỏi thông tin',
      'thông tin công viên', 'quầy thông tin', 'ticket', 'tickets', 'buy tickets', 'buy a ticket',
      'ticket counter', 'ticket price', 'information desk', 'park office', 'information',
      'nâng hạng vé', 'nâng vé', 'vé trọn gói', 'hỏi nhân viên', 'gặp nhân viên', 'nhân viên', 'trợ giúp', 'lạc đường', 'nhờ chỉ đường', 'không biết vị trí', 'đang ở đâu',  'cho bé bú', 'phòng mẹ và bé', 'nursing room',
    ],
  },
  {
    id: 'parking',
    nearest: true,
    categories: ['parking'],
    phrases: [
      'bãi đậu xe', 'gửi xe', 'lấy xe', 'chỗ để xe', 'bãi xe', 'đậu xe', 'đậu xe ở đâu', 'bãi giữ xe',
      'để xe', 'parking', 'car park', 'where to park', 'park my car', 'motorbike parking',
      'pick up my car', 'park',
      'đã gửi xe', 'gửi xe máy', 'gửi ô tô', 'quên bãi xe', 'không nhớ chỗ xe', 'gửi xe lúc vào', 'xe máy', 'ô tô',
    ],
  },
  {
    id: 'show',
    nearest: false,
    slugs: [
      'p41-san-khau-ngoi-sao',
      'p42-bieu-dien-nhac-nuoc',
      'p14-san-khau-de-men',
      'p50-rap-xiec-dam-sen',
    ],
    phrases: [
      'xem biểu diễn', 'biểu diễn', 'show', 'sân khấu', 'chương trình biểu diễn', 'nhạc nước', 'xiếc',
      'xem xiếc', 'xem ca nhạc', 'giải trí buổi tối', 'giải trí', 'performance', 'stage', 'circus',
      'music fountain', 'water show', 'live show', 'shows',
    ],
  },
  {
    id: 'cinema-indoor',
    nearest: false,
    slugs: [
      'p10-rap-phim-cinemax-dam-sen',
      'p18-dam-sen-plaza',
      'p27-bang-dang',
    ],
    phrases: [
      'xem phim', 'rạp phim', 'chiếu phim', 'cinemax', 'trốn nắng', 'chỗ mát có máy lạnh', 'tránh nắng',
      'chơi trong nhà', 'trời mưa chơi gì', 'trời mưa', 'tránh mưa', 'điều hòa', 'máy lạnh',
      'xem phim 4d', 'cinema', 'movie', 'movies', 'indoor', 'air conditioning', 'escape the heat',
      'rainy day', 'shelter from rain', 'rain',
    ],
  },
  {
    id: 'ice',
    nearest: false,
    slugs: ['p27-bang-dang'],
    phrases: [
      'băng đăng', 'lạnh', 'khu băng', 'tác phẩm băng', 'ice', 'trò chơi lạnh', 'ice lantern',
      'ice sculpture', 'cold place', 'ice hall',
    ],
  },
  {
    id: 'animals',
    nearest: false,
    slugs: [
      'p33-chuong-da-dieu-ngua-van-huou-cao-co',
      'p49-vuon-chim-thu-thien-nhien',
      'p36-thuy-cung',
      'p30-nha-trung-bay-tieu-ban-dong-thuc-vat',
    ],
    phrases: [
      'xem thú', 'động vật', 'con vật', 'hươu cao cổ', 'ngựa vằn', 'đà điểu', 'chim', 'vườn thú', 'thú',
      'thủy cung', 'cá', 'animals', 'animal', 'zoo', 'giraffe', 'zebra', 'ostrich', 'birds', 'bird',
      'aquarium', 'fish',
    ],
  },
  {
    id: 'dinosaur',
    nearest: false,
    slugs: ['p28-khu-vuon-khung-long'],
    phrases: [
      'khủng long', 'vườn khủng long', 'xem khủng long', 'khu khủng long', 'dinosaur', 'dinosaurs',
      'dinosaur garden', 'dino park',
    ],
  },
  {
    id: 'garden',
    nearest: false,
    categories: ['garden'],
    phrases: [
      'vườn', 'khu vườn', 'ngắm hoa', 'hoa', 'cây cảnh', 'cây', 'vườn nhật', 'xương rồng', 'vườn rau',
      'thượng uyển', 'đi dạo', 'dạo vườn', 'garden', 'gardens', 'flowers', 'flower', 'japanese garden',
      'cactus', 'plants', 'botanical', 'stroll',
    ],
  },
  {
    id: 'photo',
    nearest: false,
    slugs: [
      'new-dao-than-tai',
      'p19-quang-truong-la-ma',
      'p43-cau-cuu-khuc',
      'p35-vuon-nhat-ban',
      'p38-nam-tu-thuong-uyen',
      'p25-du-quay-dung',
      'p42-bieu-dien-nhac-nuoc',
    ],
    phrases: [
      'chụp ảnh', 'chụp hình', 'chụp hình đẹp', 'địa điểm chụp ảnh', 'check in', 'checkin', 'sống ảo',
      'góc sống ảo', 'chụp ảnh cưới', 'photo', 'photos', 'photo spot', 'take photos', 'instagram',
      'selfie', 'check-in spot', 'photography', 'scenic photos',
    ],
  },
  {
    id: 'romantic',
    nearest: false,
    slugs: [
      'p43-cau-cuu-khuc',
      'new-dao-than-tai',
      'p42-bieu-dien-nhac-nuoc',
      'p35-vuon-nhat-ban',
      'p38-nam-tu-thuong-uyen',
    ],
    phrases: [
      'hẹn hò', 'lãng mạn', 'đi với người yêu', 'đi dạo cặp đôi', 'cặp đôi', 'chỗ yên tĩnh ngắm hồ',
      'date', 'date spot', 'romantic', 'couple', 'honeymoon', 'quiet lakeside walk',
      'đi với người yêu', 'người yêu',
    ],
  },
  {
    id: 'souvenir',
    nearest: true,
    slugs: ['p29-quay-luu-niem-hoa-sen', 'p44-quay-luu-niem-khu-b'],
    phrases: [
      'mua quà', 'quà lưu niệm', 'lưu niệm', 'mua đồ lưu niệm', 'quà cho bạn bè', 'mua quà mang về',
      'quà', 'souvenir', 'souvenirs', 'gift shop', 'buy gifts', 'gift', 'gifts', 'keepsake',
      'souvenir shop',
    ],
  },
  {
    id: 'pedal-boat',
    nearest: false,
    slugs: ['p07-ben-thuyen'],
    phrases: [
      'đạp vịt', 'thuyền đạp vịt', 'thuyền đạp', 'thuyền vịt', 'đi thuyền', 'bến thuyền', 'thuyền', 'trò chơi nhẹ nhàng',
      'chơi nhẹ nhàng', 'trò nhẹ nhàng', 'nhóm nhỏ', 'pedalo', 'pedal boat', 'swan boat', 'boat ride', 'boat dock',
      'boat', 'boating', 'gentle ride', 'gentle rides', 'relaxing ride', 'ngắm hồ trên thuyền',
      'vui chơi nhẹ nhàng', 'vui chơi nhẹ', 'nhẹ nhàng', 'vui chơi êm', 'chơi nhẹ', 'trò chơi nhẹ',
    ],
  },
  {
    id: 'train-tour',
    nearest: true,
    slugs: ['p12-nha-ga-monorail-1-nha-hang-de-men', 'p31-nha-ga-monorail-2'],
    phrases: [
      'xe lửa', 'tàu hỏa', 'đi xe lửa', 'đi tàu', 'đi một vòng đầm sen', 'vòng đầm sen', 'một vòng đầm sen',
      'đi vòng quanh đầm sen', 'vòng quanh đầm sen', 'vòng quanh công viên', 'đi vòng quanh công viên',
      'đi một vòng công viên', 'một vòng công viên', 'đi du ngoạn', 'du ngoạn', 'du ngoạn công viên',
      'đi tham quan một vòng', 'tham quan một vòng', 'đi dạo bằng tàu', 'tàu một ray', 'tàu trên cao', 'monorail',
      'train', 'train ride', 'ride the train', 'tour the park', 'around the park', 'sightseeing', 'scenic tour',
      'sightseeing ride',
    ],
  },
  {
    id: 'getting-around',
    nearest: true,
    slugs: ['p05-tram-xe-trung-tam', 'p12-nha-ga-monorail-1-nha-hang-de-men', 'p31-nha-ga-monorail-2'],
    phrases: [
      'xe điện trong công viên', 'xe điện tham quan', 'trạm xe', 'monorail', 'tàu điện', 'tàu một ray', 'tàu trên cao',
      'đi lại trong công viên', 'mệt đi bộ', 'mỏi chân', 'shuttle', 'get around the park', 'bus station',
      'ga gần nhất', 'ga tàu', 'đoàn tàu cổ tích', 'tàu cổ tích', 'đỡ đi bộ', 'ngồi xe', 'phương tiện ngắm công viên', 'ngồi tàu ngắm cảnh', 'xe điện', 'ngắm công viên bằng xe',
    ],
  },
  {
    id: 'lake-walk',
    nearest: false,
    slugs: ['p43-cau-cuu-khuc', 'new-dao-than-tai'],
    phrases: [
      'vườn sen', 'đi bộ trên hồ', 'đi trên hồ', 'đường đi giữa hồ', 'đường giữa hồ', 'đi giữa hồ', 'đi bộ giữa hồ',
      'đường đi trên hồ', 'cầu giữa hồ', 'cầu ziczac', 'cầu cửu khúc', 'đường qua hồ', 'lối đi giữa hồ', 'hoa sen',
      'ngắm sen', 'lotus', 'lotus garden', 'lotus pond', 'walk on the lake', 'walkway over the lake',
      'path across the lake', 'bridge on the lake',
    ],
  },
  {
    id: 'lake',
    nearest: false,
    slugs: ['p43-cau-cuu-khuc', 'p07-ben-thuyen', 'svc-food-3'],
    phrases: [
      'đi dạo quanh hồ', 'quanh hồ', 'dạo hồ', 'ven hồ', 'đi bộ ngắm hồ', 'ngắm hồ', 'nhìn hồ', 'view hồ', 'ngắm nước',
        'đứng trên cầu', 'lake', 'around the lake', 'lakeside', 'lake view',
    ],
  },
  {
    id: 'roller-coaster',
    nearest: false,
    slugs: ['p46-tau-luon-sieu-toc'],
    phrases: ['tàu lượn siêu tốc', 'tàu lượn', 'roller coaster', 'rollercoaster', 'tàu lượn khu b'],
  },
  {
    id: 'spinning-train',
    nearest: false,
    slugs: ['p23-tau-xoay-cao-toc'],
    phrases: ['tàu xoay cao tốc', 'tàu xoay', 'spinning coaster', 'xoay cao tốc'],
  },
  {
    id: 'rapids',
    nearest: false,
    slugs: ['p24-vuot-thac'],
    phrases: ['vượt thác', 'tàu vượt thác', 'water flume', 'flume'],
  },
  {
    id: 'bull-arena',
    nearest: false,
    slugs: ['p32-dau-truong-bo-tot'],
    phrases: ['đấu bò tót', 'bò tót', 'đấu trường bò tót', 'bull', 'bullfight'],
  },
  {
    id: 'thrill-zone-rides',
    nearest: false,
    slugs: ['p04-khu-tro-choi-cam-giac-manh'],
    phrases: [
      'phượng hoàng bay', 'phoenix', 'thuyền đung đưa', 'cá chép nhào lộn', 'cá chép', 'nhào lộn', 'xe bay ảo tưởng',
      'xe bay', 'ảo tưởng', 'nhà hơi liên hoàn', 'nhà hơi', 'liên hoàn', 'nhún hơi',
    ],
  },
  {
    id: 'kids-zone-rides',
    nearest: false,
    slugs: ['p11-khu-tro-choi-thieu-nhi'],
    phrases: [
      'thảm bay', 'tháp xoay', 'hải cẩu vượt thác', 'hải cẩu', 'ếch nhảy', 'frog hop', 'xe lửa mini', 'tàu mini',
      'khủng long bay', 'siêu nhân robot', 'siêu nhân', 'robot', 'massage cá', 'cá rỉa chân', 'bé chơi thảm bay',
    ],
  },
  {
    id: 'alias-roman',
    nearest: false,
    slugs: ['p19-quang-truong-la-ma'],
    phrases: ['la mã', 'roman', 'roman square', 'kiến trúc cổ', 'kiến trúc la mã', 'đấu trường la mã'],
  },
  {
    id: 'alias-japanese',
    nearest: false,
    slugs: ['p35-vuon-nhat-ban'],
    phrases: ['nhật bản', 'japanese', 'zen garden', 'vườn nhật', 'phong cách nhật bản'],
  },
  {
    id: 'alias-windy',
    nearest: false,
    slugs: ['new-cafe-windy'],
    phrases: ['windy', 'win dy', 'cf windy', 'cafe windy', 'cà phê windy'],
  },
  {
    id: 'alias-stones',
    nearest: false,
    slugs: ['p08-ca-phe-vuon-da-dam-sen'],
    phrases: ['tảng đá', 'tảng đá đẹp', 'những tảng đá đẹp', 'vườn đá', 'quán có đá', 'cafe đá'],
  },
  {
    id: 'bumper',
    nearest: false,
    slugs: ['p15-xe-dien-dung-dai-duong', 'p26-xe-dien-dung-the-he-moi'],
    phrases: [
      'xe điện đụng', 'đụng xe', 'xe đụng', 'lái xe điện', 'bumper cars', 'bumper car', 'dodgem',
      'drive electric cars',
      'bumper', 'xe điện đụng đại dương', 'xe điện đụng thế hệ mới',
    ],
  },
  {
    id: 'meeting',
    nearest: true,
    slugs: [
      'p19-quang-truong-la-ma',
      'p20-dam-sen-square',
      'p37-quang-truong-vua-hung',
      'p40-quang-truong-au-lac',
    ],
    phrases: [
      'điểm hẹn', 'hẹn gặp', 'tập trung', 'quảng trường', 'chỗ hẹn nhóm', 'gặp bạn', 'meeting point',
      'meet friends', 'square', 'plaza', 'gather the group',
    ],
  },
  {
    id: 'scary',
    nearest: false,
    slugs: ['p45-lau-dai-kinh-di', 'p32-dau-truong-bo-tot'],
    phrases: [
      'kinh dị', 'lâu đài ma', 'sợ', 'trò chơi ma', 'hù doạ', 'bò tót', 'haunted', 'horror',
      'ghost house', 'scary castle', 'bull arena', 'scary',
      'nhà ma', 'hù dọa', 'kinh dị', 'haunted house',
    ],
  },
  {
    id: 'water-fun',
    nearest: false,
    slugs: ['p24-vuot-thac', 'new-truot-phao-tren-tham'],
    phrases: [
      'trò chơi nước', 'vượt thác', 'trượt phao', 'bị ướt', 'chơi nước mát', 'thác nước', 'water ride',
      'rapids', 'tube slide', 'get wet', 'cool off ride',
    ],
  },
  {
    id: 'free',
    nearest: false,
    slugs: [
      'p19-quang-truong-la-ma',
      'p34-vuon-xuong-rong',
      'p35-vuon-nhat-ban',
      'p38-nam-tu-thuong-uyen',
      'p43-cau-cuu-khuc',
    ],
    phrases: [
      'miễn phí', 'đi dạo miễn phí', 'không mất tiền', 'chỗ đi dạo', 'tham quan nhẹ nhàng', 'free',
      'free to visit', 'no ticket needed', 'easy walk',
    ],
  },
];

/** Words that carry no need: "tôi muốn", "gần nhất", "where is the". Compared without diacritics. */
const FILLERS = new Set(
  [
    'tôi',
    'mình',
    'em',
    'anh',
    'chị',
    'muốn',
    'cần',
    'tìm',
    'ở',
    'đâu',
    'nào',
    'gần',
    'nhất',
    'là',
    'có',
    'không',
    'cho',
    'để',
    'đến',
    'tới',
    'xin',
    'hỏi',
    'nhé',
    'ạ',
    'với',
    'một',
    'các',
    'những',
    'chỗ',
    'nơi',
    'gì',
    'đi',
    'thì',
    'của',
    'chỉ',
    'mua',
    'vui',
    'từ',
    'người',
    'nhóm',
    'quá',
    'rất',
    'lắm',
    'hơi',
    'thật',
    'luôn',
    'đây',
    'đó',
    'kia',
    'vào',
    'bụng',
    'i',
    'me',
    'my',
    'we',
    'want',
    'to',
    'the',
    'a',
    'where',
    'is',
    'are',
    'nearest',
    'near',
    'closest',
    'find',
    'need',
    'go',
    'can',
    'for',
    'please',
    'how',
    'do',
    'get',
    'looking',
    'look',
    'show',
    'there',
    'any',
    'some',
    'what',
    'in',
    'at',
    'of',
    'am',
    'would',
    'like',
    'park',
    'here',
    'now',
  ].map(normalizeSearchText),
);

interface Word {
  /** Lower case with diacritics, as typed. */
  typed: string;
  /** Without diacritics: what the text search sees. */
  plain: string;
}

interface CompiledRule {
  rule: NeedRule;
  phrases: Word[][];
}

const words = (text: string): Word[] =>
  text
    .normalize('NFC')
    .toLocaleLowerCase('vi')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((typed) => ({ typed, plain: normalizeSearchText(typed) }))
    .filter((word) => word.plain !== '');

const COMPILED: readonly CompiledRule[] = RULES.map((rule) => ({
  rule,
  phrases: rule.phrases
    .map(words)
    .filter((phrase) => phrase.length > 0)
    .sort((left, right) => right.length - left.length),
}));

/**
 * A phrase word matches a query word without diacritics ("ve", "toi muon di ve"); a query word
 * typed WITH diacritics must match them too, so "vé" (ticket) is not read as "về" (go home).
 */
function sameWord(query: Word, phraseWord: Word): boolean {
  if (query.plain !== phraseWord.plain) return false;
  return query.typed === query.plain || query.typed === phraseWord.typed;
}

function findPhrase(query: readonly Word[], phrase: readonly Word[]): number {
  for (let start = 0; start + phrase.length <= query.length; start += 1) {
    if (
      phrase.every((word, offset) => sameWord(query[start + offset]!, word))
    ) {
      return start;
    }
  }
  return -1;
}

const PROXIMITY = new Set(
  [
    'gần',
    'cạnh',
    'kế',
    'near',
    'nearby',
    'around',
    'quanh',
    'next',
    'close',
  ].map(normalizeSearchText),
);

/**
 * The need a query expresses, or null. Every phrase of every need is looked for; a phrase inside
 * a longer one is dropped ("xe điện" inside "xe điện đụng đại dương", "đi về" inside "đi vệ
 * sinh"); of what is left the one said first wins ("bãi xe gần cổng 2" is parking, near gate 2,
 * "WC gần Đu quay đứng" a toilet near the wheel), the longer phrase on a tie. What is neither the
 * need nor filler is handed back as `residual`.
 */
export function matchNeedIntent(query: string): NeedIntent | null {
  const tokens = words(query);
  if (tokens.length === 0) return null;
  interface Hit {
    compiled: CompiledRule;
    start: number;
    length: number;
  }
  const hits: Hit[] = [];
  for (const compiled of COMPILED) {
    for (const phrase of compiled.phrases) {
      const start = findPhrase(tokens, phrase);
      if (start >= 0) hits.push({ compiled, start, length: phrase.length });
    }
  }
  const maximal = hits.filter(
    (hit) =>
      !hits.some(
        (other) =>
          other !== hit &&
          other.start <= hit.start &&
          other.start + other.length >= hit.start + hit.length &&
          other.length > hit.length,
      ),
  );
  if (maximal.length === 0) return null;
  const best = [...maximal].sort(
    (left, right) => left.start - right.start || right.length - left.length,
  )[0]!;
  // Take every phrase of the winning need out of the query; what is left must be filler.
  const left = [...tokens];
  for (const phrase of best.compiled.phrases) {
    for (;;) {
      const at = findPhrase(left, phrase);
      if (at < 0) break;
      left.splice(at, phrase.length);
    }
  }
  const informative = (token: Word) =>
    !FILLERS.has(token.plain) && !/^\d+$/.test(token.plain);
  const residual = left
    .filter(informative)
    .map((token) => token.plain)
    .join(' ');
  const { id, slugs, slugPrefixes, categories, nearest, note } =
    best.compiled.rule;
  return {
    id,
    ...(note ? { note } : {}),
    slugs,
    slugPrefixes,
    categories,
    nearest,
    near: tokens.some((token) => PROXIMITY.has(token.plain)),
    // The query without filler: when it is a place's name the name search answers.
    core: tokens
      .filter((token) => !FILLERS.has(token.plain))
      .map((token) => token.plain)
      .join(' '),
    ...(residual ? { residual } : {}),
  };
}

/**
 * A query that is just a map number: "POI 21", "chỉ đường đến POI 11.1", "số 5". Returns the
 * number as written ("21", "11"), or null. Sub-numbers (11.1) lead to their place (11).
 */
export function parsePoiNumber(query: string): string | null {
  const tokens = normalizeSearchText(query.replace(/(\d)\.(\d)/g, '$1 $2'))
    .split(' ')
    .filter(Boolean);
  const numbers = tokens.filter((token) => /^\d+$/.test(token));
  const rest = tokens.filter((token) => !/^\d+$/.test(token));
  if (numbers.length === 0 || numbers.length > 2) return null;
  const allowed = new Set([
    'chi',
    'duong',
    'den',
    'toi',
    'di',
    'poi',
    'so',
    'diem',
    'tim',
    'dan',
    'xem',
    'muon',
    'o',
    'dau',
  ]);
  if (!rest.every((token) => allowed.has(token))) return null;
  const number = Number(numbers[0]);
  return number >= 1 && number <= 50 ? String(number) : null;
}

export function needMatchesPlace(
  need: NeedIntent,
  place: { slug: string; category: string },
): boolean {
  return (
    (need.slugs?.includes(place.slug) ?? false) ||
    (need.slugPrefixes?.some((prefix) => place.slug.startsWith(prefix)) ??
      false) ||
    (need.categories?.includes(place.category) ?? false)
  );
}

/** Position of a place in the need's own list (listed slugs first, in order). */
export function needOrder(need: NeedIntent, slug: string): number {
  const index = need.slugs?.indexOf(slug) ?? -1;
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}
