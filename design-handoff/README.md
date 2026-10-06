# Handoff: Sổ Nghe Nhạc — Zalo Mini App

## Overview
Mini app thống kê nghe nhạc cá nhân (Last.fm + thư viện Apple Music), chạy trong Zalo trên iPhone và Android. Dữ liệu lấy từ server riêng (đã tính sẵn), mini app chỉ đọc và hiển thị.

## About the Design Files
File `So Nghe Nhac - Zalo Mini App.dc.html` là **bản thiết kế tham chiếu viết bằng HTML** (mở trực tiếp trong trình duyệt, cần `support.js` cùng thư mục). Đây không phải code để dùng thẳng. Nhiệm vụ là dựng lại bằng **React + ZaUI (zmp-ui)** theo cấu trúc dự án Zalo Mini App (`zmp-sdk`), dùng component sẵn có của ZaUI khi có tương đương.

## Fidelity
**High-fidelity.** Màu, chữ, khoảng cách, bo góc, tương tác là bản cuối. Dữ liệu là dữ liệu mẫu — thay bằng API server.

## Khung & điều hướng
- Khổ thiết kế 375 × 812; kiểm tra 360 × 800 (Android) và 430 × 932. Không chữ/bảng nào tràn ngang: mọi cột text dùng `minmax(0,1fr)` + ellipsis.
- **Thanh tiêu đề Zalo** (header native, cấu hình qua `app-config.json` / `setNavigationBarTitle`): tiêu đề trang bên trái, cụm "⋯ | ✕" của Zalo góc phải — **không đặt nội dung trong ~100 px góc phải trên**. Cao 44 + safe-area top. Không dùng large title.
- **BottomNavigation** (ZaUI) 4 tab, cao 56 + safe-area bottom (34 trên iPhone có tai thỏ): Hôm nay · Thống kê · Diễn biến · Thư viện.
- **Tab Thống kê:** tiêu đề trang là "Thống kê". Ngay dưới header có Tabs gạch chân "Xếp hạng | Tổng quan", chạm để đổi màn (`screen` = `rank` | `overview`), không đẩy vào stack. "Xem tất cả" ở Top bài tháng này mở Thống kê → Xếp hạng. Tab đang chọn màu `--accent`, nhãn 11/600; tab khác `--text3`, 11/500.
- Trang chi tiết (Top 100, Nghệ sĩ All time, **Bài đang lên hạng** (`rising`), Bài hát, Nghệ sĩ) push lên stack; quay lại bằng nút ← của header Zalo. Tab bar vẫn hiển thị.
- Vùng nội dung: padding trên = chiều cao header, dưới = BottomNavigation + 16.

## Màn hình
1. **Lần đầu mở**: spinner, dòng "Đang tải dữ liệu…" và skeleton.
2. **Hôm nay**: thẻ Tuần này / Tháng này / Năm 2026, biểu đồ từng ngày, Vừa nghe, "Top nghệ sĩ tuần này" (xếp theo **giờ nghe**, ngày chưa tới hiện "·"), "Top bài tháng này" (thay đổi so với tháng trước, không ★, không sparkline).
3. **Xếp hạng**: Tabs **Bài hát · Nghệ sĩ · Album**, kèm chip kỳ.
   - Cột thay đổi hạng chỉ có ở Tuần (so với tuần trước), Tháng (so với tháng trước) và All time (so với cuối tháng trước). Ở 7 ngày, 1 tháng, 100 ngày, Từ 04/2024 không có cột này, tên dịch sang trái.
   - Sparkline hạng 18 tháng chỉ có ở All time.
   - **Album** chỉ có bảng All time: ẩn chip kỳ, hiện dòng "Album chỉ xếp hạng All time". Mỗi dòng gồm hạng, bìa vuông, tên, nghệ sĩ (chạm mở trang nghệ sĩ), badge lv1–lv3 (lv3 nền `--accent`) và số giờ. Xếp theo mức rồi số giờ: lv3 ≥ 24 giờ; lv2 là album ≥ 45 phút có 5–24 giờ; lv1 còn lại.
