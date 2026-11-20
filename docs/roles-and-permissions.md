# SafeNet: Vai trò và phân quyền

Tài liệu quyết định (đã chốt 2026-11-20). Thay thế mô hình cũ `profiles.role`
(`personal|parent|guardian`) và `family_members.role` (`manager|adult|child|elder`).
Chưa triển khai: xem `docs/roles-and-permissions-implementation-prompt.md`.

## 1. Nguyên tắc

1. **Quyền nằm ở từng nhóm, không ở tài khoản.** Một tài khoản tham gia nhiều
   nhóm; mỗi nhóm có bộ quyền riêng. Thành viên nhóm A không thấy gì của nhóm B.
2. **Giao diện tách khỏi quyền.** `ui_mode` chỉ quyết định cách hiển thị.
3. **Ai được chăm sóc do người quản lý trong nhóm quyết định**, không do người
   được chăm sóc tự khai. Người lớn đồng ý một lần khi nhận lời mời.
4. **Tuổi dưới 18 là mốc pháp lý** (luôn được chăm sóc). **Từ 60 là mốc gợi ý**
   (Luật Người cao tuổi): ô "Cần được chăm sóc" được tick sẵn.
5. **Không ai cấu hình theo dõi chính mình.**
6. **SOS và té ngã luôn có người nhận.**
7. **App hiển thị tên vai trò bằng chữ**, không dùng icon thay tên.

## 2. Đăng ký và giao diện

Đăng ký: thông tin cơ bản + **ngày sinh (bắt buộc)**. Không có câu hỏi về quyền.

| Tuổi | Giao diện (`ui_mode`) | Ghi chú |
|---|---|---|
| Dưới 13 | `kid` | Cố định |
| 13–17 | `adult` | |
| 18–59 | `adult` hoặc `assisted` | Người dùng tự chọn: "Tiêu chuẩn" / "Chữ to, dễ dùng" |
| Từ 60 | `assisted` (chọn sẵn) | Đổi sang `adult` được |

- UI người lớn chỉ có một bản. Các chức năng quản lý (vùng an toàn, nhắc nhở,
  luật điện thoại, lịch sử, báo cáo) chỉ hiện khi người dùng là **Quản lý** ở
  nhóm đang xem.
- Tài khoản dưới 18 tuổi không tạo được nhóm; chỉ vào nhóm qua lời mời hoặc mã.
- Tài khoản chưa có ngày sinh (dữ liệu cũ) phải nhập trước khi tạo nhóm, nhận
  lời mời hoặc vào nhóm bằng mã.
- Tuổi tính theo ngày lịch giờ Việt Nam (`Asia/Ho_Chi_Minh`).

## 3. Vai trò trong nhóm

| Vai trò (tên hiển thị) | Lưu ở đâu | Quyền |
|---|---|---|
| **Quản lý** | `family_members.can_manage_care = true` | Đặt vùng an toàn, nhắc nhở, luật điện thoại (chỉ cho người dưới 18); xem lịch sử vị trí, báo cáo hằng ngày; nhận cảnh báo vùng an toàn và nhắc nhở. Mời người, xóa thành viên không phải Quản lý, cấp quyền Quản lý, bật/tắt "Cần được chăm sóc" cho người lớn |
| **Chủ nhóm** | `families.owner_user_id` (luôn là Quản lý) | Như Quản lý, thêm: thu quyền Quản lý, xóa Quản lý khác, chuyển chủ nhóm, xóa/lưu trữ nhóm. Là trọng tài khi các Quản lý không thống nhất |
| **Được chăm sóc** | Tính: `tuổi < 18 OR family_members.is_care_recipient` | Được theo dõi; không tự cấu hình theo dõi mình; không tự tắt chia sẻ vị trí |
| **Người chăm sóc** (thuê) | `family_members.is_hired = true` (nhãn `caregiver`) | Quản lý bị giới hạn phạm vi (xem mục 6) |
| Thành viên (không badge) | — | SOS, chia sẻ vị trí, chat |

Một người có thể mang nhiều vai trò, ví dụ "Ba · Chủ nhóm · Quản lý", hoặc
"Quản lý · Được chăm sóc" (quản lý người khác, không tự cấu hình mình).

