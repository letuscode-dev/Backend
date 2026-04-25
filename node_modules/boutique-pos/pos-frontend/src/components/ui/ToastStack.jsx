import { useEffect, useRef, useState } from "react";
import { XIcon } from "../icons/Icons.jsx";

const TOAST_EVENT = "tone:toast";

function safeString(v) {
  if (v == null) return "";
  return typeof v === "string" ? v : String(v);
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function ToastStack() {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());

  const dismiss = (id) => {
    const t = timersRef.current.get(id);
    if (t) clearTimeout(t);
    timersRef.current.delete(id);
    setToasts((prev) => prev.filter((x) => x.id !== id));
  };

  const push = (detail) => {
    const message = safeString(detail?.message || "").trim();
    if (!message) return;

    const toast = {
      id: makeId(),
      type: safeString(detail?.type || "error") || "error",
      title: safeString(detail?.title || ""),
      message,
    };

    setToasts((prev) => [toast, ...prev].slice(0, 4));

    const timeoutMs = Number(detail?.timeoutMs) > 0 ? Number(detail.timeoutMs) : 12000;
    const t = setTimeout(() => dismiss(toast.id), timeoutMs);
    timersRef.current.set(toast.id, t);
  };

  useEffect(() => {
    const onToast = (e) => push(e?.detail);

    const onUnhandledRejection = (e) => {
      const reason = e?.reason;
      const message = safeString(reason?.message || reason || "Unhandled error");
      push({ type: "error", title: "Unhandled Error", message, timeoutMs: 15000 });
    };

    if (typeof window !== "undefined") {
      window.addEventListener(TOAST_EVENT, onToast);
      window.addEventListener("unhandledrejection", onUnhandledRejection);
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener(TOAST_EVENT, onToast);
        window.removeEventListener("unhandledrejection", onUnhandledRejection);
      }

      timersRef.current.forEach((t) => clearTimeout(t));
      timersRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack no-print" aria-live="polite" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <div className="toast-body">
            <div className="toast-title">{t.title || (t.type === "error" ? "Error" : "Notice")}</div>
            <div className="toast-message">{t.message}</div>
          </div>
          <button className="icon-btn sm" type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <XIcon className="nav-icon" />
          </button>
        </div>
      ))}
    </div>
  );
}