4. **Top 100 All time**: không đổi.
5. **Nghệ sĩ All time**: Tabs Giờ nghe / Điểm / Lượt. Dòng phụ "n bài · nghe lần cuối dd/mm". Tab Điểm chỉ gồm 30 nghệ sĩ trong nhóm chấm điểm; số lớn là điểm, hạng là hạng điểm.
6. **Diễn biến**: Bài đang lên hạng; Nghệ sĩ đang lên tháng này ("#11 ← #12" là hạng All time cuối tháng so với cuối tháng trước, dòng phụ "x giờ All time").
   - **Top 1–3 theo kỳ**: chip Tuần / Tháng / Năm, mỗi kỳ một thẻ, mới nhất trước, hiện 3 thẻ rồi "Xem thêm".
   - Mỗi thẻ có 3 dòng Nghệ sĩ / Bài / Album. Kỳ tuần chỉ có bài #1 và album #1; kỳ tháng có thêm hàng chip "50+ lượt". Hạng bằng nhau thì hiện cả hai tên cùng vị trí.
   - Chạm tên nghệ sĩ hoặc bài mở trang tương ứng; chạm album mở trang nghệ sĩ.
7. **Tổng quan**: chú thích cột "Trước" là 8.323 lượt. "Top 10 album" tính theo **giờ**. "Nghệ sĩ theo điểm" **chỉ hiện ở phạm vi All time**: thanh dài theo tỉ lệ với người cao nhất, chạm mở 8 thành phần.
8. **Thư viện**:
   - Nguồn dữ liệu: "Thư viện Apple Music · 3.071 bài · thêm gần nhất 19/09/2026".
   - "Quy tắc tính" chỉ còn công tắc "Gộp bản remaster vào bài gốc", dưới đó là ghi chú Last.fm/Lark. Đổi công tắc thì hiện "Đang ghép lại các lượt chưa khớp…".
   - Lượt nghe chưa khớp: 870 lượt / 630 bài. Mỗi dòng có tối đa 3 gợi ý dạng chọn một. "Ghép" ghép vào gợi ý đang chọn; dòng không có gợi ý có nút "Tìm bài…" mở sheet tìm trong thư viện. Ghép xong hiện "Đã ghép n lượt".
9. **Chi tiết bài hát**:
   - Ô Điểm là số nguyên 0–10 theo Lark. Bài có "Stop rating" hiện "★ n/5" (nhãn "Đánh giá Apple"); bài thêm hôm nay hiện "–".
   - Bài bị loại khỏi bảng All time: ô hạng hiện "–" kèm dòng "Không xếp hạng".
   - Bảng thông tin: Thêm vào thư viện (ngày · số ngày), Lần nghe cuối, Bỏ qua, Tổng lượt (Apple đến 12/2024 + Last.fm), Thời gian đã nghe.
10. **Chi tiết nghệ sĩ**:
   - Cờ dưới tên. 3 ô hạng Tuần / Tháng / All time, dưới đó một dòng "7 ngày · 1 tháng · 100 ngày · từ 04/2024".
   - "Khoảng cách trung bình giữa các ngày nghe" và dòng "Trong thư viện: n bài · n album · thể loại".
   - Thẻ **Điểm** (chỉ khi nghệ sĩ có điểm): số lớn, hạng điểm và 8 thành phần.
   - Lượt theo tuần lấy 26 tuần gần nhất.

**Điểm nghệ sĩ (công thức Lark, R ALL)**: tổng 8 phần, không có trần: Đánh giá bài · Hạng All time · Hạng từ 04/2024 · Thành tích tuần · Thành tích tháng · Thành tích năm · Album top 30 · Bài top 100. Chỉ 30 nghệ sĩ trong nhóm chấm điểm có điểm; nghệ sĩ khác hiện "–".

**Cờ nghệ sĩ**, đặt ngay sau tên ở mọi danh sách nghệ sĩ:
- `*` màu `--accent` (đang nóng): (hạng 100 ngày ≤ 12 và hạng 1 tháng ≤ 8) hoặc (hạng 7 ngày ≤ 4 và hạng 1 tháng ≤ 8).
- `!!!` màu `--down` (đã nguội): top 10 từ 04/2024 nhưng ngoài top 15 ở cả 7 ngày, 1 tháng và 100 ngày.

