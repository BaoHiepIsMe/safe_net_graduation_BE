# Prompt: Flutter theo mô hình vai trò và phân quyền mới

Chạy **sau khi** backend đã xong (xem `roles-and-permissions-implementation-prompt.md`)
và `docs/flutter-integration-contract.md` đã cập nhật. Dán nguyên văn phần dưới
đường kẻ cho agent làm Flutter, mở ở thư mục gốc `safe_net/`.

---

Bạn đang làm việc trong app Flutter SafeNet (thư mục `safe_net/`, backend nằm ở
`safe_net/backend/`). Nhiệm vụ: chuyển app sang mô hình vai trò mới.

## Đọc trước khi sửa

1. `AGENTS.md` ở thư mục gốc (Clean Architecture, Cubit, routing, design system,
   validation). Tuân thủ tuyệt đối.
2. `backend/docs/roles-and-permissions.md`: **nguồn sự thật** cho hành vi.
3. `backend/docs/flutter-integration-contract.md` và Swagger `/api/docs`: nguồn
   sự thật cho request/response. Không đoán field; field nào chưa có trong
   contract thì dừng lại và hỏi.

## Điều kiện trước khi bắt đầu

- `git status` sạch (hoặc chỉ có thay đổi thuộc nhiệm vụ này); nếu không, dừng
  và báo người dùng. Làm trên nhánh mới.
- Backend đã có: cờ thành viên mới, `uiMode`, xem trước mã, yêu cầu xin vào,
  duyệt/từ chối/hủy. Nếu chưa có, dừng lại.

## Hiện trạng cần thay (đã khảo sát)

- `FamilyRole` enum và `isManager => role == FamilyRole.manager` trong
  `lib/features/family/domain/entities/family_entities.dart`.
- Chỗ dùng `isManager`/`FamilyRole`: `family_cubit.dart`,
  `add_family_member_screen.dart`, `family_members_screen.dart`,
  `family_settings_screen.dart` (lọc người nhận chuyển chủ nhóm theo
  adult/manager), `member_detail_screen.dart` (đổi `role`),
  `location/.../family_map_screen.dart` (bộ lọc children/elders),
  `location/.../member_pin.dart`, `safety/.../safe_zones_screen.dart`,
  `safety/.../safe_zone_editor_screen.dart`, `reminders/.../reminders_screen.dart`.
- `profiles.role` (`personal|parent|guardian`): `auth` (models, entities,
  datasource, repository, usecases, cubit, `register_screen.dart`),
  `profile` (models, entities, cubit, `profile_screen.dart` có map
  `'parent' => 'Phụ huynh'`).
- `join_family_screen.dart`: hiện vào nhóm ngay bằng mã.
- `ChildHomeScreen` có route `RoutePaths.childHome`.

Grep lại `role`, `FamilyRole`, `isManager`, `'parent'`, `'guardian'` trước khi
sửa để bắt chỗ còn sót.

## Việc cần làm

### 1. Data/domain

- Entity thành viên: bỏ `role`; thêm `isOwner`, `canManageCare`,
  `isCareRecipient`, `isMinor`, `isHired`, `careScopeMemberIds`. Model map đúng
  contract.
- Entity gia đình hiện tại: thay `isManager` bằng các getter rõ nghĩa của
  membership của chính user: `canManageCare`, `isOwner`, `isHired`,
  `canAdminister` (= `canManageCare && !isHired` hoặc `isOwner`).
- Hàm dùng chung `canManage(me, target)` theo công thức mục 3 tài liệu (chỉ để
  ẩn/hiện UI; backend vẫn là nơi quyết định).
- Profile/auth: bỏ `role`, thêm `uiMode` (`kid|adult|assisted`).
- Nhãn quan hệ: thêm `husband, wife, brother, sister, grandchild`.

### 2. Đăng ký và giao diện

- `register_screen.dart`: bỏ chọn role. Sau ngày sinh: nếu từ 18 tuổi, hỏi giao
  diện "Tiêu chuẩn" / "Chữ to, dễ dùng" (chọn sẵn "Chữ to" khi từ 60); dưới 18
  không hỏi.
- Hồ sơ: thay hiển thị role bằng cài đặt "Giao diện" (người dưới 13 không đổi được).
- Routing sau đăng nhập: `uiMode == kid` → `ChildHomeScreen`. `assisted` → home
  hiện có với cỡ chữ lớn (dùng theme/text scale của design system). **Không tự
  thiết kế màn hình hỗ trợ mới**; nếu cần màn riêng, ghi vào báo cáo cuối.
- Tài khoản cũ chưa có ngày sinh: chặn tạo nhóm/nhận lời mời/xin vào bằng mã,
  hiện màn nhập ngày sinh trước.

### 3. Hiển thị vai trò

- Chip chữ, không icon thay chữ: "Chủ nhóm", "Quản lý", "Được chăm sóc",
  "Người chăm sóc" (người thuê). Thành viên thường chỉ hiện nhãn quan hệ. Một
  người có thể có nhiều chip, ví dụ "Ba · Chủ nhóm · Quản lý".
- Chuỗi đặt trong `family_texts.dart` (hoặc nơi chứa text của feature).
- Bản đồ: bộ lọc theo role cũ đổi thành "Được chăm sóc" / "Tất cả".

### 4. Ẩn/hiện chức năng theo quyền

