# SafeNet Backend Requirements

## 1. Mục tiêu

Backend cung cấp API ổn định, an toàn cho ứng dụng Flutter SafeNet, phục vụ phối hợp gia đình, theo dõi an toàn và xử lý sự kiện khẩn cấp. PostgreSQL là nguồn dữ liệu chính; push notification và realtime chỉ là kênh chuyển phát.

## 2. Công nghệ và kiến trúc

- NestJS và TypeScript với `strict: true`.
- PostgreSQL trên Supabase; Prisma là lớp truy cập dữ liệu và chủ sở hữu các migration ứng dụng sau khi schema hiện có được introspect và baseline.
- Supabase Auth là nguồn xác thực duy nhất. Dữ liệu hồ sơ ứng dụng nằm trong `public.profiles`; không tạo bảng mật khẩu hoặc hệ thống JWT thứ hai.
- Zod dùng để kiểm tra dữ liệu đầu vào; Swagger/OpenAPI mô tả API.
- Socket.IO qua NestJS Gateway dùng cho realtime khi tính năng cần; Firebase Admin/FCM dùng cho push khi đã cấu hình.
- Tổ chức theo module NestJS; luồng dữ liệu thông thường: Controller → Service → Repository → PrismaService → PostgreSQL.
- Trước khi thêm thành phần mới, kiểm tra và tái sử dụng bootstrap, module, guard, decorator, pipe, filter, interceptor và provider hiện có.

## 3. Yêu cầu chức năng

Backend cung cấp API theo nhu cầu và theo từng giai đoạn cho các miền sau:

1. **Hồ sơ và gia đình:** hồ sơ người dùng; nhóm gia đình; lời mời; thành viên, vai trò `manager`, `adult`, `child`, `elder` và trạng thái thành viên.
2. **Thiết bị và vị trí:** đăng ký thiết bị; liên kết người dùng/ thành viên; vị trí hiện tại và lịch sử có phân trang; kiểm tra quyền chia sẻ vị trí.
3. **Vùng an toàn:** tạo và quản lý geofence theo gia đình; xác định sự kiện vào/ra; hạn chế tạo sự kiện trùng khi có nhiều mẫu vị trí liên tiếp.
4. **Phát hiện té ngã:** tiếp nhận kết quả từ điện thoại hoặc camera đã được liên kết; xác thực nguồn và payload; chống trùng; lưu sự kiện và thông báo trước khi gửi realtime/FCM; hỗ trợ các trạng thái theo quy tắc nghiệp vụ.
5. **Thông báo:** lưu thông báo bền vững; danh sách có cursor pagination; số lượng chưa đọc; đánh dấu một hoặc tất cả đã đọc.
6. **SOS:** quản lý liên hệ khẩn cấp; tạo sự kiện SOS, ảnh chụp vị trí nếu có, thông báo và audit; thực hiện chuyển trạng thái hợp lệ và xử lý retry an toàn.
7. **Nhắc nhở:** CRUD, lịch lặp đã được kiểm tra, thành viên nhận nhắc nhở và trạng thái từng lần thực hiện; ngăn tạo occurrence trùng.
8. **Quản lý điện thoại trẻ em:** nhật ký sử dụng có phân trang; quy tắc sử dụng; lệnh thiết bị có idempotency và chỉ hoàn tất khi thiết bị xác nhận.
9. **Báo cáo và cài đặt:** báo cáo ngày duy nhất cho mỗi thành viên/ngày; tùy chọn đăng nhập sinh trắc học chỉ lưu metadata, không lưu dữ liệu sinh trắc học.
10. **Chat và cuộc gọi:** nếu được triển khai, kiểm tra tư cách thành viên cho mọi thao tác; lưu tin nhắn trước khi phát realtime; hỗ trợ phân trang cursor và trạng thái đọc theo người nhận. Chỉ cung cấp signaling/trạng thái cuộc gọi nếu chưa có dịch vụ truyền tải media.

Các miền lớn cần được triển khai theo giai đoạn, dựa trên code và migration hiện có; không xây nhiều miền lớn trong một thay đổi không kiểm soát.

## 4. API và hợp đồng dữ liệu