Dấu ★ "nổi ở nhiều bảng" đã bỏ.

## Chia sẻ
- Nút Chia sẻ mở **Sheet** (ZaUI) với: tiêu đề "Chia sẻ ảnh thẻ", phụ đề "Ảnh 4:5 gửi vào chat Zalo", ảnh xem trước, 2 nút "Lưu ảnh" (`--surface2`) và "Gửi vào chat Zalo" (`--accent`, chữ `--ink`), cao 48.
- **Ảnh thẻ 4:5**: dựng ở 360 × 450, xuất 1080 × 1350 (scale 3). Padding 24/24/18. Đầu thẻ "SỔ NGHE NHẠC" mono 11/700 `--accent` + kỳ bên phải; chân "Tạo từ Sổ Nghe Nhạc trên Zalo" 10px `--text3`. Hai mẫu:
  - Top 10 tuần: tiêu đề 26/700, phụ đề tổng tuần, 10 dòng (hạng · tên **đậm** · nghệ sĩ · lượt).
  - Số liệu bài / nghệ sĩ: ảnh 92 + tên 24/700, 3 ô số (22/700), sparkline 14 tháng.
- Sinh ảnh: render ra canvas (vd. html-to-image) rồi dùng `openShareSheet` / `saveImageToPhotosAlbum` của zmp-sdk. Ảnh theo chế độ sáng/tối hiện tại.

## Tương tác
- Chỉ chạm, không hover. Vùng chạm tối thiểu 44 × 44 (chip cao 36 nằm trong vùng 44; link "Xem tất cả" có vùng 44).
- **Biểu đồ**: chạm cột/điểm/ô → chọn mục đó, các cột khác mờ (opacity 0.38) hoặc hiện vạch dọc đứt + chấm; giá trị hiện ở **một dòng phía trên biểu đồ** (13/600 tabular), vd. "T09/26 · 210 lượt". Mặc định chọn mục mới nhất.
- Chạm dòng bài → Chi tiết bài; dòng nghệ sĩ → Chi tiết nghệ sĩ.
- Đổi chip kỳ chỉ đổi danh sách + nhãn khoảng ngày.

## State
- **Điều hướng:** `tab`, `screen`, `id` (bài/nghệ sĩ đang xem), `stack[]` gồm các mục `{ screen, id }`.
  - Mở chi tiết: đẩy `{screen, id}` hiện tại vào stack.
  - Nút ←: lấy lại mục trên cùng của stack.
  - Đổi tab: xoá stack.
- **Xếp hạng:** `seg` = 'Bài hát' | 'Nghệ sĩ' | **'Album'**; `period`. Khi `seg = 'Album'` thì bỏ qua `period`.
- **Nghệ sĩ All time:** `artistSort` = 'Giờ nghe' | 'Điểm' | 'Lượt'.
- **Diễn biến:** `boardKind` = 'Tuần' | 'Tháng' | 'Năm'; `boardExpanded`.
- **Tổng quan:** `overviewScope`; `openPoints` (index nghệ sĩ đang mở 8 thành phần); `top15Expanded`.
- **Thư viện:** `q`; `a25` (Tổng quan: mở đủ 25 nghệ sĩ theo giờ); màn mới `rules` (Quy tắc thay thế); `mergeRemaster` (bool); `remerging`.
  - Ghép bài: `pick{rowId: suggestionIndex}` và `matched{rowId: {plays, to}}`.
  - Sheet tìm bài: `findFor` (rowId) và `findQuery`.
- **Chung:** `chartSel{chartId: index}`, `shareSheetOpen`, `toast`.

