import React from "react";
import { createPortal } from "react-dom";

interface AboutDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const AboutDialog: React.FC<AboutDialogProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={onClose}>
      <style>{`
        @keyframes modal-in {
          0% { opacity: 0; transform: scale(0.96) translateY(-8px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        .dialog-in { animation: modal-in 0.2s cubic-bezier(0.2, 0.8, 0.2, 1) forwards; }
      `}</style>
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
      <div className="dialog-in relative w-80 bg-black/40 backdrop-blur-2xl border border-white/10 rounded-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="p-6 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-pink-500 to-blue-500 flex items-center justify-center">
            <span className="text-2xl font-bold text-white">B</span>
          </div>
          <h3 className="text-white text-xl font-bold mb-1">BiliMusic</h3>
          <p className="text-white/40 text-xs mb-4">v1.0.0</p>
          <p className="text-white/60 text-sm leading-relaxed">
            Apple Music 风格桌面播放器<br />
            支持本地音乐 + B站音轨
          </p>
        </div>
        <div className="border-t border-white/10 bg-white/5 p-2">
          <button onClick={onClose}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white/80 hover:bg-white/10 transition-all">
            关闭
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default AboutDialog;