- Prefix API mặc định: `/api/v1`; health endpoint: `/api/health`.
- API dùng REST; mọi danh sách đều có giới hạn và phân trang. Dùng cursor pagination cho luồng thông báo, vị trí, tin nhắn và sự kiện khi phù hợp; giới hạn `limit` mặc định không vượt quá 100.
- Thành công dùng hợp đồng `{ "success": true, "message": "...", "data": ... }`; danh sách bổ sung object `pagination`.
- Lỗi dùng `{ "success": false, "error": { "code": "...", "message": "...", "details": null } }` với mã lỗi ổn định để Flutter xử lý theo `error.code`.
- Dùng HTTP status nhất quán: 200, 201, 204, 400, 401, 403, 404, 409, 422, 429 và 500 theo ý nghĩa chuẩn. Phản hồi 204 không có body.
- Controller chỉ nhận context và dữ liệu đã kiểm tra, gọi service, rồi ánh xạ kết quả; nghiệp vụ nằm trong service, truy vấn nằm trong repository.
- Swagger phải mô tả xác thực, quyền truy cập, params, query, body, status thành công và lỗi cùng error code.

## 5. Xác thực, phân quyền và riêng tư

- Request được bảo vệ dùng `Authorization: Bearer <Supabase access token>`; danh tính actor được lấy từ guard/decorator, không nhận `userId`, `senderId`, `createdBy` hoặc trường tương tự từ client làm nguồn tin cậy.
- Kiểm tra quyền theo membership đang hoạt động, vai trò, quyền sở hữu và quan hệ với tài nguyên trước mọi thao tác đọc/ghi riêng tư. Biết UUID không đồng nghĩa có quyền.
- Tất cả body, params, query, header và payload từ thiết bị/webhook đều phải validate bằng schema Zod phù hợp; request object mặc định `.strict()`.
- Bảo vệ token, khóa dịch vụ, thông tin camera và tọa độ chính xác: không đưa vào response không cần thiết hoặc log thông thường.
- Giới hạn kích thước body/upload, phạm vi truy vấn, kích thước mảng và số lượng ID; whitelist trường lọc/sắp xếp.
- Áp dụng rate limit cấu hình được cho endpoint nhạy cảm như đăng nhập, lời mời, SOS và tiếp nhận fall event.

## 6. Dữ liệu và độ tin cậy

- Dùng ràng buộc PostgreSQL phù hợp: primary/foreign key, unique, not-null, check, default và index cho truy vấn quyền, lọc, sắp xếp và lịch sử theo thời gian.
- Sự kiện thực tế dùng timestamp có timezone. Migration là forward-only; không sửa migration đã áp dụng, không chạy baseline phá hủy hoặc chỉnh trực tiếp database production để thay cho migration.
- Dùng transaction cho nghiệp vụ nhiều lần ghi cần nguyên tử. Với SOS, fall event và sự kiện an toàn: xác thực → phân quyền → idempotency → transaction/commit → realtime hoặc FCM.
- Duplicate-sensitive operation hỗ trợ `Idempotency-Key` hoặc event ID ổn định. Cùng key/cùng payload dùng lại kết quả; cùng key/payload khác trả 409.
- Lưu bản ghi nguồn trước khi phát realtime hoặc push. Lỗi chuyển phát không được xóa hoặc làm mất sự kiện đã commit; thiết kế retry phải an toàn với bản ghi trùng.
- Quyền truy cập vị trí, camera, chat và dữ liệu trẻ em phải được kiểm tra theo gia đình/thành viên/tài nguyên tương ứng.

## 7. Vận hành và chất lượng

- Dùng exception filter/interceptor chung cho response và lỗi; không trả stack trace, SQL hoặc lỗi thô từ dịch vụ bên thứ ba cho client.
- Ghi log có cấu trúc và request/correlation ID; không ghi mật khẩu, token, secret, thông tin camera riêng tư hoặc tọa độ chính xác vào log chung.
- Kiểm tra cấu hình bắt buộc khi khởi động; `.env.example` chỉ chứa tên biến và mô tả an toàn, không chứa secret.
- Mọi outbound call có timeout; chỉ retry lỗi transient và bảo đảm thao tác retry không tạo hiệu ứng nghiệp vụ trùng.
- Dùng dependency hiện có; không thêm ORM, database, broker, realtime framework, dịch vụ AI hoặc nhà cung cấp cuộc gọi ngoài danh sách được duyệt nếu chưa được chấp thuận.
- Thay đổi cần theo convention test hiện có và có kiểm tra phù hợp cho validation, xác thực, phân quyền, conflict/idempotency, chuyển trạng thái và lỗi database/chuyển phát ở các workflow quan trọng.

## 8. Nguồn ưu tiên khi có mâu thuẫn

Ưu tiên code đang chạy và migration đã áp dụng; tiếp theo là `AGENTS.md`; sau đó là tài liệu API/database hiện hành; cuối cùng mới đến đặc tả tính năng và ghi chú thiết kế cũ. Không triển khai yêu cầu theo tài liệu cũ nếu nó tạo hệ thống xác thực thứ hai hoặc mâu thuẫn với schema hiện hành.