## Quy ước hiển thị (prompt 10)
- **Thời lượng nghe:** dạng "Nd Nh Nm", bỏ phần bằng 0. Ví dụ 1.061 phút → "17h 41m"; 272,8 giờ → "11d 8h 48m"; 18 phút → "18m". Dùng cho Tổng ở trang bài, giờ nghệ sĩ, giờ album, dòng giá trị biểu đồ giờ. Trục biểu đồ giữ dạng ngắn "50h".
- **Không hiển thị lv** ở bất kỳ đâu: Top 100, Album, ảnh thẻ, trang bài. Trang bài còn 2 ô: Điểm /10 · Hạng All time. Server vẫn xếp theo mức.
- **Nút Chia sẻ** tạm ẩn ở Xếp hạng, trang bài và trang nghệ sĩ. Sheet và ảnh thẻ vẫn giữ trong code.
- **Bài đang lên hạng:** dưới số hạng có "▲n" (lastMonth.rise, không có thì rise). Đường hạng chỉ ghi 3 tháng gần nhất. Diễn biến hiện 6 bài kèm "Xem tất cả (n)", mở màn `rising` có ghi chú và đủ danh sách. Sắp theo ▲ giảm dần, bằng nhau thì hạng cao trước. Màn `rising` gọi `/history/songs?top=100&months=18`.
- **Nghệ sĩ đang lên:** ghi "#cũ → #mới", nhãn nhỏ "All time".
- **Top 1–3 theo kỳ:** chỉ còn dòng Nghệ sĩ, Bài và "50+ lượt" (kỳ tháng); bỏ dòng Album.
- **Top bài tháng này khi đang hiện tháng trước:** dòng phụ "Tháng trước · so với T08/26". MỚI = bài không có trong bảng của tháng liền trước.

## Dữ liệu từ server
- **Kết nối:** GET `${apiBase}${path}` với header `Authorization: Bearer ${apiToken}`. Thiết kế dùng token chỉ đọc.
- **Dùng chung kết quả:** `fetchJson` lưu kết quả theo path trong một Map, mọi điện thoại trên canvas dùng chung. Đã có kết quả thì không gọi lại, kể cả khi lần sau server lỗi. Timeout 12 giây.
- **Khi lỗi:** dùng số mẫu của màn đó, kèm chip "Dữ liệu mẫu · không kết nối được server". Lỗi 503 `{ error: "d1_daily_limit" }` thì chip ghi "Server tạm nghỉ đến 7:00 · đang hiện dữ liệu đã lưu / dữ liệu mẫu".
- **Kỳ rỗng:** kỳ rỗng (đầu tuần, đầu tháng) không tính là lỗi.
  - Hôm nay: hiện "Tháng M chưa có lượt nghe" kèm top 5 tháng trước, lấy từ `/charts/songs?window=month&asOf={ngày cuối tháng trước}&limit=5`.
  - Xếp hạng: hiện trạng thái trống, có nút "Chọn 1 tháng".
  - Tổng quan: có thêm chip tháng trước, biểu đồ ngày / thứ / giờ hiện trạng thái trống.
- **Bảng "Kiểm tra dữ liệu" trên canvas** (chỉ ở chế độ Server):
  - Mỗi path đã gọi một dòng: mã trả về · số dòng · ms.
  - Danh sách path cần kiểm tra mà chưa gọi, kèm nút "Gọi các path còn lại".
  - Các màn đang dùng số mẫu và lý do.

**Path theo từng màn** (mọi màn gọi thêm `/artwork` một lần mỗi phiên)
- **Hôm nay:** `/summary`, `/daily`, `/recent?limit=5`, `/artists/week?limit=5`, `/charts/songs?window=month&limit=5`. Tháng hiện tại rỗng thì gọi thêm `…&asOf=`.
- **Xếp hạng:**
  - Luôn gọi `/summary`.
  - `/charts/songs|artists?window=week|7d|month|1m|100d|ft0424|at&limit=50`. Nghệ sĩ có `tracks`, dòng phụ là "n bài". Bài hát ở at gọi thêm `/history/songs?top=100&months=18`.
  - Album: `/charts/albums?limit=50`.
  - Sheet chia sẻ: `/charts/songs?window=week&limit=10`.
- **Top 100:** `/history/songs?top=100&months=18`.
- **Nghệ sĩ All time:** `/artists/alltime?sort=hours|points|plays&limit=100` và `/charts/artists?window=at&limit=50` (lấy số bài cho dòng phụ).
- **Diễn biến:** `/history/songs?top=100&months=18`, `/history/artists?top=50&months=12`, `/board?kind=ww|mm|yy&limit=3`.
  - Nghệ sĩ đang lên lấy từ `rising[]` (period, rows: artist, rank, previous, rise, monthPlays, monthHours, monthRank). Bỏ qua nhóm rỗng.