Ràng buộc:

- Mỗi nhóm đúng 1 Chủ nhóm, từ 18 tuổi, luôn có `can_manage_care = true`.
  Hệ quả: nhóm nào cũng có ít nhất 1 Quản lý.
- Người dưới 18 tuổi không là Quản lý hoặc Chủ nhóm.
- `family_label` chỉ để hiển thị quan hệ, không suy ra quyền.

### Kiểm tra quyền

```
isMinor(m)          = tuổi(m) < 18
isCareRecipient(m)  = isMinor(m) OR m.is_care_recipient
inScope(actor, t)   = NOT actor.is_hired OR actor là Chủ nhóm OR t ∈ care_scope(actor)

canManage(actor, target) =
      actor.status = accepted AND target.status = accepted (cùng nhóm, nhóm active)
  AND actor.can_manage_care
  AND actor.user_id ≠ target.user_id
  AND isCareRecipient(target)
  AND inScope(actor, target)

Luật điện thoại: canManage(actor, target) AND isMinor(target)
```

## 4. Tạo nhóm, mời, nhận lời mời

**Tạo nhóm:** người tạo (từ 18 tuổi) thành **Chủ nhóm + Quản lý**
("luật người lớn đầu tiên").

**Mời** (Quản lý không phải người thuê, hoặc Chủ nhóm):

- Email hoặc SĐT, nhãn quan hệ.
- `canManageCare` (chỉ cho người lớn): Flutter tick sẵn với nhãn
  `father|mother|husband|wife`.
- `isCareRecipient` (chỉ cho người lớn): lúc mời chưa biết tuổi người được mời,
  nên **bỏ trống = tự theo tuổi**: khi nhận lời, từ 60 tuổi → `true`, còn lại
  `false`. Gửi `true`/`false` rõ ràng thì backend dùng đúng giá trị đó. Flutter
  tick sẵn với nhãn `grandfather|grandmother`. Người dưới 18 luôn được chăm sóc.
- Nhãn `caregiver` ⇒ `is_hired = true`, bắt buộc `careScopeMemberIds` (≥1 người
  Được chăm sóc trong nhóm; Flutter chọn sẵn nếu nhóm chỉ có 1 người).
- Nếu người được mời chưa có tài khoản hoặc chưa biết tuổi, các cờ được kiểm tra
  lại khi nhận lời mời; cờ không hợp lệ với tuổi thì bị bỏ (ví dụ trẻ em không
  nhận `canManageCare`).

**Nhận lời mời:** màn hình nêu rõ vai trò. Nếu là Được chăm sóc: liệt kê ai sẽ
thấy vị trí, đặt vùng an toàn, nhắc nhở; kèm dòng "SOS và té ngã gửi cho cả
nhà". Hai nút: Đồng ý tham gia / Từ chối. Đồng ý là đồng ý được chăm sóc.

**Vào nhóm bằng mã (xin vào, chờ duyệt):** mã mời không còn cho vào nhóm ngay.

1. Người dùng nhập mã → app hiện **xem trước nhóm**: tên nhóm, ảnh nhóm, tên và
   ảnh Chủ nhóm, số thành viên. Không hiện gì khác về thành viên.
2. Người dùng chọn nhãn quan hệ (và tên hiển thị nếu muốn) → gửi **yêu cầu tham
   gia**. Membership ở trạng thái `requested`.
3. Chủ nhóm và các Quản lý không phải người thuê nhận thông báo. Người duyệt mở
   yêu cầu, thấy **cùng form như khi mời** (nhãn có thể sửa, `canManageCare`,
   `isCareRecipient`, phạm vi nếu nhãn `caregiver`), cờ được tick sẵn theo đúng
   luật mời, rồi **Chấp nhận** hoặc **Từ chối**.
