import { useRef, useState } from "react";
import { toPng } from "html-to-image";
import { openShareSheet, saveImageToGallery } from "zmp-sdk";
import { Sheet } from "zmp-ui";
import { Ctx, VM } from "@/vm";
import { Thumb } from "./ui";
import { IOS_APP } from "@/config";
import { shareImageDataUrlInNativeApp } from "@/lib/ios-bridge";

type Any = any;

// Ảnh thẻ 4:5, dựng ở 360 × 450, xuất 1080 × 1350.
export function ShareCard({ sc }: { sc: Any }) {
  const foot = <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 8 }}>Tạo từ Sổ Nghe Nhạc trên Zalo</div>;
  const head = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <div style={{ font: "700 11px var(--mono)", letterSpacing: 1.2, color: "var(--accent)" }}>SỔ NGHE NHẠC</div>
      <div className="num t3" style={{ fontSize: 11 }}>{sc.period}</div>
    </div>
  );
  return (
    <div style={{ width: 360, height: 450, padding: "24px 24px 18px", background: "var(--bg)", color: "var(--text)", display: "flex", flexDirection: "column", fontFamily: "-apple-system,BlinkMacSystemFont,Roboto,system-ui,sans-serif" }}>
      {head}
      {sc.isWeek ? (
        <>
          <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5, marginTop: 10 }}>{sc.title}</div>
          <div className="sub13" style={{ marginTop: 2 }}>{sc.sub}</div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 12, flex: 1 }}>
            {sc.rows.map((r: Any) => (
              <div key={r.rank} style={{ display: "grid", gridTemplateColumns: "22px minmax(0,1fr) auto", gap: 10, alignItems: "baseline", padding: "5px 0", borderTop: "0.5px solid var(--line)" }}>
                <div className="num" style={{ fontSize: 14, fontWeight: 700, textAlign: "right" }}>{r.rank}</div>
                <div className="ell" style={{ fontSize: 14 }}>
                  <span style={{ fontWeight: 600 }}>{r.title}</span>
                  <span className="t2"> · {r.artist}</span>
                </div>
                <div className="num t2" style={{ fontSize: 13 }}>{r.n}</div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 16 }}>
            <Thumb ini="" label="ảnh bìa" img={sc.img} size={92} style={{ borderRadius: 10, font: "500 10px var(--mono)", background: "repeating-linear-gradient(135deg,var(--surface2) 0 6px,var(--surface) 6px 7px)" }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.4, lineHeight: 1.15 }}>{sc.title}</div>
              <div className="t2" style={{ fontSize: 14, marginTop: 4 }}>{sc.sub}</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginTop: 18 }}>
            {sc.stats.map((s: Any, k: number) => (
              <div key={k} style={{ background: "var(--surface)", borderRadius: 12, padding: "12px 10px" }}>
                <div className="num" style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{s.v}</div>
                <div className="t2" style={{ fontSize: 11, marginTop: 5 }}>{s.l}</div>
              </div>
            ))}
          </div>
          <div className="lbl" style={{ marginTop: 18 }}>{sc.chartLabel}</div>
          <div style={{ marginTop: 10, flex: 1 }}>{sc.chart}</div>
        </>
      )}
      {foot}
    </div>
  );
}

const isZalo = () => /Zalo/i.test(navigator.userAgent);

