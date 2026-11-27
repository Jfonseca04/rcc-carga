import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

/** Lee un QR con la cámara trasera. Funciona en Android y iPhone (no depende de BarcodeDetector). */
export function Escaner({ onLeido, onCerrar }: { onLeido: (texto: string) => void; onCerrar: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let vivo = true;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (!vivo || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const tick = () => {
          const v = video.current;
          if (!vivo || !v || !ctx) return;
          if (v.readyState === v.HAVE_ENOUGH_DATA) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            ctx.drawImage(v, 0, 0);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const qr = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
            if (qr?.data) {
              navigator.vibrate?.(80);
              onLeido(qr.data);
              return;
            }
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setError("No se pudo abrir la cámara. Revisá el permiso o tipeá la caravana.");
      }
    })();

    return () => {
      vivo = false;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach(t => t.stop());
    };
  }, [onLeido]);

  return (
    <div className="escaner">
      {error ? <p className="error">{error}</p> : <video ref={video} playsInline muted />}
      <div className="mira" aria-hidden />
      <button className="btn secundario" onClick={onCerrar}>Cancelar</button>
    </div>
  );
}
