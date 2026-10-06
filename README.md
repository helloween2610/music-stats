> **Bản chính: Version 2.** Phát triển, build và deploy từ `/Volumes/MIN LAB/Pepple app/music-stats-v2/zalo-miniapp/music-stats`. Thư mục `music-stats` cũ là bản lưu V1.

# Sổ Nghe Nhạc — Zalo Mini App

Mini app thống kê nghe nhạc cá nhân (Last.fm + thư viện Apple Music). Dữ liệu đọc từ server Cloudflare Worker (`../../server`), mini app chỉ hiển thị.

Giao diện dựng theo bản thiết kế trong [design-handoff/](design-handoff/) (React + ZaUI).

Đã tích hợp handoff ngày 02/10/2026 (prompt 10): 4 tab, nhãn All time, thời lượng `Nd Nh Nm`, ẩn lv và nút chia sẻ, trang Bài đang lên hạng, bỏ Album khỏi Top 1–3 theo kỳ. Khi Hôm nay hiển thị top tháng trước, nhãn so sánh tự tính tháng liền trước của kỳ đó (ví dụ mở tháng 10: “Tháng trước · so với T08/26”).

## Chạy và deploy

### Xem thiết kế trên trình duyệt

```bash
npm run dev:web
```

Mở http://127.0.0.1:4174/browser.html để xem giao diện tương tác kiểu điện thoại của Version 2. Mở http://127.0.0.1:4174/web.html để xem phiên bản web/laptop responsive; bản web có sidebar điều hướng riêng, màn Hôm nay/Thống kê/Diễn biến được bố trí riêng cho laptop. Thống kê dùng hàng chỉ số ngang, lưới chart và cột điểm nhấn; chart cao 180–220px. Sidebar thu gọn khi màn hình dưới 1100px, các vùng nội dung chuyển cột ở 720px và 520px. CSS web được nạp riêng, không áp dụng lên bản mobile.

Bản xem dùng dữ liệu thật từ server (`API_BASE` / `API_TOKEN`), cùng cơ chế lưu dữ liệu gần nhất như bản Zalo. Preview luôn chọn Server, kể cả khi `.env` đặt nguồn Mẫu. Điều hướng nằm trong phiên xem; tải lại sẽ trở về Hôm nay.

```bash
npm run build:web    # xuất bản web riêng vào dist-web/
npm run preview:web  # xem bản đã build tại /browser.html
```

Thư mục `dist-web/` có thể phục vụ bằng HTTP static server. Cấu hình Zalo vẫn dùng `vite.config.mts`; cấu hình trình duyệt dùng `vite.web.config.mts`.

### Zalo Mini App

```bash
npm install
zmp start     # dev server: http://localhost:3000 (khung giả lập Zalo), app ở http://localhost:2999
npm run typecheck   # kiểm tra kiểu TypeScript
zmp build     # build ra www/
zmp login && zmp deploy
```

Bản build production chỉ chạy dưới đường dẫn `/zapps/<APP_ID>` của Zalo; mở `www/` trực tiếp trên trình duyệt sẽ ra trang trống.

## Cấu hình

- Giao diện luôn sáng trên cả Zalo và trình duyệt (`<App theme="light">`), không phụ thuộc chế độ tối của Zalo/điện thoại. Màu chữ thanh hệ thống đặt đen cho cả hai chế độ.

- `src/config.ts`: địa chỉ server (`API_BASE`), token (`API_TOKEN`), nguồn dữ liệu (`Server` hoặc `Mẫu`).
- Token: mặc định là token chỉ đọc (`read_…`, như bản thiết kế). Bản build của chủ app đặt `VITE_API_TOKEN=<USER_TOKEN của server>` trong `.env` (không lên git; lấy trong `server/.dev.vars`). `USER_TOKEN` đọc mọi thứ, bấm hai nút đồng bộ, ghép bài chưa khớp (`POST /library/match`) và bật/tắt gộp remaster (`POST /settings/rules`). Với token chỉ đọc, hai việc sau chỉ mô phỏng trên máy.
- Thêm domain server (`stats.helloween2610.workers.dev`) vào danh sách domain được phép của mini app trên trang quản lý Zalo Mini App, nếu không app trên Zalo sẽ không gọi được API.
- `app-config.json`: tiêu đề app; `actionBarHidden: true` vì header vẽ bằng ZaUI `Header`, cụm ⋯ | ✕ của Zalo nằm đè góc phải.

## Cấu trúc