- **Tổng quan:**
  - `/summary`, `/overview?scope=all|ft0424|YYYY|YYYY-MM|{tháng trước}`, `/release-years`. Phạm vi all gọi thêm `/points/artists`.
  - Sparkline của nghệ sĩ lấy từ `artists[].spark` (12 tháng theo `sparkMonths`).
  - `byDay.k` là ngày "YYYY-MM-DD"; `byWeekday.k` 0 = CN; `byHour.k` là giờ.
- **Thư viện:**
  - `/library`: đọc sync "lastfm" và sync "library" (`file_modified`, `added`, `missing`).
  - `/library/unmatched?limit=3`, `/library/title-rules`.
  - Tìm kiếm: `/library/search?q=&limit=15` (không phân biệt hoa thường và dấu), gọi sau 300 ms ngừng gõ, khi q có từ 2 ký tự.
- **Bài chưa khớp:** `/library`, `/library/unmatched?limit=50`.
- **Quy tắc thay thế:** `/library/title-rules` → `rules[]` (from_key, artist_key, track_id, title, artist). Chỉ xem, chạm mở bài.
- **Chi tiết bài:** `/song/:track_id`. `track.in_library = 0` thì hiện nhãn "Không còn trong thư viện".
- **Chi tiết nghệ sĩ:** `/artist/:tên`.

**Ảnh**: `/artwork` → `{ artists: {tên: url}, tracks: {track_id: url}, albums: {"nghệ sĩ\u001falbum": url} }`.
- Dùng ở mọi ô bìa/avatar: dòng xếp hạng, Vừa nghe, Top 100, Nghệ sĩ All time, Nghệ sĩ đang lên, Top 10 album, tìm kiếm, trang chi tiết (112 / 72) và ảnh thẻ chia sẻ (92).
- Ảnh dùng `<img loading="lazy">` với object-fit: cover. Không có url hoặc ảnh lỗi thì giữ ô chữ viết tắt.