4. Chấp nhận → `accepted` ngay (người xin đã chủ động xin vào; màn hình xin vào
   đã hiện nội dung đồng ý: "Nếu bạn được đánh dấu Cần được chăm sóc, Quản lý sẽ
   thấy vị trí, đặt vùng an toàn, nhắc nhở; SOS và té ngã gửi cho cả nhà").
   Người xin nhận thông báo kết quả.
5. Người xin có thể hủy yêu cầu khi đang chờ. Yêu cầu hết hạn sau 7 ngày
   (giống lời mời). Một người chỉ có một yêu cầu đang chờ cho mỗi nhóm.
6. Đã là thành viên → báo "đã ở trong nhóm". Mã sai/hết hạn → 404 như hiện tại.
7. Xem trước và gửi yêu cầu đều giới hạn tần suất chặt như endpoint `join` hiện tại.

**Nhãn quan hệ** (`FAMILY_LABELS`): giữ `father, mother, son, daughter,
grandfather, grandmother, caregiver, other`; thêm `husband, wife, brother,
sister, grandchild`.

## 5. Chuyển giao chủ nhóm

Khi một Quản lý có nhãn `father|mother` vừa vào nhóm và Chủ nhóm hiện tại có
nhãn khác `father|mother`, Flutter hiện banner cho Chủ nhóm:
"Chuyển chủ nhóm cho ba?" với 3 lựa chọn:

- **Chuyển, thôi quản lý** → `transfer-ownership` rồi tự thu `can_manage_care`.
- **Chuyển, vẫn cùng quản lý** → `transfer-ownership`.
- **Để sau**.

Chuyển chủ nhóm: chỉ Chủ nhóm, cho một người lớn đã `accepted`. Người nhận tự
động được `can_manage_care = true`; nếu là người thuê thì phạm vi bị xóa (Flutter
cảnh báo trước). Chủ nhóm phải chuyển quyền trước khi rời nhóm.

Lời khuyên hiển thị: nhóm chăm sóc cha mẹ nên do con cái tạo, để con cái là
Chủ nhóm.

## 6. Người chăm sóc thuê

- Là Quản lý chỉ trong phạm vi `family_member_care_scopes`: chỉ thấy vị trí,
  lịch sử, báo cáo, cảnh báo của người trong phạm vi.
- Không mời người, không xóa người, không cấp/thu quyền, không đổi cờ chăm sóc.
- Vẫn nhận SOS và té ngã của mọi thành viên.
- Không đọc camera.

**Bà có con cháu:** con là Chủ nhóm + Quản lý, thêm bà (Được chăm sóc), mời
người chăm sóc với phạm vi = bà.

**Bà đơn thân:** người chăm sóc tự tạo nhóm (Chủ nhóm + Quản lý đầy đủ, nhãn
`caregiver`) rồi mời bà. Chủ nhóm là người thuê thì **không xóa được người Được
chăm sóc**. Bà luôn tự rời nhóm được. Con cháu vào sau → banner chuyển chủ nhóm.
Hết hợp đồng → chuyển chủ nhóm cho người lớn còn lại (có thể là bà) rồi rời nhóm.

Một người chăm sóc làm cho nhiều cụ thì ở nhiều nhóm.

## 7. Thay đổi về sau

| Việc | Ai làm |
|---|---|
| Duyệt/từ chối yêu cầu xin vào bằng mã | Quản lý không phải người thuê, hoặc Chủ nhóm |
| Cấp Quản lý | Quản lý không phải người thuê, hoặc Chủ nhóm |
| Thu Quản lý, xóa Quản lý | Chủ nhóm (Quản lý tự thôi quyền của mình được, trừ Chủ nhóm) |
| Chuyển chủ nhóm | Chủ nhóm |
| Bật/tắt "Cần được chăm sóc" cho người lớn | Quản lý không phải người thuê (không áp cho chính mình) |
| Đổi phạm vi người chăm sóc thuê | Quản lý không phải người thuê |
| Xóa thành viên thường | Quản lý không phải người thuê |
| Rời nhóm | Người lớn tự rời (Chủ nhóm phải chuyển quyền trước). Người dưới 18 không tự rời |
| Người Được chăm sóc rời nhóm | Được; Flutter xác nhận 2 lần; mọi Quản lý nhận thông báo ưu tiên cao ngay |
| Trẻ tròn 18 tuổi | Tự hết "Được chăm sóc" (tính từ ngày sinh) |

Mọi lần cấp/thu quyền, đổi cờ chăm sóc, chuyển chủ nhóm đều tạo thông báo cho
cả nhóm.

## 8. Cảnh báo và vị trí

| | Thành viên khác | Được chăm sóc |
|---|---|---|
| Chia sẻ vị trí | Tự bật/tắt | Luôn bật, không tự tắt |
| Vị trí hiện tại | Cả nhóm (khi bật) | Cả nhóm; người thuê chỉ thấy người trong phạm vi |
| Lịch sử vị trí, báo cáo | Không ai | Người có `canManage` |
| Cảnh báo vùng an toàn, lỡ nhắc nhở | — | Người có `canManage` |
| **SOS, té ngã** | **Mọi thành viên ở mọi nhóm của người đó, kèm vị trí, kể cả khi tắt chia sẻ** | như bên trái |

Nếu không còn thành viên nào khác nhận SOS: gửi liên hệ khẩn cấp cá nhân
(`sos_contacts`) nếu tính năng đó hỗ trợ; nếu chưa, ghi vào
`docs/technical-debt.md`.

## 9. API (Flutter tự đổi cờ sang tên hiển thị)

Thành viên trả về:

```json
{
  "id": "uuid",
  "userId": "uuid",
  "familyLabel": "father",
  "displayName": "Ba",
  "isOwner": true,
  "canManageCare": true,
  "isCareRecipient": false,
  "isMinor": false,
  "isHired": false,
  "careScopeMemberIds": [],
  "locationSharingEnabled": true
}
```

Không trả ngày sinh của thành viên khác. `careScopeMemberIds` chỉ khác rỗng với
người thuê. Profile trả `uiMode` thay cho `role`.

## 10. Dữ liệu

```
profiles:        + ui_mode VARCHAR CHECK (ui_mode IN ('kid','adult','assisted'))
                 - role   (bỏ sau khi Flutter chuyển xong)
family_members:  + can_manage_care BOOLEAN NOT NULL DEFAULT false
                 + care_granted_by UUID NULL
                 + is_care_recipient BOOLEAN NOT NULL DEFAULT false
                 + care_recipient_set_by UUID NULL
                 + is_hired BOOLEAN NOT NULL DEFAULT false
                 - role   (bỏ sau khi Flutter chuyển xong)
                 status: thêm giá trị 'requested' (xin vào bằng mã, chờ duyệt)
family_member_care_scopes (mới):
                 member_id UUID FK family_members, target_member_id UUID FK family_members,
                 PK (member_id, target_member_id), cùng family_id
families:        owner_user_id giữ nguyên; trigger owner ⇒ can_manage_care
```

Chuyển dữ liệu cũ:

| Cũ | Mới |
|---|---|
| `family_members.role = manager` | `can_manage_care = true` |
| `role = adult`, nhãn `father|mother` | `can_manage_care = true` |
| `role = adult`, nhãn khác | không cờ |
| `role = elder` | `is_care_recipient = true` |
| `role = child` | không cờ (tính theo tuổi); nếu thiếu ngày sinh → `is_care_recipient = true` để không mất theo dõi |
| nhãn `caregiver` | `is_hired = true`, phạm vi = mọi người Được chăm sóc hiện có trong nhóm |
| `profiles.role` | `ui_mode` theo tuổi (`kid` <13, `assisted` ≥60, còn lại `adult`) |

## 11. Giới hạn chấp nhận

- Quản lý (không phải người thuê) quản lý mọi người Được chăm sóc trong nhóm.
  Muốn tách riêng (ví dụ con riêng khi tái hôn) thì tạo nhóm riêng.
- App không xác minh quan hệ thật hoặc giám hộ hợp pháp; bù lại mọi thay đổi
  quyền đều được thông báo.
- Té ngã tự động (AI) chưa làm; không đặt ngưỡng theo tuổi cho tính năng này.
- Thông báo trước 30 ngày khi trẻ sắp 18 tuổi và cho Quản lý đổi `ui_mode` của
  trẻ 13–17 về `kid`: làm sau (ghi vào technical debt).