| Đường dẫn | Nội dung |
|---|---|
| `src/components/layout.tsx` | App, router, Header, BottomNavigation 4 tab; Thống kê mở thẳng Tổng quan |
| `src/vm.ts` | View-model từng màn: số mẫu → ghi đè bằng dữ liệu server |
| `src/screens/main.tsx` | Hôm nay, Top 100, Nghệ sĩ All time, Diễn biến, Bài đang lên hạng, Tổng quan |
| `src/screens/detail.tsx` | Thư viện, Bài chưa khớp, Quy tắc thay thế, Chi tiết bài, Chi tiết nghệ sĩ |
| `src/components/sheets.tsx` | Sheet chia sẻ ảnh thẻ 4:5 (html-to-image + zmp-sdk), sheet tìm bài |
| `src/lib/charts.ts` | Biểu đồ SVG (chạm để chọn cột/điểm) |
| `src/lib/api.ts` | Gọi server: dùng chung kết quả theo path, timeout 12 giây, path lỗi gọi lại sau 30 giây |
| `src/lib/sync.ts` | Nút Đồng bộ Last.fm (`POST /sync`) và thư viện Apple Music (`POST /library/sync-request`, hỏi lại mỗi 20 giây) |
| `src/lib/sample.ts` | Dữ liệu mẫu từ bản thiết kế |
| `src/css/app.scss` | Design tokens sáng/tối và lớp dùng chung |

## Tổng quan và đồng hồ tuần

Trang Xếp hạng, route `/rank`, công tắc Xếp hạng/Tổng quan và state của trang đó đã được xoá. Tab Thống kê mở thẳng Tổng quan; hai trang Top 100 All time và Nghệ sĩ All time được mở từ Tổng quan.

Bộ lọc tuần đã được xoá khỏi Thống kê. Đồng hồ trên Hôm nay vẫn gọi `/overview?scope=week`, tính từ thứ Hai đến hiện tại theo giờ Việt Nam, kể cả tuần vắt qua tháng/năm.

## Hành vi khi server lỗi

Mỗi response hợp lệ được lưu vào bộ nhớ và localStorage theo server/tài khoản/path (gồm kỳ, bộ lọc, ID). Khi mở lại, app hiện dữ liệu đã lưu và tải mới. Lỗi mạng, 401, 5xx, timeout hoặc response sai dạng giữ dữ liệu thành công gần nhất, kèm nhãn và thời điểm lưu. Không tự thay bằng dữ liệu mẫu. Màn chưa từng tải thành công hiện “Chưa có dữ liệu” và nút “Thử lại”. Server hết hạn mức D1 (503 `d1_daily_limit`) thì nhãn ghi “Server tạm nghỉ đến 7:00”. Cache trên máy có giới hạn dung lượng; nếu trình duyệt chặn lưu trữ hoặc người dùng xóa dữ liệu ứng dụng thì chỉ giữ được trong phiên hiện tại. Kỳ rỗng (đầu tuần, đầu tháng) không tính là lỗi: Hôm nay hiện top 5 tháng trước, Tổng quan hiện trạng thái trống.

## Ảnh

Ảnh bìa / avatar lấy từ `/artwork` (bài theo track_id, album theo nghệ sĩ + album, nghệ sĩ theo tên). Không có ảnh hoặc ảnh lỗi thì hiện chữ viết tắt.

## Đồng bộ

Hai nút Đồng bộ ở Thư viện (và kéo xuống ở đầu trang Hôm nay), nút Ghép và công tắc gộp remaster là các POST duy nhất app gửi. Chỉ gửi khi người dùng bấm, không tự gọi khi mở app.

## Làm mới dữ liệu

Kết quả mỗi path được giữ trong phiên và bản thành công gần nhất được lưu trên máy. Làm mới chỉ xóa trạng thái request, không xóa bản dữ liệu dự phòng. Bấm Đồng bộ / kéo làm mới tải lại các số hôm nay, tuần, tháng; mở lại app sau hơn 10 phút ở nền cũng vậy. Ghép bài, đổi quy tắc, đồng bộ thư viện xong thì tải lại tất cả.

## Biểu đồ và thứ tự hiển thị

