# Watch Together

Chrome extension để nhiều người xem chung một tập phim trên animevietsub: khi một người play, pause hoặc tua, video của mọi người trong phòng làm theo. Có chat, nút Bật/Tắt đồng bộ và nút Resync để xử lý quảng cáo. Video không đi qua server nào, mỗi người tự mở trang phim; Firebase Realtime Database chỉ giữ trạng thái phòng.

Phần mở rộng: thư mục `web/` là một trang web xem chung YouTube (Vite + React + TypeScript, nhúng trình phát YouTube, đồng bộ cho cả phòng, có chat), deploy lên Vercel. Nó dùng chung project Firebase nhưng không đụng tới extension. Xem mục [Webapp YouTube](#webapp-youtube).

## Cấu trúc

```
watch-together/
  src/                    code nguồn, esbuild đóng gói vào extension/dist/
    background.js         service worker: kết nối Firebase, quản lý phòng, chuyển tin
    video.js              chạy ở mọi frame: dò video, bắt play/pause/tua, áp lệnh của phòng, sửa drift
    overlay.js            thanh nổi trên trang phim: Bật/Tắt, Resync, độ lệch, thành viên, chat
    popup.js              popup: nhập tên, tạo/vào/rời phòng, Bật/Tắt, Resync
    shared.js             hàm dùng chung (tính vị trí phòng, định dạng giờ)
    config.js             các ngưỡng đồng bộ, bật/tắt emulator
    firebase-config.js    config Firebase của bạn (không commit, tạo từ firebase-config.example.js)
  extension/              thư mục load vào Chrome (manifest, popup.html, popup.css, icons/, dist/)
  probe/                  extension dò video riêng (bước 1), không cần build
  docs/                   hướng dẫn cài cho người dùng (được đóng vào zip), kết quả dò video
  package.mjs             tạo file zip để gửi cho người khác (npm run package)
  database.rules.json     rules bảo mật cho Realtime Database
  firebase.json           cấu hình Firebase CLI và emulator
  test/                   trang phim giả + test tự động 2 trình duyệt (extension và webapp)
  web/                    webapp YouTube: Vite + React + TypeScript, deploy lên Vercel
    vite.config.ts        build ra web/dist/, chèn config Firebase từ biến môi trường
    src/components/       giao diện: Sảnh, Phòng, trình phát, thành viên, chat
    src/lib/              Firebase, phòng (nhánh ytRooms/), YouTube, SyncEngine (đồng bộ)
    src/hooks/            nối Firebase và SyncEngine vào React
  vercel.json             cho Vercel biết cách build webapp
```

## Cài đặt

Cần Node.js 18 trở lên và Chrome 116 trở lên.

### 1. Tạo project Firebase

1. Vào [Firebase Console](https://console.firebase.google.com), tạo project mới (không cần Google Analytics).
2. **Build → Realtime Database → Create database**, chọn vùng Singapore (`asia-southeast1`), chọn *Start in locked mode*.
3. **Build → Authentication → Get started → Sign-in method**, bật **Anonymous**.
4. **Project settings → Your apps → Web (</>)**, đăng ký app và chép đối tượng `firebaseConfig`.
5. Chép `src/firebase-config.example.js` thành `src/firebase-config.js` rồi thay các giá trị `DIEN_...` bằng config vừa chép. File này nằm trong `.gitignore` nên không bị đẩy lên GitHub. `databaseURL` lấy ở trang Realtime Database (dạng `https://<project>-default-rtdb.asia-southeast1.firebasedatabase.app`).
6. Đưa rules lên: vào **Realtime Database → Rules**, dán nội dung `database.rules.json` rồi bấm **Publish**. Hoặc dùng CLI: `npx firebase-tools login`, `npx firebase-tools use --add`, rồi `npm run deploy:rules`.

### 2. Build và cài extension

```bash
npm install
npm run build        # hoặc npm run watch khi đang sửa code
```

Mở `chrome://extensions`, bật **Developer mode**, bấm **Load unpacked** và chọn thư mục `extension/`. Mỗi lần build lại thì bấm nút tải lại (↻) của extension, rồi tải lại trang phim.

## Chia sẻ cho người không biết code

```bash
npm run package
```

Lệnh này build bản rút gọn và tạo `release/watch-together-v<version>.zip`, bên trong có sẵn `HUONG-DAN-CAI-DAT.html`. Gửi file zip đó là xong: người nhận chỉ cần giải nén, mở `chrome://extensions`, bật Chế độ dành cho nhà phát triển và bấm Tải tiện ích đã giải nén. Không cần git, Node.js hay build. Muốn ra bản mới thì tăng `version` trong `extension/manifest.json` rồi chạy lại lệnh.

Lệnh sẽ dừng nếu `src/firebase-config.js` chưa có hoặc còn giá trị `DIEN_...`, hoặc `USE_EMULATOR` đang bật.

## Cách dùng

1. Mở tập phim trên animevietsub.
2. Bấm icon extension, nhập tên, bấm **Tạo phòng cho tập đang mở**, rồi **Copy mã** gửi cho bạn bè.
3. Bạn bè mở cùng tập, nhập tên và mã phòng, bấm **Vào phòng**.
4. Mỗi người xem hết quảng cáo, khi phim thật đang chạy thì bấm **Đồng bộ: TẮT** (trên thanh nổi ở góc phải dưới, hoặc trong popup) để chuyển sang **BẬT**. Extension dò video lúc đó và nhảy về đúng vị trí của phòng.
5. Từ giờ ai play, pause hay tua thì mọi người đang Bật đều làm theo. Chat ở thanh nổi.
6. Gặp quảng cáo giữa chừng: extension tự Tắt khi thấy video ngắn hơn 2 phút thay vào. Xem xong quảng cáo thì bấm **Resync** (dò lại video và nhảy về vị trí phòng), hoặc bấm Bật lại.

Nếu Chrome chặn tự phát video, trên trình phát sẽ hiện nút **Bấm để đồng bộ**, bấm một lần là xong.

## Extension dò video (probe)

Trang ẩn video khi mở DevTools, nên dùng `probe/` để xem trình phát nằm ở đâu:

1. **Load unpacked** thư mục `probe/` (có thể tắt extension chính trong lúc dò).
2. Mở tập phim, bấm play, đợi vài giây.
3. Mở popup **Video Probe**: frame có video được tô xanh, kèm URL frame, `src`, `duration`, đường dẫn DOM, danh sách iframe con và URL media. Bấm **Copy JSON** để lưu lại.

Extension chính dùng `<all_urls>` cho `video.js` vì trình phát nằm trong iframe của domain khác. Khi biết domain trình phát, có thể thu hẹp `matches` và `host_permissions` trong `extension/manifest.json` cho đúng domain đó. Nếu animevietsub đổi tên miền, sửa `SITE_PATTERNS` trong `src/shared.js` và mục `overlay.js` trong `manifest.json`.

## Cách đồng bộ hoạt động

- Phòng lưu ở `rooms/{mã}` gồm `url`, `playback { paused, time, updatedAt, by }`, `members/{uid}`, `chat/`.
- Mỗi người đăng nhập ẩn danh để có `uid`. Khi ai đó play/pause/tua, `video.js` đợi 200 ms (gộp chuỗi sự kiện của một cú bấm) rồi ghi `playback` với `updatedAt = serverTimestamp()`.
- Vị trí phòng = `time + (giờ server hiện tại − updatedAt)` khi đang phát. Giờ server tính bằng `.info/serverTimeOffset`, nên mạng chậm vẫn khớp giây.
- **Chống lặp:** bỏ qua bản ghi có `by` là chính mình; khi áp lệnh của phòng, `video.js` nhớ trạng thái mong đợi trong 2 giây và không gửi lại các sự kiện mà chính nó gây ra.
- **Drift:** mỗi 5 giây so vị trí video với vị trí phòng. Lệch quá 1,5 giây thì tua lại, lệch 0,3 đến 1,5 giây thì chỉnh tốc độ 0,95x hoặc 1,05x cho tới khi khớp.
- Người vào sau đọc `playback` hiện tại rồi nhảy tới đúng chỗ. Khi đóng tab, `onDisconnect` tự xóa họ khỏi danh sách.

## Webapp YouTube

Trang web để xem chung YouTube, không cần cài gì: một người dán link YouTube và tạo phòng, gửi link mời (dạng `https://<trang>/#K7Q2XM`) cho bạn bè, ai play, pause, tua hay đổi video thì cả phòng làm theo.

### Chạy trên máy

```bash
npm install
npm run dev:web      # mở http://localhost:5173, sửa code là trang tự cập nhật
npm run build:web    # kiểm tra kiểu TypeScript rồi build ra web/dist/
npm run preview:web  # xem thử bản đã build
```

Config Firebase lấy từ `src/firebase-config.js` như extension. Muốn dùng config khác thì chép `web/.env.example` thành `web/.env.local` và điền các biến `FIREBASE_*` (file này không bị commit). Nhớ đưa `database.rules.json` mới lên Firebase (có thêm nhánh `ytRooms`), nếu không trang sẽ báo lỗi permission denied khi tạo phòng.

### Cài thành ứng dụng (PWA)

Webapp cài được như một ứng dụng: có icon riêng, mở trong cửa sổ riêng không có thanh địa chỉ.
- **Chrome, Edge, Android**: bấm **Cài ứng dụng** ở Sảnh (hoặc biểu tượng cài trên thanh địa chỉ).
- **iPhone**: mở bằng Safari, bấm Chia sẻ rồi chọn **Thêm vào MH chính**.

Service worker chỉ lưu sẵn file của webapp (HTML, JS, CSS, icon). YouTube và Firebase luôn cần mạng, nên vẫn không xem offline được; mất mạng thì trang hiện thanh báo. Sau mỗi lần deploy, ứng dụng hiện thanh **Có bản mới** với nút Tải lại thay vì tự tải lại giữa lúc đang xem.

PWA cần HTTPS (bản Vercel) hoặc `localhost`. Ở `npm run dev:web` service worker tắt; muốn thử PWA trên máy thì chạy `npm run build:web` rồi `npm run preview:web`.

### Deploy lên Vercel

1. Đưa rules mới lên: **Realtime Database → Rules**, dán nội dung `database.rules.json`, bấm **Publish** (hoặc `npm run deploy:rules`).
2. Push code lên GitHub. Vào [vercel.com/new](https://vercel.com/new), chọn repo `watch-together`, bấm **Import**.
3. Giữ **Root Directory** là thư mục gốc của repo (không chọn `web/`), vì `web/` dùng chung `src/config.js`, `src/shared.js` và `package.json` ở gốc. Các lệnh build đã có trong `vercel.json` nên không cần sửa gì ở Build Settings.
4. Mở **Environment Variables** và thêm 5 biến, lấy giá trị từ `src/firebase-config.js`:

   | Biến | Lấy từ |
   |---|---|
   | `FIREBASE_API_KEY` | `apiKey` |
   | `FIREBASE_AUTH_DOMAIN` | `authDomain` |
   | `FIREBASE_DATABASE_URL` | `databaseURL` |
   | `FIREBASE_PROJECT_ID` | `projectId` |
   | `FIREBASE_APP_ID` | `appId` |

5. Bấm **Deploy**. Từ giờ mỗi lần push lên `main`, Vercel tự build và deploy lại.

Config Firebase web không phải mật khẩu (trình duyệt nào mở trang cũng đọc được), quyền thật nằm ở rules và đăng nhập ẩn danh. Đặt vào biến môi trường chỉ để không phải commit file config.

### Cách đồng bộ trên YouTube

- Phòng lưu ở `ytRooms/{mã}` gồm `videoId`, `playback`, `members`, `chat`, cùng cách tính vị trí phòng như extension.
- Đồng bộ nằm trong lớp `SyncEngine` (`web/src/lib/sync-engine.ts`), không nằm trong state của React, nên React vẽ lại không làm trình phát bị gọi lặp. React chỉ đọc độ lệch, nút "Bấm để phát" và thông báo.
- YouTube không có sự kiện tua, nên trang đọc vị trí video mỗi 0,5 giây; nhảy quá 1,5 giây so với dự kiến thì coi là tua.
- Drift chỉ sửa bằng cách tua (lệch quá 1,5 giây), vì YouTube không cho chỉnh tốc độ lẻ như 1,05x.
- Mỗi tab là một người (đăng nhập ẩn danh theo tab), nên mở 2 tab trên cùng máy để thử cũng được.
- Video bị chủ kênh chặn nhúng sẽ báo "Video này không cho phép xem nhúng". Nếu trình duyệt chặn tự phát, trên video hiện nút **Bấm để phát cùng phòng**.
- Quảng cáo YouTube trong trình phát nhúng làm người đó chậm lại; xem xong bấm **Resync**.

## Test

Test tự động chạy 2 profile Chromium có cài extension, Firebase emulator và một trang phim giả (trang chính + trình phát trong iframe khác domain, tập 02 có quảng cáo 30 giây). Gồm 22 ca: tạo/vào phòng, mã sai, play, pause, tua, bấm liên tục không lặp, tắt đồng bộ, Resync, người vào sau, sửa drift, chat, thông báo hệ thống, từ chối Bật khi đang quảng cáo.

```bash
./test/make-media.sh                          # cần ffmpeg, tạo video giả
npx firebase-tools emulators:start --only auth,database --project demo-watch-together
# terminal khác:
npm install -D playwright && npx playwright install chromium
node test/e2e.mjs                             # trên Linux không có màn hình: xvfb-run node test/e2e.mjs
# kiểm tra một bản đã build sẵn (ví dụ thư mục giải nén từ zip, build với emulator):
WT_EXTENSION=đường/dẫn/thư-mục node test/e2e.mjs
# webapp YouTube (29 ca, trình phát YouTube giả chạy video thử, không cần mạng):
npm run test:web
```

Test webapp thay `https://www.youtube.com/iframe_api` bằng `test/web/fake-youtube-api.js` (cùng các hàm `YT.Player` mà app dùng, phát `movie.webm`) và kiểm tra: tạo phòng, link mời, mã sai, link sai, play, pause, tua khi dừng và khi đang phát, bấm liên tục, người vào sau, 2 tab cùng trình duyệt, rời phòng, drift, Resync, chat, đổi video, video chặn nhúng, và phần PWA (manifest, icon, service worker, nút Cài ứng dụng, dán link mời vào ô mã phòng, mở khi mất mạng).

## Giới hạn đã biết

- Khi bật toàn màn hình trong trình phát, thanh nổi (ở trang chính) bị che. Thoát toàn màn hình để chat.
- Chưa thử trên animevietsub thật: domain trình phát và cách trang thay video sau quảng cáo cần xác nhận bằng extension dò.
- Trang có thể phát hiện extension như đã phát hiện DevTools; nếu vậy cần xem lại cách gắn vào video.
- Phòng cũ không tự xóa, mỗi phòng chỉ vài KB nên không ảnh hưởng gói miễn phí.