**Nút đồng bộ** (hai POST duy nhất được gửi bằng token chỉ đọc, chỉ khi người dùng bấm hoặc kéo làm mới, không tự gọi khi mở app)
- **Last.fm:** nút "Đồng bộ" ở dòng Last.fm (Thư viện); kéo xuống để làm mới ở Hôm nay cũng gọi nút này.
  - Bấm gọi `POST /sync`. Trong lúc chờ, nút thành spinner "Đang đồng bộ…" và không bấm lại được.
  - `{ sync: { inserted } }`: toast "Đã cập nhật · +n lượt mới" (n = 0 thì "Không có lượt mới"). Sau đó xoá bộ nhớ tạm của /summary, /daily, /recent, /artists/week, /charts/* (week, 7d, month, 1m), /library và tải lại màn.
  - `{ skipped: true }`: toast "Vừa đồng bộ xong, thử lại sau 1 phút". Lỗi 503 `d1_daily_limit`: toast "Server tạm nghỉ đến 7:00".
- **Lịch tự đồng bộ Last.fm:** T2–T6 lúc 0h, 7h, 9h, 13h, 14h, 18h, 20h–23h; T7, CN lúc 0h, 2h, 7h, 9h, 11h–23h. Mỗi lần lấy lại hôm qua và hôm nay.
- **Thư viện Apple Music:** nút "Đồng bộ" ở dòng Apple Music.
  - Bấm gọi `POST /library/sync-request` → `{ status: "pending", requested_at }`. Trạng thái đọc từ `/library.libraryRequest` hoặc `GET /library/sync-request`.
  - pending: hiện "Đang chờ máy Mac… (gửi lúc HH:mm)". Khi màn Thư viện đang mở, hỏi lại GET mỗi 20 giây, tối đa 10 phút.
  - done: toast "Đã đồng bộ thư viện" (summary toàn 0 thì "Thư viện đã khớp, không có gì mới"), dòng "Lần đồng bộ gần nhất HH:mm dd/mm: +a bài mới · m bài không còn · c bài thay đổi". Xoá toàn bộ bộ nhớ tạm và tải lại.
  - Quá 10 phút vẫn pending: hiện "Máy Mac chưa nhận yêu cầu — kiểm tra máy Mac đang bật" kèm nút "Gửi lại".
- **Trên canvas:** spinner và toast chỉ hiện ở điện thoại bấm nút; kết quả tải lại dùng chung bộ nhớ. Bảng "Kiểm tra dữ liệu" có thêm hai dòng POST: lần bấm, mã trả về, kết quả.
- **State:** `lfmBusy`, `libBusy`, `ptoast` theo từng điện thoại; `LIBREQ` (trạng thái yêu cầu, poller) dùng chung.

**Ghép bài / đổi quy tắc:** token chỉ đọc nên thiết kế chỉ mô phỏng. App thật dùng `POST unmatched/:id/merge` và `POST settings` với APP_TOKEN.

## Design tokens
Chế độ sáng/tối theo Zalo (`getSystemInfo().zaloTheme` hoặc CSS `prefers-color-scheme`).

| Token | Tối | Sáng |
|---|---|---|
| --bg | #121110 | #F5F3EF |
| --surface | #1C1A17 | #FFFFFF |
| --surface2 | #2A2723 | #ECE9E3 |
| --line | rgba(255,240,220,.09) | rgba(40,25,10,.10) |
| --line2 | rgba(255,240,220,.20) | rgba(40,25,10,.18) |
| --bar (header/tab, blur 20) | rgba(20,19,17,.86) | rgba(248,246,242,.90) |
| --text | #F3EFE8 | #1B1916 |
| --text2 | #A8A196 | #6A645B |
| --text3 | #736D63 | #9A938A |
| --accent | oklch(0.80 0.10 80) | oklch(0.55 0.11 70) |
| --up | oklch(0.76 0.14 150) | oklch(0.55 0.14 150) |
| --down | oklch(0.69 0.17 25) | oklch(0.56 0.19 25) |
| --new | oklch(0.75 0.12 245) | oklch(0.53 0.15 250) |
| --ink (chữ trên accent) | #15130F | #FFFFFF |

8 màu biểu đồ `--c1…--c8`: oklch(L C H), tối L .72 C .11, sáng L .60 C .13, H = 80, 215, 25, 150, 300, 55, 185, 350.

**Chữ**: chữ hệ thống (`-apple-system, Roboto, system-ui`). Số lớn 48/700 (−1px); tiêu đề trang 17/600 (header Zalo); tiêu đề mục 19/700 (−0.3px); dòng chính 15/600; phụ 13/400; nhãn 11/600 hoa (+0.5px); trục biểu đồ 10px. Mọi số trong bảng/trục: `font-variant-numeric: tabular-nums`. Badge lv và đường hạng: monospace.

**Khoảng cách**: 4, 8, 12, 16, 20, 24, 32. Lề ngang thẻ 16, chữ tiêu đề mục 20. **Bo góc**: 6 (thumbnail), 12 (nhóm list, nút), 16 (thẻ), 20 (sheet). Viền phân cách 0.5px `--line`.

**Thay đổi hạng**: ▲n `--up` (kèm ^/^^/^^^ cho 1–2 / 3–4 / ≥5), ▼n `--down` (v), "–" `--text3`, "MỚI" `--new` (+). ★ `--accent` = nổi ở nhiều bảng. Badge lv: lv1–7 viền mờ, lv8–14 viền, lv15–19 nền `--surface2`, lv20 nền `--accent`.

## Assets
Không có ảnh thật. Ảnh bìa/avatar là ô giữ chỗ — dùng ảnh từ server (Last.fm / Apple Music artwork). Biểu tượng tab là hình giữ chỗ — thay bằng icon nét của ZaUI (`<Icon icon="zi-…">`): Hôm nay ~ zi-calendar, Xếp hạng ~ zi-list-1, Diễn biến ~ zi-poll, Tổng quan ~ zi-more-grid, Thư viện ~ zi-folder (chọn lại khi code).

## Files
- `So Nghe Nhac - Zalo Mini App.dc.html` — design system, mẫu ảnh thẻ chia sẻ, 14 màn hình × (tối, sáng) + kiểm tra khổ 360/430. Mọi điện thoại đều bấm được.
- `support.js` — runtime để mở file HTML ở trên.