- Thanh tab: Hôm nay → Diễn biến → Thống kê → Thư viện.
- Nghệ sĩ đang lên: trong từng tháng, sắp theo hạng All time hiện tại tăng dần (#1 trước #2), không theo số bậc tăng.
- Tổng quan “Theo giờ”: đồng hồ tròn 24 múi, 00/06/12/18 theo chiều kim đồng hồ, chiều cao thanh tỉ lệ lượt nghe. Chọn mặc định giờ nhiều lượt nhất; chạm hoặc dùng bàn phím để đổi giờ. Biểu đồ dùng màu giao diện sáng.

- Hôm nay: đồng hồ 24 giờ lấy `byHour` của tuần hiện tại (thứ Hai đến ngày đang xem, giờ Việt Nam) từ `/overview?scope=week`; tuần chưa nghe hiển thị 24 múi trống.
- Tổng quan: bộ lọc đảo từ tháng trước đến All time. Hai biểu đồ tổng hợp theo tháng không hiển thị khi chọn một tháng.
- Top nghệ sĩ / bài hát hiển thị 5 dòng đầu của kỳ đang xem. All time dùng cùng nguồn với trang Nghệ sĩ All time / Top 100 All time; kỳ khác mở trang danh sách riêng, giữ nguyên kỳ và ngày chốt. API overview hỗ trợ `limit` tối đa 5000 cho danh sách đầy đủ.

- Trang Top theo kỳ dùng cùng dòng thông tin với Top 100 All time / Nghệ sĩ All time. Hạng, lượt/giờ nghe thuộc kỳ đang xem; lịch sử top 100, điểm, cờ và lần nghe cuối được ghi rõ là All time. Thông tin thiếu không được tạo giả; mũi tên không hiện “Mới” khi chưa tải được kỳ so sánh.
- Đồng hồ tuần trên Hôm nay dùng thẻ ngang: vòng tròn tối đa 190 px, thông tin giờ/lượt ở bên phải.

- Đã xoá nhóm hai liên kết tắt All time khỏi Tổng quan; các trang All time vẫn mở qua “Xem tất cả” của từng mục Top.

Biểu đồ từng ngày ở Hôm nay hiển thị Trung bình → Tuần trước → Tuần này. Trung bình cùng thứ tính từ 01/06/2024 đến Chủ nhật tuần trước, gồm cả ngày không nghe; không tính tuần hiện tại chưa hoàn tất. Dòng readout vẫn có trong code nhưng được ẩn bằng `hidden`.

Top album nằm trước Top bài hát trong Thống kê. Trang Top nghệ sĩ/bài hát có biểu đồ lịch sử Top 10: kỳ tháng cộng dồn theo ngày, kỳ năm cộng dồn theo tháng, từ 04/2024 xem 12 mốc tháng gần nhất; All time dùng lịch sử All time. Khoảng trống là ngoài Top 10 hoặc thiếu lịch sử, không thay bằng hạng giả. Biểu đồ nghệ sĩ theo lượt/giờ tương ứng bộ lọc; khi xem điểm All time, biểu đồ vẫn ghi rõ xếp theo giờ nghe.

Tất cả trang Top nghệ sĩ và bài hát dùng tab Lịch sử riêng. Biểu đồ lấy đủ các mục trong danh sách (bài hát giữ bộ lọc đang chọn), chiều cao theo hạng cuối hiện tại; các mốc hạng thấp hơn được bỏ khỏi biểu đồ. Trang bài hát có Danh sách / Lịch sử; nghệ sĩ theo thứ tự Giờ nghe / Lượt / Điểm / Lịch sử. API lịch sử theo kỳ dùng limit=5000 giống danh sách đầy đủ.

Lịch sử ở các kỳ ngoài All time giới hạn Top 25 và trục hạng dừng ở hạng cuối nhóm này; tab danh sách vẫn giữ đủ dữ liệu. Lịch sử nghệ sĩ và bài hát All time giữ nguyên toàn bộ danh sách.

## Playlist từ XML

Playlist hiển thị dạng lưới 3 cột với ô thấp, gọn. Trong `_New Music`, mọi bài đều hiện scrobbles và người nghe cộng đồng Last.fm; `00_COLLECTION` chỉ hiện lượt và thời gian nghe All time của người dùng. Số liệu cộng đồng chỉ tải các dòng gần vùng xem, gửi tuần tự, lưu kết quả 24 giờ (không tìm thấy: 1 giờ). Dấu “—” là thiếu dữ liệu, không phải 0. Bài ngoài thư viện dùng endpoint `GET /discovery/lastfm?artist=...&title=...`; thay đổi này cần deploy cả backend và frontend để dùng trên Zalo.

Thư viện → Danh sách playlist nằm trên Lượt nghe chưa khớp. Chỉ lấy playlist trong folder `_New Music`, `00_COLLECTION` và các folder con, giữ thứ tự bài, bài trùng, playlist rỗng và các bài `Playlist Only`. Bài đã ghép với thư viện hiện tại mở trang bài hát; bài còn lại dùng hộp thoại chia sẻ Apple Music hiện có.

Dữ liệu là bản chụp XML đóng gói riêng, chỉ tải khi mở trang playlist. Không tự tải lại XML hoặc thay đổi luồng đồng bộ thư viện đang tạm dừng. Để cập nhật bản chụp, chạy từ thư mục frontend:

```sh
python3 scripts/import-playlists.py '/đường/dẫn/Library.xml'
```

Sau đó build và deploy frontend như bình thường. Bản chụp chỉ giữ metadata của các bài được tham chiếu; không mang theo đường dẫn file nhạc. Nếu một Track ID không có trong XML, giữ một dòng thiếu thông tin, không tự suy đoán bài. Kiểm tra parser bằng `python3 scripts/test_playlists.py`, kiểm tra ghép bài bằng `node --test tests/playlists.test.mjs`.
