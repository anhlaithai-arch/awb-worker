# Worker tự đọc Google Sheet và dùng Workers AI đối chiếu địa chỉ

## File đã cấu hình
DATA_SHEET_ID: 19iJGccjb-EplvSOGF6Axo9gJUfQ03gMXEize_o4Kef4
DATA_SHEET_NAME: Hub name
Đã quan sát trực tiếp tab Hub name: B State (tỉnh), C City (huyện), D District (xã/phường cũ), J Pick Station (Hub tool hiện dùng), P Sort code, Q Xã mới, R Tỉnh mới. N là Return Station; bản này giữ ánh xạ J của tool hiện tại, chưa tự đổi nghiệp vụ sang N.
Worker chỉ yêu cầu A:R của tab Hub name. Không đọc tab cookie.

## Google
1. Google Cloud Console: chọn/tạo project; bật Google Sheets API.
2. IAM & Admin → Service Accounts → Create service account. Không cần cấp project-wide role hay domain-wide delegation.
3. Mở Service Account → Keys → Add key → Create new key → JSON. Lưu file an toàn; không upload vào repo hoặc chat.
4. Mở Google Sheet → Share → thêm client_email trong JSON với quyền Viewer.
Quyền Viewer là cấp toàn file. Nếu không muốn Service Account có khả năng đọc tab cookie, dùng file chỉ chứa dữ liệu Hub, thay DATA_SHEET_ID và đồng bộ dữ liệu với Sheet gốc của tool.
Nếu tổ chức chặn chia sẻ ra Service Account hoặc chặn tạo khóa, cần quản trị viên hỗ trợ; không mở file công khai.

## Cloudflare Secrets
Worker awb-worker → Settings → Variables and Secrets → Add.
GOOGLE_SERVICE_ACCOUNT_JSON: kiểu Secret, nội dung toàn bộ JSON khóa Service Account.
WORKER_API_KEY: kiểu Secret, một chuỗi ngẫu nhiên ít nhất 24 ký tự để bảo vệ endpoint đọc Sheet/AI.
Ví dụ tạo chuỗi bằng password generator; KHÔNG dùng ví dụ hoặc cookie SPX làm khóa.
Không đặt hai Secret này trong wrangler.jsonc hoặc GitHub.

## GitHub / deploy
Upload các file index.js, sheet-ai.mjs, build.mjs, package.json, package-lock.json, wrangler.jsonc vào root repo awb-worker.
Build command trống; Deploy command: npm run build && npx wrangler deploy --no-bundle.
Node 24, AI binding AI đã có trong wrangler.jsonc.
GET Worker phải trả version awb-sheet-ai-2.0.0.

## Apps Script
Thay Code.gs và index.html bằng hai file kèm theo.
Project Settings → Script properties: thêm AI_WORKER_API_KEY, giá trị giống hệt WORKER_API_KEY của Cloudflare.
Chạy testWorkersAISheetConnection trước. Thành công: ok=true, rowCount>0, source đúng file/tab.
Chạy testWorkersAIAddress (có thể thay địa chỉ mẫu trong hàm).
Sau khi hai bài test ổn, triển khai Web App phiên bản mới.

## Luồng và giới hạn
GAS lấy receiver từ AWB qua Worker hiện có, rồi gửi action address_lookup chỉ gồm địa chỉ và khóa gọi API ở header. Không gửi cookie vào prompt AI.
Worker dùng Service Account readonly để đọc Sheet, lọc tối đa 80 ứng viên; vượt giới hạn thì yêu cầu địa chỉ rõ hơn, không cắt ngầm.
AI trả ID dòng và trích dẫn nguyên văn địa chỉ. Worker kiểm tra ID, loại Xã/Phường, bằng chứng và toàn bộ dòng Sheet; GAS kiểm tra lại tuple địa bàn/Hub/Sort Code trên Sheet gốc trước khi dùng.
AI lỗi hoặc chọn thiếu căn cứ: không chuyển. AI chỉ báo chưa phân biệt được: giữ ứng viên đã khớp bằng code và quy tắc đếm Hub bạn yêu cầu, không gọi đó là AI xác nhận.
Hub nhiều kết quả nhất duy nhất được chọn; đồng hạng thì kiểm tra thủ công. Trong Hub còn nhiều xã/Sort Code: điền Hub, để trống xã/Sort Code.
Không thể xác minh phân tuyến đến đường/thôn nếu Sheet không chứa dữ liệu đó; AI không tự tạo bản đồ phân tuyến.
Sheet cache trong bộ nhớ mỗi Worker 30 giây để giảm số lượt đọc khi chạy nhiều mã; có checkedAt trong source. Đặt SHEET_CACHE_SECONDS=0 để tắt. sheet_test luôn đọc mới; GAS vẫn đối chiếu Sheet gốc mỗi lần.
Không có Sheet cache công khai, không log khóa, token, PDF hoặc địa chỉ trong Worker.
Test cục bộ đã dùng JWT ký thật với khóa tạm và dịch vụ Google/AI giả lập, chưa xác minh quyền Service Account/tài khoản thực.

Tài liệu:
https://developers.google.com/identity/protocols/oauth2/service-account
https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get
https://developers.cloudflare.com/workers-ai/configuration/bindings/
