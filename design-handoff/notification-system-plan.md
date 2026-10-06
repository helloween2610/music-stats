# Kế hoạch hệ thống thông báo

**Trạng thái 05/10/2026:** đã triển khai và kiểm thử trên local; chưa áp dụng migration remote, chưa deploy Worker hoặc Zalo Mini App.

## Phạm vi đã chốt

Hệ thống chỉ tạo các nhóm thông báo sau:

1. Bài hát vào Top 100 All time.
2. Bài hát tăng hạng mạnh hoặc vượt các mốc hạng quan trọng.
3. Nghệ sĩ Top 25 All time đã quá nhịp nghe trung bình.
4. Nghệ sĩ yêu thích chuyển sang trạng thái bị bỏ quên.
5. Phát hiện bản phát hành mới, sắp phát hành, phát hành hôm nay hoặc đổi ngày phát hành.
6. Tóm tắt các thay đổi quan trọng trong ngày.

Không tạo thông báo cho:

- Hoàn thành album.
- Mốc lượt nghe của bài hát hoặc nghệ sĩ.
- Thay đổi thư viện.

## Nguyên tắc vận hành

- Server tính và lưu thông báo. App chỉ đọc danh sách, số chưa đọc và gửi thao tác đánh dấu đã đọc.
- Lần chạy đầu chỉ lưu snapshot làm mốc, không tạo thông báo từ dữ liệu cũ.
- Mỗi sự kiện có `fingerprint` duy nhất để cùng một thay đổi không bị báo lại.
- Nếu một bài đồng thời tăng mạnh và vượt mốc hạng, chỉ giữ thông báo có mức ưu tiên cao nhất.
- Các thay đổi nhỏ được gộp vào tóm tắt, không tạo nhiều thông báo riêng.
- Không dùng iTunes, Apple Music, Last.fm Similar hoặc Lyrics để quyết định các thông báo cốt lõi.

## Luật tạo thông báo

### Bài hát

- **Vào Top 100:** hạng trước lớn hơn 100 và hạng mới từ 1 đến 100.
- **Vượt mốc:** đi qua một trong các mốc 100, 80, 50, 25, 10 hoặc lên hạng 1.
- **Tăng mạnh:** tăng ít nhất 5 bậc khi đang trong Top 100. Trong Top 10, tăng từ 1 bậc đã đủ điều kiện.
- Thứ tự ưu tiên khi trùng: hạng 1 → Top 10 → Top 25 → Top 50 → Top 80 → Top 100 → tăng mạnh.
- Snapshot lưu Top 300 để phân biệt một bài thật sự đi từ ngoài Top 100 vào Top 100. Bài không có trong snapshot cũ không tự động được xem là bài mới vào hạng.

### Nghệ sĩ

- Xác định Top 25 bằng **giờ nghe All time hiện tại**.
- Chỉ đánh giá nhịp nghe khi nghệ sĩ có ít nhất 5 ngày nghe khác nhau.
- Mức quá hạn đầu tiên: số ngày từ lần nghe cuối lớn hơn `max(avgGapDays × 1,25; 3 ngày)`.
- Mức quá hạn thứ hai: lớn hơn `avgGapDays × 2`.
- Mỗi mức chỉ thông báo một lần. Nghe lại nghệ sĩ sẽ xóa trạng thái quá hạn và bắt đầu chu kỳ mới.
- **Bị bỏ quên:** phát thông báo khi nghệ sĩ lần đầu chuyển sang cờ `!!!`; không báo lại cho tới khi nghệ sĩ thoát trạng thái rồi quay lại.

### Bản phát hành

- Báo khi server lần đầu phát hiện một bản phát hành hợp lệ của nghệ sĩ đang theo dõi.
- Nhắc một lần khi còn 7 ngày và một lần trong ngày phát hành.
- Nếu ngày phát hành thay đổi, tạo một thông báo riêng nêu ngày cũ và ngày mới.
- Dùng `release.id` làm định danh; nếu nguồn đổi nhưng bản phát hành không đổi thì không tạo thông báo mới.

### Tóm tắt

- Tóm tắt ngày gộp các sự kiện nhỏ và hiển thị số thay đổi theo từng nhóm.
- Không tạo bản tổng kết tuần.
- Bài giảm hạng hoặc rời Top 100 không tạo thông báo.

## Lưu trữ trên server

Thêm migration mới với hai bảng:

### `notification_events`

- `id`: mã sự kiện.
- `fingerprint`: khóa chống trùng, unique.
- `type`: loại thông báo.
- `entity_kind`, `entity_id`: bài hát, nghệ sĩ hoặc bản phát hành.
- `title`, `body`: nội dung hiển thị.
- `priority`: `high`, `normal`, `digest`.
- `route`: đường dẫn mở khi chạm.
- `payload`: JSON chứa hạng cũ/mới, ngày phát hành hoặc dữ liệu tổng kết.
- `event_at`, `created_at`, `read_at`.

### `notification_state`

