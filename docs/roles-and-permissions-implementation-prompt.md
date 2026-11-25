# Prompt: triển khai mô hình vai trò và phân quyền mới

Dán nguyên văn phần dưới đường kẻ cho agent triển khai.

---

Bạn đang làm việc trong backend SafeNet (NestJS 11, Prisma, Supabase PostgreSQL).
Nhiệm vụ: thay mô hình vai trò cũ bằng mô hình trong `docs/roles-and-permissions.md`.

## Đọc trước khi sửa

1. `AGENTS.md` (hợp đồng kỹ thuật bắt buộc), `CLAUDE.md`.
2. `docs/roles-and-permissions.md`: **nguồn sự thật duy nhất** cho hành vi. Nếu
   code hiện tại hoặc prompt này mâu thuẫn với tài liệu đó, theo tài liệu; nếu
   tài liệu không nói rõ, dừng lại và hỏi, không tự đặt luật.
3. `docs/flutter-integration-contract.md`, `docs/technical-debt.md`.

## Điều kiện trước khi bắt đầu

- Chạy `git status`. Nếu cây làm việc còn thay đổi chưa commit không thuộc nhiệm
  vụ này, dừng lại và báo người dùng; không stash, không commit hộ.
- Làm trên nhánh mới từ nhánh người dùng chỉ định (ví dụ `feat/care-roles`).
- Không chạy `prisma migrate dev` vào DB dùng chung. Không chạy `0_init`. Viết
  migration SQL forward trong `prisma/migrations/`, rồi `npm run prisma:generate`.

## Hiện trạng cần thay (đã khảo sát)

Cột và ràng buộc:

- `profiles.role` + check `profiles_role_supported`
  (`20261110090000_profile_registration_role`), và trigger tạo profile khi
  signup đọc `raw_user_meta_data->>'role'`.
- `family_members.role` + check `family_members_role_supported`, trigger
  `assert_active_family_owner_manager` (`20260820040000_phase2_family_integrity`).
- SQL dùng role: `20260901090000_phase11_phone_management` (hàm kiểm tra
  `target_role <> 'child'`), `20260902120000_phase14_daily_status_reports`
  (`role IN ('child','elder')`).

Code dùng role (không tính spec):

- `src/common/constants/domain.constants.ts`
- `src/modules/families/`: `families.constants.ts` (`FAMILY_ROLES`,
  `INVITABLE_FAMILY_ROLES`, `deriveRoleFromLabel`), `dto/family.dto.ts`,
  `family-access.service.ts` (`requireManager`, `requireOwner`),
  `families.service.ts`, `families.repository.ts`, `families.swagger.ts`
- `src/modules/geofences/geofences.service.ts`, `geofences.repository.ts`
- `src/modules/reminders/reminders.repository.ts`
- `src/modules/phone-management/phone-management.repository.ts`
- `src/modules/daily-status/` (constants, repository, service)
- `src/modules/cameras/` (constants, repository, service)
- `src/modules/chat/chat.repository.ts`
- `src/modules/locations/` (repository, service, swagger)
- `src/modules/auth/` (dto, service, controller), `src/common/schemas/profile.schema.ts`,
  `src/common/swagger/api-docs.ts`, `src/modules/profiles/`

Trước mỗi pha, grep lại `role`, `'manager'`, `'child'`, `'elder'`, `'adult'`,
`requireManager` để bắt chỗ còn sót. Kiểm tra cả SOS, notifications, realtime
recipients.

## Thực hiện theo pha; mỗi pha phải qua `lint:check`, `typecheck`, `test`, `build`

### Pha 1: Migration bổ sung (không xóa cột cũ)

- Thêm cột theo mục 10 của tài liệu, bảng `family_member_care_scopes` (FK, PK
  ghép, ràng buộc cùng `family_id` bằng trigger), RLS/grant theo mẫu các bảng
  hiện có.
- Backfill theo bảng "Chuyển dữ liệu cũ".
- Sửa trigger chủ nhóm: chủ nhóm active phải là member `accepted` có
  `can_manage_care = true` (không dựa vào `role` nữa).
- Ràng buộc: người dưới 18 không có `can_manage_care` (trigger, dùng
  `profiles.date_of_birth`, ngày theo `Asia/Ho_Chi_Minh`).
- Sửa trigger signup: ghi `ui_mode` (tính theo tuổi nếu metadata không có),
  ngừng đọc `role`. Giữ `profiles.role` nullable, không còn bắt buộc.
- Thêm trạng thái membership `requested` (xin vào bằng mã): cập nhật check
  constraint/trigger liên quan `family_members.status`; `requested` không bao
  giờ cấp quyền truy cập (chỉ `accepted` mới có quyền, như hiện tại).
- Sửa hàm SQL phone management và daily status sang điều kiện mới
  (dưới 18 / `isCareRecipient`).
- Cập nhật `prisma/schema.prisma`, `npm run prisma:generate`, `npm run prisma:validate`.
- Thêm `*-migration.spec.ts` kiểm tra SQL (theo mẫu spec migration hiện có).