- Vùng an toàn, nhắc nhở, luật điện thoại, lịch sử vị trí, báo cáo: chỉ hiện khi
  `canManage(me, target)`. Luật điện thoại chỉ cho `target.isMinor`.
- Người thuê: danh sách mục tiêu chỉ gồm người trong `careScopeMemberIds`; ẩn
  mời, xóa, cấp quyền, camera.
- Người Được chăm sóc: ẩn công tắc tắt chia sẻ vị trí của chính mình; hiện dòng
  "Đang chia sẻ vị trí với <tên nhóm>".

### 5. Mời thành viên (`add_family_member_screen.dart`)

- Email/SĐT, chip nhãn quan hệ.
- Ô "Cho quyền quản lý": tick sẵn với `father|mother|husband|wife`.
- "Cần được chăm sóc" có 3 lựa chọn: "Tự động theo tuổi" (mặc định, không gửi
  field; backend đặt khi người được mời từ 60), "Có", "Không". Nhãn
  `grandfather|grandmother` chọn sẵn "Có". Ghi chú nhỏ: "Dưới 18 tuổi luôn được
  chăm sóc."
- Nhãn "Người chăm sóc" → hiện "Chăm sóc cho:" chọn người Được chăm sóc (chọn sẵn
  nếu nhóm chỉ có 1 người); bắt buộc chọn ít nhất 1.
- Tách form thành widget dùng lại cho màn duyệt yêu cầu (mục 7).

### 6. Vào nhóm bằng mã (`join_family_screen.dart`)

Luồng mới, thay cho vào ngay:

1. Nhập mã → gọi xem trước → hiện thẻ nhóm: tên + ảnh nhóm, **tên + ảnh Chủ
   nhóm**, số thành viên. Mã sai/hết hạn → thông báo lỗi rõ ràng.
2. Chọn nhãn quan hệ (và tên hiển thị) → hiện đoạn đồng ý: "Nếu bạn được đánh
   dấu Cần được chăm sóc, Quản lý sẽ thấy vị trí, đặt vùng an toàn, nhắc nhở. SOS
   và té ngã gửi cho cả nhà." → nút "Gửi yêu cầu".
3. Màn chờ: "Đang chờ <tên Chủ nhóm> duyệt", nút "Hủy yêu cầu". Mở lại app vẫn
   thấy yêu cầu đang chờ (lấy từ API "yêu cầu của tôi").
4. Nhận thông báo duyệt → vào nhóm; bị từ chối → báo và quay về màn trống.

### 7. Duyệt yêu cầu (người có `canAdminister`)

- Mục "Yêu cầu tham gia" trên màn thành viên, có số đếm.
- Mở một yêu cầu → form như mời (mục 5), tick sẵn theo `isMinor`/gợi ý từ 60 →
  "Chấp nhận" / "Từ chối".
- Thông báo đẩy loại "yêu cầu tham gia" mở thẳng màn duyệt.

### 8. Chi tiết thành viên (`member_detail_screen.dart`)

Thay dropdown role bằng các công tắc, chỉ hiện cho người được phép (bảng mục 7
tài liệu):

- "Quản lý" (cấp: `canAdminister`; thu: Chủ nhóm; tự thôi: chính mình, trừ Chủ nhóm).
- "Cần được chăm sóc" (người lớn; `canAdminister`; không áp cho chính mình).
- "Chăm sóc cho" (người thuê).
- "Chuyển chủ nhóm" (Chủ nhóm; người nhận là người lớn; cảnh báo nếu là người
  thuê). Bỏ lọc adult/manager cũ trong `family_settings_screen.dart`.
- Xóa khỏi nhóm theo đúng quyền (Chủ nhóm là người thuê không xóa được người
  Được chăm sóc).

### 9. Banner chuyển giao

Khi user là Chủ nhóm với nhãn khác `father|mother`, và trong nhóm có Quản lý
nhãn `father|mother` vừa vào: banner "Chuyển chủ nhóm cho <tên>?" với 3 nút
"Chuyển, thôi quản lý" / "Chuyển, vẫn cùng quản lý" / "Để sau". "Để sau" nhớ
theo nhóm trên máy (lưu cục bộ, không phải backend).

### 10. Rời nhóm

- Người dưới 18: ẩn nút rời.
- Chủ nhóm: yêu cầu chuyển chủ nhóm trước.
- Người Được chăm sóc: xác nhận 2 lần, câu chữ nói rõ Quản lý sẽ được báo ngay.

### 11. Thông báo

Xử lý các loại thông báo mới theo contract (yêu cầu tham gia, kết quả duyệt,
thay đổi quyền, người Được chăm sóc rời nhóm): hiển thị và điều hướng khi bấm.

## Không làm

- Không thêm quyền chi tiết ngoài contract.
- Không đổi backend.
- Không thiết kế lại các màn ngoài phạm vi trên.

## Hoàn thành khi

- `dart format` các file đã sửa, `flutter analyze` sạch, `flutter test` các test
  liên quan qua (thêm test cho `canManage`, model mapping, cubit join/duyệt).
- Không còn `FamilyRole`, `isManager`, `'parent'`, `'guardian'` trong `lib/`.
- Báo cáo: màn đã đổi, luồng đã thử tay (nếu có), phần chưa làm (ví dụ màn hỗ
  trợ riêng cho `assisted`).