- `key`: khóa trạng thái, ví dụ `song-rank:TR01234` hoặc `artist-overdue:Aephanemer`.
- `value`: JSON snapshot gần nhất.
- `updated_at`.

Giữ tối đa 180 ngày thông báo. Snapshot trạng thái không tự xóa khi dọn lịch sử thông báo.

## API

- `GET /notifications?limit=50&before=...`: danh sách, nhóm ngày và số chưa đọc.
- `POST /notifications/read`: đánh dấu một danh sách ID hoặc tất cả đã đọc.
- `GET /notifications/settings`: đọc cấu hình.
- `POST /notifications/settings`: bật/tắt từng nhóm thông báo.

Các POST trên được thêm vào quyền của `USER_TOKEN`; preview chỉ được đọc.

## Thời điểm tính

- Sau mỗi lần đồng bộ Last.fm thành công: cập nhật hạng bài và trạng thái nghệ sĩ.
- Sau khi hàng đợi quét phát hành lúc 07:30 hoàn tất: tính thông báo phát hành.
- Sau lần đồng bộ đầu tiên của ngày: tạo tóm tắt ngày nếu có sự kiện.
- Nút đồng bộ thủ công cũng chạy bộ phát hiện, nhưng `fingerprint` bảo đảm không tạo trùng.

## Giao diện app

- Thêm biểu tượng chuông trên header và badge số chưa đọc.
- Thêm màn `notifications`, không chiếm một tab dưới cùng.
- Chia danh sách thành **Hôm nay**, **Tuần này**, **Trước đó**.
- Thông báo quan trọng hiển thị riêng; thay đổi nhỏ nằm trong một thẻ tóm tắt.
- Chạm thông báo mở đúng trang bài hát, nghệ sĩ, album phát hành hoặc màn thống kê tương ứng.
- Có thao tác **Đánh dấu tất cả đã đọc** và phần bật/tắt từng nhóm.
- Khi app mở, chỉ tải danh sách đã lưu; không kích hoạt quét hoặc tính lại dữ liệu.

## Trình tự triển khai

### Giai đoạn 1 — Nền tảng server

1. Thêm migration và lớp truy cập dữ liệu thông báo.
2. Viết các detector dạng hàm thuần cho hạng bài, nghệ sĩ quá hạn và trạng thái bị bỏ quên.
3. Tạo snapshot ban đầu im lặng.
4. Tích hợp detector sau đồng bộ Last.fm.

Điều kiện hoàn tất: đồng bộ lặp lại không tạo thông báo trùng; lần chạy đầu không phát sinh lịch sử giả.

### Giai đoạn 2 — Bản phát hành và tóm tắt

1. So sánh snapshot phát hành trước/sau hàng đợi quét 07:30.
2. Tạo các mốc mới phát hiện, trước 7 ngày, hôm phát hành và đổi ngày.
3. Tạo bộ tổng hợp thay đổi quan trọng trong ngày.

Điều kiện hoàn tất: một bản phát hành chỉ có đúng một thông báo cho mỗi mốc và vẫn hoạt động khi nguồn MusicBrainz/Bandcamp thay đổi.

### Giai đoạn 3 — API và giao diện

1. Thêm API đọc, đánh dấu đã đọc và cài đặt.
2. Thêm chuông, badge và màn danh sách.
3. Nối điều hướng tới các màn chi tiết hiện có.
4. Lưu cài đặt trên server để các thiết bị dùng cùng trạng thái.

Điều kiện hoàn tất: badge khớp số chưa đọc, thao tác đọc được giữ sau khi tải lại và mọi liên kết mở đúng đối tượng.

### Giai đoạn 4 — Kiểm thử và hiệu chỉnh

1. Unit test từng ngưỡng hạng, ưu tiên khi trùng, hai mức quá hạn và reset sau khi nghe lại.
2. Integration test D1 cho chống trùng, đánh dấu đọc, dọn dữ liệu 180 ngày và lịch cron.
3. Test preview bằng fixture có đủ trạng thái rỗng, một sự kiện, nhiều sự kiện và nội dung dài.
4. Chạy typecheck, toàn bộ test và build web.
5. Kiểm tra trên Zalo Testing; chỉ deploy khi có yêu cầu riêng.

## Tiêu chí nghiệm thu toàn hệ thống

- Không có ba nhóm đã loại khỏi phạm vi.
- Không tạo thông báo cũ trong lần khởi tạo.
- Không tạo trùng khi sync, reload hoặc cron chạy lại.
- Hạng bài được so với snapshot lần đồng bộ trước, không dùng nhầm snapshot tháng.
- Nghệ sĩ quá hạn dùng Top 25 theo giờ nghe All time và có đủ mẫu nghe.
- App không tự kích hoạt quét khi mở màn thông báo.
- Thông báo đã đọc và cài đặt được giữ giữa các phiên và thiết bị.
- Tất cả đường dẫn từ thông báo mở đúng màn chi tiết.
- Không deploy cho tới khi người dùng yêu cầu.