### Pha 2: Lõi phân quyền

- Helper tuổi dùng chung (một chỗ duy nhất): `isMinor`, tuổi theo
  `Asia/Ho_Chi_Minh`; thiếu ngày sinh ⇒ không phải minor.
- `FamilyAccessService`:
  - `requireAcceptedMember` (giữ).
  - `requireOwner` (theo `families.owner_user_id`).
  - `requireCareManager(userId, familyId)`: `can_manage_care`, kể cả người thuê.
  - `requireFamilyAdmin(userId, familyId)`: `can_manage_care` và không phải
    người thuê, hoặc là Chủ nhóm (dùng cho mời, xóa thành viên thường, cấp quyền,
    đổi cờ chăm sóc, đổi phạm vi).
  - `canManage(actorUserId, targetMemberId)` / `requireCanManage(...)` đúng công
    thức mục 3 của tài liệu.
  - `listManagersFor(targetMemberId)`: người nhận cảnh báo vùng an toàn/nhắc nhở.
- Bỏ `requireManager`; thay ở mọi nơi gọi.
- Unit test đủ các nhánh: không phải Quản lý, tự nhắm chính mình, mục tiêu không
  được chăm sóc, người thuê ngoài/trong phạm vi, người thuê là Chủ nhóm, mục tiêu
  dưới 18, thiếu ngày sinh, membership `pending/removed`, nhóm `archived`.

### Pha 3: Module families

- DTO mời: bỏ `role`; thêm `canManageCare?`, `isCareRecipient?`,
  `careScopeMemberIds?` (bắt buộc khi nhãn `caregiver`). Nhãn mới:
  `husband, wife, brother, sister, grandchild`.
- `isCareRecipient` trong lời mời có 3 trạng thái: không gửi (lưu `NULL`/cờ
  "auto" trên lời mời) → khi nhận lời đặt `true` nếu từ 60 tuổi; `true`/`false`
  → dùng đúng giá trị.
- Nhận lời mời: áp lại cờ theo tuổi thật; từ chối khi thiếu ngày sinh (mã lỗi
  mới trong `error-codes.ts`, message tiếng Việt).
- **Vào bằng mã đổi thành xin vào, chờ duyệt** (mục 4 tài liệu). Hiện tại
  `families.repository.ts` `joinByInviteCode` tạo membership `accepted` ngay;
  thay bằng:
  - `GET /families/join-preview?code=` (throttle như `join`): trả tên nhóm, ảnh
    nhóm, tên + ảnh Chủ nhóm, số thành viên `accepted`. Mã sai/hết hạn → 404.
  - `POST /families/join`: tạo/tái dùng membership `requested` (nhãn, tên hiển
    thị); trả trạng thái chờ duyệt. Đã `accepted` → lỗi "đã là thành viên". Đã
    có yêu cầu đang chờ → trả lại yêu cầu đó (idempotent). Thiếu ngày sinh → lỗi.
    Thông báo cho Chủ nhóm và Quản lý không phải người thuê (persist rồi mới gửi).
  - `GET /families/:familyId/join-requests` (người duyệt): danh sách yêu cầu
    đang chờ, kèm tuổi đã quy đổi thành `isMinor` và gợi ý `isSenior` (từ 60) để
    Flutter tick sẵn; không trả ngày sinh.
  - `POST /families/:familyId/join-requests/:memberId/approve`: body giống phần
    cờ của DTO mời (`familyLabel?`, `canManageCare?`, `isCareRecipient?`,
    `careScopeMemberIds?`), validate y như mời → `accepted`; thông báo người xin.
  - `POST /families/:familyId/join-requests/:memberId/reject` → `rejected`;
    thông báo người xin.
  - `GET /families/join-requests/mine` + `DELETE /families/join-requests/:memberId`
    cho người xin xem và hủy yêu cầu của mình.
  - Yêu cầu hết hạn sau `INVITATION_TTL_DAYS` (cùng cách tính `invitedAt`).
  - Xử lý tranh chấp: duyệt/từ chối/hủy đồng thời → transaction + kiểm tra trạng
    thái `requested` trong cùng transaction.
  - Cập nhật unit test và e2e của luồng `join` hiện có.
- Tạo nhóm: từ 18 tuổi; người tạo `can_manage_care = true`.
- PATCH thành viên: bỏ `role`; thêm `canManageCare`, `isCareRecipient`,
  `careScopeMemberIds` với đúng người được phép theo bảng mục 7. Không cho tự bật/tắt
  `isCareRecipient` của chính mình; Quản lý được tự thôi `canManageCare` (trừ Chủ nhóm).
- Chuyển chủ nhóm: người nhận phải là người lớn `accepted`; tự set
  `can_manage_care = true`; người thuê bị xóa phạm vi.
- Xóa thành viên: Quản lý chỉ xóa thành viên không phải Quản lý; Chủ nhóm xóa
  được Quản lý; Chủ nhóm là người thuê không xóa được người Được chăm sóc.
