# Telegram bot cục bộ

Bot Telegram cung cấp giao diện quản lý đơn giản cho APIRouter:

- Providers và trạng thái tài khoản
- Combos và danh sách model
- Usage theo `today`, `24h`, `7d`, `30d`, `60d`, hoặc `all`
- Quota tracker theo từng tài khoản
- Thêm, ngắt/kết nối lại và xóa provider API key/cookie
- Thêm, đổi tên, sửa model, xóa và chọn strategy cho combo

Bot dùng long polling, chạy trên cùng máy với APIRouter và không cần webhook hay package bổ sung.

## 1. Tạo bot

Tạo bot bằng `@BotFather`, sau đó lấy token. Thêm vào `.env.local`:

```env
TELEGRAM_BOT_TOKEN=123456789:replace-with-bot-token
APIRouter_BASE_URL=http://127.0.0.1:20228
```

Bot sử dụng chính mật khẩu đăng nhập Web UI APIRouter. Không cần cấu hình mật khẩu Telegram riêng.

## 2. Đăng nhập lần đầu

Khởi động APIRouter:

```bash
./apirouter --no-browser
```

Trong màn hình `Choose Interface`, chọn `Telegram Bot: OFF → toggle` để chuyển sang `ON`. Bot được APIRouter tự khởi động và dừng; không cần chạy lệnh chatbot riêng. Chọn lại mục này để tắt bot.

Lệnh `npm run bot:telegram` vẫn được giữ lại cho mục đích phát triển hoặc chẩn đoán độc lập.

Gửi `/start` hoặc `/login` trong chat riêng với bot. Bot yêu cầu mật khẩu Web UI hiện tại và xác minh qua APIRouter. Sau khi thành công, phiên được lưu tại:

```text
DATA_DIR/telegram-bot/sessions.json
```

File chỉ chứa chat ID, thông tin nhận diện Telegram, phiên bản xác thực không đảo ngược và thời điểm đăng nhập/gần nhất; không chứa mật khẩu hay nội dung chat. Phiên còn hiệu lực sau khi bot khởi động lại. Dùng `/logout` để xóa phiên và yêu cầu mật khẩu ở lần sau.

Mặc định phiên hết hạn sau 30 ngày không hoạt động. Có thể thay đổi:

```env
TELEGRAM_SESSION_TTL_DAYS=30
```

Nếu mật khẩu Web UI, `INITIAL_PASSWORD`, hoặc chế độ đăng nhập Password/OIDC/SAML thay đổi, phiên Telegram cũ tự bị thu hồi và bot yêu cầu đăng nhập lại. Bot chỉ lưu fingerprint HMAC của cấu hình xác thực, không lưu mật khẩu hoặc password hash.

Có thể thêm allowlist như một lớp giới hạn trước khi cho phép thử mật khẩu. Gửi `/id` để lấy chat ID, sau đó thêm:

```env
TELEGRAM_ALLOWED_CHAT_IDS=123456789
```

Có thể cho phép nhiều tài khoản bằng danh sách phân cách bởi dấu phẩy:

```env
TELEGRAM_ALLOWED_CHAT_IDS=123456789,987654321
```

Nếu không cấu hình `TELEGRAM_ALLOWED_CHAT_IDS`, bất kỳ người dùng chat riêng nào biết đúng mật khẩu Web UI đều có thể đăng nhập.

## Lệnh

- `/menu` — menu nút bấm
- `/providers` — providers
- `/combos` — combos
- `/usage 7d` — usage; có thể thay `7d` bằng kỳ khác
- `/quota` — chọn tài khoản và xem quota
- `/login` — đăng nhập lần đầu bằng mật khẩu Web UI
- `/logout` — xóa phiên Telegram đã ghi nhớ
- `/cancel` — hủy bước nhập mật khẩu hoặc thao tác quản lý đang chờ
- `/id` — xem chat ID

Mật khẩu được gửi tới endpoint nội bộ `/api/auth/verify-password`, được bảo vệ bằng CLI token, để so sánh với cùng mật khẩu/hash của Web UI. Endpoint này không tạo cookie, không tạo phiên Web UI và không dùng chung bộ khóa thử sai của trang đăng nhập. Mật khẩu không được bot lưu lại. Bot cố gắng xóa tin nhắn chứa mật khẩu ngay sau khi nhận, nhưng Telegram vẫn là hệ thống bên thứ ba; chỉ nên đăng nhập trong chat riêng. Không chia sẻ `.env.local`, bot token, thư mục `DATA_DIR`, file `auth/cli-secret`, hoặc file phiên Telegram.

## Quản lý providers

Trong menu `Providers`, chọn `Thêm provider`. Danh sách provider và loại xác thực bám theo Terminal UI:

- Provider OAuth callback: bot tạo link đăng nhập; sau khi xác thực, sao chép toàn bộ callback URL từ thanh địa chỉ và gửi lại cho bot.
- Provider OAuth device-code: bot hiển thị link và mã; sau khi đăng nhập, bấm `Kiểm tra đăng nhập`.
- Provider API key: bot hỏi tên hiển thị rồi API key.

Tin nhắn chứa API key hoặc callback URL được xóa ngay sau khi nhận. API key không được lưu trong state của bot; OAuth verifier chỉ được giữ trong bộ nhớ cho tới khi hoàn tất hoặc hủy thao tác.

Chọn `Quản lý` để mở từng kết nối. Có thể ngắt kết nối, kết nối lại hoặc xóa vĩnh viễn. Thao tác xóa luôn yêu cầu xác nhận.

## Quản lý combos

Trong menu `Combos`, chọn `Thêm combo` hoặc `Điều chỉnh`. Bot hiển thị provider đang hoạt động trước, sau đó tải và phân trang danh sách model của provider đã chọn. Có thể chọn nhiều model, quay lại provider khác và tiếp tục chọn; dấu `✅` thể hiện model/provider đã được chọn.

Nút `Nhập thủ công` vẫn cho phép nhập danh sách model phân cách bằng dấu phẩy hoặc xuống dòng, ví dụ:

```text
cx/gpt-5.3-codex, cc/claude-sonnet
```

Mỗi combo có một trong ba strategy:

- `Fallback` — thử model theo thứ tự, chuyển sang model tiếp theo khi lỗi
- `Round Robin` — luân phiên model giữa các request
- `Fusion` — chạy panel model và dùng judge model để tổng hợp kết quả

Khi tạo Fusion, bot mặc định dùng model đầu tiên làm judge. Có thể đổi judge trong màn hình chi tiết combo. Đổi tên hoặc xóa combo cũng cập nhật phần `comboStrategies` tương ứng trong settings.

Trong Quota Tracker, nút `Tất cả providers` tải tối đa 20 tài khoản đang hoạt động, tối đa 3 request song song. Mỗi quota được hiển thị bằng thanh tiến trình, phần trăm còn lại, lượng đã dùng và thời gian reset. Màn hình account và màn hình tổng hợp đều có nút quay về danh sách quota và menu chính.

Nếu APIRouter chạy trong Docker, bot phải dùng cùng `DATA_DIR` volume để tạo đúng token CLI, hoặc chạy bot trong cùng container. Nếu Telegram báo bot đang dùng webhook, hãy xóa webhook của bot trước khi dùng long polling.
