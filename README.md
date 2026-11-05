# Sửa tách riêng cột người nhận

Đầu vào giữ đúng GAS hiện tại: POST {"awb_url":"https://spx.shopee.vn/api/awb_print/label/print?token_str=...","debug":true}.
Đầu ra: ok, awb, sort_line, sender, receiver, recipient_name, address; khi debug=true có thêm items/rows.
Không cần cookie gửi Worker vì token AWB đủ để tải mẫu PDF đã thử.

Repo đã dùng bộ build trước: thay index.js bằng file mới này. wrangler.jsonc đặt name là awb-worker, đúng URL bạn đưa.
Nếu repo chưa có build config, thêm các file kèm theo.
Cloudflare build command: npm run build
Cloudflare deploy command: npx wrangler deploy --no-bundle
Node: 24. compatibility date 2026-08-01, flag nodejs_compat.
Commit main, chờ deploy xong rồi chạy lại awbTestPreview trong GAS. Không dán các ký hiệu diff @@ vào code.
GET Worker trả version receiver-columns-1.1.0.

Nguyên nhân: dòng PDF chứa cả Từ và Đến; tìm ^Đến trên cả dòng sẽ thất bại. Bản mới tìm từng nhóm mảnh ký tự trong dòng để xác định x của mỗi tiêu đề, sau đó lọc cột TRƯỚC khi ghép text.

Giới hạn: nhãn một trang có lớp text với hai cột Từ/Đến. Không xác định được vùng thì trả lỗi, không lấy nhầm bên gửi. Nhãn không có Dchi vẫn lấy tên từ dòng đầu, địa chỉ từ các dòng tiếp theo; receiver giữ nguyên toàn bộ vùng để kiểm tra.
Đã kiểm tra PDF thật đơn SPXVN06833565649B và fixture tọa độ dựng theo ảnh đơn SPXVN06802469153B; chưa có PDF gốc của đơn mới.
Đã kiểm tra runtime workerd local, build và Wrangler dry-run. Chưa deploy tài khoản của bạn.