- Rời nhóm: dưới 18 không tự rời (giữ luật cũ); Chủ nhóm phải chuyển trước;
  người Được chăm sóc rời → thông báo ưu tiên cao cho mọi Quản lý (persist trước,
  emit sau).
- Mọi thay đổi quyền tạo thông báo cho cả nhóm (dùng module notifications sẵn có,
  thêm loại thông báo cần thiết).
- Response thành viên theo mục 9; không trả ngày sinh người khác.
- Swagger cập nhật.

### Pha 4: Các module dùng quyền

- Geofences: tạo/sửa/xóa cần `requireCareManager`; mọi member gán vào geofence
  phải qua `canManage`. Người thuê chỉ thấy geofence của người trong phạm vi.
- Reminders: thay `role: 'manager'` bằng `canManage` với từng target; người nhận
  cảnh báo lỡ nhắc = `listManagersFor`.
- Phone management: mục tiêu phải `isMinor` và `canManage`.
- Daily status: đối tượng = `isCareRecipient`; người xem = `canManage`;
  `phoneUsage` chỉ khi `isMinor`.
- Cameras: quản lý camera = `requireFamilyAdmin`; xem camera = người lớn
  `accepted` không phải người thuê.
- Chat: thay điều kiện `role: 'manager'` bằng Chủ nhóm hoặc `requireFamilyAdmin`
  tùy ngữ cảnh (đọc code để xác định đúng ý nghĩa cũ).
- Locations: nhánh gốc đã có điều khiển chia sẻ (`user_settings.sharing_mode`,
  `location_visibility` `all|selected`, bảng `location_share_viewers`). Với
  người Được chăm sóc: không được tắt chia sẻ, và `selected` không được loại
  người có `canManage` khỏi danh sách xem (Quản lý luôn thấy). Người Được chăm sóc
  không tắt chia sẻ; lịch sử chỉ cho
  `canManage`; người thuê chỉ thấy vị trí hiện tại của người trong phạm vi;
  bỏ `role` khỏi response/swagger, thay bằng cờ mục 9. Giữ quy tắc realtime
  recipients khớp quy tắc xem.
- Realtime room authorization: kiểm tra lại các room `member:` theo quyền mới.

### Pha 5: Auth và profile

- Register DTO: bỏ `role`; thêm `uiMode?` (`adult|assisted`); backend ép `kid`
  khi dưới 13, mặc định `assisted` khi từ 60.
- Profile GET/PATCH: trả và cho sửa `uiMode` (dưới 13 không đổi được).
- Cập nhật `api-docs.ts`, swagger auth.

### Pha 6: SOS và té ngã

- Đọc luồng SOS hiện tại. Đảm bảo: SOS gửi mọi thành viên `accepted` ở mọi nhóm
  active của người gửi (trừ chính họ), kèm vị trí, bất kể `locationSharingEnabled`.
  Persist và commit trước, emit realtime/FCM sau; lỗi gửi không rollback sự kiện.
- Nếu đã có luồng gửi `sos_contacts` thì dùng làm dự phòng khi không còn người nhận;
  nếu chưa có, không tự xây, ghi vào `docs/technical-debt.md`.
- Không đụng tới phát hiện té ngã tự động (ngoài phạm vi).

### Pha 7: Tài liệu

- `docs/flutter-integration-contract.md`: đăng ký, profile, thành viên, mời,
  nhận lời, xem trước mã + xin vào + duyệt/từ chối/hủy yêu cầu, PATCH thành viên, chuyển chủ nhóm, mã lỗi mới, banner chuyển giao
  (Flutter tự quyết định hiển thị theo mục 5).
- `AGENTS.md` mục 14 "Family Role Model": thay bằng mô hình mới.
- `docs/technical-debt.md`: thông báo trước 30 ngày khi trẻ sắp 18; Quản lý đổi
  `ui_mode` trẻ 13–17; bỏ cột `role` cũ.
- `docs/backend-implementation-log.md`: ghi lại pha đã làm.

### Không làm trong nhiệm vụ này

- Không xóa `profiles.role` và `family_members.role` (để migration sau, khi
  Flutter đã chuyển). Code mới không đọc/ghi các cột này, trừ backfill.
- Không thêm quyền chi tiết theo từng cặp người ngoài `family_member_care_scopes`.
- Không refactor ngoài phạm vi.

## Hoàn thành khi

- `npm run lint:check`, `npm run typecheck`, `npm test`, `npm run test:e2e`,
  `npm run build` đều qua.
- `grep` không còn `requireManager`, `FAMILY_ROLES`, `deriveRoleFromLabel`, hay
  điều kiện `role === 'manager' | 'child' | 'elder' | 'adult'` trong `src/`
  (trừ migration spec và backfill).
- Báo cáo: các pha đã xong, file migration, endpoint thay đổi (breaking change cho
  Flutter), những gì chưa xác minh trên DB thật.
