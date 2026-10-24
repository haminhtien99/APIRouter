# Agent Workspace (DeepSeek Harness Integration)

The Dashboard's **Agent** page (`/dashboard/agent`) embeds the full DeepSeek Harness Web UI into APIRouter. Harness provides sessions, workspaces, file trees, terminal tools, and approval flows; APIRouter powers the AI capabilities through its local `/v1` endpoint.

---

## 1. Quick Start / Khởi chạy nhanh

### Bước 1: Khởi động APIRouter
```bash
# Chế độ phát triển (port mặc định 20127)
npm run dev

# Hoặc chế độ standalone / CLI (port mặc định 20228 hoặc theo cấu hình)
npm start
# hoặc: apirouter
```

### Bước 2: Khởi động DeepSeek Harness runtime
Từ thư mục dự án APIRouter, mở một terminal riêng và chạy:
```bash
npm run harness:web
```
*Script sẽ tự động vá theme đồng bộ, loại bỏ nút chọn theme riêng trong Harness, và khởi động Harness web tại `http://127.0.0.1:3081`.*

### Bước 3: Mở trang Agent
Truy cập vào Dashboard APIRouter (ví dụ `http://127.0.0.1:20127/dashboard/agent` hoặc `http://127.0.0.1:20228/dashboard/agent`).
Trang sẽ tự động kết nối và hiển thị không gian làm việc của Harness!

---

## 2. Cấu hình Model / Combo (Tag) để chạy được luôn

Harness kết nối tới APIRouter qua chuẩn **OpenAI-compatible completions** (`/v1`). Bạn có thể cấu hình model theo một trong 2 cách:

### A. Định danh Model / Combo Tag trong APIRouter
Trong APIRouter, mọi model hoặc combo đều có định danh (ID / tag) riêng:
- **Combo tags (Khuyên dùng):** Tạo tại trang **Combos** (`/dashboard/combos`), ví dụ: `my_combo`, `code_combo`, `fast_router`... Combo có tính năng tự động chuyển đổi dự phòng (fallback) nếu một nhà cung cấp bị lỗi hoặc cạn quota.
- **Provider model tags:** Lấy từ trang **Providers**, ví dụ:
  - DeepSeek: `ds/deepseek-flash`, `ds/deepseek-chat`
  - Antigravity: `ag/claude-3-7-sonnet`, `ag/gemini-2.5-pro`, `ag/gemini-3.8-flash-high`
  - OpenAI: `oa/gpt-4o`, `oa/o3-mini`
  - OpenCode / MiMo: `oc/mimo-v2.5-free`

### B. Lấy API Key từ APIRouter
1. Vào mục **Endpoint & Key** (`/dashboard/endpoint`).
2. Sao chép một API Key đang kích hoạt (hoặc bấm **Create** để tạo key mới).

---

### Cách 1: Cấu hình qua file `cordis.patch.yml` (Khuyên dùng, chạy ngay lập tức)

Mở file cấu hình profile Harness (mặc định tại `../deepseek-harness/.cache/dsh-apirouter/profiles/web/cordis.patch.yml` hoặc `$DSH_HOME/profiles/web/cordis.patch.yml`):

```yaml
- id: llm-pi-ai
  config:
    providers:
      apirouter:
        displayName: APIRouter
        api: openai-completions
        baseURL: http://127.0.0.1:20127/v1 # Đổi cổng theo port APIRouter đang chạy (20127 hoặc 20228)
        apiKeyEnv: APIROUTER_API_KEY
        compat:
          thinkingFormat: deepseek
        models:
          - id: my_combo
            name: APIRouter Multi-Model Combo
            contextWindow: 1000000
            maxTokens: 32768
            input:
              - text
              - image
          - id: ds/deepseek-flash
            name: DeepSeek Flash
          - id: ag/claude-3-7-sonnet
            name: Claude 3.7 Sonnet
          - id: ag/gemini-2.5-pro
            name: Gemini 2.5 Pro

- id: agent-default-model
  config:
    provider: apirouter
    model: my_combo # Chọn model tag mặc định khi mở session mới

- id: ui-settings-models
  config:
    credentialOnboarding: false
```

*Lưu ý:* Thiết lập biến môi trường `APIROUTER_API_KEY=<key_cua_ban>` trong terminal chạy `npm run harness:web`, hoặc điền key trong mục Settings của Harness.

---

### Cách 2: Thêm Model trực tiếp trên giao diện Harness

1. Trong giao diện Agent, bấm vào biểu tượng **Settings (Cài đặt)** ở góc dưới sidebar của Harness.
2. Chọn mục **Models**.
3. Tại nhà cung cấp **APIRouter**:
   - **Base URL:** `http://127.0.0.1:20127/v1` (hoặc `http://127.0.0.1:20228/v1`)
   - **API Key:** Dán API key lấy từ APIRouter.
4. Bấm **Add Model** (hoặc dấu `+`):
   - **Model ID (Tag):** Nhập chính xác tên model tag hoặc combo tag trong APIRouter (ví dụ: `my_combo` hoặc `ds/deepseek-flash`).
   - **Context Window:** `1000000` (hoặc dung lượng model hỗ trợ).
   - Chọn loại input: `text`, `image` (nếu model có hỗ trợ Vision).
5. Bấm **Save** (Lưu).

---

## 3. Tạo Session và chạy Agent

1. Tại thanh bên Harness, bấm **New Session** (hoặc phím tắt `Ctrl + Shift + O` / `Cmd + N`).
2. Chọn Model ở góc dưới khung nhập chat (chọn `my_combo` hoặc model bạn vừa thêm).
3. Chọn thư mục Workspace dự án muốn Agent làm việc cùng.
4. Nhập yêu cầu lập trình / task của bạn và bấm gửi $\rightarrow$ Agent bắt đầu đọc file, lập kế hoạch, chạy lệnh terminal và giải quyết nhiệm vụ ngay lập tức!

---

## 4. Các tính năng giao diện tiện ích

* **Activity Bar tự động:** Khi vào trang Agent, thanh bên APIRouter tự động chuyển sang dạng ray 64px (Activity Bar) để nhường toàn bộ không gian cho Workspace Sidebar và khung làm việc của Harness.
* **Chế độ Focus Mode:** Bấm nút **Focus Mode** trên thanh công cụ đầu trang (hoặc bấm phím **`Esc`** để thoát) để mở rộng Workspace ra toàn màn hình.
* **Đồng bộ Sáng/Tối:** Chuyển đổi theme ở nút Mặt trời/Mặt trăng trên Header APIRouter sẽ tự động đổi màu Harness đồng bộ theo thời gian thực.
* **Đóng/mở nhanh thanh bên:** Nhấn tổ hợp phím **`Ctrl + B`** (hoặc `Cmd + B`).

---

## 5. Danh mục biến môi trường nâng cao

| Biến môi trường | Ý nghĩa | Mặc định |
| --- | --- | --- |
| `APIROUTER_HARNESS_DIR` | Đường dẫn tuyệt đối đến thư mục mã nguồn deepseek-harness | `../deepseek-harness` |
| `APIROUTER_HARNESS_PORT` | Cổng HTTP của Harness runtime | `3081` |
| `DSH_HOME` | Thư mục lưu cấu hình, credentials và sessions của Harness | `~/.apirouter/harness` hoặc `.cache/dsh-apirouter` |
| `DATA_DIR` | Thư mục dữ liệu APIRouter | `~/.apirouter` |
| `APIROUTER_API_KEY` | API key APIRouter cấp cho Harness khi khởi động | (Đọc từ environment) |