export function ShareSheet({ vm, c }: { vm: VM; c: Ctx }) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const open = c.p.sheet;
  const toastThen = (msg: string, close = true) => {
    c.set(() => ({ toast: msg }));
    c.later(1100, () => c.set(() => ({ toast: "", ...(close ? { sheet: false } : {}) })));
  };
  const render = async () => {
    const node = ref.current;
    if (!node) throw new Error("no card");
    const bg = getComputedStyle(document.body).getPropertyValue("--bg").trim();
    const opts = { pixelRatio: 3, width: 360, height: 450, backgroundColor: bg || undefined, cacheBust: true };
    try {
      return await toPng(node, opts);
    } catch {
      // Ảnh bìa từ CDN không cho đọc chéo domain: xuất thẻ không kèm ảnh.
      return toPng(node, { ...opts, filter: (n) => (n as HTMLElement).tagName !== "IMG" });
    }
  };
  const save = async (dataUrl: string) => {
    if (IOS_APP && await shareImageDataUrlInNativeApp(dataUrl)) return;
    if (isZalo()) await saveImageToGallery({ imageBase64Data: dataUrl });
    else {
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = "so-nghe-nhac.png";
      a.click();
    }
  };
  const onSave = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await save(await render());
      toastThen("Đã lưu ảnh");
    } catch (e) {
      console.warn(e);
      toastThen("Không lưu được ảnh", false);
    } finally {
      setBusy(false);
    }
  };
  const onSend = async () => {
    if (busy) return;
    setBusy(true);
    let url = "";
    try {
      url = await render();
      if (!(IOS_APP && await shareImageDataUrlInNativeApp(url))) await openShareSheet({ type: "image", data: { imageUrls: [url] } });
      toastThen("Đã gửi");
    } catch (e) {
      // Một số bản Zalo chỉ nhận ảnh qua URL: lưu vào máy để người dùng tự gửi.
      console.warn(e);
      try {
        if (url) { await save(url); toastThen("Đã lưu ảnh, mở chat Zalo để gửi"); }
        else toastThen("Không tạo được ảnh", false);
      } catch {
        toastThen("Không gửi được ảnh", false);
      }
    } finally {
      setBusy(false);
    }
  };
  const sc = vm.shareCards[0];
  return (
    <>
      <Sheet className="app-sheet" visible={open} onClose={() => c.set(() => ({ sheet: false, toast: "" }))} autoHeight unmountOnClose>
        <div className="sheet-body" style={{ alignItems: "center" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 17, fontWeight: 600 }}>Chia sẻ ảnh thẻ</div>
            <div className="sub13" style={{ marginTop: 2 }}>Ảnh 4:5 gửi vào chat Zalo</div>
          </div>
          <div style={{ width: 224, height: 280, borderRadius: 12, overflow: "hidden", boxShadow: "0 0 0 0.5px var(--line2)" }}>
            <div style={{ width: 360, height: 450, transform: "scale(0.6222)", transformOrigin: "0 0" }}>
              <div ref={ref}>{sc && <ShareCard sc={sc} />}</div>
            </div>
          </div>
          <div style={{ width: "100%", display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)", gap: 10, opacity: busy ? 0.6 : 1 }}>
            <div onClick={onSave} style={{ height: 48, borderRadius: 12, background: "var(--surface2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Lưu ảnh</div>
            <div onClick={onSend} style={{ height: 48, borderRadius: 12, background: "var(--accent)", color: "var(--ink)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>Gửi vào chat Zalo</div>
          </div>
        </div>
      </Sheet>
      {open && c.p.toast && <div className="toast"><div>{c.p.toast}</div></div>}
    </>
  );
}

let fTimer: ReturnType<typeof setTimeout> | undefined;

export function FindSheet({ vm, c }: { vm: VM; c: Ctx }) {
  const close = () => c.set(() => ({ findK: null, fq: "", fqd: "" }));
  const onFq = (v: string) => {
    c.set(() => ({ fq: v }));
    clearTimeout(fTimer);
    fTimer = setTimeout(() => c.set(() => ({ fqd: v })), 300);
  };
  return (
    <Sheet className="app-sheet" visible={!!vm.findOpen} onClose={close} height="72%" unmountOnClose>
      <div className="sheet-body" style={{ gap: 10, height: "100%", paddingBottom: 0 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 600 }}>Tìm bài trong thư viện</div>
          <div className="sub13 pretty" style={{ marginTop: 2 }}>Ghép {vm.findTitle}</div>
        </div>
        <div className="search" style={{ flex: "none", paddingRight: 12 }}>
          <div className="dot" />
          <input value={c.p.fq} onChange={(e) => onFq(e.target.value)} placeholder="Tên bài hoặc nghệ sĩ" />
        </div>
        <div className="t2" style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 }}>{vm.findLabel}</div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", margin: "0 -16px", paddingBottom: 24 }}>
          {vm.fRes.map((r: Any, k: number) => (
            <div key={k} className="row" onClick={r.onTap} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px" }}>
              <Thumb ini={r.ini} img={r.img} />
              <div style={{ minWidth: 0 }}>
                <div className="title15 ell">{r.title}</div>
                <div className="sub13 ell">{r.artist}</div>
              </div>
            </div>
          ))}
          {vm.fNone && <div className="sub13" style={{ padding: "24px 16px", textAlign: "center" }}>Không tìm thấy bài nào.</div>}
        </div>
      </div>
    </Sheet>
  );
}
